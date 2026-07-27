# Junkpile Example 09 — Feedback Lab WebSocket Windows

**Folder:** `feedback-tauri-v2-ws-template`  
**Collection:** Tauri v2 Essentials  
**Renderer:** Raw WebGL 1 / GLSL ES 1.0  
**Window model:** Two Tauri v2 WebView windows connected by an embedded loopback WebSocket relay

## What this example demonstrates

Example 09 combines the persistent GPU-feedback lesson from Example 08 with a two-window control architecture. It demonstrates how to:

- separate a control interface from a dedicated live renderer;
- relay JSON messages through Rust on `ws://127.0.0.1:2727`;
- keep `getUserMedia()`, the `MediaStream`, the hidden video element, camera texture uploads, WebGL programs, and framebuffer state in one renderer WebView;
- retain authoritative parameter and camera-intent state in the controls WebView;
- restore parameters after either window reconnects;
- coalesce slider traffic to at most one message per animation frame;
- compile and link one fullscreen-quad vertex shader, one simulation fragment shader, and one display fragment shader;
- allocate and validate two framebuffer-backed textures;
- read the prior simulation result while writing the next persistent state;
- exchange framebuffer read/write roles after every frame;
- select six distinct temporal feedback simulations;
- inject feedback state directly with pointer input in the canvas window;
- enumerate cameras before permission and refresh labels after permission;
- upload only newly decoded camera frames;
- distinguish render FPS from camera texture-upload FPS;
- return camera, shader, framebuffer, texture-format, GPU, connection, and frame-rate telemetry to the controls window;
- pause, clear, reset, and toggle native canvas fullscreen state without mixing Tauri v1 configuration or APIs into the project.

The example remains deliberately focused. It is not a recorder, compositor, media router, authenticated network service, or native camera framework.

## Why this example exists

A normal WebGL pass is stateless. A feedback renderer becomes temporal by making the previous output one of the next frame's inputs.

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

The two-window version adds another concern: user controls and renderer-owned resources live in separate WebViews.

```text
Controls WebView
  parameters + camera intent + pause state
              │
              │ JSON over ws://127.0.0.1:2727
              ▼
Embedded Rust relay
              │
              ▼
Canvas WebView
  camera + video decoder + WebGL + brush + FBO history
```

A `MediaStream`, WebGL texture, or framebuffer cannot be serialized and sent through this relay. The protocol therefore carries only commands, numeric state, and diagnostics.

## Ownership model

### Controls window owns

- current mode and parameter values;
- paused intent;
- selected camera device ID;
- whether the user intends camera input to be running;
- human-readable device list and renderer diagnostics;
- reconnect restoration messages.

### Canvas window owns

- camera permission prompts;
- active `MediaStream` and camera track;
- hidden `HTMLVideoElement`;
- unique decoded-frame detection;
- camera texture and placeholder texture;
- GLSL compilation and program linking;
- fullscreen-quad buffer and uniform locations;
- two ping-pong framebuffer targets;
- brush pointer state;
- accumulated simulation time;
- render loop and all GPU telemetry.

### Rust owns

- loopback WebSocket listeners for IPv4 and IPv6;
- client registration and role logging;
- broadcast of text messages to the other connected WebView;
- the Tauri command that toggles the `canvas` WebView fullscreen state.

## Signal flow

### Camera input

```text
Operating-system camera
    ↓
getUserMedia in canvas WebView
    ↓
hidden HTMLVideoElement
    ↓
new decoded frame detected
    ↓
gl.texImage2D(..., video)
    ↓
u_webcam sampler2D
```

The camera stream never crosses the WebSocket. Stopping the camera replaces its texture with a one-pixel dark placeholder, while the simulation and brush remain operational.

### Ping-pong simulation

WebGL cannot safely sample from a texture while that same texture is attached as the active render destination. The renderer therefore uses two physical targets:

```text
Frame N
  Read target B → write target A → display A → swap roles

Frame N + 1
  Read target A → write target B → display B → swap roles
```

The simulation program stores state. The display program applies palette mapping and tone mapping without feeding that presentation color back into the simulation.

### Brush injection

```text
Pointer on renderer canvas
    ↓
normalized canvas UV
    ↓
u_mouse + u_mouseDown + u_brushSize
    ↓
localized simulation-state injection
```

Reaction-Diffusion mode injects the V activator. The other modes inject a time-varying color.

## Feedback modes

| Mode | Stored-state behavior | Camera behavior |
|---|---|---|
| Echo Trail | Previous RGB is multiplied by Decay | Current camera RGB is added every frame |
| Fluid Smear | Previous state is advected through curl noise | Camera edges increase flow and camera RGB is injected |
| Reaction-Diffusion | Red and green store Gray-Scott U and V chemicals | Camera luminance injects V and removes U |
| Thermal | A nine-tap neighborhood diffuses stored energy | Camera luminance becomes a continuous heat source |
| Mirror Echo | Previous state contracts through a six-sector symmetry fold | Camera is sampled through the same kaleidoscopic fold |
| Glitch Memory | Previous RGB is block-shifted with chromatic offsets | Camera is injected with matching aberration |

Changing modes clears both physical feedback targets because the simulation branches interpret stored channels differently. Reaction-Diffusion initializes with `U = 1`; image modes initialize near black.

## Framebuffer format negotiation

The renderer prefers floating-point state because several modes can accumulate values outside the normalized byte range. WebGL 1 support differs across systems, so the app performs an actual framebuffer-completeness test:

```text
Try RGBA + FLOAT target
    ↓ complete? yes → use floating-point feedback
    ↓ no
Use RGBA8 unsigned-byte feedback
```

The selected format is shown in both the controls diagnostics and renderer HUD. RGBA8 remains functional, but subtle gradients and chemical state can quantize more visibly.

## WebSocket protocol

### Controls → canvas

```text
state-sync
  Complete parameter and paused state.

param
  One coalesced parameter update.

action
  set-mode, set-paused, clear-feedback, reset-feedback, or fullscreen.

camera-command
  enumerate, start, or stop, with an optional deviceId.

request-state
  Ask an existing renderer to replay readiness and telemetry.
```

### Canvas → controls

```text
canvas-ready / request-state
  Renderer is ready for state restoration.

runtime
  Renderer ready, camera idle, running, paused, or error state.

diagnostic
  One camera, shader, FBO, GPU, resolution, or FPS field.

error-log
  Camera, WebGL, or Tauri error details.

camera-devices
  Device IDs and labels reported by the canvas WebView.

camera-status
  Requesting, running, stopped, ended, or error.

paused-state
  Authoritative pause state, including canvas keyboard actions.

renderer-state
  Complete parameters after a canvas-side reset or mode shortcut.
```

Slider input is collected in a `Map` and flushed through `requestAnimationFrame()`. Repeated motion of one slider replaces its pending value rather than generating unbounded socket traffic.

## Reconnect behavior

The controls window is the authority for user-facing state. When the canvas reconnects, controls resend:

1. all parameters;
2. paused state;
3. a camera enumeration request;
4. camera start intent and selected device when applicable.

The renderer avoids restarting an already-running camera when the same device is requested after a controls-only reconnect.

Persistent feedback history is GPU-local state. It cannot survive a canvas reload or WebGL context loss. A new renderer correctly begins with newly initialized framebuffer targets rather than pretending that prior texture history was restored.

## Frontend architecture

### `src/controls.html`

Defines the Junkpile control shell, connection pills, camera controls, six mode buttons, simulation parameters, palette controls, brush size, renderer diagnostics, and action buttons.

### `src/controls.js`

Contains:

1. authoritative defaults and state;
2. fixed-width value formatting;
3. animation-frame parameter coalescing;
4. WebSocket connection and reconnect behavior;
5. renderer-state restoration;
6. camera intent and device selection;
7. diagnostic and error-log display;
8. pause, clear, reset, mode, camera, and fullscreen commands;
9. keyboard shortcuts;
10. protection against replacing a slider value while that slider is actively dragged.

### `src/canvas.html`

Defines the full-window renderer canvas, camera-status notice, renderer HUD, fatal error layer, and hidden video element.

### `src/canvas.js`

Contains:

1. the original six-branch simulation shader;
2. the separate palette/display shader;
3. explicit shader compilation and linking;
4. cached attributes and uniforms;
5. camera enumeration, permission, switching, and cleanup;
6. unique-frame camera uploads;
7. floating-point framebuffer probing with RGBA8 fallback;
8. two validated ping-pong targets;
9. mode-aware clear and resize behavior;
10. accumulated simulation time;
11. direct pointer brush injection;
12. render and texture-upload telemetry;
13. bidirectional WebSocket state synchronization;
14. native canvas fullscreen invocation;
15. WebGL context-loss handling.

### `src/styles.css`

Provides a shared visual language for both windows. The controls shell, panel, and child layout use explicit `min-height: 0` and panel-local `overflow-y: auto`, so scrolling works immediately on first launch without resizing the window.

## Rust and Tauri architecture

`src-tauri/src/main.rs` starts embedded WebSocket listeners on:

```text
127.0.0.1:2727
[::1]:2727
```

Each connection identifies itself as `controls` or `canvas`. The relay broadcasts each text message to all other connected clients.

The `toggle_canvas_fullscreen` command retrieves the configured renderer through:

```rust
app.get_webview_window("canvas")
```

`src-tauri/capabilities/main-capability.json` grants `core:default` to both configured WebView labels.

`src-tauri/Cargo.toml` includes a standalone workspace boundary:

```toml
[workspace]
resolver = "2"
```

This prevents Cargo from walking upward into an unrelated parent workspace.

## macOS camera declarations

`src-tauri/Info.plist` includes `NSCameraUsageDescription` for the system permission prompt.

`src-tauri/entitlements.plist` includes the camera entitlement referenced by `tauri.conf.json`.

## Project structure

```text
feedback-tauri-v2-ws-template/
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

## Installation and development

```bash
cd feedback-tauri-v2-ws-template
npm install
npm run dev
```

Both windows open automatically. Camera permission belongs to the renderer window because that WebView calls `getUserMedia()`.

## Production build

```bash
npm run build
```

Tauri writes platform bundles below:

```text
src-tauri/target/release/bundle/
```

Unsigned or unnotarized macOS applications may be blocked by Gatekeeper when moved to another computer.

## Controls

### Camera

- **Video input:** selects the requested camera. Labels can remain generic until permission is granted.
- **Start Camera / Stop Camera:** sends camera intent to the renderer.
- **Refresh Devices:** asks the renderer to enumerate inputs before or after permission.

### Simulation

- **Feedback Mode:** selects one of six simulation branches and clears incompatible stored state.
- **Decay:** controls previous-state retention.
- **Camera Mix:** controls current camera injection.
- **Speed:** advances a continuous accumulated shader clock without wall-clock jumps.
- **Flow Scale:** controls curl-noise frequency in Fluid Smear.
- **Intensity:** changes camera injection and distortion gain.

### Display and brush

- **Hue Drift:** offsets the display palette.
- **Palette:** selects Fire, Ice, Acid, Void, or Rainbow.
- **Brush Size:** controls the direct renderer-pointer injection radius.
- **Clear Feedback State:** clears both physical targets without changing controls.
- **Reset:** restores defaults, resets accumulated shader time, unpauses, and clears both targets.
- **Canvas Fullscreen:** toggles the renderer WebView rather than the controls window.

## Keyboard shortcuts

Shortcuts are available in both windows unless focus is inside a form control.

| Key | Action |
|---|---|
| `C` | Start or stop camera |
| `Space` | Pause or resume simulation |
| `X` | Clear feedback state |
| `R` | Restore defaults and reset simulation time |
| `F` | Toggle canvas fullscreen |
| `1`–`6` | Select feedback mode |

Canvas-side pause, reset, and mode shortcuts report authoritative state back to the controls window.

## Diagnostics

The controls window displays telemetry generated by the renderer:

- relay and renderer connection state;
- camera state;
- active camera label;
- stream resolution and reported frame rate;
- unique decoded-frame texture-upload rate;
- vertex shader compilation;
- simulation fragment shader compilation;
- display fragment shader compilation;
- both program links;
- two framebuffer target completeness;
- selected feedback texture format;
- render FPS;
- drawing-buffer resolution;
- WebGL renderer string;
- camera, WebGL, and Tauri error logs.

Render FPS and upload FPS are intentionally separate. A 60 Hz renderer can repeatedly display a 30 fps camera, but the camera texture should only be uploaded when the video decoder produces a new frame.

## Tauri v2-specific behavior

- Configuration uses the Tauri 2 schema.
- `app.withGlobalTauri` exposes `window.__TAURI__.core.invoke()` to vanilla JavaScript.
- Both `controls` and `canvas` are explicitly named in the capability file.
- Rust retrieves the configured renderer with `get_webview_window()`.
- The CSP explicitly permits the loopback WebSocket and browser camera media sources.
- No Tauri v1 allowlist or window API syntax is used.

## Known limitations

- The camera is browser/WebView-managed rather than captured through a native camera API.
- Device labels may be blank or generic before permission.
- Camera resolution and frame-rate constraints are advisory and can be ignored by the device.
- A camera already opened by another application can fail with `NotReadableError`.
- Floating-point feedback is extension-dependent in WebGL 1; RGBA8 is the fallback.
- Drawing-buffer pixel ratio is capped at `2` to limit framebuffer memory and shader cost.
- Feedback history cannot survive a renderer reload or WebGL context loss.
- The relay is local and unauthenticated. It is a teaching component, not a remote-control security model.
- Camera streams are intentionally not transmitted through the socket. Encoded media transport would require a different architecture such as WebRTC, NDI, or FFmpeg/network streaming.

## Suggested experiments

1. Add reconnect counters and compare controls-only reconnects with renderer reloads.
2. Add camera resolution and requested frame-rate controls to the protocol.
3. Compare RGBA32F and RGBA8 behavior in Reaction-Diffusion and Fluid Smear.
4. Add half-resolution feedback targets while preserving full-resolution display.
5. Add a second camera texture and keep both streams owned by the renderer WebView.
6. Replace the text relay with Tauri events and compare state-restoration behavior.
7. Add brush pressure from pointer events where the WebView reports it.
8. Route the final canvas into a recorder example without transferring camera ownership.
