# Validation Report

## Completed static checks

- `package.json` parses as JSON.
- `src-tauri/tauri.conf.json` parses as JSON.
- `src-tauri/Cargo.toml` parses as TOML.
- `src/app.js` passes `node --check`.
- The bundled GLB has a valid glTF binary header, JSON chunk, binary chunk, declared total size, and glTF 2.0 asset declaration.
- Rust source delimiter balance was checked with strings and comments excluded.
- All frontend command names are registered in the Tauri invoke handler.
- `withGlobalTauri` is enabled for the frontend bridge.
- The renderer uses the wgpu 29 `CurrentSurfaceTexture` variants.
- The renderer uses `frame.present()` rather than removed queue presentation APIs.
- Pipeline layouts use wgpu 29 optional bind-group-layout entries and `immediate_size`.
- Depth state uses the wgpu 29 optional depth-write and depth-compare fields.
- No previous reserved WGSL identifiers such as `active` or `smooth` remain.
- No illegal WGSL swizzle assignments remain.
- No stale `SurfaceError`, `request_redraw()`, `Queue::present`, or `push_constant_ranges` patterns remain.

## Runtime validation still required

The packaging environment does not include Cargo, Rust, a window server, or GPU access. The authoritative validation is therefore:

```bash
npm install
npm run dev:metal
```

Recommended tests:

1. Bundled sample scene loads and renders.
2. Orbit-pad drag and wheel controls update the camera.
3. All four view modes work.
4. Backface culling can be toggled.
5. A textured `.glb` loads.
6. A multi-file `.gltf` with neighboring `.bin` and images loads.
7. Missing external resources produce a visible Last error without destroying the previous scene.
8. Resizing reconfigures the surface and depth target.
9. Fullscreen can be entered and exited.

## Expected first-run diagnostics

The bundled scene should report approximately:

```text
Nodes:       4
Meshes:      2
Primitives:  2
Textures:    0
Cameras:     1
Animations:  0
Skins:       0
Triangles:   18
```

A default fallback material is retained internally in addition to the two authored sample materials.


## 21.1 vertex-layout correction

- Removed the invalid `Option<VertexBufferLayout>` wrapper from `VertexState::buffers`.
- Verified there are no remaining `buffers: &[Some(wgpu::VertexBufferLayout` patterns.
- Updated the visible build marker to `21.1`.
