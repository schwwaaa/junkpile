# 14 · Tauri v2 Canvas Recorder

A standalone Tauri v2 example that records a live WebGL canvas through `canvas.captureStream()` and `MediaRecorder`, optionally adds microphone audio, and saves the completed video with a native desktop dialog.

The project is the Tauri v2 counterpart to the v1 Canvas Recorder. The browser media pipeline remains easy to inspect, while Tauri v2 capabilities and Rust commands provide narrowly scoped native file output and fullscreen control.

## What this example demonstrates

- Raw WebGL 1 rendering inside a Tauri v2 WebView
- `HTMLCanvasElement.captureStream()` video capture
- `MediaRecorder` codec negotiation
- WebM or MP4 output according to WebView support
- 24, 30, and 60 fps capture targets
- 720p, 1080p, 1440p, 4K, and custom backing-store resolutions
- Adjustable video and audio bitrates
- Optional microphone audio
- Microphone device refresh and selection
- Countdown, pause, resume, manual stop, and timed auto-stop
- Native Tauri v2 save dialog
- Rust binary-file writing command
- Browser-download fallback outside Tauri
- Full-resolution PNG snapshots
- Native fullscreen preview
- Live duration, accumulated size, FPS, and render-resolution telemetry
- Scroll-safe controls from the corrected v2 layout pattern

## Run

```bash
npm install
npm run dev
```

The project contains an explicit `[workspace]` boundary in `src-tauri/Cargo.toml`, preventing unrelated parent Cargo workspaces from absorbing it.

## First test

1. Leave the output at **1920 × 1080**, **60 fps**, and **24 Mbps**.
2. Leave microphone audio disabled for the first capture.
3. Press **Record** and wait for the countdown.
4. Record five to ten seconds.
5. Press **Stop**.
6. Press **Save recording** and choose a destination.
7. Press **Save PNG** to export the current full-resolution canvas frame.

## Signal path

```text
WebGL fragment shader
        │
        ▼
HTMLCanvasElement
        │ captureStream(FPS)
        ▼
Canvas video track ──────────────┐
                                 ├──► MediaStream ─► MediaRecorder
Optional getUserMedia audio ─────┘                       │
                                                        ▼
                                                  Blob chunks
                                                        │
                                                        ▼
                                     Tauri v2 save dialog
                                                        │
                                                        ▼
                                        Rust write_binary command
```

## Resolution behavior

The CSS preview scales to fit the stage, but the canvas backing store remains at the selected recording resolution. A 3840 × 2160 selection therefore renders and records a true 4K canvas even when the application window is smaller.

Higher resolutions increase GPU, encoder, memory, and IPC costs. Confirm 1080p first, then move to 4K.

## Codec selection

The example asks `MediaRecorder.isTypeSupported()` about multiple candidate formats.

Without microphone audio it prefers:

```text
video/webm;codecs=vp9
video/webm;codecs=vp8
video/mp4;codecs=h264
video/mp4
video/webm
```

With microphone audio enabled it prefers audio-bearing variants such as VP9/Opus, VP8/Opus, or H.264/AAC. The selected MIME type appears in the **Codec** field before recording.

Codec availability belongs to the operating system WebView, not Tauri. A format available on one machine may be unavailable on another.

## Microphone behavior

Microphone audio is optional and disabled by default.

When enabled:

- The selected device is requested when recording begins.
- Device names refresh after permission is granted.
- The audio track is added directly to the recording stream.
- The microphone is never connected to speaker output.
- Audio tracks are stopped when recording finishes or the app closes.

For macOS bundles, `Info.plist` contains `NSMicrophoneUsageDescription`, and `entitlements.plist` enables audio input.

## Tauri v2 native saving

The official dialog plugin provides the save dialog:

```toml
tauri-plugin-dialog = "2"
```

The capability file grants only:

```json
[
  "core:default",
  "dialog:allow-save"
]
```

After the user chooses a destination, PNG snapshots use a direct `write_binary` command. Larger video recordings are divided into 1 MiB chunks and sent sequentially through `create_binary` and `append_binary`, avoiding one enormous IPC payload. The Save button reports chunk progress while the file is written.

## Memory considerations

This educational example retains MediaRecorder chunks in memory until the recording is discarded or replaced. Long, high-resolution, or high-bitrate captures may use substantial memory.

A production recorder would normally consider:

- Streaming MediaRecorder chunks to Rust while recording rather than after stop
- Native FFmpeg or platform encoders
- Encoder-backpressure and dropped-frame diagnostics
- Separate preview and recording render targets
- Audio meters and channel routing

## Included visual generator

Four procedural shader modes are included so recording can be tested without external media:

- Liquid field
- Infinite tunnel
- Cellular lattice
- Signal bands

Controls include speed, scale, detail, warp, pulse, hue, saturation, brightness, and contrast.

## Project structure

```text
14-tauri-v2-canvas-recorder/
├── package.json
├── README.md
├── src/
│   ├── index.html
│   ├── styles.css
│   └── app.js
└── src-tauri/
    ├── Cargo.toml
    ├── Info.plist
    ├── entitlements.plist
    ├── tauri.conf.json
    ├── capabilities/default.json
    ├── build.rs
    ├── icons/
    └── src/main.rs
```

## Troubleshooting

### Canvas recording unavailable

The WebView must expose both `canvas.captureStream()` and `MediaRecorder`. The example checks both APIs at startup.

### No codec appears

The platform WebView rejected every tested MIME string. Upgrade the operating system/WebView or test another target platform.

### Microphone names are generic

Some systems hide device labels before microphone permission. Enable microphone audio and begin a recording attempt; the device list refreshes after permission succeeds.

### Recording is choppy

Reduce the resolution, frame rate, bitrate, or shader detail. The preview FPS is a rendering-loop measurement, not a guaranteed encoded-frame count.

### Save is slow

The completed video is transferred to Rust only after recording stops and a path is chosen. Large captures can take time and temporarily require another in-memory byte representation.

## Why this belongs in the essentials series

A visual application needs a clear path from live GPU output to a persistent media file. This example isolates the browser capture APIs, optional audio mixing, codec negotiation, desktop save workflow, and Tauri v2 permission model in one reusable project.
