# 10 · wgpu 3D Particle Volume

A standalone Tauri 2 + Rust/wgpu example that extends the compute-particle system into a true XYZ simulation and perspective renderer.

## What changes from example 09

Example 09 stores two-dimensional position and velocity. This project stores three-dimensional position and velocity and adds the remaining pieces required to make Z visible:

```text
XYZ particle storage
       ↓
3D WGSL compute field
       ↓
world-to-camera transform
       ↓
perspective projection
       ↓
camera-facing particle billboards
       ↓
Depth32Float attachment
       ↓
Metal / Vulkan / DX12 surface
```

The **Z depth** control is intentionally central. At `0.0`, the rendering collapses onto an XY plane. At `1.0`, the initial sphere has natural depth. Values above `1.0` stretch the volume toward and away from the camera.

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

## Controls

### Volume

- **Z depth** — scales world-space Z before camera projection.
- **Z force** — adds motion around and through the depth axis.
- **Depth fog** — attenuates particles with camera distance.
- **Depth occlusion** — switches between additive volume rendering and true depth-writing rendering.

### Camera

- Yaw
- Pitch
- Distance
- Vertical field of view
- Automatic orbit speed

### Simulation

- Particle count from 100K to 1M, subject to GPU limits
- Orbit field
- Turbulence
- Drag
- Speed
- Compute substeps

## Particle memory layout

Each particle occupies 48 bytes:

```rust
position: [f32; 4] // xyz + phase
velocity: [f32; 4] // xyz + seed
color:    [f32; 4] // rgba
```

At one million particles, the storage buffer is approximately 45.8 MiB.

## Additive volume versus depth occlusion

**Additive volume** does not write particle depth. Distant particles remain visible through nearer particles and accumulate into a luminous cloud.

**Depth occlusion** writes to a `Depth32Float` attachment. A nearer particle can hide particles behind it, demonstrating actual front-to-back depth behavior. Soft transparent billboards are not physically opaque geometry, so this mode is instructional rather than a complete order-independent transparency solution.

## Why billboards

Each particle is still rendered as a six-vertex quad. The quad is constructed in camera-space right/up directions, so it always faces the camera. Its size is expressed in world units, which means perspective naturally makes nearby particles appear larger.

## Pinned versions

```text
Tauri       2.11.5
tauri-build 2.6.3
wgpu        29.0.4
```
