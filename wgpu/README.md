# Junkpile Native wgpu Examples

This directory begins the next-generation Junkpile renderer path:

```text
Tauri HTML controls
        ↓ commands
Rust renderer state
        ↓
wgpu
        ↓
Metal · Vulkan · DX12
```

The output window is a raw Tauri window with a native wgpu surface. It is deliberately separate from the controls WebView so the WebView and GPU do not compete for the same platform surface.

## Foundation milestone

| Order | Project | What it establishes |
|---:|---|---|
| 00 | `00-wgpu-surface-probe` | Native surface creation and backend diagnostics |
| 01 | `01-wgpu-resize-fullscreen` | Resize, HiDPI, minimize, fullscreen, surface recovery |
| 02 | `02-wgpu-wgsl-shader` | Fullscreen triangle, uniforms, procedural WGSL |
| 03 | `03-wgpu-tauri-controls` | Validated HTML → Rust → renderer parameter flow |

## Requirements

- Current stable Rust toolchain
- Node.js and npm
- Tauri 2 platform prerequisites
- A Metal, Vulkan, DX12, or supported fallback GPU driver

Each project is standalone:

```bash
cd 00-wgpu-surface-probe
npm install
npm run dev
```

## Why `tauri` uses the `unstable` feature

Tauri's raw `WindowBuilder`, distinct from `WebviewWindowBuilder`, is currently exposed by the crate's `unstable` feature. This is a Tauri API stability label, not a Rust nightly requirement. The examples use stable Rust.

## Next implementation layer

After these four foundations are tested on macOS and Windows, the next examples should be:

1. image texture upload
2. ping-pong feedback
3. multipass rendering
4. compute feedback
5. native webcam
6. video decoding
7. audio analysis
8. MIDI, OSC, and WebSocket control
