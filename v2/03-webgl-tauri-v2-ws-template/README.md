# Example 03 — Raw WebGL WebSocket Windows

**Folder:** `webgl-tauri-v2-ws-template`  
**Stack:** Tauri 2 + HTML/CSS/JavaScript + WebGL 1 + GLSL ES 1.0 + Rust WebSocket relay  
**Window model:** Separate controls and renderer WebViews

## What this example demonstrates

This example separates a raw WebGL renderer from its user interface while keeping the complete graphics pipeline visible. It shows how to:

- configure two Tauri 2 WebView windows;
- run an embedded Rust WebSocket relay on loopback port `2727`;
- identify clients with `controls` and `canvas` roles;
- send slider and toggle values as JSON messages;
- coalesce slider traffic to no more than one send per animation frame;
- request and restore complete state after a renderer reconnect;
- return WebGL diagnostics and FPS telemetry to the controls window;
- compile GLSL, link a WebGL 1 program, bind a fullscreen quad, upload uniforms, and render without p5.js;
- toggle the native canvas window fullscreen through a Tauri 2 command.

The visual remains the original domain-warped fractional Brownian motion study. The modernization improves the interface, reconnection behavior, diagnostics, and documentation without turning the example into a compositor, recorder, or media router.

## Why this example exists

Example 02 keeps controls and raw WebGL in one WebView. Example 03 adds one architectural variable: the controls and renderer now live in independent windows and communicate through a local WebSocket relay.

This pattern is useful for learning how an application can keep a dedicated output window independent from its control surface. It also demonstrates the basic message-routing idea later used by larger Junkpile and shared component layer systems.

## Signal flow

```text
controls.html / controls.js
    │
    │ JSON over ws://127.0.0.1:2727
    │ { type: "param", name: "zoom", value: 1.5 }
    ▼
Embedded Rust WebSocket relay
    │ broadcasts text to every other client
    ▼
canvas.html / canvas.js
    │ updates local params object
    │ uploads uniforms on next animation frame
    ▼
Linked GLSL program
    │ fragments generated across fullscreen quad
    ▼
WebGL drawing buffer
    ▼
Canvas Tauri WebView window
```

Renderer diagnostics travel in the reverse direction:

```text
Canvas FPS / resolution / GPU / shader status
    │ { type: "telemetry", role: "canvas", ... }
    ▼
Rust WebSocket relay
    ▼
Controls diagnostics panel
```

## Reconnection and state synchronization

Both windows automatically reconnect when the relay is temporarily unavailable.

The canvas sends:

```json
{ "type": "state_request", "role": "canvas" }
```

The controls window responds with its complete current state:

```json
{
  "type": "state",
  "role": "controls",
  "params": {
    "hue": 180,
    "zoom": 1.5,
    "speed": 0.5
  },
  "paused": false,
  "resetTime": false
}
```

This means reopening or reconnecting the renderer does not silently revert it to stale defaults. The controls window remains the source of truth.

## WebSocket message protocol

### Handshake

```json
{ "type": "hello", "role": "controls" }
{ "type": "hello", "role": "canvas" }
```

### Parameter update

```json
{ "type": "param", "role": "controls", "name": "distortion", "value": 0.42 }
```

Checkboxes are transmitted as booleans. The canvas converts them to `1.0` or `0.0` before uploading float uniforms.

### Full state

```json
{
  "type": "state",
  "role": "controls",
  "params": { "hue": 180, "saturation": 0.8 },
  "paused": false,
  "resetTime": false,
  "reason": "canvas_requested_state"
}
```

### Runtime action

```json
{ "type": "action", "role": "controls", "name": "pause", "value": true }
{ "type": "action", "role": "controls", "name": "fullscreen" }
```

### Telemetry

```json
{
  "type": "telemetry",
  "role": "canvas",
  "runtime": "running",
  "vertexStatus": "Compiled",
  "fragmentStatus": "Compiled",
  "linkStatus": "Linked",
  "renderer": "Apple GPU",
  "resolution": "1920 × 1440",
  "fps": 60.0,
  "paused": false,
  "error": ""
}
```

## Architecture

### Controls frontend

`src/controls.html` contains the Junkpile control surface and renderer diagnostics.

`src/controls.js` owns the authoritative parameter state. Slider input is coalesced with `requestAnimationFrame()` so a rapid drag sends only the most recent value for each parameter once per browser frame. It also handles reconnection, renderer liveness, complete-state synchronization, pause, reset, and fullscreen actions.

### Renderer frontend

`src/canvas.html` contains only the canvas, minimal HUD, and visible error state.

`src/canvas.js` contains:

1. default renderer state;
2. WebSocket receiver and state-request logic;
3. GLSL vertex and fragment source;
4. shader compilation and program linking;
5. fullscreen-quad buffer creation;
6. cached attribute and uniform locations;
7. accumulated shader time;
8. drawing-buffer resizing;
9. FPS measurement and telemetry;
10. native fullscreen invocation.

### Rust / Tauri

`src-tauri/src/main.rs` performs two focused jobs:

- launches IPv4 and IPv6 loopback WebSocket listeners through `tauri::async_runtime::spawn()`;
- registers `toggle_canvas_fullscreen`, retrieving the configured renderer with Tauri 2's `get_webview_window("canvas")` API.

Text messages are broadcast to all clients except their sender. Binary messages remain supported and are routed only to clients whose role is `canvas`, preserving the original relay lesson for later experiments.

`src-tauri/capabilities/main-capability.json` explicitly grants `core:default` to both WebView labels.

`src-tauri/Cargo.toml` includes a local workspace boundary so Cargo does not walk upward into an unrelated repository workspace.

## Project structure

```text
webgl-tauri-v2-ws-template/
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
  - macOS: Xcode command-line tools
  - Windows: Microsoft C++ Build Tools and WebView2
  - Linux: the distribution packages required by Tauri and WebKitGTK

## Install

```bash
cd webgl-tauri-v2-ws-template
npm install
```

The Tauri CLI is installed locally through `devDependencies`; no global CLI is required.

## Development

```bash
npm run dev
```

Tauri opens two windows:

- **Junkpile 03 — Raw WebGL Controls**
- **Junkpile 03 — Raw WebGL Renderer**

The Rust process listens on both:

```text
ws://127.0.0.1:2727
ws://[::1]:2727
```

Only loopback interfaces are used. The relay is not exposed to the local network.

## Production build

```bash
npm run build
```

Desktop bundles are written beneath:

```text
src-tauri/target/release/bundle/
```

Signing, notarization, installer identity, and platform distribution requirements remain the responsibility of the final application.

## Controls

| Control | Shader role |
|---|---|
| Hue Shift | Base HSB hue in degrees |
| Saturation | Color saturation |
| Brightness | Pattern output gain |
| Zoom | UV scale before noise evaluation |
| Speed | Multiplier applied to accumulated shader time |
| Distortion | Strength of the two-sample domain warp |
| Complexity | Number of active fBm octaves, 1–8 |
| Symmetry | Number of radial sectors |
| Glow | Center-weighted brightness gain |
| Invert | Mixes the color with its inverse |
| Pulse | Enables sinusoidal brightness modulation |
| Rotate | Enables time-based UV rotation |

### Runtime actions

- **Pause / Resume:** transmits a WebSocket action and freezes accumulated shader time.
- **Reset:** restores control defaults, resets renderer time, and resumes playback.
- **Canvas Fullscreen:** sends a WebSocket action to the renderer; the renderer invokes the native Tauri command.

### Controls-window keyboard shortcuts

| Key | Action |
|---|---|
| `Space` | Pause or resume animation |
| `R` | Reset parameters and renderer time |
| `F` | Toggle canvas-window fullscreen |

The canvas window also accepts `F` for native fullscreen.

## Diagnostics

The canvas returns the following to the controls window approximately twice per second:

- vertex shader compile state;
- fragment shader compile state;
- program link state;
- frames per second;
- drawing-buffer resolution;
- WebGL renderer string;
- paused/running state;
- visible runtime errors.

The controls window also reports sent and received WebSocket message counts. A missing renderer is shown explicitly instead of appearing as unexplained inactive controls.

## Tauri v2 behavior

Both windows are WebView-rendered. The canvas uses WebGL 1 and GLSL ES 1.0 through the operating system's embedded browser graphics stack. This is intentionally different from Junkpile's native Rust + wgpu examples.

The frontend uses Tauri's global vanilla-JavaScript API only in the canvas window for native fullscreen:

```js
window.__TAURI__.core.invoke('toggle_canvas_fullscreen')
```

`app.withGlobalTauri` is enabled in `tauri.conf.json`, and both WebView labels are included in the capability.

## Known limitations

- Port `2727` must be available. A second running copy of this example will not be able to bind the same loopback port.
- WebSocket messages are not persisted after both windows close; the controls window is the in-session source of truth.
- This is WebGL 1 / GLSL ES 1.0, not WebGL 2.
- GLSL loop bounds must remain compile-time constants. The fBm function uses a fixed eight-iteration loop and exits early according to `u_complexity`.
- Renderer strings can be masked by the WebView or GPU privacy policy.
- Device-pixel ratio is capped at `2` to prevent unusually large drawing buffers.
- The relay does not authenticate clients because it binds only to local loopback interfaces and exists as an educational application-local transport.

## Suggested experiments

1. Add a second canvas window and observe that text messages broadcast to both renderers.
2. Change the relay so parameter messages route only to clients with the `canvas` role.
3. Add a sequence number and measure dropped or reordered messages.
4. Send a compact binary parameter packet and use the existing canvas-only binary route.
5. Add a new float uniform from controls HTML to GLSL output.
6. Close and reopen the renderer window and inspect the state-request handshake.
7. Compare WebSocket control latency with a direct Tauri command or event channel.

## Modernization boundary

This project deliberately does **not** add camera input, recording, media routing, external shader replacement, or native wgpu rendering. Those concerns are covered by other Junkpile examples.
