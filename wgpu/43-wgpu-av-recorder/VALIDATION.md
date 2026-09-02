# Validation

Static checks completed in the generation environment:

- `src/app.js` passes Node syntax checking.
- Tauri commands referenced by the frontend are registered in `main.rs`.
- Project metadata and Tauri product names are filesystem-safe.
- `wgpu` is pinned to 29.0.4 to match the current native examples.
- No Cargo build artifacts are included.
- Microphone permission plist is included for macOS.
- Video output remains outside the watched source tree.

Runtime validation still required locally because Rust/Cargo is unavailable in the generation environment:

- CPAL device enumeration and microphone capture.
- H.264 + AAC mux.
- ProRes + PCM mux.
- Audio-file looping.
- 4K/5K/8K performance on target hardware.
