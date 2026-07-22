# Validation

Static validation completed for this package:

- `package.json` and `tauri.conf.json` parse as JSON
- `Cargo.toml` parses as TOML
- `src/app.js` and backend launcher pass Node syntax checks
- every JavaScript `byId()` reference exists in `index.html`
- Tauri command names match frontend invocations
- wgpu 29 surface acquisition uses `CurrentSurfaceTexture`
- pipeline layouts use `bind_group_layouts: &[Some(...)]` and `immediate_size: 0`
- no removed `SurfaceError`, `Queue::present`, `BlendState::ADDITIVE`, or `request_redraw()` APIs
- WGSL contains no reserved `smooth` identifier
- WGSL contains no left-hand swizzle assignments
- package is isolated from parent Cargo workspaces with `[workspace]`
- archive integrity checked after packaging

Cargo and GPU execution are not available in the packaging environment. Local compilation and OSC traffic remain the authoritative runtime validation.

## WGSL reserved-keyword correction

- Renamed the fragment-local identifier `active` to `active_state` because `active` is reserved by WGSL.
- Confirmed no remaining `let active` declaration exists in the shader.
