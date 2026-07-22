# 02 · WGSL Shader

The first complete procedural native visual.

## New concepts

- Fullscreen triangle generated from `vertex_index`
- WGSL vertex and fragment entry points
- A Rust uniform struct mirrored byte-for-byte in WGSL
- `queue.write_buffer` once per frame
- Domain-warped fractional Brownian motion
- Pause and time reset commands without moving the render loop into JavaScript

## Run

```bash
npm install
npm run dev
```

Edit `src-tauri/src/shader.wgsl` to change the visual. Shader compilation errors are printed by wgpu during startup.
