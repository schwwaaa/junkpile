# 17 — wgpu MIDI Parameter Registry

A standalone Tauri 2 + Rust/wgpu example showing how native MIDI messages become reusable renderer parameters rather than hard-coded controller assignments.

```text
MIDI device / virtual port
            ↓
      midir callback
            ↓
 Rust mapping registry
  • MIDI learn
  • channel + source matching
  • min / max remapping
  • inversion
  • temporal smoothing
            ↓
 normalized renderer state
  • 8 scalar parameters
  • 128 note velocities
  • pitch bend
  • channel pressure
            ↓
 wgpu uniform + storage buffers
            ↓
 Metal / Vulkan / DX12 surface
```

## Run

```bash
npm install
npm run dev:metal   # macOS
```

Or let wgpu select the backend:

```bash
npm run dev
```

Other backend launchers:

```bash
npm run dev:vulkan
npm run dev:dx12
```

## First test

1. Connect a MIDI keyboard/controller or enable a virtual input such as macOS IAC Bus.
2. Click **Refresh**.
3. Select the port and click **Connect**.
4. Play notes. Note velocities immediately enter the 128-value GPU storage buffer.
5. Click **Learn** next to a renderer parameter.
6. Move a MIDI CC, pitch bend, pressure control, or play a note.
7. Adjust the new mapping's min, max, smoothing, or inversion.

## Registry parameters

| Target | Normalized behavior |
|---|---|
| Hue | Color position from 0–1 |
| Zoom | Camera scale |
| Rotation | Full negative-to-positive rotation range |
| Field strength | Procedural field energy |
| Turbulence | Spatial distortion |
| Trail persistence | Note-release decay |
| Exposure | Output brightness/tone response |
| Pulse decay | Note-on flash duration |

The values remain normalized in the Rust registry. The WGSL shader converts them to useful renderer ranges. This keeps MIDI, OSC, automation, presets, and future input sources compatible with the same parameter contract.

## MIDI learn

MIDI learn accepts:

- Control Change
- Note On/Off
- Pitch bend
- Channel pressure
- Polyphonic aftertouch

One learned mapping replaces the previous mapping for that target. The mapping table can then change:

- Output minimum
- Output maximum
- Inversion
- Smoothing

## Starter map

The optional starter map demonstrates conventional assignments:

| MIDI source | Renderer target |
|---|---|
| CC 1 | Field strength |
| CC 7 | Exposure |
| CC 10 | Hue |
| CC 74 | Turbulence |
| Pitch bend | Rotation |

Use MIDI learn for devices that send different CC numbers or channels.

## Mapping persistence

**Save in browser** stores the current mapping list in the controls WebView's local storage. **Load saved** sends that list back into the Rust registry. This keeps the example self-contained and avoids adding filesystem permissions solely for a mapping demonstration.

## Platform notes

### macOS

`midir` uses CoreMIDI. For virtual ports:

1. Open **Audio MIDI Setup**.
2. Open **MIDI Studio**.
3. Double-click **IAC Driver**.
4. Enable **Device is online**.

### Windows

`midir` uses the Windows multimedia MIDI services. Hardware and virtual ports should appear after **Refresh**.

### Linux

`midir` uses ALSA. Debian/Ubuntu development builds generally require:

```bash
sudo apt install libasound2-dev
```

## Architecture

`src-tauri/src/midi.rs`

- Owns native port enumeration and the live `MidiInputConnection`.
- Parses raw MIDI bytes.
- Maintains mappings, learn state, message history, and normalized parameters.
- Publishes a compact `MidiSnapshot` for the renderer.

`src-tauri/src/renderer.rs`

- Owns the native wgpu surface.
- Smooths normalized parameter targets each frame.
- Decays released note velocities according to trail persistence.
- Uploads uniforms and a 128-float note storage buffer.

`src-tauri/src/midi.wgsl`

- Reads all scalar parameters from a uniform buffer.
- Reads note energy from a storage buffer.
- Produces a procedural note field with pitch-based direction, rings, grids, and pulses.

## Why this example matters

A fixed MIDI map is useful for one controller. A parameter registry is reusable infrastructure. The same normalized targets can later be driven by:

- OSC
- Gamepads
- Mouse/touch gestures
- Audio analysis
- Automation timelines
- Network control
- Preset morphing

That makes this example the input-routing foundation for larger Junkpile instruments.
