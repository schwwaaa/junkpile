# 13 · wgpu Voxel Feedback Volume

A standalone Tauri 2 + Rust/wgpu example that evolves a persistent three-dimensional RGBA16F field with a WGSL compute shader, then renders it with a volume raymarcher.

```bash
npm install
npm run dev:metal
```

## Concepts

- 3D sampled textures and 3D storage textures
- Ping-pong voxel feedback
- 4×4×4 compute workgroups
- Advection, diffusion, erosion, injection and burst impulses
- Volume raymarching, orthogonal slices, maximum-intensity projection and threshold surfaces
- Independent volume and output definition
- HDR offscreen rendering and tone mapping

Start at 128³. Two RGBA16F fields require 32 MiB at 128³, 108 MiB at 192³, and 256 MiB at 256³.
