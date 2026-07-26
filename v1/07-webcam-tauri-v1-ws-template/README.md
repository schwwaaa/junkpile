# 07 · Tauri v1 Webcam WebSocket

A two-window Tauri v1 example that keeps HTML controls separate from live camera capture and raw WebGL rendering.

```text
controls.html
    │ parameter batches / camera commands
    ▼
ws://127.0.0.1:2727
    │ embedded Rust relay
    ▼
canvas.html
    │ getUserMedia → video → texImage2D
    ▼
GLSL effect → ping-pong history → output
```

## What this demonstrates

- Two Tauri v1 WebViews with explicit `controls` and `canvas` roles
- An embedded Rust WebSocket relay
- Camera capture inside the same WebView that owns WebGL
- Pre-permission device enumeration and post-permission labels
- Restartable camera selection and capture presets
- Camera frames uploaded with `gl.texImage2D()`
- Six GLSL camera effects
- Persistent ping-pong feedback
- Separate effect and blit programs
- Reconnect-safe parameter and camera state synchronization
- Output FPS, camera FPS, resolution, GPU, shader, and camera telemetry

## Requirements

- Rust and Cargo
- Node.js and npm
- macOS: Xcode command-line tools
- A camera or virtual camera for live-input testing

## Development

```bash
npm install
npm run dev
```

Approve camera permission when requested. The output displays a generated calibration field until a camera is running.

## Production build

```bash
npm install
npm run build
```

The macOS production bundles are created under:

```text
src-tauri/target/release/bundle/
```

Unsigned local builds may be stopped by Gatekeeper on another Mac. Distribution requires the normal Apple signing and notarization process.

## Window responsibilities

### Controls window

- Owns the current visual parameter state
- Requests camera start, stop, restart, and device enumeration
- Sends parameter batches once per animation frame
- Restores the complete state when the output reconnects
- Displays renderer and camera telemetry

### Output window

- Owns `navigator.mediaDevices.getUserMedia()`
- Owns the hidden `<video>` element and `MediaStream`
- Owns the WebGL context, camera texture, shader programs, and feedback buffers
- Sends camera/device/render status to the controls window

A `MediaStream` is not transferred between the two windows. The camera stays in the output WebView where its frames are consumed.

## Camera presets

- 640 × 480
- 1280 × 720
- 1920 × 1080
- Highest available

These are ideal constraints, not guarantees. The selected camera may return a different supported format.

## Effects

1. Passthrough
2. Wave distortion
3. Radial warp
4. Kaleidoscope
5. Edge detection
6. Glitch bands

## Keyboard shortcuts

From the controls window:

- `Space`: pause/resume rendering
- `R`: reset parameters
- `X`: clear feedback history
- `S`: synchronize the complete state
- `F`: toggle output fullscreen

From the output window:

- `F`: toggle its own fullscreen state

## macOS permissions

`src-tauri/Info.plist` contains the camera usage explanation. `entitlements.plist` enables camera access in the packaged application.

## Important extension points

- Add a parameter in `controls.html` and `controls.js`
- Add the corresponding property in `canvas.js`
- Declare and upload a matching GLSL uniform
- Add new camera constraints in `captureConstraints()`
- Extend telemetry without changing the Rust relay

## Known limitations

- Browser camera support depends on the platform WebView and installed codecs/drivers.
- Capture constraints are requests rather than guaranteed formats.
- The relay binds to local loopback only.
- Windows and Linux camera packaging should be verified independently.
