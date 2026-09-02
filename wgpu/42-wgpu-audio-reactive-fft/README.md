# Junkpile · Native wgpu Audio-Reactive FFT

A native Rust/wgpu counterpart to the WebView audio-reactive FFT workflow: microphone capture, FFT and waveform analysis, beat detection, GPU analysis textures, and live audio-reactive graphics.

## What it demonstrates

```text
Microphone
  ↓ CPAL native capture
Mono sample ring
  ↓ RustFFT / analysis worker
FFT + waveform + bass/mid/treble + beat pulse
  ↓ shared analysis frame
RGBA8 spectrum / waveform textures
  ↓ wgpu / WGSL
Authoritative native render target
  ↓
Scaled native preview
```

The audio callback performs only sample conversion and bounded ring-buffer insertion. FFT work stays off the real-time audio callback.

## wgpu version

This revision pins `wgpu = 29.0.4` and uses the wgpu 29 `CurrentSurfaceTexture` / `Queue::present` surface API.

## Run

```bash
npm install
npm run dev
```

Two windows open:

- **Controls** — input device, analysis controls, visual modes, render resolution, telemetry.
- **Native renderer** — Rust/wgpu output surface.

## First test

1. Leave **Demo signal when idle** enabled and confirm the native renderer animates before microphone access.
2. Choose **System default input** and click **Start microphone**.
3. Accept the operating-system microphone permission request if shown.
4. Speak, play music, or route audio into the selected input.
5. Confirm RMS, peak, bass, mid, treble, waveform, spectrum, and beat values respond.
6. Switch among the six visual modes.
7. Set **Spin speed** to `0.00 rad/s`. Rotation must stop. Positive and negative values must rotate in opposite directions.
8. Increase the internal render resolution only as far as the machine can sustain smoothly.

## Visual modes

- Spectrum Tunnel
- Radial Bloom
- Wave Scope
- Bass Lattice
- Spectral Nebula
- Frequency Mandala

All modes consume the same native FFT and waveform textures while interpreting them differently.

## Audio analysis controls

### Input gain

Multiplies the captured mono signal before FFT and waveform analysis.

### Spectrum smoothing

Temporal FFT smoothing. `0` follows new bins immediately; higher values retain more of the previous frame.

### Beat threshold

Compares current low-frequency energy against an adaptive low-frequency floor.

### Beat hold

Minimum time between detected beats.

## Visual controls

### Reactivity

Scales the amount of spectral and band-energy displacement in the WGSL visual.

### Spin speed

Actual angular velocity in radians per second:

- `0` = stopped
- positive = forward rotation
- negative = reverse rotation
- greater magnitude = faster rotation

### Hue shift

Offsets the procedural palette without changing the underlying FFT analysis.

## Native render resolution

The authoritative render target can be selected independently from the preview window:

- 720p
- 1080p
- 1440p
- 4K
- 5K
- 8K

Unsupported texture dimensions are disabled according to the adapter-reported limit. A selectable resolution is not a promise that the machine can sustain it at 60 FPS; use the renderer FPS and frame-time telemetry.

## Preview modes

- Fit
- Fill
- Stretch
- Pixel 1:1

Changing preview presentation does not change the authoritative render target.

## Microphone permissions

### macOS

`src-tauri/Info.plist` contains `NSMicrophoneUsageDescription`. macOS should ask for microphone access on the first capture attempt. If access was denied previously, review **System Settings → Privacy & Security → Microphone**.

### Windows

Ensure desktop applications are allowed to use microphone devices in Windows privacy settings.

### Linux

CPAL normally uses ALSA on Linux. Development packages may be required:

```bash
sudo apt install libasound2-dev
```

PipeWire systems may expose devices through the ALSA compatibility layer.

## Frame data contract

The renderer receives:

- 256 spectrum samples encoded into a `256 × 1` `RGBA8Unorm` texture
- 512 waveform samples encoded into a `512 × 1` `RGBA8Unorm` texture
- RMS
- peak amplitude
- bass energy
- mid energy
- treble energy
- beat pulse

The textures are updated with `queue.write_texture` and sampled directly by WGSL.

## Why the demo signal exists

Microphone permission, device availability, and external routing are environment-dependent. The generated signal lets the graphics pipeline remain inspectable before a microphone is connected. It is explicitly reported as an idle/demo state and does not masquerade as captured audio.

## Files

```text
src/
  index.html
  styles.css
  app.js

src-tauri/src/
  main.rs       Tauri commands and window lifecycle
  audio.rs      CPAL capture, sample ring, FFT, beat analysis
  renderer.rs   native wgpu renderer and analysis-texture upload
  visuals.wgsl  six audio-reactive visual modes
  preview.rs    native presentation sink
  preview.wgsl  fit/fill/stretch/pixel presenter
  config.rs     preview-mode contract
```

## Build

```bash
npm run build
```

## Known limits

- Input device selection currently identifies devices by their display name.
- Hotplug refresh is manual through **Refresh**.
- This project analyzes microphone input only; local audio-file transport belongs in the separate audio-file FFT parity example.
- 5K/8K are intentionally exposed but may not sustain real-time performance on every GPU.

## Revision 0.1.2

Pinned to `wgpu 29.0.4`. Surface acquisition uses `CurrentSurfaceTexture`; successful frames are presented with `SurfaceTexture::present()`, which is the wgpu 29 presentation API.
