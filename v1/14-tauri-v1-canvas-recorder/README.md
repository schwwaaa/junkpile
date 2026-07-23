# 14 · Tauri v1 Canvas Recorder

A standalone Tauri v1 example that records a live WebGL canvas with the browser `MediaRecorder` pipeline and saves the resulting video through Tauri's native file dialog.

This is the first export-focused project in the Tauri v1 essentials series. It demonstrates the complete path from a GPU-rendered browser canvas to a persistent desktop video file without adding a native encoder dependency.

## What this example demonstrates

- Raw WebGL 1 rendering inside the Tauri v1 WebView
- `HTMLCanvasElement.captureStream()` for frame capture
- `MediaRecorder` codec feature detection
- WebM or MP4 output depending on WebView support
- 24, 30, and 60 fps capture targets
- 720p, 1080p, 1440p, 4K, and custom canvas sizes
- Adjustable video and audio bitrates
- Optional microphone audio mixed into the recording stream
- Pause, resume, manual stop, countdown, and timed auto-stop
- Native save dialogs with `__TAURI__.dialog.save`
- Binary video and PNG writing with `__TAURI__.fs.writeBinaryFile`
- Browser-download fallback when the Tauri global API is unavailable
- Full-resolution PNG frame export
- A live recording timer and accumulated data-size display

## Run

```bash
npm install
npm run dev
```

The project includes an explicit `[workspace]` boundary in `src-tauri/Cargo.toml`, so an unrelated Cargo workspace higher in the filesystem cannot absorb it.

## Basic workflow

1. Choose the output resolution, frame rate, and bitrate.
2. Optionally enable microphone audio.
3. Press **Record**.
4. Pause, resume, or stop as needed.
5. Press **Save recording** and select a destination.

The **Save PNG** button exports the current full-resolution WebGL frame independently from video recording.

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
                                          Tauri save dialog + fs API
```

## Resolution and preview behavior

The CSS preview fills the available stage, but the canvas backing store remains at the selected recording resolution. For example, selecting 3840 × 2160 causes WebGL to render and record a true 4K canvas even if the visible application window is smaller.

Higher resolutions increase GPU and encoder cost. Start with 1920 × 1080 at 60 fps and 24 Mbps, then move to 4K after confirming that the local WebView can sustain the desired frame rate.

## Codec selection

The example asks `MediaRecorder.isTypeSupported()` about several candidates and selects the first available option.

For a recording without microphone audio it tries:

```text
video/webm;codecs=vp9
video/webm;codecs=vp8
video/mp4;codecs=h264
video/mp4
video/webm
```

When microphone audio is enabled, audio-bearing codec combinations are preferred. The active result appears in the **Codec** field before recording starts.

The exact output container is therefore platform- and WebView-dependent. The save dialog uses the extension that matches the recorder's selected MIME type.

## Microphone behavior

Microphone input is optional and disabled by default.

When enabled:

- The selected audio input is requested when recording starts.
- Echo cancellation, automatic gain control, and noise suppression are requested off so the example receives a less processed signal when the platform permits it.
- The audio track is added directly to the recording `MediaStream`.
- The microphone is not connected to an audio output node, so it is not monitored through the speakers.
- All microphone tracks are stopped when recording ends or the application closes.

On macOS, `Info.plist` contains `NSMicrophoneUsageDescription`, and `entitlements.plist` enables audio input for bundled builds.

## Saving files

`tauri.conf.json` enables only the APIs needed by this example:

```json
"allowlist": {
  "all": false,
  "dialog": { "save": true },
  "fs": { "writeFile": true }
}
```

The matching Rust features are declared in `src-tauri/Cargo.toml`:

```toml
tauri = { version = "1", features = ["wry", "dialog-save", "fs-write-file"] }
```

The frontend receives the pre-bundled Tauri API through:

```json
"withGlobalTauri": true
```

The completed `Blob` is converted to a `Uint8Array` only when the user chooses to save. This keeps the active recording path focused on MediaRecorder chunks rather than repeatedly sending large buffers through IPC.

## Memory considerations

This essentials example holds completed MediaRecorder chunks in memory until the recording is discarded or replaced. That keeps the architecture understandable, but very long or very high-bitrate captures can consume significant memory.

For a production recorder, common next steps are:

- Stream chunks to a native Rust file command while recording.
- Use FFmpeg or another native encoder for deterministic codecs.
- Add audio-level metering.
- Separate preview resolution from recording resolution.
- Add dropped-frame and encoder-backpressure diagnostics.

## Included visual shader

The internal generator provides four recording-ready modes:

- Liquid field
- Infinite tunnel
- Cellular lattice
- Signal bands

The shader includes speed, scale, octave detail, warp, pulse, hue, saturation, brightness, and contrast controls. It exists so the recording pipeline can be tested immediately without loading external media.

## Project structure

```text
14-tauri-v1-canvas-recorder/
├── package.json
├── README.md
├── src/
│   ├── index.html       controls and WebGL stage
│   ├── styles.css       compact recorder interface
│   └── app.js           shader, capture, MediaRecorder, and saving
└── src-tauri/
    ├── Cargo.toml
    ├── Info.plist
    ├── entitlements.plist
    ├── tauri.conf.json
    ├── build.rs
    ├── icons/
    └── src/main.rs
```

## Troubleshooting

### Canvas recording unavailable

The WebView must expose both `canvas.captureStream()` and `MediaRecorder`. The UI performs this check at startup and displays an unsupported-state overlay when either API is absent.

### No codec appears

The WebView did not accept any of the tested MIME strings. Upgrade the operating system/WebView and rerun the example. Codec availability is provided by the platform browser engine rather than Tauri itself.

### Microphone list has generic names

Some systems hide device labels until microphone permission has been granted. Enable microphone audio and start one recording attempt; after permission succeeds, the list is refreshed automatically.

### Recording is choppy

Reduce one or more of:

- Canvas resolution
- Target frame rate
- Video bitrate
- Shader detail

The FPS readout reports the live rendering loop, not a guaranteed encoded-frame count.

### File save fails

Confirm that both the Tauri allowlist entries and the Rust features remain present. The native save path depends on the dialog-save and fs-write-file APIs.

## Why this belongs in the essentials series

Rendering is only half of a live-visual application. Artists and developers also need to capture output, understand browser codec negotiation, mix optional audio, communicate recording state clearly, and move binary media from the WebView into the desktop filesystem. This project isolates that complete workflow in one small Tauri v1 application.
