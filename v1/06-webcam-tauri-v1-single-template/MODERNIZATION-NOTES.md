# Example 06 modernization notes

This pass updates the original legacy webcam template without changing its educational purpose.

## Preserved

- Original folder name
- Tauri v1
- Single-window architecture
- Raw WebGL 1 renderer
- Browser `getUserMedia()` camera capture
- Camera-as-`sampler2D` workflow
- Original six effects, color controls, toggles, and feedback concept
- No p5.js, WebSocket relay, or native wgpu renderer

## Updated

- Current Junkpile visual system and Example 06 numbering
- Immediate controls-panel scrolling
- Permission-aware device enumeration and refresh
- Restartable camera/device/resolution switching
- Source resolution, camera FPS, render FPS, and canvas telemetry
- Contain, cover, and stretch source framing
- Animated calibration source before camera permission
- Separate effect and blit programs to avoid double processing
- Reliable feedback-buffer resize and clear behavior
- Shader compile/link diagnostics
- WebGL context-loss handling
- Pause, reset, presets, shortcuts, and native fullscreen
- Camera usage text and macOS camera entitlement
- Correct product name, bundle identifier, and `.icns` packaging
- Explicit standalone Cargo workspace boundary
- Complete development, build, architecture, and extension documentation
