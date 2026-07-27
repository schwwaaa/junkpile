# 10 — Tauri v2 MIDI Input

A standalone Tauri v2 example showing how native MIDI input can be received in Rust with `midir`, emitted into a vanilla JavaScript frontend, mapped with MIDI learn, and used to control a raw WebGL visual.

## Signal flow

```text
MIDI controller / virtual MIDI port
                ↓
          Rust `midir`
                ↓
       Tauri `midi-event`
                ↓
  JavaScript mapping + MIDI learn
                ↓
         WebGL uniforms
```

## Features

- MIDI device refresh, connect, disconnect, and diagnostics
- Note, CC, pitch bend, aftertouch, pressure, program-change, and system message parsing
- Editable MIDI-learn mappings saved in `localStorage`
- Manual slider fallback
- Live MIDI monitor and fixed-width readouts
- Scroll-safe Junkpile interface
- Native fullscreen command

## Run

```bash
npm install
npm run dev
```

## Default map

| MIDI | Parameter |
|---|---|
| CC 1 | Hue |
| CC 2 | Zoom |
| CC 3 | Speed |
| CC 7 | Brightness |
| CC 10 | Distortion |
| CC 74 | Complexity |

On macOS, virtual MIDI can be enabled through **Audio MIDI Setup → MIDI Studio → IAC Driver**. On Debian/Ubuntu, `midir` commonly requires `libasound2-dev`.

## Production build

```bash
npm run build
```

The generated platform bundles are written beneath `src-tauri/target/release/bundle/`.
