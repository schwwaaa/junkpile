# 22 · wgpu Skeletal Pose Lab

A standalone Tauri 2 + wgpu 29 example for loading, animating, inspecting, and manually posing skinned glTF/GLB characters on a native GPU surface.

## Run

```bash
npm install
npm run dev:metal
```

Other backend wrappers are included:

```bash
npm run dev:vulkan
npm run dev:dx12
npm run dev
```

## What this example adds

- glTF `JOINTS_0` and `WEIGHTS_0` vertex attributes
- glTF skins and inverse-bind matrices
- GPU linear-blend skinning in WGSL
- Translation, rotation, and scale animation channels
- Linear and step sampling
- Safe fallback for cubic-spline channels
- Animation clip transport, timeline, looping, reverse playback, speed, and blending
- Manual X/Y/Z joint rotation layered after animation
- Skeleton line overlay
- Selected-joint weight heatmap
- Strongest-joint color inspection
- Native orbit camera and depth-tested material rendering

## Bundled model

`src-tauri/assets/sample-skinned.glb` is a generated four-joint weighted tube with a looping wave animation. It is intentionally small and inspectable. It proves the entire skinning path without requiring an external asset.

## External assets

Use **Open glTF / GLB** to select a character. For `.gltf` files, keep referenced `.bin` and image files beside the JSON document.

The example currently focuses on one standard skinning layer:

- up to four joint influences per vertex
- `JOINTS_0` and `WEIGHTS_0`
- node TRS animation
- triangle primitives
- base-color material textures

Morph targets are reserved for example 23.

## Architecture

```text
glTF / GLB
   ↓
Rust scene graph + skins + animation channels
   ↓
node local pose → node world matrices
   ↓
inverse(mesh world) × joint world × inverse bind
   ↓
per-primitive joint storage buffer
   ↓
WGSL linear-blend skinning
   ↓
material shading + skeleton diagnostic overlay
```

See [`SKELETAL-POSE-GUIDE.md`](SKELETAL-POSE-GUIDE.md) for the data flow and extension points.


## 22.1 correction

The skeleton overlay uses `PrimitiveTopology::LineList`. Its depth state now uses `DepthBiasState::default()` because nonzero depth bias is valid only for triangle primitives in wgpu 29. The mesh pipeline remains unchanged.
