# 06 · wgpu Multipass Render Graph

A readable four-pass native GPU pipeline:

1. Procedural HDR source
2. Horizontal blur
3. Vertical blur
4. Bloom/chromatic composite and tone mapping

Run with `npm install` then `npm run dev`.

The three intermediate targets use RGBA16F. The control panel reports their approximate memory footprint so increasing resolution has an understandable cost.

## Pass graph

```text
procedural HDR source
        ↓
horizontal blur
        ↓
vertical blur
        ↓
source + bloom + chromatic shift + tone map
        ↓
native surface
```

## Backend and version policy

This project pins Tauri 2.11.5 and wgpu 29.0.4. It requests `wgpu::Backends::PRIMARY`, so native rendering uses Metal, Vulkan, or DX12 rather than a GL/GLES fallback.


## Grain stability

The final composite pass uses a spatially stable per-pixel grain pattern. An earlier version offset the grain coordinates by the frame index, which translated the entire noise field diagonally by one pixel per frame and could appear as a faint rolling video-oscillator pattern. The grain amount remains adjustable, but its default is reduced to `0.015` so the render graph is easier to inspect.
