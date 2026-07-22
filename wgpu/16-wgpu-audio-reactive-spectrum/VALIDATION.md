# Validation record

Static checks completed in the packaging environment:

- package, Tauri, and Cargo metadata reviewed
- JSON parsing
- JavaScript syntax validation
- HTML element-reference validation
- Tauri command name cross-check
- WGSL delimiter and entry-point checks
- no left-hand swizzle assignments
- no use of the WGSL reserved identifier `smooth`
- wgpu 29 pipeline-layout form (`Some(&layout)`, `immediate_size`)
- surface presentation through `SurfaceTexture::present()`
- wgpu 29 surface acquisition through `CurrentSurfaceTexture` variants
- no removed `SurfaceError` API and no unsupported `tauri::Window::request_redraw()` call
- storage buffer sized for 256 spectrum + 512 waveform floats
- macOS microphone usage description included
- ZIP archive integrity

Cargo and native audio hardware were unavailable in the packaging environment. Local compilation and microphone capture are the authoritative runtime tests.
