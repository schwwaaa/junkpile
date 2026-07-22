# 21 · wgpu glTF Scene Loader

A standalone Tauri 2 + wgpu 29 example for importing glTF 2.0 scenes into a native Metal, Vulkan, or DirectX 12 render surface.

This begins Junkpile's mesh and posing sequence. It deliberately focuses on the scene-loading foundation before skeletal animation, morph targets, and compute deformation are added in later examples.

## What it demonstrates

- Native `.gltf` and `.glb` file selection
- glTF scene, node, mesh, primitive, material, image, camera, animation, and skin discovery
- Recursive scene-hierarchy traversal
- Node transform application
- Indexed triangle rendering
- Position, normal, and UV vertex attributes
- Automatic normal generation when a primitive has no normals
- Base-color factors and base-color textures
- Metallic/roughness-aware direct lighting
- Automatic model centering and scale normalization
- Depth buffering and optional backface culling
- Lit, normal, UV, and material-ID inspection modes
- Interactive orbit pad, mouse-wheel dolly, camera sliders, lighting controls, and diagnostics
- A bundled glTF Binary sample that loads through the same importer as external files

## Run

```bash
npm install
npm run dev:metal
```

Automatic backend selection:

```bash
npm run dev
```

Other explicit backends:

```bash
npm run dev:vulkan
npm run dev:dx12
```

## First test

1. Launch the project.
2. Confirm the bundled cube-and-pyramid scene appears.
3. Drag in the orbit controller and use the mouse wheel to change camera distance.
4. Switch among Lit PBR, Normals, UV coordinates, and Material IDs.
5. Click **Open glTF / GLB** and select another asset.
6. Check the node, mesh, primitive, material, texture, animation, and skin counts.

For external `.gltf` files, keep referenced `.bin` and image files beside the `.gltf` file. A `.glb` usually packages those resources into one file.

## Current scope

This example renders triangle primitives and the core PBR base-color path. It records animation and skin counts but does not animate or skin the mesh yet. Those capabilities belong to the following examples:

- `22-wgpu-skeletal-pose-lab`
- `23-wgpu-morph-target-lab`
- `24-wgpu-mesh-feedback-deformer`

See [GLTF-SCENE-GUIDE.md](GLTF-SCENE-GUIDE.md) for the complete pipeline explanation.

## Important files

```text
src-tauri/src/main.rs       Tauri commands, file picker, native windows
src-tauri/src/scene.rs      glTF import, hierarchy traversal, CPU scene data
src-tauri/src/renderer.rs   wgpu buffers, textures, materials, camera and drawing
src-tauri/src/scene.wgsl    mesh vertex and fragment shaders
src-tauri/assets/           bundled sample GLB
src/                        controls WebView
```

## Dependencies

- Tauri `2.11.5`
- wgpu `29.0.4`
- gltf `1.4`
- glam `0.30`
- rfd `0.17`
- bytemuck `1.24`

## Known limitations

- Only triangle-list primitives are rendered. Lines, points, strips, and fans are counted as skipped.
- Node transforms are baked into CPU vertex data during loading. This makes the first example easy to inspect but is not the final animation architecture.
- Base-color textures and metallic/roughness factors are used; normal, emissive, occlusion, and metallic-roughness textures are deferred.
- Alpha modes are simplified to a small alpha discard and opaque output.
- glTF cameras are discovered but the renderer currently uses its own orbit camera.
- Animation clips and skins are counted but not evaluated.
- Draco and Meshopt compressed geometry require additional extension support and are not decoded here.

## License

MIT.


## 21.1 correction

The wgpu 29 vertex state uses a direct slice of `wgpu::VertexBufferLayout` values:

```rust
buffers: &[wgpu::VertexBufferLayout { /* ... */ }],
```

It must not wrap each layout in `Some(...)`.
