# Shader and renderer future-proofing

## What “OpenGL is being sunset” actually means

OpenGL is not disappearing everywhere at the same moment. The important platform signal is Apple: OpenGL and OpenCL have been deprecated on macOS since macOS 10.14, and Apple directs developers toward Metal. Windows and Linux can still expose OpenGL, but it should no longer be the architectural center of a new cross-platform native renderer.

Junkpile therefore uses this source-to-backend path:

```text
WGSL source
    ↓ wgpu validation + Naga translation
Metal shader path on macOS
Vulkan shader path on Linux
DX12/Vulkan shader path on Windows
```

Developers maintain one WGSL codebase while wgpu handles the native backend translation. This avoids maintaining separate GLSL, Metal Shading Language, HLSL, and SPIR-V source trees for the baseline examples.

## What is stable and what will still change

WGSL is designed for WebGPU and modern GPU APIs, but the language and ecosystem continue to evolve. wgpu also changes its Rust API between major releases. Future-proofing does not mean “never update.” It means isolating the parts expected to change.

Keep these boundaries clear:

1. **Shader contract:** WGSL binding numbers, entry points, texture formats, and uniform layouts.
2. **Renderer contract:** Rust structs and bind-group layouts that mirror those WGSL declarations.
3. **Application contract:** Tauri commands and parameter names sent to the renderer.
4. **Backend contract:** features and limits queried from the selected adapter.

A UI change should not require rewriting shaders. A shader change should not require changing Tauri window management.

## Baseline WGSL rules

For the portable baseline examples:

- Use WGSL core features that work across Metal, Vulkan, and DX12.
- Use explicit bind groups and binding numbers.
- Keep CPU and WGSL uniform structures byte-for-byte compatible.
- Keep `#[repr(C)]`, `bytemuck::Pod`, and explicit padding where alignment is ambiguous.
- Prefer fullscreen triangles over backend-specific screen-quad conventions.
- Use explicit intermediate textures for feedback and multipass dependencies.
- Avoid sampling from a texture subresource while writing to the same subresource.
- Keep optional features such as shader `f16`, subgroups, timestamp queries, bindless resources, or platform interop behind runtime capability checks.

## Modern backend selection

The examples use `wgpu::Backends::PRIMARY`. At the current wgpu baseline, that selects the first-tier backend set and excludes the GL/GLES secondary backend.

This is useful for testing because the diagnostics panel exposes the actual backend. A macOS build should say `Metal`; a Linux build should say `Vulkan`; a Windows build should normally say `Dx12` or `Vulkan` depending on the adapter selected.

Do not infer the backend from the operating system. Always display `AdapterInfo.backend`.

## Version policy

Treat wgpu major upgrades as planned migrations.

For every upgrade:

1. Create a branch dedicated to the new wgpu major version.
2. Update the simplest project first (`00-wgpu-surface-probe`).
3. Record descriptor and presentation API changes in a migration note.
4. Compile `00` through `07` on macOS before merging.
5. Compile on Windows and Linux before declaring the backend matrix stable.
6. Regenerate and commit `Cargo.lock`.
7. Only then upgrade the more complex webcam, compute, recording, or external-output examples.

Relevant wgpu 29 conventions already incorporated here include:

- Present with `SurfaceTexture::present()` after queue submission.
- Use `Option<&BindGroupLayout>` entries in `PipelineLayoutDescriptor`.
- Use `immediate_size` rather than the earlier push-constant range field.
- Construct `InstanceDescriptor` with `new_without_display_handle()` rather than relying on a removed `Default` implementation.

## 4K and 8K are resource budgets, not checkboxes

Resolution multiplies cost in two dimensions:

| Definition | Pixels | RGBA16F target |
|---|---:|---:|
| 1920×1080 | 2.07 million | 15.8 MiB |
| 3840×2160 | 8.29 million | 63.3 MiB |
| 7680×4320 | 33.18 million | 253.1 MiB |

A two-target 8K feedback pair uses about 506.3 MiB. Three 8K HDR intermediates use about 759.4 MiB. Four use about 1.06 GB / 0.99 GiB before swapchain images, driver allocations, depth buffers, staging buffers, decoded media, or recording resources.

For future high-definition projects:

- Separate **display resolution** from **internal render resolution**.
- Allow independent render scale.
- Query `max_texture_dimension_2d` before allocation.
- Reuse targets instead of allocating every frame.
- Reduce bloom, blur, and feedback passes to half or quarter resolution where visually acceptable.
- Prefer separable filters over large two-dimensional kernels.
- Report target formats, dimensions, memory estimates, FPS, and frame time in the controls window.
- Add adaptive quality only after deterministic fixed-quality modes work.

## HDR and color

`Rgba16Float` is used for feedback and intermediate rendering because recursive and multipass effects can exceed the 0–1 display range. The final pass tone maps into the surface format.

That is not the same as delivering HDR to an HDR monitor. True HDR output also requires platform-specific surface color spaces, luminance metadata, display capability checks, and a defined transfer function. Keep “HDR intermediate math” and “HDR display output” as separate examples.

## Capability tiers for later examples

A useful future structure is:

### Portable baseline

- WGSL core
- Uniform buffers
- Sampled textures
- Render attachments
- `Rgba8UnormSrgb` and `Rgba16Float`
- Metal, Vulkan, DX12

### Capability-checked advanced tier

- Compute shaders
- Storage buffers and storage textures
- Timestamp queries
- `f16`
- Subgroups
- Indirect drawing
- Large workgroup and binding counts

### Platform interop tier

- Syphon / Metal sharing on macOS
- Spout / Direct3D sharing on Windows
- Vulkan or DMA-BUF sharing on Linux
- Hardware video decoding and encoding

Never make an advanced or platform-specific feature a hidden requirement of a baseline example.

## Suggested next examples

The next progression after this collection is:

```text
08-wgpu-compute-texture
09-wgpu-particle-storage-buffer
10-wgpu-native-webcam-upload
11-wgpu-video-decode
12-wgpu-audio-fft
13-wgpu-midi-parameter-registry
14-wgpu-osc-parameter-registry
15-wgpu-recording-readback
16-wgpu-hdr-display-output
17-wgpu-platform-output-bridge
```

Compute should come next because it introduces a second GPU workload model without first adding the substantial platform variability of cameras, codecs, and hardware encoders.

## Primary references

- Apple, *macOS Mojave 10.14 Release Notes*: OpenGL and OpenCL deprecation.
- wgpu project documentation: native Metal, Vulkan, Direct3D 12, and optional GL/GLES backends.
- W3C, *WebGPU Shading Language* specification.
- wgpu API documentation for `Instance`, `Backends`, adapter features, limits, and texture-format capabilities.
