# Example 02 — Raw WebGL Single Window

**Folder:** `webgl-tauri-v2-single-template`  
**Stack:** Tauri 2 + HTML/CSS/JavaScript + WebGL 1 + GLSL ES 1.0  
**Window model:** One Tauri WebView window containing both controls and renderer

## What this example demonstrates

This example exposes the complete browser-side WebGL rendering path without p5.js or another graphics framework. It shows how to:

- request a WebGL 1 context from an HTML canvas;
- compile a vertex shader and a fragment shader explicitly;
- link both shader stages into a program;
- create and bind a fullscreen-quad vertex buffer;
- locate an attribute and shader uniforms;
- upload time, resolution, and control values each frame;
- render with `gl.drawArrays()` inside `requestAnimationFrame()`;
- resize the drawing buffer when the Tauri WebView changes size;
- report shader, program, renderer, resolution, and FPS diagnostics.

The visual remains the original domain-warped fractional Brownian motion study. The modernization adds a consistent Junkpile interface, reliable scrolling, runtime controls, and visible failure states without turning the example into a compositor or media application.

## Why this example exists

p5.js is useful because it hides most graphics setup. That convenience can also make the underlying pipeline difficult to inspect. Example 02 removes that abstraction while retaining a compact single-window application.

Use this example when you want to understand the WebGL operations that a higher-level framework normally performs for you.

## Signal flow

```text
HTML controls
    │ input/change events
    ▼
JavaScript params object
    │ read once per animation frame
    ▼
WebGL uniform uploads
    │
    ├── u_time / u_resolution
    ├── color controls
    ├── UV and domain-warp controls
    └── fBm and toggle controls
    ▼
Linked GLSL program
    │ fragments generated across a fullscreen quad
    ▼
WebGL drawing buffer
    ▼
Tauri v2 WebView window
```

The fullscreen button is the only frontend-to-Rust path:

```text
Fullscreen button or F key
    ▼
window.__TAURI__.core.invoke("toggle_fullscreen")
    ▼
Rust command
    ▼
app.get_webview_window("main")
    ▼
Native window fullscreen state
```

## Architecture

### Frontend

`src/index.html` defines the controls, diagnostics, canvas, and renderer status overlays.

`src/styles.css` provides the shared Junkpile visual shell. The layout uses explicit `min-height: 0` rules on grid and panel children so the controls panel is scrollable immediately, including on WKWebView.

`src/app.js` contains the educational WebGL pipeline:

1. default parameter state;
2. GLSL vertex and fragment source;
3. shader compilation;
4. program linking;
5. fullscreen-quad buffer setup;
6. cached uniform locations;
7. drawing-buffer resize handling;
8. render loop and FPS measurement;
9. controls, pause, reset, and keyboard shortcuts.

### Rust / Tauri

`src-tauri/src/main.rs` keeps native code intentionally small. It registers one `toggle_fullscreen` command and retrieves the configured WebView with Tauri 2's `get_webview_window()` API.

`src-tauri/capabilities/main-capability.json` explicitly associates `core:default` with the `main` window.

`src-tauri/Cargo.toml` includes a local workspace boundary so Cargo does not walk upward into an unrelated repository workspace.

## Project structure

```text
webgl-tauri-v2-single-template/
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
cd webgl-tauri-v2-single-template
npm install
```

The Tauri CLI is installed locally through `devDependencies`; no global CLI is required.

## Development

```bash
npm run dev
```

This opens the single Tauri window and serves the static files in `src/` through Tauri's application asset protocol.

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

- **Pause / Resume:** freezes shader time while keeping the UI and renderer responsive.
- **Reset:** restores the original control values, resets shader time, and resumes playback.
- **Fullscreen:** invokes the native Tauri window command.

### Keyboard shortcuts

| Key | Action |
|---|---|
| `Space` | Pause or resume animation |
| `R` | Reset parameters and shader time |
| `F` | Toggle native fullscreen |

Keyboard shortcuts are ignored while a slider, checkbox, or button has focus.

## Diagnostics

The controls panel reports:

- vertex shader compile state;
- fragment shader compile state;
- program link state;
- smoothed frames per second;
- WebGL drawing-buffer resolution;
- renderer string, using `WEBGL_debug_renderer_info` when available.

A WebGL initialization, compilation, linking, or context-loss error is displayed both in the controls panel and over the renderer. The application should never fail as an unexplained blank canvas.

## Tauri v2 behavior

This remains a **WebView-rendered WebGL example**. Tauri 2 owns the desktop application window, but GLSL runs through the operating system's embedded browser graphics stack. This is intentionally different from the native Rust + wgpu examples, where WGSL renders to a native GPU surface.

The frontend uses Tauri's global vanilla-JavaScript API only for the fullscreen command. `app.withGlobalTauri` is enabled in `tauri.conf.json`, and the call is made with:

```js
window.__TAURI__.core.invoke('toggle_fullscreen')
```

## Known limitations

- This is WebGL 1 / GLSL ES 1.0, not WebGL 2.
- GLSL loop bounds must remain compile-time constants. The fBm function uses a fixed eight-iteration loop and exits early according to the float `u_complexity` uniform.
- Renderer strings can be masked by the WebView or GPU privacy policy.
- Device-pixel ratio is capped at `2` to prevent unusually large drawing buffers on high-density displays.
- Fullscreen behavior is delegated to the native Tauri window and can vary slightly by operating system.
- The shader source is embedded in `app.js`; live shader editing belongs in a later shader-editor example.

## Suggested experiments

1. Change the fullscreen quad from `TRIANGLE_STRIP` to two explicit triangles and compare the buffer layout.
2. Add a new float uniform from HTML control to GLSL output.
3. Move the shader strings into separate `.vert` and `.frag` files and load them before initialization.
4. Add a second render pass with a framebuffer and texture.
5. Compare this WebGL path with the equivalent native wgpu/WGSL example.
6. Remove the uniform-location cache and inspect the performance and code-clarity tradeoff.

## Modernization boundary

This project deliberately does **not** add camera input, recording, routing, external shader replacement, video textures, or multi-window synchronization. Those concerns are covered by other Junkpile examples.
