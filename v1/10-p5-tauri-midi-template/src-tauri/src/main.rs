#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use midir::{Ignore, MidiInput, MidiInputConnection};
use once_cell::sync::Lazy;
use serde::Serialize;
use std::sync::{Arc, Mutex};
use tauri::{command, Window};

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

struct MidiState {
    connection: Option<MidiInputConnection<()>>,
    port_name: Option<String>,
}

static MIDI_STATE: Lazy<Mutex<MidiState>> = Lazy::new(|| {
    Mutex::new(MidiState {
        connection: None,
        port_name: None,
    })
});

fn parse_midi(timestamp_micros: u64, bytes: &[u8]) -> MidiEvent {
    let status = bytes.first().copied().unwrap_or(0);
    let data1 = bytes.get(1).copied().unwrap_or(0);
    let data2 = bytes.get(2).copied().unwrap_or(0);
    let message_type = status & 0xF0;
    let channel = (status & 0x0F) + 1;

    match message_type {
        0x90 if data2 > 0 => MidiEvent {
            kind: "note_on".into(),
            channel,
            data1,
            data2,
            value: data2 as f32 / 127.0,
            pitch_bend: 0,
            timestamp_micros,
            raw: bytes.to_vec(),
        },
        0x80 | 0x90 => MidiEvent {
            kind: "note_off".into(),
            channel,
            data1,
            data2,
            value: data2 as f32 / 127.0,
            pitch_bend: 0,
            timestamp_micros,
            raw: bytes.to_vec(),
        },
        0xB0 => MidiEvent {
            kind: "cc".into(),
            channel,
            data1,
            data2,
            value: data2 as f32 / 127.0,
            pitch_bend: 0,
            timestamp_micros,
            raw: bytes.to_vec(),
        },
        0xE0 => {
            let raw14 = ((data2 as u16) << 7) | data1 as u16;
            let bend = raw14 as i32 - 8192;
            MidiEvent {
                kind: "pitch_bend".into(),
                channel,
                data1,
                data2,
                value: (bend as f32 / 8192.0).clamp(-1.0, 1.0),
                pitch_bend: bend as i16,
                timestamp_micros,
                raw: bytes.to_vec(),
            }
        }
        0xA0 => MidiEvent {
            kind: "poly_aftertouch".into(),
            channel,
            data1,
            data2,
            value: data2 as f32 / 127.0,
            pitch_bend: 0,
            timestamp_micros,
            raw: bytes.to_vec(),
        },
        0xC0 => MidiEvent {
            kind: "program_change".into(),
            channel,
            data1,
            data2: 0,
            value: data1 as f32 / 127.0,
            pitch_bend: 0,
            timestamp_micros,
            raw: bytes.to_vec(),
        },
        0xD0 => MidiEvent {
            kind: "channel_pressure".into(),
            channel,
            data1,
            data2: 0,
            value: data1 as f32 / 127.0,
            pitch_bend: 0,
            timestamp_micros,
            raw: bytes.to_vec(),
        },
        _ => MidiEvent {
            kind: "unknown".into(),
            channel,
            data1,
            data2,
            value: data2 as f32 / 127.0,
            pitch_bend: 0,
            timestamp_micros,
            raw: bytes.to_vec(),
        },
    }
}

#[command]
fn list_midi_ports() -> Result<Vec<String>, String> {
    let midi = MidiInput::new("junkpile-midi-list").map_err(|error| error.to_string())?;
    Ok(midi
        .ports()
        .iter()
        .filter_map(|port| midi.port_name(port).ok())
        .collect())
}

#[command]
fn debug_midi_ports() -> Result<String, String> {
    let midi = MidiInput::new("junkpile-midi-debug").map_err(|error| error.to_string())?;
    let ports = midi.ports();
    if ports.is_empty() {
        return Ok("No MIDI inputs found. On macOS, open Audio MIDI Setup → MIDI Studio. Enable IAC Driver for virtual MIDI from Max, Pure Data, or another application.".into());
    }

    let lines = ports
        .iter()
        .enumerate()
        .map(|(index, port)| {
            let name = midi.port_name(port).unwrap_or_else(|_| "<unknown>".into());
            format!("[{index}] {name}")
        })
        .collect::<Vec<_>>()
        .join("\n");

    Ok(format!("{} MIDI input(s):\n{}", ports.len(), lines))
}

#[command]
fn connect_midi_port_by_name(port_name: String, window: Window) -> Result<String, String> {
    {
        let mut state = MIDI_STATE.lock().map_err(|_| "MIDI state lock failed".to_string())?;
        state.connection = None;
        state.port_name = None;
    }

    let mut midi = MidiInput::new("junkpile-midi-input").map_err(|error| error.to_string())?;
    midi.ignore(Ignore::None);
    let ports = midi.ports();
    let lowered = port_name.to_lowercase();

    let port = ports
        .iter()
        .find(|port| midi.port_name(port).ok().as_deref() == Some(port_name.as_str()))
        .or_else(|| {
            ports.iter().find(|port| {
                midi.port_name(port)
                    .map(|name| name.to_lowercase().contains(&lowered))
                    .unwrap_or(false)
            })
        })
        .ok_or_else(|| {
            let available = ports
                .iter()
                .filter_map(|port| midi.port_name(port).ok())
                .collect::<Vec<_>>();
            format!("MIDI input '{port_name}' was not found. Available inputs: {available:?}")
        })?;

    let resolved_name = midi.port_name(port).unwrap_or(port_name);
    let event_window = Arc::new(window);
    let connection = midi
        .connect(
            port,
            "junkpile-midi-connection",
            move |timestamp, bytes, _| {
                let event = parse_midi(timestamp, bytes);
                if let Err(error) = event_window.emit("midi-event", event) {
                    eprintln!("[midi] event emit failed: {error}");
                }
            },
            (),
        )
        .map_err(|error| error.to_string())?;

    let mut state = MIDI_STATE.lock().map_err(|_| "MIDI state lock failed".to_string())?;
    state.connection = Some(connection);
    state.port_name = Some(resolved_name.clone());
    println!("[midi] connected to {resolved_name}");
    Ok(resolved_name)
}

#[command]
fn disconnect_midi() -> Result<(), String> {
    let mut state = MIDI_STATE.lock().map_err(|_| "MIDI state lock failed".to_string())?;
    state.connection = None;
    state.port_name = None;
    println!("[midi] disconnected");
    Ok(())
}

#[command]
fn midi_connection_name() -> Result<Option<String>, String> {
    let state = MIDI_STATE.lock().map_err(|_| "MIDI state lock failed".to_string())?;
    Ok(state.port_name.clone())
}

#[command]
fn toggle_fullscreen(window: Window) -> Result<bool, String> {
    let next = !window.is_fullscreen().map_err(|error| error.to_string())?;
    window
        .set_fullscreen(next)
        .map_err(|error| error.to_string())?;
    Ok(next)
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            list_midi_ports,
            debug_midi_ports,
            connect_midi_port_by_name,
            disconnect_midi,
            midi_connection_name,
            toggle_fullscreen,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Junkpile V1 Example 10");
}
