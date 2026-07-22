# 07 · wgpu High Resolution Lab

This example decouples internal render definition from the size of the visible window.

## Presets

- Window-sized
- 1920×1080
- 3840×2160
- 7680×4320

The offscreen target is RGBA16F, or 8 bytes per pixel. Approximate memory for one target:

- 1080p: 15.8 MiB
- 4K: 63.3 MiB
- 8K: 253.1 MiB

Those figures exclude the swapchain, uniform buffers, driver overhead, and any additional passes. A four-target 8K graph uses about 1.06 GB (roughly 0.99 GiB) just for color targets, before driver overhead, staging buffers, depth buffers, or duplicated resources.

## Run

```bash
npm install
npm run dev
```

Start at window or 1080p resolution. Move to 4K and 8K while watching the reported FPS, frame time, pixel throughput, and memory estimate.

## What 8K means here

The 8K preset creates a 7680×4320 offscreen target and then downsamples it into the visible window. It does not require an 8K monitor. This separates render definition from display definition and lets developers measure shader cost before implementing 8K recording or output.

## Backend and version policy

This project pins Tauri 2.11.5 and wgpu 29.0.4. It requests `wgpu::Backends::PRIMARY`, so native rendering uses Metal, Vulkan, or DX12 rather than a GL/GLES fallback. Begin at 1080p, then test 4K, and only then test 8K.
