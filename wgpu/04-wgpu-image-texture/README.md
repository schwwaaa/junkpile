# 04 · wgpu Image Texture

A native Tauri 2 + wgpu example showing the complete path from encoded image bytes to a sampled GPU texture.

## Run

```bash
npm install
npm run dev
```

## What it teaches

- Decode a bundled PNG in Rust with the `image` crate.
- Upload RGBA8 pixels with `Queue::write_texture`.
- Use an sRGB texture format so sampling produces linear color values.
- Bind a texture, sampler, and uniform buffer to WGSL.
- Compare nearest and linear filtering.
- Implement contain, cover, and stretch without CSS or a browser canvas.

The renderer window is a native wgpu surface. The WebView is used only for controls.

## Backend and version policy

This project pins Tauri 2.11.5 and wgpu 29.0.4. It requests `wgpu::Backends::PRIMARY`, so native rendering uses Metal, Vulkan, or DX12 rather than a GL/GLES fallback.
