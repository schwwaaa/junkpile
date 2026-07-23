# Skeletal Pose Pipeline Guide

## 1. Vertex data

Each vertex contains:

```rust
position: [f32; 3]
normal:   [f32; 3]
uv:       [f32; 2]
joints:   [u32; 4]
weights:  [f32; 4]
```

`joints` indexes the current skin's joint list. `weights` determines how much each joint matrix affects the vertex. Imported weights are normalized before upload.

## 2. Node hierarchy

Every glTF node retains its decomposed local transform:

```text
translation
rotation quaternion
scale
```

World matrices are rebuilt recursively from the parent-child graph. Animation channels replace or blend the local translation, rotation, or scale before hierarchy evaluation.

## 3. Skin matrices

For a primitive attached to a skinned mesh node, each GPU joint matrix is computed as:

```text
inverse(mesh node world)
× joint node world
× inverse bind matrix
```

The primitive model matrix then applies:

```text
scene normalization × mesh node world
```

This keeps the glTF skin calculation in mesh-local space while still allowing the whole character to be centered and scaled for the example viewer.

## 4. GPU skinning

The vertex shader reads a runtime array of joint matrices from a read-only storage buffer. It blends four matrices using the vertex weights and transforms both position and normal.

Each primitive owns its own joint buffer. This is deliberate: the same glTF skin may be attached to multiple mesh nodes, and the mesh-node inverse in the skin formula can differ for each attachment.

## 5. Animation and manual pose

The animation system samples translation, rotation, and scale channels. Linear channels use vector interpolation or quaternion spherical interpolation. Step channels hold the previous sample.

Manual joint rotation is applied after the animation sample:

```text
base pose
  ↓
animation sample + blend
  ↓
manual X/Y/Z rotation offset
  ↓
world hierarchy
  ↓
GPU joint matrices
```

This allows a performer to bend or twist an animated character without stopping the clip.

## 6. Diagnostic views

- **Lit material** — standard material and light response
- **Selected weight** — heatmap of the selected joint's influence
- **Strongest joint** — palette color for the dominant joint per vertex
- **Normals** — transformed surface normals
- **Skeleton overlay** — parent-to-child joint line segments

## 7. Current boundaries

This example intentionally does not implement:

- morph targets
- inverse kinematics
- retargeting between skeletons
- constraints or joint limits
- additive animation clips
- dual-quaternion skinning

Those are separate layers and should not be hidden inside the first skeletal foundation.
