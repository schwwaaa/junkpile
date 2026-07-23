# Junkpile 24 — wgpu Mesh Feedback Deformer

A standalone Tauri 2 + wgpu example that treats mesh geometry as a persistent GPU feedback system.

Instead of uploading new vertex positions from Rust every frame, a WGSL compute pass reads the previous mesh state from one storage buffer and writes the next state into another. The render pass consumes the newly written state directly. On the next frame, the buffers reverse roles.

```text
frame N
state A ──compute──► state B ──render──► native surface

frame N + 1
state B ──compute──► state A ──render──► native surface
```

This is the geometry equivalent of ping-pong texture feedback.

## What this example demonstrates

- Two-window Junkpile architecture
  - `controls`: HTML/CSS/JavaScript WebView
  - `renderer`: separate native OS window owned by wgpu
- Persistent vertex position and velocity stored entirely on the GPU
- Ping-pong storage buffers
- Compute-to-render synchronization inside one command encoder
- Indexed rendering with vertex data read from a storage buffer
- Procedural force fields and neighbor smoothing
- One-shot and recurring localized impulses
- GPU-generated normals based on neighboring mesh positions
- Live backend, buffer, dispatch, and simulation telemetry
- Metal, Vulkan, and Direct3D 12 backend launch scripts

## Run

```bash
npm install
npm run dev
```

Backend-specific development commands:

```bash
npm run dev:metal
npm run dev:vulkan
npm run dev:dx12
```

The backend must be available on the current operating system.

## Window architecture

Only the controls WebView is declared in `tauri.conf.json`. During Tauri setup, Rust creates a second native window labeled `renderer` and passes that window directly to `wgpu::Instance::create_surface`.

```text
┌─────────────────────────────┐       Tauri commands       ┌───────────────────────────┐
│ controls WebView            │ ─────────────────────────► │ Rust renderer thread      │
│ sliders / presets / status  │                            │ compute + render encoder  │
└─────────────────────────────┘                            └─────────────┬─────────────┘
                                                                        │
                                                                        ▼
                                                          ┌───────────────────────────┐
                                                          │ native renderer window    │
                                                          │ Metal / Vulkan / DX12     │
                                                          └───────────────────────────┘
```

The graphics window is not a WebView canvas. wgpu owns its native surface.

## Persistent vertex state

Every vertex occupies 64 bytes in both Rust and WGSL:

```text
position_u           vec4  xyz current position, w U coordinate
velocity_v           vec4  xyz persistent velocity, w V coordinate
normal_displacement  vec4  xyz normal, w displacement from rest
rest_seed            vec4  xyz immutable rest position, w stable seed
```

The default sphere uses 128 latitude segments and 192 longitude segments. The seam is duplicated so the mesh can retain standard UV coordinates.

## Frame sequence

Each active simulation frame performs these steps:

1. Rust writes only compact compute and scene uniform buffers.
2. The compute pass reads the active storage buffer.
3. Each workgroup updates up to 128 vertices.
4. The compute pass writes positions, velocities, normals, and displacement into the other storage buffer.
5. The render pass binds that destination buffer as read-only vertex-stage storage.
6. The indexed draw reads each vertex through `@builtin(vertex_index)`.
7. The buffers exchange roles for the next frame.

No per-frame mesh readback or CPU vertex upload occurs.

## Compute forces

The compute shader combines:

- animated four-octave value noise
- attraction toward the immutable rest sphere
- four-neighbor surface smoothing
- axis twist
- tangential curl motion
- radial pulse
- vertical force
- localized impulses
- velocity feedback and damping
- maximum-displacement constraint

The controls deliberately separate **feedback** from **damping**:

- Feedback determines how much previous velocity survives into the next state.
- Damping removes energy over time.
- Values slightly above `1.0` can amplify history and produce unstable or explosive behavior.

## Presets

- **Breath** — strong rest attraction and radial motion
- **Liquid** — balanced persistent flow; default
- **Storm** — amplified feedback, fast noise, recurring impacts
- **Taffy** — long-lived twist with slow recovery
- **Sculpture** — heavily damped, slow, high-frequency deformation

Applying a preset resets both storage buffers to the original sphere so the preset starts from a known state.

## Inspection modes

- **Lit surface** — displacement- and velocity-reactive material
- **Normals** — RGB normal visualization
- **Velocity heat** — color represents current vertex speed
- **Displacement heat** — color represents distance from the rest mesh
- **UV grid** — verifies topology and seam behavior

## Important implementation files

```text
src-tauri/src/main.rs       Tauri commands and two-window lifecycle
src-tauri/src/renderer.rs   wgpu device, ping-pong buffers, compute/render loop
src-tauri/src/mesh.rs       initial sphere topology and persistent vertex state
src-tauri/src/feedback_compute.wgsl compute simulation stage
src-tauri/src/feedback_render.wgsl  vertex and fragment rendering stages
src/index.html              controls window
src/app.js                  IPC and telemetry synchronization
```

## Reset behavior

`Restore sphere state` writes the original vertex array into both GPU state buffers. This is an explicit user action, not part of the normal frame path.

`Reset all` restores the default controls and resets the mesh state.

## Performance notes

The example allocates two geometry state buffers because simultaneous read/write feedback on a single buffer would introduce data hazards. wgpu inserts the required compute-to-vertex synchronization when both passes are encoded in order.

The renderer uses `PresentMode::Fifo`, so visible frame rate normally follows display refresh. Compute work still scales with vertex count, shader complexity, and backend.

## Platform path

- macOS: WGSL → Metal
- Linux: WGSL → Vulkan
- Windows: WGSL → Direct3D 12

wgpu and Naga handle backend translation. WGSL remains the canonical source shader.
