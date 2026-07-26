# Example 05 modernization notes

This pass updates the legacy template without changing its educational purpose.

## Preserved

- Original folder name
- Tauri v1
- Separate controls and output windows
- Embedded Rust WebSocket relay on port `2727`
- Raw WebGL 1 renderer
- External `src/shader.frag`
- Runtime shader-source hot swapping
- Original domain-warped fBm shader
- Original uniform controls
- No p5.js or native wgpu renderer

## Updated

- Current Junkpile visual system and Example 05 numbering
- Reliable initial controls scrolling
- External CSS and structured frontend files
- Smooth animation-frame-coalesced parameter batches
- Full parameter and shader-source recovery after reconnect
- Shader source metadata and compiler telemetry
- Compiler/linker terminal in the controls window
- Last-valid-program retention after a failed replacement
- Local file picker and shader drag/drop
- Project shader restoration and manual recompilation
- Output FPS, size, renderer, pause, connection, and shader status
- Responsive high-DPI output resizing
- Context-loss handling
- Native show/focus/fullscreen commands
- Correct product name and bundle identifier
- Explicit standalone Cargo workspace boundary
- Complete development, production-build, shader-contract, and architecture documentation
