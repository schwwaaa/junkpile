#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use midir::{Ignore, MidiInput, MidiInputConnection};
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
struct MidiState { connection: Mutex<Option<MidiInputConnection<()>>> }

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct MidiEvent {
    kind: String, channel: u8, data1: u8, data2: u8, value: f32,
    pitch_bend: i16, timestamp_micros: u64, raw: Vec<u8>,
}

fn parse_midi(timestamp_micros: u64, bytes: &[u8]) -> MidiEvent {
    let status = bytes.first().copied().unwrap_or(0);
    let data1 = bytes.get(1).copied().unwrap_or(0);
    let data2 = bytes.get(2).copied().unwrap_or(0);
    let message_type = status & 0xF0;
    let channel = (status & 0x0F) + 1;
    let (kind, value, pitch_bend) = match message_type {
        0x90 if data2 > 0 => ("note_on", data2 as f32 / 127.0, 0),
        0x80 | 0x90 => ("note_off", 0.0, 0),
        0xB0 => ("cc", data2 as f32 / 127.0, 0),
        0xE0 => {
            let raw14 = ((data2 as u16) << 7) | data1 as u16;
            let signed = raw14 as i32 - 8192;
            ("pitch_bend", (signed as f32 / 8192.0).clamp(-1.0, 1.0), signed as i16)
        }
        0xA0 => ("poly_aftertouch", data2 as f32 / 127.0, 0),
        0xC0 => ("program_change", data1 as f32 / 127.0, 0),
        0xD0 => ("channel_pressure", data1 as f32 / 127.0, 0),
        0xF0 => ("system", 0.0, 0),
        _ => ("unknown", 0.0, 0),
    };
    MidiEvent { kind: kind.into(), channel, data1, data2, value, pitch_bend, timestamp_micros, raw: bytes.to_vec() }
}

fn available_ports(client_name: &str) -> Result<Vec<String>, String> {
    let midi = MidiInput::new(client_name).map_err(|e| e.to_string())?;
    Ok(midi.ports().iter().map(|p| midi.port_name(p).unwrap_or_else(|_| "<unnamed MIDI input>".into())).collect())
}

#[tauri::command]
fn list_midi_ports() -> Result<Vec<String>, String> { available_ports("junkpile-v2-midi-list") }

#[tauri::command]
fn debug_midi_ports() -> String {
    match available_ports("junkpile-v2-midi-debug") {
        Ok(ports) if ports.is_empty() => "No MIDI inputs are visible. On macOS, enable IAC Driver in Audio MIDI Setup for virtual MIDI.".into(),
        Ok(ports) => format!("{} input port(s):\n{}", ports.len(), ports.iter().enumerate().map(|(i,n)| format!("  [{i}] {n}")).collect::<Vec<_>>().join("\n")),
        Err(error) => format!("Could not initialize MIDI: {error}"),
    }
}

#[tauri::command]
fn connect_midi_port_by_name(port_name: String, app: AppHandle, state: State<'_, MidiState>) -> Result<String, String> {
    state.connection.lock().map_err(|_| "MIDI state is poisoned".to_string())?.take();
    let mut midi = MidiInput::new("junkpile-v2-midi-input").map_err(|e| e.to_string())?;
    midi.ignore(Ignore::None);
    let ports = midi.ports();
    let index = ports.iter().position(|p| midi.port_name(p).ok().as_deref() == Some(port_name.as_str()))
        .or_else(|| { let needle=port_name.to_lowercase(); ports.iter().position(|p| midi.port_name(p).map(|n| n.to_lowercase().contains(&needle)).unwrap_or(false)) })
        .ok_or_else(|| format!("MIDI input '{port_name}' was not found"))?;
    let port = ports.get(index).ok_or_else(|| "MIDI port disappeared before connection".to_string())?;
    let resolved_name = midi.port_name(port).unwrap_or(port_name);
    let event_app = app.clone();
    let connection = midi.connect(port, "junkpile-v2-midi-connection", move |timestamp, bytes, _| {
        let _ = event_app.emit("midi-event", parse_midi(timestamp, bytes));
    }, ()).map_err(|e| e.to_string())?;
    *state.connection.lock().map_err(|_| "MIDI state is poisoned".to_string())? = Some(connection);
    Ok(resolved_name)
}

#[tauri::command]
fn disconnect_midi(state: State<'_, MidiState>) -> Result<(), String> {
    state.connection.lock().map_err(|_| "MIDI state is poisoned".to_string())?.take();
    Ok(())
}

#[tauri::command]
fn toggle_fullscreen(app: AppHandle) -> Result<bool, String> {
    let window=app.get_webview_window("main").ok_or("Main window unavailable")?;
    let next=!window.is_fullscreen().map_err(|e|e.to_string())?;
    window.set_fullscreen(next).map_err(|e|e.to_string())?; Ok(next)
}

fn main() {
    tauri::Builder::default().manage(MidiState::default())
      .invoke_handler(tauri::generate_handler![list_midi_ports, debug_midi_ports, connect_midi_port_by_name, disconnect_midi, toggle_fullscreen])
      .run(tauri::generate_context!()).expect("error while running Tauri application");
}
