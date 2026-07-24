# 20 · Tauri v2 Live Video Switcher

A standalone Tauri v2 + raw WebGL example that turns four reusable media slots into a compact software video switcher. Each source can be an animated pattern, still image, looping video, or shared live camera. Independent Preview and Program buses feed GPU transitions, a lower-third/logo overlay, MediaRecorder capture, native saving, and PNG export.

## Run

```bash
npm install
npm run dev
```

On macOS, approve camera permission only when assigning the camera to a source slot.

## Signal flow

```text
Source 1 ┐
Source 2 ├─→ Preview / Program buses ─→ WebGL transition ─→ overlay ─→ stage
Source 3 ┤                                                       ├─→ MediaRecorder
Source 4 ┘                                                       └─→ PNG export
```

## Source rack

All four source slots support:

- Built-in animated test patterns
- Native Tauri v2 open dialog
- Browser file-picker fallback
- Native operating-system drag-and-drop
- PNG, JPEG, WebP, GIF, BMP, TIFF, AVIF, MP4, MOV, WebM, MKV, AVI, OGV, and OGG where the WebView supports them
- Shared selectable webcam
- Muted looping video playback
- Per-slot speed control for patterns and videos
- Play/pause for videos
- Live resolution and transport telemetry

Hover or click a source card before dropping a file. The highlighted card becomes the native drop target.

### Native media paths

Images and videos intentionally use different loading paths:

```text
Image → Rust bytes → Blob URL → WebGL texture
Video → authorized Tauri asset URL → video element → WebGL texture
```

The image path avoids WKWebView texture-security errors. The video path preserves streaming and seeking without loading the complete file into IPC memory.

## Switching

- Independent Preview and Program rows
- Direct Program selection
- Classic `CUT` operation that swaps Preview and Program
- `AUTO` transition using the chosen duration
- Manual T-bar
- Optional smooth easing
- Keyboard shortcuts:
  - `1`–`4`: select Preview
  - `C`: cut
  - `Space`: automatic transition

## GPU transitions

1. Dissolve
2. Horizontal wipe
3. Vertical wipe
4. Radial reveal
5. Box reveal
6. Noise dissolve
7. Luma melt

The four source textures remain resident in WebGL. The fragment shader chooses active Program and Preview sources, generates a transition mask, composites the overlay, and applies fade-to-black.

## Program graphics

- Editable title and subtitle
- Accent and text colors
- Opacity and vertical position
- Native/browser logo loading
- Program-only overlay

The lower third and logo are drawn into a transparent 2D canvas and uploaded as one WebGL texture.

## Output and recording

- Program view
- Preview view
- Four-source multiview
- Program/Preview borders in multiview
- Fade to black
- Native fullscreen preview
- 30 or 60 fps canvas recording
- WebM/MP4 codec negotiation
- Pause/resume recording
- Native Tauri v2 save dialog
- Chunked native writing for large recordings
- PNG current-frame snapshots

## Tauri v2 architecture

- Explicit capability file for core IPC and dialog permissions
- Official `tauri-plugin-dialog` for native open/save dialogs
- Rust commands inspect and authorize media paths
- Images return through `tauri::ipc::Response`
- Videos stream through the Tauri asset protocol
- Native drops arrive through `Webview::onDragDropEvent`
- Large files are written in sequential 1 MiB chunks

## macOS permissions

`src-tauri/Info.plist` includes `NSCameraUsageDescription`, and `entitlements.plist` enables camera access. Camera frames remain local to the app.

## Important WebView notes

- Video container and codec support depends on the operating-system WebView.
- Some large or unusually encoded videos may not expose a finite duration.
- Source videos are muted so playback can begin without an audio gesture.
- Recording captures the rendered stage, including transitions, overlay, logo, and fade-to-black.
- Only one shared camera stream is opened; assigning it to a new source restores the previous slot's pattern.

## Project layout

```text
20-tauri-v2-live-video-switcher/
├── package.json
├── README.md
├── V2-FOLDER-MAP.md
├── src/
│   ├── index.html
│   ├── styles.css
│   └── app.js
└── src-tauri/
    ├── Cargo.toml
    ├── Info.plist
    ├── entitlements.plist
    ├── tauri.conf.json
    ├── build.rs
    ├── capabilities/default.json
    ├── icons/
    └── src/main.rs
```
