# Example 03 modernization notes

This pass updates the original raw-WebGL two-window template without changing its educational purpose.

## Preserved

- Original folder name
- Tauri v1
- Separate controls and output WebViews
- Embedded Rust WebSocket relay on port 2727
- Client roles: `controls` and `canvas`
- Raw WebGL 1 renderer with no p5.js
- Original domain-warped fBm shader
- Original core parameters
- Generic text and binary relay behavior

## Updated

- Current Junkpile visual system and Example 03 identity
- Reliable controls-panel scrolling from initial launch
- Responsive high-DPI-aware drawing-buffer resizing
- Fixed-width parameter readouts
- Coalesced parameter batches for smooth slider movement
- Full-state snapshots and reconnect synchronization
- Relay presence messages with role counts
- Renderer FPS, size, GPU, pause, and shader telemetry
- Explicit shader compile/link errors in the output window
- WebGL context-loss/restoration handling
- Pause, reset, sync, presets, and keyboard shortcuts
- Native show, focus, and fullscreen commands for the output window
- Tauri product name, bundle identifier, and macOS icon
- Standalone Cargo workspace boundary
- Complete architecture, run, build, and extension documentation
