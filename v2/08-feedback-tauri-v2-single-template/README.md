# Junkpile Example 08 — Feedback Lab Single Window

**Folder:** `feedback-tauri-v2-single-template`  
**Collection:** Tauri v2 Essentials  
**Renderer:** Raw WebGL 1 / GLSL ES 1.0  
**Window model:** One Tauri v2 WebView window

## What this example demonstrates

Example 08 is a focused study of persistent GPU feedback driven by a live camera texture. It demonstrates how to:

- capture a camera with `navigator.mediaDevices.getUserMedia()`;
- upload only newly decoded camera frames into a WebGL texture;
- allocate and validate two framebuffer-backed textures;
- read the previous simulation state while writing the next state;
- exchange the framebuffer read/write roles after every frame;
- separate simulation state from display color using two linked GLSL programs;
- run six feedback algorithms from one explicit shader pipeline;
- inject state interactively through pointer coordinates and a brush radius;
- clear or reinitialize feedback safely when the mode, size, or camera changes;
- report camera, shader, framebuffer, texture-format, GPU, and frame-rate diagnostics;
- pause, reset, and toggle the native Tauri window fullscreen state.

The example is intentionally not a recorder, compositor, router, native camera driver, or general node system. Its lesson is persistent texture state.

## Why this example exists

A normal WebGL pass is stateless: the shader receives textures and uniforms, writes pixels, and the next frame begins again. Feedback changes that model by making the prior output one of the next frame's inputs.

```text
Current webcam texture ───────────────┐
                                      ▼
Previous feedback texture → Simulation program → Next feedback texture
                                      │
                                      ▼
                               Display program
                                      │
                                      ▼
                                Visible canvas
```

WebGL cannot sample from the same texture currently attached as the render destination. Two targets are therefore required:

```text
Frame N
  Read target B → write target A → display A → swap roles

Frame N + 1
  Read target A → write target B → display B → swap roles
```

That read/write exchange is the central concept of the example.

## Signal flow

### Camera input

```text
Operating-system camera
    ↓
getUserMedia MediaStream
    ↓
hidden HTMLVideoElement
    ↓
new decoded frame detected
    ↓
gl.texImage2D(..., video)
    ↓
u_webcam sampler2D
```

The camera and renderer have separate lifecycles. The WebGL pipeline initializes before permission, remains active when the camera is stopped, and uses a one-pixel black placeholder whenever no stream is available.

### Simulation and display

```text
Texture unit 0: previous feedback target
Texture unit 1: current camera texture
    ↓
Simulation fragment shader
    ↓
write framebuffer
    ↓
Display fragment shader
    ↓
palette mapping + tone mapping
    ↓
window canvas
```

The simulation program stores state. The display program colors that state without feeding the palette conversion back into the simulation.

### Brush injection

```text
Pointer position on canvas
    ↓
normalized UV coordinate
    ↓
u_mouse + u_mouseDown + u_brushSize
    ↓
localized state injection in simulation shader
```

In Reaction-Diffusion mode, the brush injects the V activator. In the other modes it injects a time-varying color.

## Feedback modes

| Mode | Stored-state behavior | Camera behavior |
|---|---|---|
| Echo Trail | Previous RGB is multiplied by Decay | Camera RGB is added each frame |
| Fluid Smear | Previous state is advected through curl noise | Camera edges increase flow and camera RGB is injected |
| Reaction-Diffusion | Red and green channels store Gray-Scott U and V chemicals | Camera luminance injects V and removes U |
| Thermal | A nine-tap diffusion pass spreads stored energy | Camera luminance acts as a heat source |
| Mirror Echo | Previous state is sampled through a contracting symmetry fold | Camera is sampled through a six-way mirror fold |
| Glitch Memory | Previous RGB is block-shifted with chromatic offsets | Camera is injected with matching aberration |

Changing modes clears the persistent state because each mode interprets the texture channels differently. Reaction-Diffusion initializes both targets with `U = 1`, while the image modes initialize to near-black.

## Framebuffer format negotiation

The example prefers floating-point feedback because several modes can store values outside the normalized byte range. WebGL 1 support varies by platform, so startup performs an actual framebuffer completeness test:

```text
Try RGBA + FLOAT target
    ↓ complete? yes → use float target
    ↓ no
Use RGBA8 unsigned-byte target
```

The selected target format appears in Diagnostics and in the renderer HUD. RGBA8 remains functional, but very subtle feedback gradients and reaction-diffusion state may quantize more visibly.

## Architecture

### Frontend

`src/index.html` defines the Junkpile application shell, camera controls, six mode buttons, simulation parameters, color parameters, brush control, diagnostics, action buttons, renderer canvas, camera notice, and fatal renderer error layer.

`src/styles.css` provides the scroll-safe two-panel interface. The application grid and both child panels use `min-height: 0`, so the controls panel scrolls immediately in WKWebView rather than only after the window is resized.

`src/app.js` contains:

1. default parameter state and mode descriptions;
2. the fullscreen-quad vertex shader;
3. the original six-branch simulation fragment shader;
4. the separate palette/display fragment shader;
5. explicit shader compilation and program linking;
6. cached attribute and uniform locations;
7. camera texture allocation and unique-frame upload detection;
8. camera enumeration, permission, switching, and stream cleanup;
9. floating-point framebuffer probing with RGBA8 fallback;
10. two validated ping-pong targets;
11. mode-aware state clearing and resize rebuilding;
12. simulation and display passes;
13. pointer brush injection;
14. render and texture-upload telemetry;
15. controls, keyboard shortcuts, pause, reset, and fullscreen behavior;
16. WebGL context-loss and camera-device-change handling.

### Rust / Tauri

`src-tauri/src/main.rs` registers `toggle_fullscreen` and retrieves the configured Tauri 2 WebView with `get_webview_window("main")`.

`src-tauri/capabilities/main-capability.json` grants `core:default` to the `main` WebView label.

`src-tauri/Cargo.toml` contains a local workspace boundary:

```toml
[workspace]
resolver = "2"
```

### macOS camera declarations

`src-tauri/Info.plist` supplies `NSCameraUsageDescription` for the macOS permission prompt. `src-tauri/entitlements.plist` contains the camera entitlement referenced by `tauri.conf.json`.

## Project structure

```text
feedback-tauri-v2-single-template/
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
- Platform prerequisites for Tauri 2
- A camera recognized by the operating system for live-input testing

## Install and run

```bash
cd feedback-tauri-v2-single-template
npm install
npm run dev
```

## Production build

```bash
npm run build
```

On macOS, production bundles are written below:

```text
src-tauri/target/release/bundle/
```

Unsigned or unnotarized applications may be blocked by Gatekeeper when moved to another computer.

## Controls

### Camera

- **Video input:** select a camera. Labels may be generic until permission is granted.
- **Start Camera / Stop Camera:** owns the `MediaStream` lifecycle.
- **Refresh Devices:** re-enumerates video inputs before or after permission.

### Simulation

- **Mode:** selects one of the six simulation branches.
- **Decay:** controls prior-state retention.
- **Camera Mix:** controls how much current camera data enters the persistent state.
- **Speed:** advances a continuous accumulated shader clock. Changing it does not jump to a new wall-clock phase.
- **Flow Scale:** changes curl-noise frequency in Fluid Smear.
- **Intensity:** changes camera injection and distortion strength.

### Display and brush

- **Hue Drift:** offsets the display palette.
- **Palette:** selects Fire, Ice, Acid, Void, or Rainbow.
- **Brush Size:** controls direct pointer injection radius.
- **Clear Feedback State:** clears both physical targets without changing controls.
- **Reset:** restores all defaults, resets shader time, and clears both targets.

### Keyboard

| Key | Action |
|---|---|
| `C` | Start or stop camera |
| `Space` | Pause or resume simulation |
| `X` | Clear feedback state |
| `R` | Reset parameters and time |
| `F` | Toggle native fullscreen |
| `1`–`6` | Select feedback mode |

## Tauri v2-specific behavior

- Configuration uses the Tauri 2 schema.
- `app.withGlobalTauri` exposes `window.__TAURI__.core.invoke()` to vanilla JavaScript.
- The capability file explicitly includes the `main` WebView label.
- Rust retrieves the configured window with `get_webview_window()`.
- No Tauri v1 allowlist syntax is used.

## Known limitations

- Camera capture is browser/WebView-managed rather than native capture.
- Device labels can remain generic until permission is granted.
- Some cameras ignore ideal resolution or frame-rate constraints.
- Floating-point render targets are extension-dependent in WebGL 1; the app falls back to RGBA8.
- Feedback targets are rebuilt at drawing-buffer resolution and capped at a device-pixel ratio of 2. Extremely large windows still increase GPU memory and shader cost.
- Reaction-Diffusion is a compact educational approximation rather than a physically exact solver.
- WebGL context recovery reloads the page because camera textures and framebuffer state must be reconstructed.

## Suggested experiments

1. Remove `u_prev` from Echo Trail to compare a stateless camera pass with temporal feedback.
2. Route palette-colored output back into simulation instead of raw state and observe how quickly color transforms destabilize the system.
3. Add a half-resolution simulation scale to compare performance and diffusion behavior.
4. Change the Reaction-Diffusion feed and kill constants.
5. Replace camera luminance injection with edge-only injection.
6. Add a third framebuffer for a dedicated velocity or mask state.
7. Record the framebuffer locally in a later, separate example rather than expanding this focused template.

## Educational boundary

This example teaches camera-driven persistent GPU state inside one Tauri v2 WebView. Later applications may add routing, recording, native capture, or shared I/O contracts, but those concerns are deliberately excluded here so the ping-pong feedback mechanism remains explicit.
