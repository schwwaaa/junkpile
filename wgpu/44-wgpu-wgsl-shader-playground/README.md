# wgpu WGSL Shader Playground

A native Tauri 2 + wgpu counterpart to Junkpile's WebView shader playground workflow.

The application keeps the editable interface in HTML/CSS/JavaScript while WGSL compilation and rendering occur in Rust on a native GPU surface. The editor can open and save real `.wgsl` files, compile source without restarting, preserve the last successful pipeline after errors, control uniforms, pause shader time, and export high-resolution PNG stills.

## What this demonstrates

- In-application WGSL source editor
- Manual compile with `Command/Ctrl + Enter`
- Debounced automatic compilation
- Naga parsing and semantic validation
- wgpu pipeline validation
- Last-known-good pipeline protection
- Native Open, Save, and Save As dialogs
- Saving never changes the selected preset
- Unsaved-change tracking
- Twelve built-in shader presets
- Per-preset default, still, and peak profiles
- Generated controls for the shared uniform contract
- Spin as real angular velocity in radians per second
- Pause, resume, and reset shader time
- Native renderer fullscreen
- 1080p, 1440p, 4K, 5K, 8K, and custom PNG export
- Runtime GPU, FPS, frame-time, pipeline, and compiler diagnostics
- External runtime assets with filesystem watching

## Run

```bash
npm install
npm run dev
```

Two windows open:

1. **WGSL Playground** — source editor, presets, uniforms, compiler output, and export controls.
2. **Native Surface** — the current shader rendered directly through wgpu.

## Editor workflow

1. Select a built-in preset.
2. Edit the WGSL source.
3. Compile with **Compile** or `Command/Ctrl + Enter`.
4. When compilation succeeds, the native renderer replaces its pipeline transactionally.
5. When compilation fails, compiler diagnostics are shown and the previous valid pipeline keeps running.
6. Save the document without changing the active preset or profile.

Automatic compilation is enabled by default and runs after a short editing pause. Disable it for expensive shaders or large edits.

## Shared WGSL contract

Playground shaders use these entry points and bindings:

```wgsl
@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOut

@fragment
fn fs_main(input: VertexOut) -> @location(0) vec4<f32>

@group(0) @binding(0)
var<uniform> u: Uniforms;
```

The shared parameter vector is:

```wgsl
params.x  // gain
params.y  // zoom
params.z  // spin speed in radians per second
params.w  // complexity / workload
```

Spin is an angular velocity. A shader should derive rotation from time and spin:

```wgsl
let angle = u.timing.x * u.params.z;
```

At `0.0`, rotation stops. Positive and negative values rotate in opposite directions.

## File ownership

- `render.json` defines the preset catalog and startup preset.
- Runtime preset selection remains authoritative after launch.
- Saving a shader file never selects another preset.
- Editing an external file does not rewrite the preset catalog.
- Built-in presets are copied to the OS application-config directory so they can be edited safely.

The active runtime asset directory is displayed in the footer and can be opened from the preset panel.

## High-resolution still export

PNG export renders the current compiled pipeline into a separate offscreen texture at the selected dimensions. It does not resize the preview window.

Large exports require substantial GPU and CPU memory. An 8K RGBA image is approximately 126.6 MiB before PNG compression. The application validates the selected dimensions against the GPU's maximum 2D texture size before export.

## Built-in presets

- Kaleido Reactor
- Plasma Warp
- Infinite Tunnel
- Voronoi Storm
- Fractal Nebula
- Mandelbrot Reactor
- Raymarch Lattice
- Caustic Engine
- Hyperbolic Grid
- Interference Array
- Volumetric Storm
- Recursive Glyph Field

Use each preset's **peak** profile to increase GPU workload. The raymarch, interference, and volumetric shaders are the most demanding starting points.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Command/Ctrl + O` | Open WGSL file |
| `Command/Ctrl + S` | Save |
| `Command/Ctrl + Shift + S` | Save As |
| `Command/Ctrl + Enter` | Compile source |
| `Tab` | Insert two spaces in the editor |

## Validation status

Static package validation is documented in `VALIDATION.md`. The first Rust build and native runtime test must be completed on a machine with Rust, Tauri 2 prerequisites, and a compatible GPU.
