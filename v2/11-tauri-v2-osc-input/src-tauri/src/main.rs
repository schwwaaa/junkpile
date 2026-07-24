#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use rosc::{OscMessage, OscPacket, OscType};
use serde::Serialize;
use std::{
    collections::BTreeSet,
    net::{IpAddr, SocketAddr, UdpSocket},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
struct OscState {
    runtime: Mutex<Option<OscRuntime>>,
}

struct OscRuntime {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
    info: ListenerInfo,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct ListenerInfo {
    running: bool,
    bind_address: String,
    port: u16,
    endpoint: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct OscArgument {
    kind: String,
    text: String,
    numeric: Option<f64>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct OscEvent {
    address: String,
    args: Vec<OscArgument>,
    numeric_value: Option<f64>,
    sender: String,
    timestamp_ms: u64,
    bundle_depth: u32,
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn osc_argument(value: &OscType) -> OscArgument {
    let (kind, text, numeric) = match value {
        OscType::Int(value) => ("int", value.to_string(), Some(*value as f64)),
        OscType::Float(value) => ("float", format!("{value:.5}"), Some(*value as f64)),
        OscType::Double(value) => ("double", format!("{value:.5}"), Some(*value)),
        OscType::Long(value) => ("long", value.to_string(), Some(*value as f64)),
        OscType::String(value) => ("string", value.clone(), None),
        OscType::Bool(value) => ("bool", value.to_string(), Some(if *value { 1.0 } else { 0.0 })),
        OscType::Nil => ("nil", "nil".to_string(), None),
        OscType::Blob(value) => ("blob", format!("{} bytes", value.len()), None),
        other => ("other", format!("{other:?}"), None),
    };

    OscArgument {
        kind: kind.to_string(),
        text,
        numeric,
    }
}

fn emit_message(message: OscMessage, app: &AppHandle, sender: SocketAddr, bundle_depth: u32) {
    let args = message.args.iter().map(osc_argument).collect::<Vec<_>>();
    let numeric_value = args.iter().find_map(|argument| argument.numeric);
    let event = OscEvent {
        address: message.addr,
        args,
        numeric_value,
        sender: sender.to_string(),
        timestamp_ms: now_millis(),
        bundle_depth,
    };

    if let Err(error) = app.emit("osc-event", event) {
        eprintln!("[osc] frontend event error: {error}");
    }
}

fn dispatch_packet(packet: OscPacket, app: &AppHandle, sender: SocketAddr, bundle_depth: u32) {
    match packet {
        OscPacket::Message(message) => emit_message(message, app, sender, bundle_depth),
        OscPacket::Bundle(bundle) => {
            for packet in bundle.content {
                dispatch_packet(packet, app, sender, bundle_depth.saturating_add(1));
            }
        }
    }
}

fn stop_runtime(mut runtime: OscRuntime) {
    runtime.stop.store(true, Ordering::Relaxed);
    if let Some(thread) = runtime.thread.take() {
        let _ = thread.join();
    }
}

fn stop_existing(state: &OscState) -> Result<(), String> {
    let previous = {
        let mut slot = state
            .runtime
            .lock()
            .map_err(|_| "OSC listener state is poisoned".to_string())?;
        slot.take()
    };

    if let Some(runtime) = previous {
        stop_runtime(runtime);
    }
    Ok(())
}

#[tauri::command]
fn start_osc_listener(
    bind_address: String,
    port: u16,
    app: AppHandle,
    state: State<'_, OscState>,
) -> Result<ListenerInfo, String> {
    if port == 0 {
        return Err("OSC port must be between 1 and 65535".to_string());
    }

    let ip = bind_address
        .parse::<IpAddr>()
        .map_err(|_| format!("'{bind_address}' is not a valid IP address"))?;
    let endpoint = SocketAddr::new(ip, port);

    stop_existing(&state)?;

    let socket = UdpSocket::bind(endpoint)
        .map_err(|error| format!("Could not bind OSC UDP listener to {endpoint}: {error}"))?;
    socket
        .set_read_timeout(Some(Duration::from_millis(80)))
        .map_err(|error| format!("Could not configure OSC socket timeout: {error}"))?;

    let actual = socket
        .local_addr()
        .map_err(|error| format!("Could not inspect OSC socket: {error}"))?;
    let info = ListenerInfo {
        running: true,
        bind_address: actual.ip().to_string(),
        port: actual.port(),
        endpoint: actual.to_string(),
    };

    let stop = Arc::new(AtomicBool::new(false));
    let thread_stop = Arc::clone(&stop);
    let thread_app = app.clone();
    let thread_info = info.clone();

    let listener_thread = thread::Builder::new()
        .name("junkpile-osc-listener".to_string())
        .spawn(move || {
            println!("[osc] listening on {}", thread_info.endpoint);
            let mut buffer = [0_u8; 65_535];

            while !thread_stop.load(Ordering::Relaxed) {
                match socket.recv_from(&mut buffer) {
                    Ok((size, sender)) => match rosc::decoder::decode_udp(&buffer[..size]) {
                        Ok((_, packet)) => dispatch_packet(packet, &thread_app, sender, 0),
                        Err(error) => {
                            let message = format!("Could not decode OSC packet from {sender}: {error}");
                            eprintln!("[osc] {message}");
                            let _ = thread_app.emit("osc-error", message);
                        }
                    },
                    Err(error)
                        if matches!(
                            error.kind(),
                            std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                        ) => {}
                    Err(error) => {
                        let message = format!("OSC receive error: {error}");
                        eprintln!("[osc] {message}");
                        let _ = thread_app.emit("osc-error", message);
                        break;
                    }
                }
            }

            println!("[osc] listener stopped on {}", thread_info.endpoint);
        })
        .map_err(|error| format!("Could not start OSC listener thread: {error}"))?;

    let runtime = OscRuntime {
        stop,
        thread: Some(listener_thread),
        info: info.clone(),
    };

    let mut slot = state
        .runtime
        .lock()
        .map_err(|_| "OSC listener state is poisoned".to_string())?;
    *slot = Some(runtime);
    Ok(info)
}

#[tauri::command]
fn stop_osc_listener(state: State<'_, OscState>) -> Result<(), String> {
    stop_existing(&state)
}

#[tauri::command]
fn get_osc_status(state: State<'_, OscState>) -> Result<ListenerInfo, String> {
    let slot = state
        .runtime
        .lock()
        .map_err(|_| "OSC listener state is poisoned".to_string())?;

    Ok(slot
        .as_ref()
        .map(|runtime| runtime.info.clone())
        .unwrap_or(ListenerInfo {
            running: false,
            bind_address: String::new(),
            port: 0,
            endpoint: String::new(),
        }))
}

#[tauri::command]
fn get_network_hints(port: u16) -> Vec<String> {
    let mut endpoints = BTreeSet::new();
    endpoints.insert(format!("127.0.0.1:{port}"));

    for target in ["8.8.8.8:80", "1.1.1.1:80"] {
        if let Ok(socket) = UdpSocket::bind("0.0.0.0:0") {
            if socket.connect(target).is_ok() {
                if let Ok(address) = socket.local_addr() {
                    if !address.ip().is_loopback() {
                        endpoints.insert(format!("{}:{port}", address.ip()));
                    }
                }
            }
        }
    }

    endpoints.into_iter().collect()
}

#[tauri::command]
fn send_test_osc(port: u16, address: String, value: f32) -> Result<usize, String> {
    if port == 0 {
        return Err("Start the OSC listener before sending a test message".to_string());
    }
    if !address.starts_with('/') {
        return Err("OSC addresses must begin with '/'".to_string());
    }

    let packet = OscPacket::Message(OscMessage {
        addr: address,
        args: vec![OscType::Float(value)],
    });
    let encoded = rosc::encoder::encode(&packet)
        .map_err(|error| format!("Could not encode OSC test packet: {error}"))?;
    let socket = UdpSocket::bind("127.0.0.1:0")
        .map_err(|error| format!("Could not create OSC test socket: {error}"))?;
    socket
        .send_to(&encoded, ("127.0.0.1", port))
        .map_err(|error| format!("Could not send OSC test packet: {error}"))
}

fn main() {
    tauri::Builder::default()
        .manage(OscState::default())
        .invoke_handler(tauri::generate_handler![
            start_osc_listener,
            stop_osc_listener,
            get_osc_status,
            get_network_hints,
            send_test_osc,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
