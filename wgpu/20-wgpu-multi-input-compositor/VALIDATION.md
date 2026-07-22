# Validation status

Static validation completed in the packaging environment:

- package.json parsed
- tauri.conf.json parsed
- Cargo.toml parsed
- JavaScript syntax checked with Node
- `withGlobalTauri` enabled
- frontend command references compared with Tauri handlers
- video transport controls reference implemented Tauri commands
- video-audio preview never consumes microphone samples
- microphone, video, and mixed FFT source options are represented in the router
- WGSL scanned for known reserved identifiers (`smooth`, `active`)
- WGSL scanned for illegal multi-component swizzle assignments
- wgpu 29 surface-acquisition API patterns retained
- macOS camera and microphone usage descriptions retained
- ZIP archive integrity checked

Cargo compilation and live hardware validation are not available in the packaging container. Local compilation remains authoritative, especially for CPAL output-device behavior and FFmpeg audio decoding.
