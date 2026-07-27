# Example 05 — External GLSL WebSocket Windows

**Folder:** `glsl-tauri-v2-ws-template`  
**Stack:** Tauri 2 + HTML/CSS/JavaScript + WebGL 1 + GLSL ES 1.0 + Rust WebSocket relay  
**Window model:** Separate controls and renderer WebViews

## What this example demonstrates

This example adds external fragment-shader transport to the two-window raw WebGL architecture. It shows how to:

- configure independent controls and renderer windows in Tauri 2;
- run an embedded Rust WebSocket relay on loopback port `2727`;
- load a real `.frag` file in the controls WebView;
- transmit GLSL source as a bounded WebSocket text message;
- compile a candidate shader and link a candidate program in the canvas WebView;
- preserve the last valid program when a candidate fails;
- return compiler, linker, source, GPU, resolution, and FPS diagnostics to the controls window;
- retain the last accepted shader and resend it when the renderer reconnects;
- coalesce slider traffic to no more than one send per animation frame;
- pause, reset, and toggle the native canvas window fullscreen.

The default visual remains the original domain-warped fractional Brownian motion study. This project stays focused on external GLSL lifecycle and two-window message flow rather than becoming a general shader editor, compositor, recorder, or media router.

## Why this example exists

Example 04 loads and replaces external GLSL inside one WebView. Example 05 introduces one architectural variable: the source picker and control state live in one window, while compilation and rendering happen in another.

That separation demonstrates a practical pattern for dedicated output windows. The controls window can remain interactive and scrollable while the canvas window is placed on another display, made fullscreen, or restarted independently.

## Signal flow

```text
User selects my-shader.frag
    │
    ▼
controls.js reads text and enforces a 1 MiB limit
    │
    │ WebSocket JSON
    │ { type: "shader", name, source, revision }
    ▼
Embedded Rust relay on ws://127.0.0.1:2727
    │ broadcasts text to the other connected WebView
    ▼
canvas.js builds a candidate WebGL program
    │
    ├── compile/link succeeds ──► replace active program
    │                              return accepted result
    │
    └── compile/link fails ─────► keep previous valid program
                                   return rejection + compiler log
```

Parameter traffic follows the same relay:

```text
Controls slider
    │ coalesced once per animation frame
    ▼
{ type: "param", name: "zoom", value: 1.5 }
    ▼
Rust WebSocket relay
    ▼
Canvas parameter state
    ▼
Uniform upload on the next render frame
```

Diagnostics travel in reverse:

```text
Canvas compiler / GPU / FPS / resolution telemetry
    ▼
Rust relay
    ▼
Controls diagnostics panel and compiler terminal
```

## Safe shader replacement

The canvas never deletes the active program before a replacement is validated.

The replacement sequence is:

1. create and compile a candidate vertex shader;
2. create and compile the candidate fragment shader;
3. create and link a candidate program;
4. verify the required `a_position` attribute;
5. switch the renderer to the candidate;
6. delete the previous program only after successful activation.

If any step fails, the candidate resources are deleted and the existing program continues rendering. The renderer shows a non-fatal warning while the complete compiler or linker log is returned to the controls window.

## Reconnection and state synchronization

The controls window is the in-session source of truth for:

- current parameter values;
- pause state;
- last accepted shader source;
- any candidate waiting to be validated.

When the canvas connects, it sends:

```json
{ "type": "state_request", "role": "canvas" }
```

The controls respond with the complete parameter state, then resend the last accepted shader. If a candidate was pending when the connection was interrupted, the accepted shader is sent first so the renderer has a known-good fallback before the pending candidate is retried.

## WebSocket message protocol

### Handshake

```json
{ "type": "hello", "role": "controls" }
{ "type": "hello", "role": "canvas" }
```

### Parameter update

```json
{
  "type": "param",
  "role": "controls",
  "name": "distortion",
  "value": 0.42
}
```

### Full parameter state

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
  "resetTime": false,
  "reason": "canvas_requested_state"
}
```

### Shader candidate

```json
{
  "type": "shader",
  "role": "controls",
  "name": "my-shader.frag",
  "source": "precision highp float; ...",
  "revision": 3,
  "reason": "user_candidate"
}
```

### Shader result

```json
{
  "type": "shader_result",
  "role": "canvas",
  "accepted": false,
  "name": "my-shader.frag",
  "revision": 3,
  "activeShaderName": "shader.frag",
  "fragmentStatus": "Compile failed",
  "compilerLog": "[rejected] my-shader.frag\n..."
}
```

### Runtime actions

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
  "sourceStatus": "Active",
  "vertexStatus": "Compiled",
  "fragmentStatus": "Compiled",
  "linkStatus": "Linked",
  "activeShaderName": "shader.frag",
  "renderer": "Apple GPU",
  "resolution": "1760 × 1360",
  "fps": 60.0,
  "paused": false
}
```

## Architecture

### Controls frontend

`src/controls.html` contains:

- shader file controls;
- the authoritative parameter state;
- pause, reset, and canvas-fullscreen actions;
- connection state;
- compiler and renderer diagnostics.

`src/controls.js` reads shader files with the browser `File` API. It limits source to `1 MiB`, stores the last shader accepted by the canvas, tracks a pending candidate by revision, coalesces slider updates with `requestAnimationFrame()`, and restores state after reconnects.

The default `shader.frag` is fetched by the controls window so it can be resent to a restarted canvas without requiring the entire application to restart.

### Renderer frontend

`src/canvas.html` contains the canvas, minimal HUD, a non-fatal shader-rejection notice, and a fatal renderer-error overlay.

`src/canvas.js` owns:

1. the inline fullscreen-quad vertex shader;
2. runtime loading of `shader.frag`;
3. candidate shader compilation and program linking;
4. last-valid-program preservation;
5. fullscreen-quad buffer and attribute setup;
6. cached uniform locations;
7. accumulated shader time;
8. high-DPI drawing-buffer resizing;
9. FPS and renderer telemetry;
10. WebSocket state recovery;
11. native fullscreen invocation.

### Rust / Tauri

`src-tauri/src/main.rs` performs two focused jobs:

- launches IPv4 and IPv6 loopback WebSocket listeners with `tauri::async_runtime::spawn()`;
- registers `toggle_canvas_fullscreen`, retrieving the configured renderer through Tauri 2's `get_webview_window("canvas")` API.

Text messages are broadcast to all connected clients except their sender. The existing binary route remains available for later experiments and forwards only to clients identified as `canvas`.

`src-tauri/capabilities/main-capability.json` explicitly grants `core:default` to both WebView labels.

`src-tauri/Cargo.toml` contains a local workspace boundary:

```toml
[workspace]
resolver = "2"
```

This prevents Cargo from walking upward into an unrelated parent workspace.

## Project structure

```text
glsl-tauri-v2-ws-template/
├── README.md
├── package.json
├── package-lock.json
├── src/
│   ├── controls.html
│   ├── controls.js
│   ├── canvas.html
│   ├── canvas.js
│   ├── shader.frag
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
  - Linux: Tauri and WebKitGTK distribution packages

## Install

```bash
cd glsl-tauri-v2-ws-template
npm install
```

The Tauri CLI is installed locally through `devDependencies`; no global CLI is required.

## Development

```bash
npm run dev
```

Tauri opens:

- **Junkpile 05 — External GLSL Controls**
- **Junkpile 05 — External GLSL Renderer**

The embedded relay listens only on local loopback interfaces:

```text
ws://127.0.0.1:2727
ws://[::1]:2727
```

## Production build

```bash
npm run build
```

Desktop bundles are written beneath:

```text
src-tauri/target/release/bundle/
```

Signing, notarization, installer identity, and platform distribution requirements remain the responsibility of the final application.

## Shader contract

Replacement fragment shaders must be valid GLSL ES 1.0 and may use the uniforms below:

```glsl
uniform float u_time;
uniform vec2  u_resolution;
uniform float u_hue;
uniform float u_saturation;
uniform float u_brightness;
uniform float u_zoom;
uniform float u_distortion;
uniform float u_rotate;
uniform float u_complexity;
uniform float u_symmetry;
uniform float u_glow;
uniform float u_invert;
uniform float u_pulse;

varying vec2 vTexCoord;
```

Unused uniforms are permitted. The renderer skips locations optimized away by the GLSL compiler.

The fixed vertex shader exposes:

```glsl
attribute vec2 a_position;
varying vec2 vTexCoord;
```

A replacement fragment shader must define `main()` and write `gl_FragColor`.

## Controls

| Control | Shader role |
|---|---|
| Load `.frag` | Reads a local text shader and sends it to the canvas for validation |
| Restore Default | Resends the bundled `shader.frag` |
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

- **Pause / Resume:** freezes or resumes accumulated shader time.
- **Reset:** restores parameter defaults, resets renderer time, and resumes playback. It does not replace the active shader.
- **Canvas Fullscreen:** sends a WebSocket action to the canvas, which invokes the native Tauri command.

### Controls-window keyboard shortcuts

| Key | Action |
|---|---|
| `Space` | Pause or resume animation |
| `R` | Reset parameters and renderer time |
| `O` | Open the shader file picker |
| `D` | Restore the bundled default shader |
| `F` | Toggle canvas-window fullscreen |

The canvas window also accepts `F` for fullscreen.

## Diagnostics

The controls window shows:

- relay and renderer connection state;
- active and pending shader names;
- source-validation state;
- vertex and fragment compiler states;
- program linker state;
- the complete latest compiler/linker log;
- frames per second;
- drawing-buffer resolution;
- WebGL renderer string;
- sent and received message counts.

A bad replacement produces a visible warning rather than a blank canvas. The renderer continues with the previous program.

## Tauri v2 behavior

Both windows are WebViews. Rendering uses WebGL 1 and GLSL ES 1.0 through the embedded browser graphics stack; this is intentionally different from Junkpile's native Rust + wgpu examples.

The canvas uses the global vanilla-JavaScript Tauri API for native fullscreen:

```js
window.__TAURI__.core.invoke('toggle_canvas_fullscreen')
```

`app.withGlobalTauri` is enabled in `tauri.conf.json`, and both window labels are covered by the Tauri 2 capability.

## Known limitations

- Port `2727` must be available. A second running copy cannot bind the same port.
- Shader transport is text JSON intended for compact educational shaders and is capped at `1 MiB`.
- This is WebGL 1 / GLSL ES 1.0, not WebGL 2.
- GLSL loop bounds must remain compile-time constants. The bundled fBm shader uses a fixed eight-iteration loop with an early exit.
- The controls window keeps accepted source only for the current application session.
- A source file is read by the controls WebView; the original filesystem path is neither required nor sent.
- Renderer strings can be masked by the WebView or GPU privacy policy.
- Device-pixel ratio is capped at `2` to avoid unusually large drawing buffers.
- The relay has no authentication because it binds only to loopback and exists as an application-local educational transport.

## Suggested experiments

1. Introduce a syntax error in a copy of `shader.frag` and verify the old program continues rendering.
2. Remove one optional uniform and observe that the shader still works.
3. Add a custom uniform to the controls, message protocol, renderer upload, and shader source.
4. Close and reopen the canvas window and inspect the accepted-shader restoration sequence.
5. Add source hashing so reconnect synchronization can skip identical source without relying on revisions.
6. Send shader source as a binary WebSocket frame and compare the protocol with the existing JSON form.
7. Add a compact source editor while retaining candidate validation and last-valid-program behavior.

## Modernization boundary

This project deliberately does **not** add camera input, recording, media routing, native filesystem commands, native wgpu rendering, or a full integrated development environment. Those concerns belong to later Junkpile examples and applications.
