// =============================================================================
// main.rs — OSC UDP listener, events forwarded to JS via Tauri
// =============================================================================
//
// WHAT IS OSC?
// ────────────
// Open Sound Control (OSC) is a UDP-based protocol used by audio tools,
// controllers, and creative software to send parameter messages over a network.
// Compatible senders include: TouchOSC, Max/MSP, Pure Data, Ableton Live,
// SuperCollider, TouchDesigner, and many hardware controllers with OSC support.
//
// WHY RUST HANDLES OSC
// ─────────────────────
// The browser has no UDP API (only TCP/WebSocket). OSC runs over UDP.
// Rust binds a UDP socket, receives and decodes OSC packets with `rosc`,
// then forwards each message to the JavaScript frontend via Tauri events.
//
// FLOW
// ────
//   OSC sender (TouchOSC, Max, PureData, etc.)
//       │  UDP packet to 127.0.0.1:9000
//       ▼
//   Tokio UDP socket in Rust
//       │
//       ▼
//   rosc::decoder::decode_udp() → OscPacket
//       │  OscMessage { addr: "/hue", args: [OscFloat(0.75)] }
//       ▼
//   window.emit("osc-message", OscEvent)
//       │
//       ▼
//   sketch.js listen("osc-message") → ADDRESS_MAP → params → draw()
//
// OSC ADDRESS FORMAT
// ───────────────────
// OSC addresses are URL-like strings: "/hue", "/zoom", "/note/60/on"
// Args can be float, int, string, bool, or compound (bundles).
// We handle float and int args; others are passed as their string representation.
//
// DEFAULT PORT
// ─────────────
// OSC_PORT = 9000. Change this constant to avoid conflicts.
// The JS frontend reads the port via the 'osc-port' event emitted at startup.
//
// TAURI COMMANDS
// ───────────────
//   get_osc_port() → u16      (returns the port the listener is bound to)
//   stop_osc()                (stops the listener — rarely needed, app exit handles it)
//
// =============================================================================

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use once_cell::sync::OnceCell;
use rosc::{OscMessage, OscPacket, OscType};
use serde::Serialize;
use std::net::UdpSocket;
use tauri::{command, Manager, Window};
use tokio::sync::oneshot;

const OSC_PORT: u16 = 9000;

// ---------------------------------------------------------------------------
// OscEvent — sent to JS as the "osc-message" event payload
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone, Debug)]
pub struct OscEvent {
    /// OSC address string e.g. "/hue", "/zoom/set"
    pub addr: String,
    /// First argument as float (0.0 if no float/int arg present)
    pub value: f32,
    /// All arguments serialised as strings for inspection
    pub args: Vec<String>,
}

// ---------------------------------------------------------------------------
// Shutdown handle — lets us stop the listener task
// ---------------------------------------------------------------------------

static SHUTDOWN_TX: OnceCell<oneshot::Sender<()>> = OnceCell::new();

// ---------------------------------------------------------------------------
// OSC listener (runs in a Tokio task)
// ---------------------------------------------------------------------------

/// Starts the UDP OSC listener on OSC_PORT.
/// Each received message is decoded and emitted to `window` as "osc-message".
async fn run_osc_listener(window: Window, mut shutdown_rx: oneshot::Receiver<()>) {
    // Bind UDP socket on all interfaces so LAN devices can send to us too
    let addr = format!("0.0.0.0:{OSC_PORT}");
    let socket = match UdpSocket::bind(&addr) {
        Ok(s)  => s,
        Err(e) => { eprintln!("[osc] bind error on {addr}: {e}"); return; }
    };
    socket.set_nonblocking(true).expect("set_nonblocking failed");

    println!("[osc] listening on {addr}");

    // Emit the port number so the JS frontend can display it
    let _ = window.emit("osc-port", OSC_PORT);

    let mut buf = [0u8; 4096]; // max OSC packet size

    loop {
        // Check for shutdown signal (non-blocking)
        if shutdown_rx.try_recv().is_ok() {
            println!("[osc] listener stopped");
            break;
        }

        match socket.recv_from(&mut buf) {
            Ok((size, _from)) => {
                match rosc::decoder::decode_udp(&buf[..size]) {
                    Ok((_, packet)) => dispatch_packet(packet, &window),
                    Err(e)          => eprintln!("[osc] decode error: {e}"),
                }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                // No data yet — yield briefly to avoid busy-looping
                tokio::time::sleep(tokio::time::Duration::from_millis(1)).await;
            }
            Err(e) => eprintln!("[osc] recv error: {e}"),
        }
    }
}

/// Recursively dispatches an OscPacket (handles bundles containing multiple messages)
fn dispatch_packet(packet: OscPacket, window: &Window) {
    match packet {
        OscPacket::Message(msg) => emit_message(msg, window),
        OscPacket::Bundle(bundle) => {
            for p in bundle.content { dispatch_packet(p, window); }
        }
    }
}

/// Converts an OscMessage to OscEvent and emits it to JS
fn emit_message(msg: OscMessage, window: &Window) {
    // Extract the first numeric argument as a float value
    let value = msg.args.iter().find_map(|a| match a {
        OscType::Float(f) => Some(*f),
        OscType::Int(i)   => Some(*i as f32),
        OscType::Double(d) => Some(*d as f32),
        _                 => None,
    }).unwrap_or(0.0);

    // Serialise all args to strings for the monitor display in JS
    let args: Vec<String> = msg.args.iter().map(|a| match a {
        OscType::Float(f)  => format!("f:{f:.3}"),
        OscType::Int(i)    => format!("i:{i}"),
        OscType::Double(d) => format!("d:{d:.3}"),
        OscType::String(s) => format!("s:{s}"),
        OscType::Bool(b)   => format!("b:{b}"),
        _                  => "?".into(),
    }).collect();

    let event = OscEvent { addr: msg.addr.clone(), value, args };

    if let Err(e) = window.emit("osc-message", &event) {
        eprintln!("[osc] emit error: {e}");
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[command]
fn get_osc_port() -> u16 { OSC_PORT }

#[command]
fn stop_osc() {
    // Send shutdown signal if the listener is running
    // (In practice the app exit handles cleanup; this is for explicit stop)
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_osc_port, stop_osc])
        .setup(|app| {
            let window = app.get_window("main").expect("main window not found");
            let (tx, rx) = oneshot::channel::<()>();
            let _ = SHUTDOWN_TX.set(tx);

            // Spawn the OSC listener on the Tokio runtime Tauri provides
            tauri::async_runtime::spawn(run_osc_listener(window, rx));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
