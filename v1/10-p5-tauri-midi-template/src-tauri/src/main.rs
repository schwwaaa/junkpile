// =============================================================================
// main.rs — MIDI input via midir, events forwarded to JS via Tauri
// =============================================================================
//
// WHY MIDI GOES THROUGH RUST
// ───────────────────────────
// The Web MIDI API (navigator.requestMIDIAccess) does NOT work inside Tauri's
// WebView — WKWebView/WebView2/WebKitGTK don't grant MIDI access.
// We use the `midir` crate (CoreMIDI/ALSA/WinMM) in Rust instead, then
// forward each message to JavaScript via Tauri's window.emit() event system.
//
// FLOW
// ────
//   MIDI device → midir callback → parse_midi() → window.emit("midi-event")
//   → JS listen("midi-event") → params[cc] = value → draw() → shader
//
// TAURI COMMANDS (invoke from JS)
// ───────────────────────────────
//   list_midi_ports()                    → Vec<String>
//   connect_midi_port(port_index: usize) → Result<(), String>
//   disconnect_midi()                    → ()
//
// MIDI MESSAGE FORMAT (raw bytes)
//   [status, data1, data2]
//   status high nibble = type: 0x80=NoteOff 0x90=NoteOn 0xB0=CC 0xE0=PitchBend
//   status low  nibble = channel (0-15, we display as 1-16)
// =============================================================================

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use midir::{MidiInput, MidiInputConnection};
use serde::Serialize;
use std::sync::{Arc, Mutex};
use tauri::{command, Window};

// ---------------------------------------------------------------------------
// MidiEvent — serialised and sent to JS as the "midi-event" event payload
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone, Debug)]
pub struct MidiEvent {
    /// "note_on" | "note_off" | "cc" | "pitch_bend" | "aftertouch" |
    /// "program_change" | "pressure" | "unknown"
    pub kind: String,
    /// MIDI channel 1–16
    pub channel: u8,
    /// note number (note_on/off), CC number (cc), or 0
    pub data1: u8,
    /// velocity (note), CC value (cc), normalised pitch bend, or 0
    pub data2: u8,
    /// data2 / 127.0 — direct GLSL uniform value
    pub value: f32,
    /// raw bytes as received
    pub raw: Vec<u8>,
}

// ---------------------------------------------------------------------------
// Global connection — kept alive until disconnect or new connect
// ---------------------------------------------------------------------------

type MidiConn = Option<MidiInputConnection<()>>;

// std::sync::Mutex doesn't have const_new; use once_cell's Lazy instead
static MIDI_CONN: once_cell::sync::Lazy<Mutex<Option<MidiConn>>> =
    once_cell::sync::Lazy::new(|| Mutex::new(None));

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

fn parse_midi(bytes: &[u8]) -> MidiEvent {
    let status   = bytes.get(0).copied().unwrap_or(0);
    let data1    = bytes.get(1).copied().unwrap_or(0);
    let data2    = bytes.get(2).copied().unwrap_or(0);
    let msg_type = status & 0xF0;
    let channel  = (status & 0x0F) + 1;

    let (kind, d1, d2): (String, u8, u8) = match msg_type {
        0x90 if data2 > 0 => ("note_on".into(),       data1, data2),
        0x80 | 0x90       => ("note_off".into(),       data1, data2),
        0xB0              => ("cc".into(),              data1, data2),
        0xE0 => {
            let raw14 = (data2 as u16) << 7 | data1 as u16;
            let norm  = (raw14 as f32 / 16383.0 * 127.0) as u8;
            ("pitch_bend".into(), 0, norm)
        }
        0xA0 => ("aftertouch".into(),     data1, data2),
        0xC0 => ("program_change".into(), data1, 0),
        0xD0 => ("pressure".into(),       data1, 0),
        _    => ("unknown".into(),        data1, data2),
    };

    MidiEvent { kind, channel, data1: d1, data2: d2, value: d2 as f32 / 127.0, raw: bytes.to_vec() }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Returns all available MIDI input port names.
/// Creates a fresh MidiInput each call so virtual ports created after app
/// launch (Max/MSP, Pure Data, IAC Bus) are always included.
/// Each name is returned as-is from CoreMIDI — use it directly in connect_midi_port.
#[command]
fn list_midi_ports() -> Vec<String> {
    match MidiInput::new("p5-tauri-list") {
        Ok(m) => {
            let ports = m.ports();
            let names: Vec<String> = ports.iter()
                .filter_map(|p| m.port_name(p).ok())
                .collect();
            println!("[midi] found {} port(s): {:?}", names.len(), names);
            names
        }
        Err(e) => { eprintln!("[midi] list error: {e}"); vec![] }
    }
}

/// Prints all visible MIDI ports to the terminal — call this from JS if
/// list_midi_ports() returns nothing. Useful to confirm what CoreMIDI sees.
/// JS: await invoke('debug_midi_ports')
#[command]
fn debug_midi_ports() -> String {
    match MidiInput::new("p5-tauri-debug") {
        Ok(m) => {
            let ports = m.ports();
            if ports.is_empty() {
                let msg = "[midi debug] No MIDI ports found. Check Audio MIDI Setup.app — \
                           is your device listed? Is IAC Driver enabled if using virtual ports?";
                eprintln!("{msg}");
                return msg.to_string();
            }
            let lines: Vec<String> = ports.iter().enumerate()
                .map(|(i, p)| {
                    let name = m.port_name(p).unwrap_or_else(|_| "<unknown>".into());
                    format!("  [{i}] {name}")
                })
                .collect();
            let out = format!("[midi debug] {} port(s):\n{}", ports.len(), lines.join("\n"));
            println!("{out}");
            out
        }
        Err(e) => format!("[midi debug] MidiInput::new failed: {e}")
    }
}

/// Connect to a MIDI port by NAME (not index).
/// Connecting by name avoids the stale-index race: if the port list changes
/// between the JS refresh call and the connect call, the right port is still found.
///
/// JS usage: await invoke('connect_midi_port_by_name', { portName: "nanoKONTROL" })
#[command]
fn connect_midi_port_by_name(port_name: String, window: Window) -> Result<(), String> {
    { let mut g = MIDI_CONN.lock().unwrap(); *g = None; } // close any existing connection

    // Always create a fresh MidiInput so we see ports created after app launch
    let midi_in = MidiInput::new("p5-tauri-input").map_err(|e| e.to_string())?;
    let ports   = midi_in.ports();

    // Find the port whose name matches (exact first, then case-insensitive substring)
    let port = ports.iter()
        .find(|p| midi_in.port_name(p).ok().as_deref() == Some(&port_name))
        .or_else(|| {
            let lower = port_name.to_lowercase();
            ports.iter().find(|p| {
                midi_in.port_name(p).ok()
                    .map(|n| n.to_lowercase().contains(&lower))
                    .unwrap_or(false)
            })
        })
        .ok_or_else(|| {
            let available: Vec<String> = ports.iter()
                .filter_map(|p| midi_in.port_name(p).ok())
                .collect();
            format!("Port '{port_name}' not found. Available: {available:?}")
        })?;

    let resolved_name = midi_in.port_name(port).unwrap_or_else(|_| port_name.clone());
    println!("[midi] connecting → {resolved_name}");

    let win = Arc::new(window);
    let conn = midi_in
        .connect(port, "p5-conn", move |_ts, bytes, _| {
            let ev = parse_midi(bytes);
            if let Err(e) = win.emit("midi-event", &ev) {
                eprintln!("[midi] emit error: {e}");
            }
        }, ())
        .map_err(|e| e.to_string())?;

    let mut g = MIDI_CONN.lock().unwrap();
    *g = Some(Some(conn));
    println!("[midi] connected to {resolved_name}");
    Ok(())
}

/// Legacy index-based connect — kept for compatibility but prefer connect_midi_port_by_name.
#[command]
fn connect_midi_port(port_index: usize, window: Window) -> Result<(), String> {
    let midi_in = MidiInput::new("p5-tauri-list").map_err(|e| e.to_string())?;
    let ports   = midi_in.ports();
    let name = ports.get(port_index)
        .and_then(|p| midi_in.port_name(p).ok())
        .ok_or_else(|| format!("port {port_index} out of range"))?;
    connect_midi_port_by_name(name, window)
}

#[command]
fn disconnect_midi() {
    let mut g = MIDI_CONN.lock().unwrap();
    *g = None;
    println!("[midi] disconnected");
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            list_midi_ports,
            debug_midi_ports,
            connect_midi_port,
            connect_midi_port_by_name,
            disconnect_midi,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
