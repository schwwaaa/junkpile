# 01 · Tauri v2 p5.js WebSocket

A focused two-window foundation for controlling a p5.js WebGL shader from a separate Tauri v2 WebView through an embedded Rust WebSocket relay.

This folder intentionally retains its original repository name:

```text
p5-tauri-v2-ws-template
```

The visible example number is **01** so it aligns with the complete Junkpile Tauri v2 Essentials sequence.

## What this example teaches

- Declaring two independent Tauri v2 WebView windows
- Running p5.js WebGL only in the renderer window
- Hosting a local WebSocket relay inside the Rust application
- Identifying connected clients by role
- Sending parameter state from controls to output
- Returning renderer telemetry to the controls window
- Resynchronizing the renderer after a reload or reconnect
- Controlling another native Tauri v2 window through commands
- Granting both windows explicit capability access

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
canvas.html → params{} → p5 draw() → GLSL uniforms → WebGL output
    │
    └──────── telemetry: FPS / size / paused ────────► controls.html
```

Both windows identify themselves after connecting:

```json
{ "type": "hello", "role": "controls" }
{ "type": "hello", "role": "canvas" }
```

The relay reports current role counts to every client. The controls window therefore shows whether the output is actually connected instead of assuming that the second window is healthy.

## Run

```bash
npm install
npm run dev
```

`npm run dev` copies the pinned p5.js build from `node_modules` into `src/vendor/` before Tauri launches. The application does not require a CDN at runtime.

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
| `controls` | HTML controls, presets, relay status, and renderer telemetry |
| `canvas` | p5.js WebGL renderer and output HUD |

Both labels are included in `src-tauri/capabilities/default.json`. The controls window can show, focus, or toggle fullscreen on the canvas window through Rust commands invoked with Tauri v2's global `core.invoke` API.

## Message types

| Message | Direction | Purpose |
|---|---|---|
| `hello` | Either window → relay | Identifies the client role |
| `presence` | Relay → all windows | Reports connected role counts |
| `param_batch` | Controls → canvas | Sends the latest changed parameters together |
| `state_snapshot` | Controls → canvas | Sends the complete current state |
| `request_state` | Canvas → controls | Requests a full state after reconnecting |
| `action` | Controls → canvas | Pause/resume or reset-clock actions |
| `telemetry` | Canvas → controls | FPS, canvas size, and paused state |

Slider events are coalesced to at most one WebSocket message per animation frame. This keeps dragging smooth while preserving the explicit transport lesson.

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
p5-tauri-v2-ws-template/
├── README.md
├── MODERNIZATION-NOTES.md
├── package.json
├── scripts/
│   └── sync-p5.mjs
├── src/
│   ├── controls.html
│   ├── controls.css
│   ├── controls.js
│   ├── canvas.html
│   ├── canvas.css
│   ├── canvas.js
│   └── vendor/
│       └── p5.min.js          generated after npm install
└── src-tauri/
    ├── capabilities/
    │   └── default.json
    ├── Cargo.toml
    ├── tauri.conf.json
    └── src/main.rs
```

## Add a parameter

1. Add an input and output readout to `src/controls.html`.
2. Add its default to `DEFAULT_PARAMS` in `src/controls.js` and `src/canvas.js`.
3. Include its ID in the slider or toggle array in `controls.js`.
4. Declare a matching GLSL uniform in `canvas.js`.
5. Upload the parameter in `draw()` with `shaderProgram.setUniform()`.
6. Use the uniform in the shader.

The generic Rust relay does not need to change for ordinary parameter additions.

## Why WebSocket instead of Tauri events?

This example demonstrates an explicit local transport that can later be shared with external tools, browser clients, or additional windows. Other Junkpile examples use Tauri commands and events when that architecture is more appropriate.

## Tauri v2 details

- `app.withGlobalTauri` exposes `window.__TAURI__` in the vanilla frontend.
- Commands are called through `window.__TAURI__.core.invoke()`.
- The `controls` and `canvas` labels are granted access through a capability file.
- Window lookup uses `AppHandle::get_webview_window()` rather than the Tauri v1 `get_window()` API.
- The WebSocket relay itself remains ordinary Rust and is not coupled to the WebView renderer.

## Known limitations

- Port `2727` must be available locally.
- The relay is local-only and intentionally has no authentication.
- Closing the canvas window destroys that WebView; restart the application to recreate it.
- The renderer uses p5.js WebGL rather than native wgpu.
- `pixelDensity(1)` prioritizes predictable performance over Retina-resolution rendering.
