# ShadeCore Syphon Parity

## Integrated concepts

- Human-readable sender name
- macOS-only Syphon output
- Native bridge compiled from Objective-C
- Syphon framework linking
- Sender create/publish/destroy lifecycle
- Connected-client detection
- Runtime enable and disable
- Resize-aware output texture recreation
- Output isolated from preview rendering
- Explicit diagnostics and clean shutdown

## Backend adaptation

ShadeCore publishes an OpenGL texture directly through `SyphonOpenGLServer`.

This wgpu example publishes through `SyphonMetalServer`. Because the current example does not expose wgpu's backend Metal texture directly, it uses asynchronous readback and a reusable Metal upload texture.

The architecture preserves the I/O concept and public sink behavior. Direct wgpu/Metal texture interop remains a future optimization, not a prerequisite for validating Syphon output.
