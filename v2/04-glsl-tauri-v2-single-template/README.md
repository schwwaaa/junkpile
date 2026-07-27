# Example 04 — External GLSL Single Window

**Folder:** `glsl-tauri-v2-single-template`  
**Stack:** Tauri 2 + HTML/CSS/JavaScript + WebGL 1 + external GLSL ES 1.0  
**Window model:** One Tauri WebView window containing controls, compiler diagnostics, and renderer

## What this example demonstrates

This example extends the explicit raw WebGL pipeline from Example 02 by moving the fragment shader into a real external file. It demonstrates how to:

- fetch `src/shader.frag` at application startup;
- read a user-selected `.frag` or `.glsl` file with the browser File API;
- compile a fixed vertex shader and replacement fragment shader explicitly;
- link a candidate WebGL program before making it active;
- keep the last valid program alive when a replacement fails;
- rebind the fullscreen-quad attribute after a successful program swap;
- clear and rebuild cached uniform locations for the new program;
- upload time, resolution, and control uniforms each frame;
- expose compiler, linker, GPU, drawing-buffer, and FPS diagnostics;
- pause, reset, and toggle the native Tauri window fullscreen state.

The default visual remains the original domain-warped fractional Brownian motion study. The modernization adds the current Junkpile interface and failure handling without turning the project into a full shader editor, compositor, recorder, or media application.

## Why this example exists

Embedding shader source in JavaScript is convenient for a small demonstration, but production shader work is usually easier when GLSL lives in its own file. A separate `.frag` file provides editor syntax highlighting, cleaner source organization, and a natural path toward runtime replacement.

The educational focus is the shader lifecycle:

```text
Shader source
    ↓
Compile stages
    ↓
Link candidate program
    ↓
Validate required attribute
    ↓
Activate only if valid
```

A shader compile error should not destroy an already working renderer. Example 04 therefore treats every replacement as a candidate and swaps it in only after compilation and linking succeed.

## Signal flow

### Startup shader path

```text
src/shader.frag
    │ fetch("shader.frag")
    ▼
JavaScript source string
    │
    ├── compile fixed vertex shader
    ├── compile external fragment shader
    └── link candidate program
    ▼
Validated WebGL program
    │
    ├── bind fullscreen quad
    ├── cache uniforms lazily
    └── render each animation frame
    ▼
Tauri v2 WebView canvas
```

### Runtime replacement path

```text
Load .frag button
    ▼
Browser file picker
    ▼
File.text()
    ▼
Candidate compile + link
    ├── success → replace active program
    └── failure → reject candidate and preserve previous program
```

### Controls path

```text
HTML sliders and toggles
    ▼
JavaScript params object
    ▼
Uniform uploads on each frame
    ▼
Active GLSL program
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

`src/index.html` defines:

- the Junkpile example header;
- external shader loading controls;
- the original visual parameters;
- shader and renderer diagnostics;
- a compiler-output terminal;
- pause, reset, and fullscreen actions;
- the WebGL canvas and non-destructive error notice.

`src/styles.css` provides the shared Junkpile shell. The layout includes the required `min-height: 0` behavior on grid children, so the controls panel scrolls immediately in WKWebView rather than only after the window is resized.

`src/app.js` contains:

1. default control state;
2. the fixed fullscreen-quad vertex shader;
3. WebGL context creation;
4. the fullscreen-quad buffer;
5. asynchronous shader source loading;
6. candidate shader compilation and program linking;
7. safe active-program replacement;
8. lazy uniform-location caching;
9. drawing-buffer resizing and device-pixel-ratio handling;
10. accumulated shader time, pause behavior, and FPS measurement;
11. file input, controls, reset, fullscreen, and keyboard wiring.

`src/shader.frag` is the default external fragment shader. It is copied into the application assets and fetched at runtime.

### Rust / Tauri

`src-tauri/src/main.rs` intentionally remains small. It registers a `toggle_fullscreen` command and retrieves the configured WebView using Tauri 2's `get_webview_window()` API.

`src-tauri/capabilities/main-capability.json` explicitly grants `core:default` to the `main` WebView label.

`src-tauri/Cargo.toml` includes a local workspace boundary so Cargo cannot walk upward into an unrelated parent workspace.

## Project structure

```text
glsl-tauri-v2-single-template/
├── README.md
├── package.json
├── package-lock.json
├── src/
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   └── shader.frag
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
cd glsl-tauri-v2-single-template
npm install
```

The Tauri CLI is installed locally through `devDependencies`; no global CLI is required.

## Development

```bash
npm run dev
```

The default shader is fetched from the static frontend assets when the window starts.

## Production build

```bash
npm run build
```

Desktop bundles are written beneath:

```text
src-tauri/target/release/bundle/
```

Signing, notarization, installer identity, and distribution requirements remain the responsibility of the final application.

## Shader source controls

### Load `.frag`

Opens a browser file picker and reads the selected file into memory. The file path is not required and is not exposed to the application. Files up to 1 MiB are accepted in this focused example.

The source is compiled into a candidate program. The candidate becomes active only after:

- the fixed vertex shader compiles;
- the selected fragment shader compiles;
- the program links;
- the required `a_position` attribute is available.

### Restore Default

Fetches `shader.frag` again and treats it as another candidate. This allows recovery after loading an experimental shader without restarting the application.

### Failed replacements

A failed replacement does **not** stop the animation or delete the current program. The compiler terminal shows the WebGL log, a warning appears over the renderer, and the previous shader remains active.

This behavior is particularly important for live visual tools, where an editing mistake should not create a blank output.

## Expected shader interface

The default render loop attempts to upload these uniforms:

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
```

A replacement shader does not have to use every uniform. WebGL optimizes unused uniforms away, and the JavaScript upload helper safely ignores locations that return `null`.

The fixed vertex shader provides:

```glsl
varying vec2 vTexCoord;
```

A replacement fragment shader may use `vTexCoord` for normalized coordinates. It must remain compatible with WebGL 1 / GLSL ES 1.0 and include a fragment precision declaration such as:

```glsl
precision highp float;
```

## Visual controls

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

## Runtime actions

- **Pause / Resume:** freezes accumulated shader time while keeping the UI, file loader, and renderer responsive.
- **Reset:** restores the original parameter values and shader time. It does not replace the currently active shader.
- **Fullscreen:** invokes the native Tauri window command.
- **Restore Default:** reloads `shader.frag` and replaces the active shader only if compilation succeeds.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `Space` | Pause or resume animation |
| `R` | Reset parameters and shader time |
| `O` | Open the shader file picker |
| `D` | Restore the default external shader |
| `F` | Toggle native fullscreen |

Keyboard shortcuts are ignored while an input or button has focus.

## Diagnostics

The controls panel reports:

- shader source loading state;
- vertex shader compilation state;
- fragment shader compilation state;
- program linking state;
- compiler or linker output;
- smoothed frames per second;
- WebGL drawing-buffer resolution;
- renderer string, using `WEBGL_debug_renderer_info` when available;
- the filename of the currently active shader.

There are two distinct error states:

1. **Candidate rejected:** the renderer continues with the previous valid program.
2. **Fatal renderer error:** WebGL initialization failed, the initial shader could not be established, or the context was lost.

The distinction prevents recoverable shader mistakes from appearing as unexplained blank output.

## Tauri v2 behavior

This remains a **WebView-rendered WebGL example**. Tauri 2 owns the desktop application window, but GLSL runs through the embedded browser graphics stack. It is intentionally different from the native Rust + wgpu examples, where WGSL renders to a native GPU surface.

The frontend uses Tauri's global vanilla-JavaScript API only for fullscreen. `app.withGlobalTauri` is enabled in `tauri.conf.json`, and the call is made with:

```js
window.__TAURI__.core.invoke('toggle_fullscreen')
```

Shader selection uses the standard browser File API and does not require a Tauri filesystem capability because the user explicitly selects the file and its text is read within the WebView.

## Known limitations

- This is WebGL 1 / GLSL ES 1.0, not WebGL 2.
- Replacement files are fragment shaders only; the vertex shader remains fixed.
- GLSL loop bounds must remain compile-time constants.
- The loader does not provide a text editor, line-number gutter, preprocessing, includes, or dependency watching.
- Browser file selection does not provide a stable native path for automatic file watching.
- Custom shaders must be compatible with the fixed vertex stage.
- Renderer strings can be masked by the WebView or GPU privacy policy.
- Device-pixel ratio is capped at `2` to prevent unusually large drawing buffers.
- The previous valid shader exists only in memory. Restarting the application loads `shader.frag` again.

## Suggested experiments

1. Introduce a deliberate syntax error and confirm that the current visual continues rendering.
2. Change only the color mapping in a copy of `shader.frag`, then hot-swap it.
3. Remove an unused uniform and observe that the uploader safely ignores the missing location.
4. Add a new float uniform, HTML slider, parameter value, and upload call.
5. Add a textarea editor while preserving the same candidate-program safety boundary.
6. Add a Rust file watcher that emits source changes to the WebView.
7. Extend the loader to support a paired external `.vert` and `.frag` program.
8. Compare this WebGL shader replacement path with a native wgpu pipeline rebuild.

## Modernization boundary

This project deliberately does **not** add camera input, video textures, recording, routing, multiple renderer windows, a complete code editor, or native filesystem watching. Those concerns belong to later Junkpile examples.
