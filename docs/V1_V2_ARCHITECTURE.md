# Tauri generation, render ownership, and native I/O

## The critical distinction

Tauri generation, graphics renderer, and native/media I/O are separate concerns. They interact, and not every combination is represented or equally direct, but a transport should not be inferred to belong to a renderer merely from the folder that currently demonstrates it.

| Concern | Tauri v1 WebView | Tauri v2 WebView | Tauri 2 + native wgpu |
|---|---|---|---|
| Pixel owner | WebView | WebView | Rust/wgpu surface |
| Shader language | GLSL ES | GLSL ES | WGSL |
| Control surface | HTML/JS | HTML/JS | HTML/JS optional |
| Native command path | Tauri v1 invoke/event APIs | Tauri 2 core invoke/events | Tauri 2 IPC into Rust-owned state |
| Permissions | v1 allowlist/features | explicit Tauri 2 capabilities | capabilities for control WebViews plus native OS permissions |
| GPU backend | browser/OS WebView stack | browser/OS WebView stack | Metal / Vulkan / Direct3D 12 |
| Compute shaders | not through the WebGL 1 baselines | not through the WebGL 1 baselines | yes |
| Resource ownership | JavaScript/WebGL | JavaScript/WebGL | Rust/wgpu |
| Typical strength in current repository | rapid creative coding, legacy comparison | current WebView desktop apps | explicit GPU ownership, compute, current high-resolution/recording/output-router references |

## Tauri v1 specifics

Use the v1 configuration schema, dependency features, window definitions, and command/event APIs. Do not copy Tauri 2 capability or plugin syntax into a v1 project.

## Tauri v2 WebView specifics

Use the v2 configuration schema, explicit capability files, current WebView-window APIs, and Tauri 2 command/event APIs. Native OS drag/drop should use the Tauri WebView event path when browser `DataTransfer.files` is insufficient.

## Native wgpu specifics

A wgpu surface attaches to the native window. Rust manages surface creation, adapter selection, device/queue creation, resize/reconfiguration, minimized states, current-texture errors, command submission, presentation, and telemetry.

The current native track also contains reference implementations for:

- camera/video/audio bridges
- MIDI/OSC parameter routing
- compute and 3D
- high-resolution export
- FFmpeg recording
- NDI/Syphon/Spout sender paths
- multi-output routing
- unattended runtime modes
- native A/V recording

These locations describe what Junkpile currently demonstrates, not what Tauri v1/v2 are fundamentally allowed to integrate. Native services can exist behind WebView applications as Rust/platform bridges; the renderer-to-service handoff is simply different. HTML can also remain a powerful control/editor surface without being in the pixel path.

## Why all three remain useful

The WebView projects are accessible to developers coming from creative coding and web graphics. Native wgpu projects expose lower-level resource ownership and performance-oriented media paths. Keeping both approaches visible makes architectural tradeoffs concrete and supports standalone applications at different levels of complexity.
