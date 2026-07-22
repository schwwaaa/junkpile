# Validation record

The package was statically checked for:

- standalone Cargo workspace isolation
- pinned Tauri 2.11.5 and wgpu 29.0.4 dependencies
- current wgpu 29 pipeline-layout fields
- `frame.present()` surface presentation
- explicit additive-free replacement blending
- matching Rust and WGSL uniform member order
- no WGSL left-hand swizzle assignments
- no use of the reserved WGSL identifier `smooth`
- all HTML IDs referenced by JavaScript
- all Tauri command names referenced by JavaScript
- valid JSON and TOML parsing
- JavaScript syntax
- ZIP integrity

The packaging environment does not contain Cargo or a GPU runtime. Local compilation and runtime behavior remain the authoritative validation.
