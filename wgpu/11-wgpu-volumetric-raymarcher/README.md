# 11 · wgpu Volumetric Raymarcher

A standalone **Tauri 2 + Rust + wgpu 29** example that renders procedural three-dimensional signed-distance fields directly to a native Metal, Vulkan, or DX12 surface.

This project does not load a polygon mesh. The fragment shader constructs the scene mathematically, casts one ray per internal pixel, and advances through space using signed-distance estimates.

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

On macOS, Metal is the native path. Vulkan requires a Vulkan portability implementation such as MoltenVK to be installed and visible to wgpu.

## Pipeline

```text
HTML/Tauri controls
        ↓ commands
Rust renderer state
        ↓ uniform buffer
WGSL signed-distance scene
        ↓ raymarch per pixel
RGBA16Float offscreen target
        ↓ HDR post-process
Metal / Vulkan / DX12 surface
```

## Four procedural scenes

1. **SDF Sculpture** — smooth unions between a sphere, torus, rounded box, and animated cavity.
2. **Oscillator Tunnel** — finite repeated rings, radial walls, and twisted supports.
3. **Finite Lattice** — repeated sphere/box cells clipped to a finite three-dimensional volume.
4. **Soft Organism** — animated metaball-like spheres connected by a capsule and membrane deformation.

## High-resolution modes

The renderer separates the visible window from the internal HDR target:

- Window-sized
- 1920×1080
- 3840×2160
- 7680×4320
- 12.5% through 100% render scale

One 8K `Rgba16Float` target is approximately 253 MiB. Raymarching is much more expensive than a conventional fullscreen shader because every pixel can evaluate the scene many times for the primary ray, surface normal, shadows, and ambient occlusion.

Begin at Window or 1080p. Increase ray steps and resolution independently so the cost of each dimension is visible.

## Important controls

- **Ray steps** sets the maximum primary-ray iterations.
- **Surface epsilon** trades precision against speed and stability.
- **Soft shadows** launches an additional distance-field ray from a hit surface.
- **Ambient occlusion** samples the field around the estimated surface normal.
- **Volume glow** accumulates energy while the primary ray passes close to geometry.
- **Render scale** changes the internal target without resizing the output window.

## Project structure

```text
src-tauri/src/
  main.rs       Tauri commands and native renderer window
  renderer.rs   wgpu surface, pipelines, HDR target and render loop
  shader.wgsl   SDF scenes, raymarcher, lighting and post-process

src/
  index.html    control and diagnostics interface
  app.js        Tauri command wiring
  style.css     responsive controls
```

See `RAYMARCHING-GUIDE.md` for an explanation of the rendering method and `VALIDATION.md` for validation status.
