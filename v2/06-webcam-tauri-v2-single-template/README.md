# Junkpile Example 06 — Webcam Texture Single Window

**Folder:** `webcam-tauri-v2-single-template`  
**Collection:** Tauri v2 Essentials  
**Renderer:** Raw WebGL 1 / GLSL ES 1.0  
**Window model:** One Tauri v2 WebView window

## What this example demonstrates

Example 06 connects a browser-managed camera stream to an explicit raw WebGL pipeline.
It demonstrates how to:

- enumerate available video-input devices;
- request camera permission with `navigator.mediaDevices.getUserMedia()`;
- place the selected stream in a hidden HTML `<video>` element;
- upload newly decoded video frames with `gl.texImage2D()`;
- expose the camera as a GLSL `sampler2D`;
- process that texture through six shader branches;
- retain the previous output in two ping-pong framebuffers;
- display the processed target with a separate blit program;
- report camera, shader, GPU, drawing-buffer, and frame-rate diagnostics;
- pause, reset, switch cameras, and toggle the native Tauri window fullscreen state.

The example remains intentionally focused. It is not a recorder, compositor, camera driver, routing system, or native capture implementation.

## Why this example exists

WebGL does not open a webcam itself. Camera capture belongs to the browser media layer, while texture processing belongs to the GPU layer. A useful webcam application must connect those systems explicitly:

```text
Operating-system camera
    ↓
getUserMedia MediaStream
    ↓
HTMLVideoElement decoder
    ↓
texImage2D upload
    ↓
WebGL sampler2D
    ↓
GLSL effect
```

This example makes that boundary visible. The camera and WebGL renderer have separate lifecycles: the GPU pipeline can initialize and remain responsive before permission is granted, after a camera is stopped, or when a camera request fails.

## Signal flow

### Camera capture and texture upload

```text
Camera selector
    ↓
navigator.mediaDevices.getUserMedia()
    ↓
MediaStream video track
    ↓
hidden <video autoplay playsinline muted>
    ↓
new decoded frame detected by video.currentTime
    ↓
gl.texImage2D(..., video)
    ↓
u_webcam sampler2D
```

Only a newly decoded frame is uploaded. If the render loop runs faster than the camera, the previous GPU texture is reused rather than uploading the same frame repeatedly.

### Effect and feedback path

```text
Camera texture ───────────────┐
                              ▼
Previous feedback texture → Effect GLSL program
                              ↓
                         Write framebuffer
                              ↓
                      Simple blit program
                              ↓
                         Visible canvas
                              ↓
                 Write/read targets exchange roles
```

The display pass uses a separate blit shader. This matters because rendering the effect framebuffer through the effect shader a second time would apply zoom, color processing, and other transforms twice.

### Controls path

```text
HTML sliders and switches
    ↓
JavaScript params object
    ↓
Explicit uniform uploads per rendered frame
    ↓
Effect GLSL program
```

### Native fullscreen path

```text
Fullscreen button or F key
    ↓
window.__TAURI__.core.invoke("toggle_fullscreen")
    ↓
Rust command
    ↓
app.get_webview_window("main")
    ↓
Native fullscreen state
```

## Effect modes

| Mode | Processing |
|---|---|
| Passthrough | Camera texture with only zoom and color controls |
| Wave Distort | Time-driven horizontal and vertical sine displacement |
| Radial Warp | Polar-coordinate radius modulation from the image center |
| Kaleidoscope | Six-sector mirrored rotational mapping |
| Edge Detect | Sobel luminance edge extraction using camera-pixel dimensions |
| Glitch | Time-stepped horizontal bands with independent RGB displacement |

## Architecture

### Frontend

`src/index.html` defines:

- the Junkpile example identity and lesson summary;
- camera selection, refresh, and start/stop controls;
- effect, feedback, color, and switch controls;
- camera and WebGL diagnostics;
- pause, reset, and fullscreen actions;
- the visible WebGL canvas;
- the hidden video element that receives the camera stream;
- nonfatal camera notices and a fatal renderer error layer.

`src/styles.css` provides the current Junkpile shell. The application uses a scrollable controls panel and renderer panel inside a fixed application grid. `min-height: 0` is applied to grid children so WKWebView activates scrolling immediately rather than only after a resize.

`src/app.js` contains:

1. default parameter state;
2. the fullscreen-quad vertex shader;
3. the webcam effect fragment shader;
4. the simple display/blit fragment shader;
5. explicit shader compilation and program linking;
6. fullscreen-quad buffer creation and attribute binding;
7. cached uniform locations;
8. webcam texture allocation and placeholder initialization;
9. camera enumeration, permission, switching, and stream cleanup;
10. unique-frame detection before `texImage2D()` uploads;
11. validated ping-pong framebuffer creation;
12. device-pixel-ratio-aware canvas and feedback-target resizing;
13. effect and display render passes;
14. renderer and texture-upload telemetry;
15. controls, keyboard shortcuts, pause, reset, and fullscreen behavior;
16. WebGL context-loss and media-device-change handling.

### Rust / Tauri

`src-tauri/src/main.rs` registers one command, `toggle_fullscreen`, and retrieves the configured Tauri 2 WebView with `get_webview_window("main")`.

`src-tauri/capabilities/main-capability.json` explicitly grants `core:default` to the `main` WebView label.

`src-tauri/Cargo.toml` includes a local workspace boundary:

```toml
[workspace]
resolver = "2"
```

This prevents Cargo from walking upward into an unrelated repository workspace.

### macOS camera declarations

`src-tauri/Info.plist` includes `NSCameraUsageDescription`, which supplies the text displayed by the macOS camera permission prompt.

`src-tauri/entitlements.plist` includes the camera entitlement used by the application bundle configuration.

The Tauri configuration points to the entitlement file through `bundle.macOS.entitlements`.

## Project structure

```text
webcam-tauri-v2-single-template/
├── README.md
├── package.json
├── package-lock.json
├── src/
│   ├── index.html
│   ├── styles.css
│   └── app.js
└── src-tauri/
    ├── build.rs
    ├── Cargo.toml
    ├── Cargo.lock
    ├── tauri.conf.json
    ├── Info.plist
    ├── entitlements.plist
    ├── capabilities/
    │   └── main-capability.json
    ├── icons/
    └── src/
        └── main.rs
```

## Requirements

- Rust toolchain supported by Tauri 2
- Node.js and npm
- A camera recognized by the operating system
- Platform prerequisites for Tauri 2
  - macOS: Xcode command-line tools
  - Windows: Microsoft C++ Build Tools and WebView2
  - Linux: Tauri/WebKitGTK dependencies and a working camera stack

## Install

```bash
cd webcam-tauri-v2-single-template
npm install
```

The Tauri CLI is a local development dependency. A global Tauri CLI installation is not required.

## Development

```bash
npm run dev
```

The WebGL renderer starts immediately. Press **Start Camera** to trigger the operating-system permission request and begin camera texture uploads.

## Production build

```bash
npm run build
```

Desktop bundles are written beneath:

```text
src-tauri/target/release/bundle/
```

A distributed macOS build still requires the appropriate signing and notarization workflow for the final application identity.

## Camera controls

### Video input

The device list is requested once during startup. Before permission is granted, the browser may:

- return generic names such as `Camera 1`;
- return blank labels;
- expose fewer devices than it reports after permission;
- return no usable device identifiers.

The selector and **Refresh Devices** button remain available before permission. After a successful camera request, the example enumerates again so real device labels can replace generic names.

### Start Camera

Requests a video-only stream with these preferences:

```text
1280 × 720 ideal resolution
30 fps ideal frame rate
60 fps maximum preference
```

These are preferences, not guarantees. The actual track settings are shown in Diagnostics.

If the selected device becomes stale or cannot satisfy its constraints, the example refreshes the device list and makes one fallback request for the default camera.

### Stop Camera

Stops every active media track, clears the camera texture to a dark placeholder pixel, and clears both feedback framebuffers. The WebGL renderer remains active.

### Switching devices

Selecting another device while a camera is running stops only the old media stream and requests the new source. The WebGL programs, buffers, textures, and UI remain in place.

### Device changes

The example listens for the browser `devicechange` event. Connecting or disconnecting a camera refreshes the selector without automatically seizing a new source.

## Visual controls

| Control | Role |
|---|---|
| Mode | Selects one of the six fragment-shader branches |
| Distortion | Controls wave, radial, kaleidoscope, or glitch strength |
| Feedback | Mixes the current result with the previous framebuffer |
| Zoom | Scales camera UV coordinates around the center |
| Warp Speed | Advances accumulated effect time without phase jumps |
| Hue Shift | Rotates RGB hue in degrees |
| Saturation | Mixes luminance and color |
| Brightness | Multiplies processed output |
| Contrast | Expands or compresses values around 0.5 |
| Mirror X | Reverses the camera texture horizontally |
| Invert | Replaces color with `1.0 - color` |
| Greyscale | Replaces RGB with luminance |

## Runtime actions

- **Pause:** freezes the rendered output and texture uploads while leaving the camera stream open and the interface responsive.
- **Reset:** restores parameter defaults, resets shader time, and clears feedback. It does not stop the camera.
- **Fullscreen:** toggles the native Tauri window state through Rust.
- **Refresh Devices:** enumerates video inputs again without restarting the active stream.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `C` | Start or stop the camera |
| `Space` | Pause or resume rendering |
| `R` | Reset parameters, shader time, and feedback |
| `F` | Toggle native fullscreen |

Shortcuts are ignored while an input, select, or button has focus.

## Diagnostics

The interface reports:

- camera lifecycle state;
- active track label;
- actual track width, height, and reported frame rate;
- unique video frames uploaded to the GPU per second;
- vertex shader compilation;
- effect and blit fragment shader compilation;
- both program-link results;
- rendered frames per second;
- device-pixel-ratio-aware drawing-buffer resolution;
- WebGL renderer string, using `WEBGL_debug_renderer_info` when available;
- camera, fullscreen, and renderer errors in visible UI rather than only the developer console.

## Camera error behavior

A camera error is nonfatal to WebGL. Permission denial, missing hardware, a busy device, or an ended track produces a visible camera notice while the renderer continues with its placeholder texture.

A WebGL initialization, shader, linker, framebuffer, or context-loss error is fatal to the renderer and displays a full renderer error layer.

## Tauri v2-specific behavior

This project uses:

- the Tauri 2 configuration schema;
- a Tauri 2 capability for the `main` WebView;
- `window.__TAURI__.core.invoke()` from vanilla JavaScript;
- `get_webview_window()` in Rust;
- a local `@tauri-apps/cli` dependency;
- `Info.plist` extension data for macOS camera permission text.

It does not use Tauri v1 allowlists or window APIs.

## Known limitations

- Camera capture is browser/WebView managed, not a native Rust capture path.
- Camera formats and frame rates are selected by the operating system and browser implementation.
- `texImage2D(video)` performs a browser-to-WebGL upload; it is not a zero-copy native texture bridge.
- The feedback targets use standard 8-bit RGBA textures.
- The render resolution follows the application window and is capped at a device pixel ratio of 2.
- Camera aspect ratio is mapped directly into the renderer dimensions and may stretch when source and window aspect ratios differ.
- There is no audio capture.
- There is no recording, Syphon, Spout, NDI, or network output.
- Permission recovery may require changing the operating-system privacy setting before another request can succeed.
- Exact camera behavior varies across WKWebView, WebView2, and WebKitGTK.

## Suggested experiments

1. Add a `contain` / `cover` aspect-ratio mode before applying effects.
2. Replace `texImage2D()` polling with `requestVideoFrameCallback()` where the target WebView supports it.
3. Add a third framebuffer pass for blur before feedback accumulation.
4. Compare 8-bit feedback textures with floating-point targets where extensions are available.
5. Add a source-resolution selector and compare camera upload cost at 720p and 1080p.
6. Move capture to Rust and compare the browser upload path with a native camera-to-GPU route.
7. Send the processed result into the future shared Junkpile/shared component layer output contract without changing this focused example.
