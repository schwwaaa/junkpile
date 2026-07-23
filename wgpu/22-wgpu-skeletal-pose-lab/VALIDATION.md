# Validation Report

## Static checks completed

- `package.json` parses
- `tauri.conf.json` parses
- Cargo TOML parses
- frontend JavaScript passes `node --check`
- every frontend Tauri command is registered by `generate_handler!`
- `withGlobalTauri` is enabled
- shader contains no previously encountered reserved identifiers such as `active` or `smooth`
- shader contains no swizzle assignments
- wgpu 29 surface handling uses `CurrentSurfaceTexture`
- wgpu 29 pipeline layouts use `bind_group_layouts: &[Some(...)]`
- vertex layouts use direct `VertexBufferLayout` values rather than `Option`
- the bundled GLB has a valid GLB 2 header and internally consistent total length
- ZIP integrity passes

## Runtime authority

Cargo, Metal, and interactive GPU hardware are unavailable in the packaging environment. Local compilation and launch remain the authoritative verification.

- [x] Line overlay depth bias is `DepthBiasState::default()` for `LineList` topology.
