# 05 · wgpu Ping-Pong Feedback

Native HDR feedback using two `Rgba16Float` render textures. One texture is sampled while the other is written, then their roles swap for the next frame.

## Run

```bash
npm install
npm run dev
```

## Why two textures?

A render pass cannot safely sample from the same subresource it is currently writing. Ping-pong rendering makes the dependency explicit and portable across Metal, Vulkan, and Direct3D 12.

## Memory

Each RGBA16F pixel uses 8 bytes. At 3840×2160, one target is about 63.3 MiB and the pair is about 126.6 MiB. At 7680×4320, the pair would be about 506.3 MiB before other render targets and application resources.

## Backend and version policy

This project pins Tauri 2.11.5 and wgpu 29.0.4. It requests `wgpu::Backends::PRIMARY`, so native rendering uses Metal, Vulkan, or DX12 rather than a GL/GLES fallback. Start at a modest window size before testing large feedback targets.
