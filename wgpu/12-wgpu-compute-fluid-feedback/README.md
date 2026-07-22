# 12 · wgpu Compute Fluid Feedback

A standalone **Tauri 2 + Rust + wgpu 29** example that runs a two-dimensional incompressible-fluid approximation entirely on the GPU.

The output window is a native wgpu surface. The control window is a separate Tauri WebView. There is no WebGL canvas in the render path.

## Run

```bash
npm install
npm run dev:metal
```

Automatic backend selection:

```bash
npm run dev
```

Other backend launchers:

```bash
npm run dev:vulkan
npm run dev:dx12
npm run dev:gl
```

## Pipeline

Each simulation substep records this compute sequence:

1. Advect velocity and inject force.
2. Calculate scalar curl.
3. Apply vorticity confinement.
4. Calculate divergence.
5. Solve pressure through an even number of Jacobi iterations.
6. Subtract the pressure gradient from velocity.
7. Advect HDR dye through the projected velocity field.

Velocity, dye, and pressure use ping-pong textures. No field is copied through the CPU.

## GPU fields

Eight `Rgba16Float` textures are maintained:

- velocity A / B
- dye A / B
- pressure A / B
- divergence
- curl

The controls can display the actual dye, velocity, pressure, divergence, or curl texture.

## Resolution model

Simulation and output resolution are deliberately independent.

- The **fluid grid** controls simulation definition and compute cost.
- The **output definition** controls the HDR presentation target and final image definition.

A 512² simulation can therefore be presented into a 4K or 8K output target. A 2048² fluid grid is available for high-end testing and allocates approximately 256 MiB across the eight simulation textures.

## Suggested first run

- Fluid grid: `512²`
- Pressure iterations: `24`
- Substeps: `1`
- Output: `Window`
- View: `Dye`
- Emitter: `Orbit`

Then inspect `Velocity`, `Pressure`, `Divergence`, and `Curl` to understand the solver.

## Key files

```text
src-tauri/src/
├── main.rs       Tauri commands and native renderer window
├── renderer.rs   wgpu resources, compute graph, render loop, diagnostics
├── compute.wgsl  advection, curl, vorticity, pressure, projection, dye
└── present.wgsl  field visualization, bloom, tone mapping, presentation
```

See `FLUID-GUIDE.md` for the theory and performance implications.
