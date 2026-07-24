#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use midir::{Ignore, MidiInput, MidiInputConnection};
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
struct MidiState {
    connection: Mutex<Option<MidiInputConnection<()>>>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct MidiEvent {
    kind: String,
    channel: u8,
    data1: u8,
    data2: u8,
    value: f32,
    pitch_bend: i16,
    timestamp_micros: u64,
    raw: Vec<u8>,
}

fn parse_midi(timestamp_micros: u64, bytes: &[u8]) -> MidiEvent {
    let status = bytes.first().copied().unwrap_or(0);
    let data1 = bytes.get(1).copied().unwrap_or(0);
    let data2 = bytes.get(2).copied().unwrap_or(0);
    let message_type = status & 0xF0;
    let channel = (status & 0x0F) + 1;

    let (kind, normalized_data1, normalized_data2, value, pitch_bend) = match message_type {
        0x90 if data2 > 0 => (
            "note_on".to_string(),
            data1,
            data2,
            data2 as f32 / 127.0,
            0,
        ),
        0x80 | 0x90 => ("note_off".to_string(), data1, data2, 0.0, 0),
        0xB0 => (
            "cc".to_string(),
            data1,
            data2,
            data2 as f32 / 127.0,
            0,
        ),
        0xE0 => {
            let raw14 = ((data2 as u16) << 7) | data1 as u16;
            let signed = raw14 as i32 - 8192;
            let normalized = (signed as f32 / 8192.0).clamp(-1.0, 1.0);
            (
                "pitch_bend".to_string(),
                data1,
                data2,
                normalized,
                signed as i16,
            )
        }
        0xA0 => (
            "poly_aftertouch".to_string(),
            data1,
            data2,
            data2 as f32 / 127.0,
            0,
        ),
        0xC0 => (
            "program_change".to_string(),
            data1,
            0,
            data1 as f32 / 127.0,
            0,
        ),
        0xD0 => (
            "channel_pressure".to_string(),
            data1,
            0,
            data1 as f32 / 127.0,
            0,
        ),
        0xF0 => ("system".to_string(), data1, data2, 0.0, 0),
        _ => ("unknown".to_string(), data1, data2, 0.0, 0),
    };

    MidiEvent {
        kind,
        channel,
        data1: normalized_data1,
        data2: normalized_data2,
        value,
        pitch_bend,
        timestamp_micros,
        raw: bytes.to_vec(),
    }
}

fn available_ports(client_name: &str) -> Result<Vec<String>, String> {
    let midi = MidiInput::new(client_name).map_err(|error| error.to_string())?;
    Ok(midi
        .ports()
        .iter()
        .map(|port| {
            midi.port_name(port)
                .unwrap_or_else(|_| "<unnamed MIDI input>".to_string())
        })
        .collect())
}

#[tauri::command]
fn list_midi_ports() -> Result<Vec<String>, String> {
    let ports = available_ports("junkpile-v2-midi-list")?;
    println!("[midi] {} input port(s): {ports:?}", ports.len());
    Ok(ports)
}

#[tauri::command]
fn debug_midi_ports() -> String {
    match available_ports("junkpile-v2-midi-debug") {
        Ok(ports) if ports.is_empty() => {
            let message = "[midi debug] No MIDI inputs are visible. On macOS, open Audio MIDI Setup → MIDI Studio. Enable IAC Driver for virtual MIDI.";
            eprintln!("{message}");
            message.to_string()
        }
        Ok(ports) => {
            let lines = ports
                .iter()
                .enumerate()
                .map(|(index, name)| format!("  [{index}] {name}"))
                .collect::<Vec<_>>()
                .join("\n");
            let message = format!("[midi debug] {} input port(s):\n{lines}", ports.len());
            println!("{message}");
            message
        }
        Err(error) => {
            let message = format!("[midi debug] Could not initialize MIDI: {error}");
            eprintln!("{message}");
            message
        }
    }
}

#[tauri::command]
fn connect_midi_port_by_name(
    port_name: String,
    app: AppHandle,
    state: State<'_, MidiState>,
) -> Result<String, String> {
    {
        let mut connection = state
            .connection
            .lock()
            .map_err(|_| "MIDI connection state is poisoned".to_string())?;
        connection.take();
    }

    let mut midi = MidiInput::new("junkpile-v2-midi-input").map_err(|error| error.to_string())?;
    midi.ignore(Ignore::None);
    let ports = midi.ports();

    let exact = ports
        .iter()
        .position(|port| midi.port_name(port).ok().as_deref() == Some(port_name.as_str()));
    let fuzzy = exact.or_else(|| {
        let needle = port_name.to_lowercase();
        ports.iter().position(|port| {
            midi.port_name(port)
                .map(|name| name.to_lowercase().contains(&needle))
                .unwrap_or(false)
        })
    });

    let port_index = fuzzy.ok_or_else(|| {
        let names = ports
            .iter()
            .filter_map(|port| midi.port_name(port).ok())
            .collect::<Vec<_>>();
        format!("MIDI input '{port_name}' was not found. Available inputs: {names:?}")
    })?;

    let port = ports
        .get(port_index)
        .ok_or_else(|| "MIDI port disappeared before connection".to_string())?;
    let resolved_name = midi
        .port_name(port)
        .unwrap_or_else(|_| port_name.clone());
    let event_app = app.clone();

    let connection = midi
        .connect(
            port,
            "junkpile-v2-midi-connection",
            move |timestamp, bytes, _| {
                let event = parse_midi(timestamp, bytes);
                if let Err(error) = event_app.emit("midi-event", event) {
                    eprintln!("[midi] frontend event error: {error}");
                }
            },
            (),
        )
        .map_err(|error| error.to_string())?;

    let mut slot = state
        .connection
        .lock()
        .map_err(|_| "MIDI connection state is poisoned".to_string())?;
    *slot = Some(connection);
    println!("[midi] connected to {resolved_name}");
    Ok(resolved_name)
}

#[tauri::command]
fn disconnect_midi(state: State<'_, MidiState>) -> Result<(), String> {
    let mut connection = state
        .connection
        .lock()
        .map_err(|_| "MIDI connection state is poisoned".to_string())?;
    connection.take();
    println!("[midi] disconnected");
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .manage(MidiState::default())
        .invoke_handler(tauri::generate_handler![
            list_midi_ports,
            debug_midi_ports,
            connect_midi_port_by_name,
            disconnect_midi,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
