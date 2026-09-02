# Validation

## Static validation completed

- Revision 0.1.1 updates surface presentation for the wgpu 29 API: `CurrentSurfaceTexture` + `Queue::present`.
- No references to the removed `wgpu::SurfaceError` remain.

- Tauri product and bundle identifiers are filesystem-safe.
- Frontend command names match Rust command registration.
- JavaScript syntax checked with Node.js.
- WGSL source inspected for the expected uniform/texture bindings and six visual branches.
- FFT texture row size is 1024 bytes (`256 × RGBA8`).
- Waveform texture row size is 2048 bytes (`512 × RGBA8`).
- Both texture upload rows are naturally aligned to 256-byte boundaries.
- Microphone capture work is separated from FFT work.
- Spin is multiplied by elapsed shader time and therefore represents angular velocity.
- 8K preset remains under wgpu's common 8192-pixel default texture limit; runtime still checks the actual adapter.
- macOS microphone usage description is included.
- ZIP excludes `target/` and `node_modules/`.

## Runtime validation still required

Cargo/Rust is unavailable in the artifact environment, so verify locally:

1. `npm install`
2. `npm run dev`
3. Native renderer opens.
4. Demo signal animates with microphone stopped.
5. Microphone enumeration succeeds.
6. Permission prompt succeeds.
7. Start/stop works repeatedly.
8. FFT and waveform meters respond.
9. Beat count responds to transients.
10. Spin `0` stops rotation.
11. Negative Spin reverses rotation.
12. Resolution switching through the supported presets does not crash.
13. Fullscreen and resize remain stable.
