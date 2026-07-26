# 06 · Tauri v1 Webcam Texture Single Window

A focused foundation for capturing a webcam inside a Tauri v1 WebView and uploading each decoded frame into a raw WebGL texture.

This folder intentionally retains its original repository name:

```text
webcam-tauri-v1-single-template
```

The visible example number is **06** so it aligns with the complete Junkpile Tauri v1 Essentials sequence.

## What this example teaches

- Requesting camera permission with `navigator.mediaDevices.getUserMedia()`
- Enumerating and switching video-input devices
- Reading the active camera resolution and requested frame rate
- Uploading an HTML video frame with `gl.texImage2D()`
- Preserving source aspect ratio with contain, cover, and stretch framing
- Running multiple GLSL effects against a live media texture
- Creating two persistent framebuffer textures for visual feedback
- Using a separate blit program so the processed frame is not graded twice
- Handling WebGL context loss and native-window fullscreen
- Packaging camera permissions for macOS

## Signal flow

```text
Camera hardware
      ↓
getUserMedia()
      ↓
HTMLVideoElement
      ↓
gl.texImage2D()
      ↓
GLSL effect + color grade
      ↓
ping-pong history framebuffer
      ↓
blit shader
      ↓
WebGL canvas
```

Camera frames remain entirely inside the WebView. Rust does not copy or process the video stream.

## Run

```bash
npm install
npm run dev
```

Press **Start camera** and approve the operating-system permission prompt. After approval, refresh the camera list if device labels remain generic.

## Production build

```bash
npm run build
```

On macOS, generated bundles are placed under:

```text
src-tauri/target/release/bundle/
```

Public distribution generally requires Apple signing and notarization. The project includes `Info.plist` camera usage text and the camera sandbox entitlement.

## Controls

| Section | Control | Purpose |
|---|---|---|
| Camera | Device | Selects a video-input device |
| Camera | Request | Requests 480p, 720p, 1080p, or the highest available mode |
| Camera | Framing | Chooses contain, cover, or stretch source mapping |
| Effect | Mode | Selects passthrough, wave, radial, kaleidoscope, edge, or glitch processing |
| Effect | Distortion | Controls the selected spatial effect |
| Effect | Feedback | Mixes the previous processed frame into the current frame |
| Effect | Zoom | Scales source coordinates |
| Effect | Warp speed | Advances time-based effects |
| Color | Hue / saturation / brightness / contrast | Grades the processed image |
| Switches | Mirror / invert / greyscale | Enables common camera and color flags |

Keyboard shortcuts:

| Key | Action |
|---|---|
| Space | Pause or resume renderer updates without closing the camera |
| R | Restore defaults and reset animation time |
| X | Clear both feedback history buffers |
| F | Toggle native-window fullscreen |

## Project structure

```text
webcam-tauri-v1-single-template/
├── README.md
├── MODERNIZATION-NOTES.md
├── package.json
├── src/
│   ├── index.html
│   ├── sketch.js
│   └── styles.css
└── src-tauri/
    ├── Cargo.toml
    ├── Info.plist
    ├── entitlements.plist
    ├── tauri.conf.json
    └── src/main.rs
```

## Camera-device behavior

Browsers and WKWebView may hide meaningful camera labels until permission has been granted once. The Refresh button remains available before permission so the UI never becomes permanently locked in an empty state.

Changing the selected device or requested capture size while the camera is active stops the old tracks first and then opens a new stream. This avoids retaining multiple cameras or conflicting tracks.

## Feedback implementation

Two RGBA textures alternate roles each frame:

```text
Frame N:   history B → effect → history A → screen
Frame N+1: history A → effect → history B → screen
```

The screen copy uses a separate blit shader. This avoids applying hue, contrast, effects, or feedback a second time during display.

## Known limitations

- Camera formats and maximum resolutions are decided by the operating system and WebKit.
- Requested resolution and frame rate are preferences, not guarantees.
- The camera stays open when renderer updates are paused.
- This example uses browser WebGL rather than native wgpu.
- Windows and Linux camera permission behavior should be tested independently.
