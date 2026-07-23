# 23 · wgpu Morph Target Lab

A two-window Tauri 2 + Rust + wgpu example demonstrating GPU morph-target animation with a fixed mesh topology.

This project follows the established numbered Junkpile native-wgpu format:

- **Controls window:** a standard Tauri WebView containing HTML, CSS, JavaScript controls, presets, and telemetry.
- **Renderer window:** a separate native OS window created in `main.rs`; wgpu owns this window surface directly.

The renderer begins with one procedural sphere topology and generates three compatible targets at startup:

- rounded cube
- torus
- harmonic bloom

Every vertex stores the position and normal for the base shape and all three targets. The mesh and index buffers remain unchanged after startup. The WGSL vertex shader blends the target streams every frame using uniform weights.

## Architecture

```text
controls WebView window
    ↓ Tauri commands
RendererHandle / RenderCommand channel
    ↓ renderer thread
uniform upload
    ↓
WGSL vertex shader
    ├─ base position / normal
    ├─ cube position / normal
    ├─ torus position / normal
    └─ bloom position / normal
    ↓
separate native renderer window
    ↓
Metal / Vulkan / DX12 surface
```

The WebView never overlays or owns the graphics surface. Closing the controls window exits the application. Resizing or fullscreening the renderer window updates the wgpu surface independently.

## Features

- separate controls and native renderer windows
- native wgpu surface through Tauri 2
- 14,065 vertices and 27,648 triangles by default
- three simultaneous morph targets
- corresponding normal morphing for stable lighting
- manual and animated morph weights
- normalized, additive, and sequential blend rules
- lit, normal, morph-heat, and UV-grid inspection views
- presets for each target, cyclic animation, and additive overdrive
- camera orbit, FOV, lighting, exposure, roughness, and backface controls
- renderer fullscreen control
- live GPU adapter, frame-time, resolution, and mesh telemetry
- resize, scale-factor, surface-loss, and shutdown handling

## Run

```bash
cd 23-wgpu-morph-target-lab
npm install
npm run dev
```

Optional backend launchers:

```bash
npm run dev:metal
npm run dev:vulkan
npm run dev:dx12
```

The example declares its own Cargo workspace in `src-tauri/Cargo.toml`. This prevents Cargo from inheriting an unrelated parent `Cargo.toml` when the project is placed inside a larger repository.

## Controls

### Morph field

`Rounded cube`, `Torus`, and `Harmonic bloom` are the manual target weights. When **Auto morph** is enabled, `Auto amount` blends the manual values toward three phase-offset oscillators. The smaller bars beneath the sliders show the effective values actually sent to the GPU.

Blend rules:

- **Normalized:** preserves the base shape through unused weight and normalizes totals above one.
- **Additive:** treats targets like independent shape keys and can deliberately overshoot.
- **Sequential:** applies ordered crossfades from base → cube → torus → bloom.

### Inspection views

- **Lit material:** verifies interpolated normals and lighting.
- **Normals:** maps the final normal direction to RGB.
- **Morph heat:** maps cube, torus, and bloom weights to red, green, and blue.
- **UV grid:** exposes the shared topology and UV parameterization.

## Project map

```text
23-wgpu-morph-target-lab/
├── package.json
├── README.md
├── scripts/
│   └── run-backend.mjs
├── src/
│   ├── index.html       controls WebView
│   ├── styles.css       controls styling
│   └── app.js           Tauri IPC and renderer telemetry
└── src-tauri/
    ├── Cargo.toml
    ├── tauri.conf.json  declares only the controls WebView
    ├── capabilities/
    │   └── default.json
    └── src/
        ├── main.rs      creates native renderer window and routes commands
        ├── mesh.rs      procedural compatible target generation
        ├── renderer.rs  wgpu resources, state, surface, and render thread
        └── morph.wgsl   GPU position/normal blending and shading
```

## Morph-buffer layout

Each `MorphVertex` contains:

```text
base_position   vec3
cube_position   vec3
torus_position  vec3
bloom_position  vec3
base_normal     vec3
cube_normal     vec3
torus_normal    vec3
bloom_normal    vec3
uv              vec2
```

That is 104 bytes per vertex. This favors clarity over the most memory-efficient production layout. A production SDK could move target deltas into storage buffers, compress normals, stream selected targets, or execute a compute pass into a compact render buffer.

## Morph targets versus skinning

This is morph-target animation, not skeletal skinning:

- skeletal animation transforms vertices from bone matrices and per-vertex joint weights
- morph animation blends complete alternative vertex positions
- both can be combined in a larger renderer, usually morphing in object space before skinning
