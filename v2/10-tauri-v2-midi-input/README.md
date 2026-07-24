# 10 — Tauri v2 MIDI Input

A standalone Tauri v2 example showing how to receive native MIDI input in Rust and forward structured MIDI messages into a vanilla JavaScript/WebGL frontend.

## Why MIDI goes through Rust

Desktop WebViews do not provide a dependable Web MIDI API across macOS, Windows, and Linux. This example uses `midir` instead:

```text
MIDI hardware / virtual port
        ↓
Rust `midir` callback
        ↓
Tauri v2 `Emitter::emit("midi-event")`
        ↓
JavaScript `event.listen("midi-event")`
        ↓
CC map / MIDI learn / WebGL uniforms
```

## Features

- CoreMIDI, ALSA, and WinMM through `midir`
- Device refresh, connect, disconnect, and diagnostics
- Structured Note On/Off, CC, pitch bend, aftertouch, pressure, program-change, and system messages
- Live mini MIDI terminal
- Note, CC, and bipolar pitch-bend meters
- Editable MIDI-learn mapping
- Mappings persisted in `localStorage`
- Manual slider fallback when no controller is attached
- Raw WebGL 1 procedural visual
- Note velocity flash and pitch-bend field rotation
- Tauri v2 global JavaScript API
- Explicit Tauri v2 capability file
- Standalone Cargo workspace boundary

## Default CC map

| MIDI CC | Parameter |
|---:|---|
| 1 | Hue |
| 2 | Zoom |
| 3 | Speed |
| 7 | Brightness |
| 10 | Distortion |
| 74 | Complexity |

Use **MIDI learn** to replace any mapping without editing source code.

## Run

```bash
npm install
npm run dev
```

## macOS virtual MIDI

Open **Audio MIDI Setup → Window → Show MIDI Studio**. Double-click **IAC Driver**, enable **Device is online**, then refresh the port list.

## Linux prerequisite

```bash
sudo apt install libasound2-dev
```

## Tauri v2 details

The frontend uses:

```js
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
```

This requires:

```json
"app": {
  "withGlobalTauri": true
}
```

The `main` WebView receives `core:default` through `src-tauri/capabilities/default.json`. Tauri v2 capabilities determine which core and plugin APIs each window may use.
