# Junkpile Example 07 — Webcam Texture WebSocket Windows

**Folder:** `webcam-tauri-v2-ws-template`  
**Tauri:** 2.x  
**Renderer:** Raw WebGL 1 / GLSL ES 1.0  
**Windows:** Dedicated controls WebView + dedicated renderer WebView  
**Transport:** Embedded loopback WebSocket relay on port `2727`

## What this example demonstrates

Example 07 separates camera control from camera ownership.

The controls window chooses a device, changes uniforms, pauses the renderer, and requests fullscreen. Those instructions travel through a Rust WebSocket relay. The canvas window receives the instructions and performs every media and graphics operation locally:

```text
Controls WebView
  sliders / toggles / camera intent
              │
              │ JSON text messages
              ▼
Rust WebSocket relay · ws://127.0.0.1:2727
              │
              ▼
Canvas WebView
  getUserMedia permission
       ↓
  hidden HTMLVideoElement
       ↓ decoded frame
  texImage2D camera upload
       ↓
  GLSL effect pass
       ↓
  ping-pong feedback FBOs
       ↓
  blit pass → visible canvas
              │
              └── telemetry → relay → controls
```

The `MediaStream` never crosses the WebSocket. A browser camera stream cannot be transferred from one Tauri WebView to another. The renderer must own the camera, video element, WebGL context, texture, and feedback history.

## Why this example exists

Example 06 teaches camera-to-texture processing in one window. Example 07 adds a realistic remote-control boundary without hiding the browser media pipeline.

It demonstrates:

- camera commands sent across windows;
- camera permission requested in the consuming renderer WebView;
- WebSocket state synchronization and reconnect recovery;
- sliders coalesced to at most one send per animation frame;
- a renderer that remains alive when the camera is idle, denied, missing, or switched;
- decoded-frame-aware texture uploads rather than uploading the same frame repeatedly;
- shader, program, camera, texture-upload, renderer, and drawing-buffer telemetry returned to the controls window.

## Architecture

### Rust responsibility

`src-tauri/src/main.rs` starts two loopback listeners:

- `127.0.0.1:2727`
- `[::1]:2727`

Each WebView identifies itself with a hello message. The relay broadcasts text messages to every other client. It does not interpret camera frames or graphics data.

The same Rust file exposes `toggle_canvas_fullscreen`, which retrieves the configured `canvas` WebView with `get_webview_window()` and toggles native fullscreen.

### Controls responsibility

`src/controls.js` owns the authoritative user-facing state:

- effect parameters;
- toggle values;
- paused state;
- selected device;
- whether the user intends the camera to be running.

When the canvas reconnects, the controls window resends the complete state and requests device enumeration. If camera intent was active, it asks the new canvas instance to start the selected device.

### Canvas responsibility

`src/canvas.js` owns:

- `navigator.mediaDevices`;
- permission prompts;
- the active `MediaStream`;
- the hidden video element;
- decoded-frame detection;
- WebGL shader compilation and linking;
- the camera texture;
- two feedback framebuffer targets;
- the render loop and telemetry.

## WebSocket protocol

Important message families:

```text
controls → canvas
  state-sync       complete parameter and pause state
  param            one changed uniform
  camera-command   enumerate, start, or stop
  action           pause, feedback reset, or fullscreen

canvas → controls
  canvas-ready      renderer is available for state restoration
  camera-devices    device IDs and labels
  camera-status     running, stopped, ended, or error
  runtime           renderer state
  diagnostic        one telemetry field
  error-log         camera, WebGL, or Tauri error details
  paused-state      authoritative renderer pause state
  renderer-state    canvas-keyboard reset reflected in controls
```

Slider traffic is coalesced with `requestAnimationFrame`, preventing a WebSocket message for every tiny pointer event.

## WebGL signal path

The renderer compiles:

1. one fullscreen-quad vertex shader;
2. one effect fragment shader;
3. one simple blit fragment shader.

The effect pass writes to the current feedback framebuffer. The blit pass displays that already-processed texture without applying color correction a second time.

The six effect branches are:

1. Passthrough
2. Wave Distort
3. Radial Warp
4. Kaleidoscope
5. Edge Detect
6. Glitch

## Project structure

```text
webcam-tauri-v2-ws-template/
├── README.md
├── package.json
├── package-lock.json
├── src/
│   ├── controls.html
│   ├── controls.js
│   ├── canvas.html
│   ├── canvas.js
│   └── styles.css
└── src-tauri/
    ├── Cargo.toml
    ├── Cargo.lock
    ├── Info.plist
    ├── entitlements.plist
    ├── capabilities/
    │   └── main-capability.json
    ├── src/
    │   └── main.rs
    └── tauri.conf.json
```

## Installation and development

```bash
cd webcam-tauri-v2-ws-template
npm install
npm run dev
```

The controls and canvas windows open automatically. Start the camera from the controls window. The operating-system permission prompt belongs to the canvas window because that WebView calls `getUserMedia()`.

## Production build

```bash
npm run build
```

Tauri writes platform bundles under:

```text
src-tauri/target/release/bundle/
```

Unsigned macOS applications may be blocked by Gatekeeper when distributed to another computer. Production distribution normally requires code signing and notarization.

## Controls

- **Camera selector:** chooses the requested video input.
- **Start/Stop Camera:** sends camera intent to the renderer.
- **Refresh Devices:** asks the renderer to enumerate devices again.
- **Mode:** chooses the GLSL effect branch.
- **Distortion:** controls effect intensity.
- **Feedback:** mixes the previous processed frame.
- **Zoom:** scales camera UV coordinates.
- **Warp Speed:** advances effect time without discontinuities.
- **Hue, Saturation, Brightness, Contrast:** post-process color controls.
- **Mirror, Invert, Greyscale:** boolean controls represented as float uniforms.
- **Pause:** stops rendering while retaining camera ownership and state.
- **Reset:** restores parameters and clears feedback history.
- **Canvas Fullscreen:** toggles the renderer window, not the controls window.

Keyboard shortcuts in either window:

```text
Space  pause / resume
R      reset parameters or renderer feedback
C      start / stop camera
F      toggle canvas fullscreen
```

## Diagnostics

The controls window displays telemetry generated by the renderer:

- camera state;
- active device label;
- stream dimensions and reported frame rate;
- unique decoded-frame texture-upload rate;
- vertex and fragment shader compilation;
- effect and blit program linking;
- render FPS;
- drawing-buffer dimensions;
- WebGL renderer string;
- clear camera, shader, WebGL-context, and fullscreen errors.

Render FPS and texture-upload FPS are intentionally separate. A 60 Hz render loop may repeatedly display a 30 fps camera, but the renderer should upload only newly decoded video frames.

## Reconnect behavior

The controls window is the authority for parameters and camera intent. The renderer requests a complete state after opening or reconnecting.

- If only the controls window reconnects, the existing camera stream stays in the canvas window.
- If the canvas window reloads, the old stream is destroyed with that WebView. The controls window restores parameters and can request the selected camera again.
- Feedback history is local GPU state and cannot survive a renderer reload.

## Tauri 2 details

- The configuration uses the Tauri 2 schema.
- Both WebView labels are included in `capabilities/main-capability.json`.
- Vanilla JavaScript uses `window.__TAURI__.core.invoke()` for native fullscreen.
- Rust retrieves the canvas with `get_webview_window("canvas")`.
- `[workspace] resolver = "2"` isolates this standalone project from parent Cargo workspaces.
- The content security policy explicitly permits the loopback WebSocket and browser camera media sources.
- `Info.plist` includes `NSCameraUsageDescription` for macOS.
- `entitlements.plist` enables the macOS camera entitlement.

## Known limitations

- Camera availability, labels, frame rates, and supported dimensions depend on the operating system and WebView backend.
- Labels may be blank before permission is granted.
- A camera already opened by another application can fail with `NotReadableError`.
- The renderer clamps drawing-buffer pixel ratio to `2` to avoid excessive framebuffer allocation.
- The relay is a focused local teaching implementation, not an authenticated network service.
- WebGL context restoration reloads the renderer because every texture and framebuffer must be rebuilt.
- Camera streams are intentionally not transmitted through WebSocket. That would require a different encoded-media architecture such as WebRTC, NDI, or FFmpeg/network streaming.

## Suggested experiments

1. Add requested resolution and frame-rate selectors to the controls protocol.
2. Compare render FPS with texture-upload FPS for 30 fps and 60 fps cameras.
3. Add a reconnect counter and measure state restoration after reloading either WebView.
4. Add a second camera texture and build a local two-source mixer in the canvas window.
5. Replace the text relay with Tauri events and compare message timing.
6. Add a source-size-aware aspect-fit or aspect-fill control.
7. Route the processed canvas into a recorder example without moving camera ownership.
