# 03 · Tauri v1 Raw WebGL WebSocket

A focused two-window foundation for controlling a raw WebGL 1 shader from a separate Tauri v1 WebView through an embedded Rust WebSocket relay.

This folder intentionally retains its original repository name:

```text
webgl-tauri-v1-ws-template
```

The visible example number is **03** so it aligns with the complete Junkpile Tauri v1 Essentials sequence.

## What this example teaches

- Declaring separate controls and output windows in Tauri v1
- Hosting a local WebSocket relay inside the Rust application
- Identifying connected WebSocket clients by role
- Sending complete state and coalesced parameter batches
- Compiling and linking WebGL shaders without p5.js
- Creating and drawing a fullscreen vertex buffer
- Uploading JavaScript values directly as GLSL uniforms
- Returning renderer telemetry to another WebView
- Recovering state after a controls/output reload or reconnect
- Handling WebGL context loss and restoration

## Architecture

```text
controls.html
    │
    │  param_batch / state_snapshot
    ▼
ws://127.0.0.1:2727
    │
    ▼
Rust WebSocket relay
    │
    ▼
canvas.html
    │
    ├── WebGL context
    ├── shader compile + link
    ├── fullscreen quad buffer
    ├── gl.uniform* uploads
    └── gl.drawArrays(TRIANGLE_STRIP)
         │
         └──── telemetry: FPS / size / GPU / shader state ───► controls.html
```

Both windows identify themselves to the relay:

```json
{ "type": "hello", "role": "controls" }
{ "type": "hello", "role": "canvas" }
```

The output requests a complete state snapshot whenever it reconnects. The controls window remains the authoritative parameter state.

## Run

```bash
npm install
npm run dev
```

No browser rendering library or runtime CDN is required.

## Production build

```bash
npm run build
```

On macOS, generated bundles are placed under:

```text
src-tauri/target/release/bundle/
```

Unsigned applications may trigger Gatekeeper on another Mac. Public distribution generally requires Apple signing and notarization.

## Windows

| Window label | Purpose |
|---|---|
| `controls` | Parameters, presets, connection state, output telemetry, and native window actions |
| `canvas` | Raw WebGL context, GLSL program, fullscreen quad, and output HUD |

The controls window can show, focus, or toggle fullscreen on the output through small Rust commands.

## Message types

| Message | Direction | Purpose |
|---|---|---|
| `hello` | Either window → relay | Identifies the client role |
| `presence` | Relay → all windows | Reports connected role counts |
| `param_batch` | Controls → output | Sends the newest changed parameters together |
| `state_snapshot` | Controls → output | Sends the complete current state |
| `request_state` | Output → controls | Requests a full state after reconnecting |
| `action` | Controls → output | Pause/resume or reset-clock actions |
| `telemetry` | Output → controls | FPS, buffer size, GPU renderer, paused state, and shader health |

Slider events are coalesced to at most one WebSocket message per animation frame.

## Raw WebGL lifecycle

```text
canvas.getContext("webgl")
    ↓
gl.createShader / gl.compileShader
    ↓
gl.createProgram / gl.linkProgram
    ↓
gl.createBuffer / gl.bufferData
    ↓
gl.getUniformLocation / gl.uniform*
    ↓
gl.drawArrays
```

The output HUD shows shader-link status. A compiler/linker failure leaves an explicit error panel instead of a blank unexplained window.

## Controls

| Section | Parameter | Purpose |
|---|---|---|
| Color | Hue shift | Rotates the palette |
| Color | Saturation | Moves from monochrome to vivid color |
| Color | Brightness | Multiplies output brightness |
| Motion | Zoom | Scales shader coordinates |
| Motion | Speed | Advances the renderer clock |
| Motion | Distortion | Strengthens domain warping |
| Pattern | Complexity | Selects the fBm octave count |
| Pattern | Symmetry | Changes rotational folding |
| Pattern | Glow | Brightens the center of the field |
| Switches | Invert | Inverts the final color |
| Switches | Pulse | Enables rhythmic brightness modulation |
| Switches | Rotate | Rotates the coordinate field |

Keyboard shortcuts in the controls window:

| Key | Action |
|---|---|
| Space | Pause or resume output |
| R | Restore defaults and reset renderer time |
| S | Send a complete state snapshot |
| F | Toggle output-window fullscreen |

The output window also accepts **F** for fullscreen.

## Project structure

```text
webgl-tauri-v1-ws-template/
├── README.md
├── MODERNIZATION-NOTES.md
├── package.json
├── src/
│   ├── controls.html
│   ├── controls.css
│   ├── controls.js
│   ├── canvas.html
│   ├── canvas.css
│   └── canvas.js
└── src-tauri/
    ├── Cargo.toml
    ├── tauri.conf.json
    └── src/main.rs
```

## Add a parameter

1. Add an input and readout to `src/controls.html`.
2. Add its default to `DEFAULT_PARAMS` in both JavaScript files.
3. Include its ID in the slider/toggle list in `controls.js`.
4. Declare a matching uniform in `FRAG_SHADER`.
5. Upload the value in `render()` with `uniform1f`, `uniform2f`, or another WebGL uniform call.
6. Use the uniform in GLSL.

The Rust relay does not need to change for ordinary parameters.

## Why this is separate from Example 01

Example 01 demonstrates the same two-window transport with p5.js managing the WebGL lifecycle. Example 03 exposes the browser GPU API directly so developers can see what p5.js ordinarily abstracts.

## Known limitations

- Port `2727` must be available locally.
- The relay is local-only and intentionally unauthenticated.
- Closing the output window destroys that WebView; restart the application to recreate it.
- This is WebGL 1 / GLSL ES 1.0 rather than WebGL 2 or native wgpu.
- The device-pixel ratio is capped at 2 to avoid unexpectedly large drawing buffers.
