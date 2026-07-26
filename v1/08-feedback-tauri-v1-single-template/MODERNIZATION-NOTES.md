# Example 08 modernization notes

This pass updates the original legacy feedback template without changing its educational purpose.

## Preserved

- Original folder name
- Tauri v1
- Single-window architecture
- Raw WebGL 1 renderer
- Browser `getUserMedia()` source capture
- Two-texture ping-pong framebuffer architecture
- Separate simulation and display shaders
- Original six feedback modes
- Original decay, source mix, speed, scale, intensity, hue, palette, and brush concepts
- No p5.js, WebSocket relay, or native wgpu renderer

## Updated

- Current Junkpile visual system and Example 08 numbering
- Immediate controls-panel scrolling
- Animated generated source before camera permission
- Permission-aware camera enumeration and refresh
- Restartable camera/device/resolution switching
- Contain, cover, stretch, and mirror source mapping
- Render FPS, source FPS, canvas, and feedback-buffer telemetry
- Selectable 25%, 50%, 75%, and 100% history resolution
- RGBA8 framebuffer allocation with completeness checks
- Shader compile/link diagnostics and renderer reporting
- WebGL context-loss and restoration handling
- Reliable resize and history reallocation
- Six curated presets
- Pointer events for direct state injection
- Pause, reset, clear, shortcuts, and native fullscreen
- Camera usage text and macOS camera entitlement
- Correct product name, bundle identifier, and icon packaging
- Explicit standalone Cargo workspace boundary
- Complete development, build, architecture, and extension documentation
