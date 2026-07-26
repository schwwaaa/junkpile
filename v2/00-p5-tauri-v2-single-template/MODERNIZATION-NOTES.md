# Tauri v2 Example 00 modernization notes

This pass updates the original legacy v2 template without changing its educational purpose.

## Preserved

- Original folder name
- Tauri v2
- Single-window architecture
- p5.js WebGL renderer
- Domain-warped fBm shader
- Original core parameters
- Direct `params → draw → uniform` control flow

## Updated

- Current Junkpile design and Example 00 identity
- External `styles.css` instead of a large inline stylesheet
- Immediate, stable controls-panel scrolling
- Responsive canvas resizing
- Fixed-width numeric readouts
- Render status, FPS, and canvas-size telemetry
- Pause, reset, presets, keyboard shortcuts, and native fullscreen
- Runtime-offline p5.js delivery through npm
- Tauri v2 `core.invoke` command usage
- Explicit capability file scoped to the `main` WebView
- Current v2 configuration schema and bundle identifier
- Complete icon set including macOS `.icns`
- Standalone Cargo workspace boundary
- Complete development and production documentation
- Self-only CSP with Tauri IPC access and no runtime CDN
