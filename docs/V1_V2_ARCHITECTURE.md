# Tauri v1, Tauri v2, and native wgpu

## The critical distinction

Tauri generation and graphics renderer are separate axes.

| Concern | Tauri v1 WebView | Tauri v2 WebView | Tauri v2 + native wgpu |
|---|---|---|---|
| Examples | 00–25 | 00–25 | 00–25 |
| Pixel owner | WebView | WebView | Rust/wgpu surface |
| Shader language | GLSL ES 1.0 | GLSL ES 1.0 | WGSL |
| Control surface | HTML/JS | HTML/JS | HTML/JS optional |
| Native command call | v1 invoke API | `window.__TAURI__.core.invoke()` | Tauri 2 IPC into Rust state |
| Permissions | v1 allowlist/features | explicit Tauri 2 capabilities | capabilities for every control WebView |
| GPU backend | browser/OS WebView stack | browser/OS WebView stack | Metal / Vulkan / Direct3D 12 |
| Compute shaders | no | no through WebGL 1 | yes |
| Resource ownership | JavaScript/WebGL | JavaScript/WebGL | Rust/wgpu |
| Best use | legacy comparison, rapid creative coding | current WebView apps | native performance and GPU systems |

## Tauri v1 specifics

Use the v1 configuration schema, dependency features, window definitions, and command/event APIs. Do not copy Tauri 2 capabilities or plugin syntax into a v1 project.

## Tauri v2 WebView specifics

Use the v2 configuration schema, explicit capability files, current WebView-window APIs, `get_webview_window()` in Rust, and `window.__TAURI__.core.invoke()` in vanilla JavaScript. Native OS drag/drop must use the Tauri WebView event API rather than relying only on browser `DataTransfer.files`.

## Native wgpu specifics

A wgpu surface attaches to the native window. Rust must manage surface creation, adapter selection, device/queue creation, resize/reconfiguration, minimized states, current-texture errors, command submission, presentation, and telemetry. HTML can remain a powerful control interface without being in the pixel path.

## Why all three remain useful

The WebView examples are easier for developers coming from creative coding and web graphics. The native examples expose the systems needed for high-performance media instruments, reusable Scheng components, and focused commercial applications. The paired tracks make the migration cost visible rather than theoretical.
