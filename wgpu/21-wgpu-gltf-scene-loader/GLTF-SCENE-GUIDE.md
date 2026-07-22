# glTF Scene Pipeline Guide

## Why glTF is the first mesh step

glTF is not merely a triangle-file format. It is a container for a scene graph:

```text
Scene
  └── Node hierarchy
        ├── transforms
        ├── meshes
        │     └── primitives
        │           ├── vertex attributes
        │           ├── indices
        │           └── material
        ├── cameras
        └── skins / animation targets
```

A loader that ignores the node hierarchy may display the geometry but place individual objects incorrectly. Example 21 walks the selected scene recursively and combines each node's local transform with its parent transform.

## Import path

```text
Open .gltf / .glb
        ↓
gltf::import
        ↓
Document + buffers + decoded images
        ↓
selected scene hierarchy
        ↓
triangle primitives
        ↓
CPU vertices / indices / materials
        ↓
wgpu vertex, index, uniform and texture resources
        ↓
depth-tested native render pass
```

## `.gltf` versus `.glb`

A `.gltf` file is JSON. Its buffers and images may be external files or data URIs. A `.glb` stores the JSON and binary payload in a single binary container.

For a multi-file `.gltf` asset, move the entire asset folder rather than only the JSON file. The importer resolves neighboring resources relative to the selected file.

## Scene hierarchy handling

The loader starts with the file's default scene, or its first scene when no default is declared. For each root node:

```text
world transform = parent world transform × node local transform
```

The same process repeats for every child. In this foundation example, the resulting world transform is applied to positions and normals while the file is loaded.

This CPU-baked approach has two advantages for a teaching example:

- The render loop needs only one scene normalization matrix.
- Every primitive can use the same GPU pipeline and global uniform layout.

It also has one important limitation: animated node transforms cannot update cheaply. The skeletal and animation examples will preserve per-node transforms and move transform evaluation onto an animation-friendly path.

## Primitive extraction

Each supported primitive produces:

```text
Vertex {
  position: vec3
  normal:   vec3
  uv:       vec2
}
```

Indices are converted to `u32`. When a primitive has no index accessor, sequential indices are generated. When normals are absent, face normals are accumulated into per-vertex normals.

Only triangle-list primitives are rendered in this example. Other topology modes increment the skipped-primitives diagnostic.

## Materials and textures

For each glTF material, the loader reads:

- Base-color factor
- Base-color texture
- Metallic factor
- Roughness factor

Each GPU material owns a small uniform buffer and a bind group:

```text
@group(1) @binding(0) material uniform
@group(1) @binding(1) base-color texture
@group(1) @binding(2) sampler
```

Materials without a base-color image use a one-pixel white texture. Multiplying the sampled white pixel by the material factor preserves factor-only materials without a separate shader branch.

## Scene normalization

Imported models vary wildly in scale and origin. The loader calculates a world-space bounding box, then creates one normalization matrix:

```text
translate bounding-box center to the origin
                     ↓
scale largest dimension to a consistent display size
```

This means a centimeter-scale prop and a building-scale scene both become visible with the default orbit camera. The original bounds remain available in diagnostics.

## Camera

The controls WebView supplies yaw, pitch, distance, FOV, and automatic orbit speed. The native renderer constructs:

```text
view       = look_at(camera position, origin, world up)
projection = perspective(FOV, aspect, near, far)
```

The orbit pad is resolution-independent:

- Horizontal drag changes yaw.
- Vertical drag changes pitch.
- Mouse wheel changes distance.

The control window sends normalized camera parameters through Tauri commands; the native renderer owns the final matrices.

## View modes

### Lit PBR

Uses base color, metallic, roughness, one directional light, ambient light, specular response, exposure, and gamma correction.

### Normals

Maps world-space normals from `[-1, 1]` into RGB `[0, 1]`. This exposes missing, inverted, or incorrectly transformed normals.

### UV coordinates

Displays fractional UV coordinates as color. This exposes missing attributes, seams, tiling, and unexpected coordinate ranges.

### Material IDs

Assigns a deterministic color to each material index. This makes primitive/material boundaries visible even when materials have similar colors.

## Backface culling

Backface culling improves normal closed-mesh rendering. Disable it to diagnose:

- Reversed triangle winding
- Open surfaces
- Cloth and card geometry
- Assets intended to be double-sided

The project creates two pipelines at initialization so changing this option does not rebuild a pipeline during interaction.

## Preparing for animation

The importer already reports animation and skin counts, but animation is intentionally deferred. The next architecture changes are:

```text
CPU-baked node transforms
          ↓
retained node hierarchy and local transforms
          ↓
animated global node matrices
          ↓
joint palette / inverse-bind matrices
          ↓
GPU skinning
```

That progression is the purpose of example 22.
