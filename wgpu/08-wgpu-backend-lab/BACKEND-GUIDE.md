# Backend interpretation guide

## wgpu is the application API

The Rust application speaks wgpu. wgpu translates its resource model, commands, and WGSL shaders to the selected native backend.

```text
Rust + wgpu + WGSL
        ├── Metal
        ├── Vulkan
        ├── Direct3D 12
        └── optional GL/GLES
```

This example is not raw Vulkan or raw Metal. It exposes enough backend information to show which implementation is active while keeping the application code portable.

## Why the same GPU can appear more than once

An adapter is a GPU exposed through one backend. On Windows, one physical GPU may be exposed through both Vulkan and DX12. Those are separate wgpu adapters because their backend, driver path, limits, and feature reporting can differ.

## A fair comparison

Keep these values identical between runs:

- Renderer-window dimensions
- Octaves
- Layers
- Speed
- Exposure
- Display refresh rate and present mode

The current runtime FPS is useful for detecting major differences, but it is not a rigorous benchmark. Display VSync can cap every backend at the same refresh rate. A later example should add timestamp queries and deterministic offscreen workloads for proper GPU timing.

## Vulkan on macOS

macOS provides Metal as its native modern graphics API. Vulkan generally requires a portability implementation such as MoltenVK. The presence of a Vulkan SDK or MoltenVK installation does not guarantee that a particular wgpu version will enumerate it correctly. The adapter list is the source of truth for this running build.
