# Example 04 modernization notes

This pass updates the original legacy template without changing its educational purpose.

## Preserved

- Original folder name
- Tauri v1
- Single-window architecture
- Raw WebGL 1 renderer
- External `src/shader.frag` project asset
- Runtime local `.frag` / `.glsl` loading
- Domain-warped fBm default shader
- Original uniform controls
- Direct `shader source → compile/link → uniforms → drawArrays` flow
- No p5.js or external graphics framework

## Updated

- Current Junkpile visual system and Example 04 numbering
- External `styles.css` and structured `sketch.js`
- Immediate, stable controls-panel scrolling
- Responsive drawing-buffer resizing
- Fixed-width numeric readouts
- Render status, FPS, canvas-size, renderer, source-size, and compile-time telemetry
- Compiler/linker terminal with WebGL compatibility hints
- Last-valid-program retention after a failed shader replacement
- Drag-and-drop shader loading
- Project-shader restoration
- Context-loss handling
- Pause, reset, presets, keyboard shortcuts, and native fullscreen
- Tauri product name and bundle identifier
- Missing macOS `.icns` icon
- Explicit standalone Cargo workspace boundary
- Complete development, production-build, shader-contract, and extension documentation
