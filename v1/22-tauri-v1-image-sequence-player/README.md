# 22 · Tauri v1 Image Sequence Player

A two-window Tauri v1 example for playing numbered still-image sequences as time-based media. The controls WebView handles folder/file selection and transport; the output WebView owns WebGL rendering, decoding, caching, display placement, and PNG capture.

## Run

```bash
npm install
npm run dev
```

## First test

1. Launch the app. A generated 180-frame demo begins immediately.
2. Use Play/Pause, Reverse, frame stepping, scrubbing, loop modes, and frame blending.
3. Choose **Choose folder** to scan a directory of frames, or **Choose files** to select individual images.
4. For projector/fullscreen use, select a display and press **Move to display**, then **Fullscreen output**.

## Supported frame files

- PNG
- JPEG / JPG
- WebP
- BMP
- GIF
- TIFF / TIF

Frames are naturally sorted by filename, so `frame_2.png` appears before `frame_10.png` even when filenames are not zero-padded.

## Architecture

```text
controls window
  ├─ native folder/file dialog
  ├─ Rust directory scanner
  ├─ transport + cache settings
  └─ Tauri event bus
          ↓
output window
  ├─ image decode queue
  ├─ windowed or full cache
  ├─ playback clock + in/out range
  ├─ adjacent-frame blend
  ├─ WebGL framing / grade
  └─ display fullscreen + PNG export
```

The selected local paths are converted to Tauri asset URLs inside the output WebView. The output keeps at most four image decodes active at once and reports ready/loading/error counts back to the controls window.

## Playback modes

- **Loop**: wraps from the out point back to the in point.
- **Ping-pong**: reverses direction at each boundary.
- **Play once**: stops at the active boundary.
- **Drop late frames**: keeps real-time timing and may skip indices when rendering cannot keep up.
- **Hold every frame**: advances by no more than one frame per display refresh.
- **Blend adjacent frames**: interpolates between the current and next decoded frame.

## Cache modes

- **Window around playhead**: keeps a configurable radius around the current frame and evicts distant decoded images.
- **Preload all frames**: queues the entire sequence. This is useful for short sequences but can consume significant memory with high-resolution images.

## Keyboard shortcuts

- `Space`: play or pause
- `Left` / `Right`: step one frame
- `Shift + Left` / `Shift + Right`: step ten frames
- `R`: reverse direction

## Important implementation files

```text
src/app.js                 controls, file selection, transport, output commands
src/output.js              decoder cache, playback clock, WebGL renderer
src-tauri/src/main.rs      recursive directory scanner command
src-tauri/tauri.conf.json  two windows, dialogs, asset protocol, output permissions
```

## Notes

- Very large full-preload sequences can use substantial memory. Prefer the windowed cache for long 4K or 8K sequences.
- Animated GIF files are accepted as image sources, but the browser may animate the GIF internally; numbered still frames are the intended workflow.
- The example deliberately uses broad local asset access so selected arbitrary frame paths can be rendered. Narrow the asset scope for a production application.

## Playback stability update

This build waits for the current and next frame before starting a newly loaded file sequence. The default **Hold every frame** mode pauses the playback clock when decoding falls behind, then resumes from the same playhead instead of skipping into an empty cache.

- **Hold every frame** is the recommended default for PNG/JPEG sequences and high-resolution frames.
- **Drop late frames** keeps real-time timing and displays the nearest decoded frame when the exact frame is unavailable.
- Sequence FPS and playback-rate changes are coalesced before being sent to the output window, preventing slider traffic from congesting playback.
- An image sequence is a set of ordered stills where each file is one frame. A single dropped image cannot animate; unrelated images play as a slideshow in natural filename order.
