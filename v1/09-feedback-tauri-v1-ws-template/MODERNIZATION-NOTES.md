# Modernization notes — V1 Example 09

Folder retained: `feedback-tauri-v1-ws-template`

## Preserved

- Tauri v1
- Separate controls and canvas windows
- Rust WebSocket relay on port 2727
- Camera capture inside the output WebView
- Raw WebGL 1
- Two-texture ping-pong feedback
- Six original feedback simulations
- Pointer injection into the simulation state

## Modernized

- Current Junkpile Example 09 identity and visual shell
- Reliable controls scrolling from initial launch
- Relay presence reporting
- Coalesced parameter batches
- Complete state restoration after reconnect
- Generated source before camera permission
- Camera refresh, device selection, and capture presets
- Adjustable history resolution
- Output FPS, source FPS, dimensions, GPU, mode, and shader telemetry
- Shader/link/framebuffer diagnostics
- Responsive high-DPI output and buffer reallocation
- WebGL context-loss handling
- Native output show/focus/fullscreen commands
- macOS camera permission packaging
- Standalone Cargo workspace boundary
- Complete development and production documentation
