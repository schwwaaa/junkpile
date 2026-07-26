# Tauri v2 Example 01 modernization notes

This pass updates the original Tauri v2 two-window template without changing its educational purpose.

## Preserved

- Original folder name
- Tauri v2
- Two WebView windows
- Embedded Rust WebSocket relay on port 2727
- Client roles: `controls` and `canvas`
- p5.js WebGL renderer
- Domain-warped fBm shader
- Original core parameters
- Generic text and binary relay behavior

## Updated

- Current Junkpile visual system and Example 01 identity
- Separate external stylesheets for both windows
- Reliable controls-panel scrolling from initial launch
- Responsive renderer canvas sizing
- Correct fullscreen p5 vertex coordinates
- Fixed-width parameter readouts
- Local npm-managed p5.js instead of runtime CDN loading
- Coalesced parameter batches for smooth slider movement
- Full state snapshots and reconnect synchronization
- Relay presence messages with role counts
- Renderer FPS, size, and pause telemetry returned to controls
- Pause, reset, sync, presets, and keyboard shortcuts
- Native show, focus, and fullscreen commands for the output window
- Tauri v2 `core.invoke` frontend calls
- Explicit capabilities for both WebViews
- Current Tauri v2 configuration and window APIs
- Product name, bundle identifier, and complete icons
- Standalone Cargo workspace boundary
- Complete architecture, run, build, and extension documentation
