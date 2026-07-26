# 10 · Tauri v1 MIDI Input

A modernized Junkpile foundation for receiving native MIDI through Rust and using it to control a p5.js WebGL shader inside one Tauri v1 window.

The repository folder intentionally keeps its original name:

```text
p5-tauri-midi-template
```

## What this example teaches

- Why Web MIDI is not the dependable path inside Tauri v1 WebViews
- Receiving CoreMIDI, ALSA, or WinMM input through Rust `midir`
- Parsing channel voice messages into structured Tauri events
- Listening for those events in JavaScript
- Scaling MIDI CC values into useful visual parameter ranges
- Mapping controls with MIDI learn
- Combining hardware input with manual HTML controls
- Driving p5.js shader uniforms from the resulting state

## Signal flow

```text
MIDI controller / virtual MIDI port
        ↓
Rust midir callback
        ↓
parse_midi()
        ↓
window.emit("midi-event")
        ↓
JavaScript mapping + parameter state
        ↓
p5 draw loop
        ↓
GLSL uniforms
```

## Run

```bash
npm install
npm run dev
```

`npm install` provides both the local Tauri v1 CLI and p5.js. The pre-development script copies the pinned p5 build into `src/vendor/`, so the app does not require a CDN at runtime.

## Production build

```bash
npm run build
```

On macOS, bundles are generated under:

```text
src-tauri/target/release/bundle/
```

## Default MIDI mapping

| CC | Parameter |
|---:|---|
| 1 | Hue |
| 2 | Zoom |
| 3 | Speed |
| 7 | Brightness |
| 10 | Distortion |
| 74 | Complexity |

Saturation and glow begin unmapped. Use **MIDI learn** to assign them—or replace any default mapping. The mapping is saved in local storage.

Additional messages:

- Note On creates a velocity-scaled light impulse.
- Pitch bend rotates the shader field around its center.
- Note Off, aftertouch, pressure, and program changes appear in the event terminal.

## Test without a physical controller

### macOS

1. Open **Audio MIDI Setup**.
2. Choose **Window → Show MIDI Studio**.
3. Double-click **IAC Driver**.
4. Enable **Device is online**.
5. Send MIDI to the IAC Bus from Max, Pure Data, Ableton Live, Logic, or another application.

### Linux

Install ALSA development support before compiling:

```bash
sudo apt install libasound2-dev
```

### Windows

Class-compliant devices and virtual WinMM ports should appear automatically.

## Interface

- **Device** scans, connects, disconnects, and prints native port diagnostics.
- **Quick states** change visual parameters without changing MIDI assignments.
- **MIDI learn** maps the next received CC to a chosen parameter.
- **Visual parameters** remain fully operable without hardware.
- **Mini MIDI terminal** shows parsed messages and raw bytes.
- **Meters** visualize note velocity, pitch bend, and the latest CC value.

Keyboard shortcuts:

| Key | Action |
|---|---|
| Space | Pause or resume animation |
| R | Restore visual defaults |
| F | Toggle native fullscreen |

## Project structure

```text
p5-tauri-midi-template/
├── README.md
├── MODERNIZATION-NOTES.md
├── package.json
├── scripts/
│   └── sync-p5.mjs
├── src/
│   ├── index.html
│   ├── sketch.js
│   ├── styles.css
│   └── vendor/p5.min.js    generated after npm install
└── src-tauri/
    ├── Cargo.toml
    ├── tauri.conf.json
    └── src/main.rs
```

## Rust commands

| Command | Purpose |
|---|---|
| `list_midi_ports` | Returns currently visible MIDI inputs |
| `debug_midi_ports` | Returns a human-readable native port report |
| `connect_midi_port_by_name` | Opens a port and begins emitting events |
| `disconnect_midi` | Closes the active connection |
| `midi_connection_name` | Reports the current connection |
| `toggle_fullscreen` | Controls the native Tauri window |

## Extend this example

To add another MIDI-controlled shader parameter:

1. Add the parameter to `PARAMS` in `src/sketch.js`.
2. Add a matching uniform to `FRAG_SHADER`.
3. Upload it inside `draw()`.
4. Use MIDI learn to assign a CC, or provide a default `cc` number in the parameter specification.

## Known limitations

- The example accepts one MIDI input connection at a time.
- MIDI output is outside this example’s scope.
- The MIDI mapping is intentionally linear; custom curves can be added in `setParam()`.
- p5.js and WebGL run in the WebView rather than through native wgpu.
