# Validation Notes

Static checks completed during packaging:

- `package.json` parses as JSON.
- `tauri.conf.json` parses as JSON.
- `Cargo.toml` parses as TOML.
- `app.js` passes Node syntax validation.
- Every HTML ID referenced by JavaScript exists.
- Tauri command names referenced by JavaScript exist in `main.rs`.
- wgpu pipeline layouts use the wgpu 29 `Option<&BindGroupLayout>` form and `immediate_size`.
- Surface acquisition uses `CurrentSurfaceTexture` rather than removed `SurfaceError` handling.
- Surface textures are presented through `frame.present()`.
- WGSL contains no known reserved `smooth` identifier.
- WGSL contains no assignments to vector swizzles.
- The archive excludes `node_modules`, Cargo `target`, and unrelated microphone/camera metadata.

The packaging environment does not contain Rust/Cargo or MIDI hardware. Local compilation and device testing remain authoritative.
