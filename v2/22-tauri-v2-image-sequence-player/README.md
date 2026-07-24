# 22 · Tauri v2 Image Sequence Player

A two-window Tauri v2 example for playing numbered still-image sequences as time-based media. The controls WebView handles native folder/file selection and transport. The output WebView owns the decode cache, playback clock, WebGL renderer, monitor placement, and PNG capture.

## Run

```bash
npm install
npm run dev
```

## First test

1. Launch the app. A generated 180-frame sequence starts automatically.
2. Test Play/Pause, Reverse, stepping, scrubbing, looping, and adjacent-frame blending.
3. Choose **Choose folder** to scan a numbered frame folder, or **Choose files** to select individual images.
4. Select a display, press **Move to display**, then **Fullscreen output**.

## Supported frames

- PNG
- JPEG / JPG
- WebP
- BMP
- GIF
- TIFF / TIF
- AVIF where the WebView decoder supports it

Frames are naturally sorted, so `frame_2.png` appears before `frame_10.png`.

## Architecture

```text
controls WebView
  ├─ Tauri v2 native folder/file dialog
  ├─ Rust recursive directory scanner
  ├─ native drag-and-drop paths
  ├─ transport + cache controls
  └─ Tauri event bus
          ↓
output WebView
  ├─ Rust binary frame reader
  ├─ origin-clean Blob image decoder
  ├─ bounded decode queue + cache
  ├─ decode-aware playback clock
  ├─ adjacent-frame WebGL blending
  ├─ framing / grade / calibration grid
  └─ monitor placement + native PNG save
```

Local image paths are never uploaded directly into WebGL. Each requested frame is read by Rust and returned through Tauri binary IPC, then decoded from a temporary Blob URL. This avoids the WKWebView asset-protocol texture security error demonstrated and fixed in Example 16.

## Playback behavior

- **Hold every frame** pauses the clock when the requested frame is not decoded, then resumes from the same playhead.
- **Drop late frames** preserves real-time timing and displays the nearest decoded frame when necessary.
- **Loop**, **Ping-pong**, and **Play once** honor the active in/out range.
- **Blend adjacent frames** interpolates between two decoded frames.
- Sequence FPS and playback-rate updates are coalesced before crossing the window event bus.

## Cache modes

- **Window around playhead** keeps a configurable radius and evicts distant images.
- **Preload all frames** queues the full sequence and can consume substantial memory with 4K/8K frames.
- At most four Rust reads/image decodes run simultaneously.

## Keyboard shortcuts

- `Space`: play or pause
- `Left` / `Right`: step one frame
- `Shift + Left` / `Shift + Right`: step ten frames
- `R`: reverse direction

## Important files

```text
src/app.js                         controls, selection, transport, event routing
src/output.js                      cache, binary frame loading, playback, WebGL
src-tauri/src/main.rs              scanner, binary reads, monitor/output commands
src-tauri/capabilities/default.json explicit Tauri v2 permissions
src-tauri/tauri.conf.json          controls/output windows and CSP
```

## Notes

- An image sequence is a set of ordered still images where every file is one video frame. One image cannot animate; unrelated images play as a naturally sorted slideshow.
- Animated GIF files may animate internally; numbered still images are the intended workflow.
- Long high-resolution sequences should use the windowed cache.
