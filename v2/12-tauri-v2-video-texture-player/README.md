# 12 — Tauri v2 Video Texture Player

A local video playback and processing foundation for the Junkpile Tauri v2 Essentials collection.

This example demonstrates two local-media pathways:

1. **Native open** — Tauri's dialog plugin returns a file path, the selection is added to the asset-protocol scope, and `convertFileSrc()` exposes it to the WebView.
2. **Browser picker / drag-and-drop** — the WebView creates a temporary Blob URL directly from the selected `File` object.

Both pathways enter the same HTML video decoder, WebGL texture upload, GLSL processing, and ping-pong feedback pipeline.

## Signal flow

```text
Native dialog ── path ── convertFileSrc ─┐
                                         ├─ HTMLVideoElement
Browser picker / drop ── Blob URL ───────┘
                                                ↓
                                 requestVideoFrameCallback
                                                ↓
                                      WebGL video texture
                                                ↓
                                 GLSL effect + color grade
                                                ↓
                                  ping-pong feedback buffers
                                                ↓
                                  window / native PNG save
```

## Features

- Tauri v2 global JavaScript API
- Official Tauri dialog plugin
- Dynamically scoped native video selection
- Browser picker and drag-and-drop fallback
- MP4, MOV, M4V, WebM, MKV, AVI, and OGV selection filters
- WebView-dependent codec decoding
- Play, pause, restart, seek, loop, mute, volume, and playback rate
- Frame stepping using the estimated decoded source frame rate
- `requestVideoFrameCallback()` when supported
- Actual presented-frame count and source-FPS estimate
- Raw WebGL 1 video texture upload
- Contain, cover, and stretch framing
- Zoom, rotation, and mirroring
- Eight GLSL effects
- Hue, saturation, brightness, and contrast controls
- Persistent ping-pong feedback
- Feedback clearing
- Native PNG save dialog
- Browser PNG fallback outside Tauri
- Native fullscreen command
- Scroll-safe fixed-height control shell

## Run

```bash
npm install
npm run dev
```

Then:

1. Select **Native open**.
2. Choose a local video.
3. Press **Play**.
4. Select an effect and raise **Effect amount**.
5. Raise **Feedback** and slightly alter **Feedback zoom**.
6. Save the processed output with **Save PNG frame**.

## Files

```text
12-tauri-v2-video-texture-player/
├── src/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── src-tauri/
│   ├── capabilities/default.json
│   ├── icons/
│   ├── src/main.rs
│   ├── Cargo.toml
│   ├── build.rs
│   └── tauri.conf.json
├── package.json
└── README.md
```

## Tauri v2 concepts demonstrated

### Capabilities

The `main` WebView receives only core access and the two dialog commands it needs:

```json
"permissions": [
  "core:default",
  "dialog:allow-open",
  "dialog:allow-save"
]
```

### Native dialog plugin

Rust initializes the official plugin:

```rust
.plugin(tauri_plugin_dialog::init())
```

The vanilla JavaScript frontend accesses it through:

```js
const tauriDialog = window.__TAURI__.dialog;
```

### Asset protocol

Native file paths cannot be assigned directly to `<video src>`. The selected path is converted with:

```js
const sourceUrl = window.__TAURI__.core.convertFileSrc(path);
```

The dialog plugin dynamically adds selected paths to the asset-protocol scope for the current application session.

### Native application commands

Small application-specific operations remain explicit Rust commands:

- `inspect_video_file`
- `write_png`
- `toggle_fullscreen`

The WebView owns decoding and rendering. Rust owns native dialogs, filesystem output, and application-window actions.

## Codec note

The application can select many container formats, but actual playback depends on codecs supported by the operating system's WebView:

- macOS: WKWebView / AVFoundation
- Windows: WebView2 / installed media codecs
- Linux: WebKitGTK / GStreamer packages

A file can therefore be selectable but still produce a decoder error.

## Why this example exists

Examples 00–09 establish the v2 WebView graphics foundation. Examples 10 and 11 add Rust MIDI and OSC bridges. Example 12 begins the v2 media-processing layer with a local, timeline-based video source.

## Drag and drop

Desktop file drops use Tauri v2's native `Webview.onDragDropEvent` API rather than relying only on browser `DataTransfer.files`. The dropped path is canonicalized and added to the runtime asset-protocol scope before `convertFileSrc()` is used, so the video can be decoded by the WebView without granting broad filesystem access. Browser drag/drop remains available as a fallback when the frontend is run outside Tauri.
