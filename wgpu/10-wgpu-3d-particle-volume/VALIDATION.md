# Validation status

Static validation performed during generation:

- JSON parses successfully.
- TOML parses successfully.
- JavaScript passes `node --check`.
- HTML references its local CSS and JavaScript files.
- WGSL uniform and particle structures match between compute and render shaders.
- Rust and WGSL particle structures are each 48-byte, three-vec4 layouts.
- Pipeline layouts use the wgpu 29 `Option<&BindGroupLayout>` form.
- Presentation uses `SurfaceTexture::present()`.
- Additive blending is declared explicitly rather than using a newer convenience constant.
- The project is isolated from parent Cargo workspaces.

Cargo and GPU runtime validation must be performed on a local machine with Rust and the selected graphics backend available.

## WGSL swizzle-assignment compatibility fix

WGSL does not permit vector swizzles on the left-hand side of assignments. The compute shader now reconstructs complete `vec4<f32>` particle values while preserving `.w` metadata, and the render shader reconstructs the complete camera-space `vec3<f32>` after applying billboard offsets.
