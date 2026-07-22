# Validation

Static checks performed during packaging:

- JSON and TOML parse successfully
- JavaScript syntax check
- WGSL delimiter, reserved-identifier, and left-hand-swizzle checks
- wgpu 29 pipeline-layout and surface-presentation patterns
- Rust brace and file-reference checks
- ZIP integrity

Local `cargo` and GPU execution are the authoritative compile/runtime validation.
