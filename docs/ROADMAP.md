# Junkpile roadmap

## Current documentation milestone

The immediate priority is documentation fidelity: the website, machine-readable catalog, architecture docs, and local READMEs should describe the repository that actually exists.

That means:

- no fixed public example totals
- real `v1/`, `v2/`, and `wgpu/` paths
- the native wgpu progression beyond the original foundations
- explicit I/O/recording architecture
- clear experimental/unresolved status boundaries
- diagrams that explain how standalone applications are assembled from the stack

## Native wgpu direction

Continue two complementary lines of work.

### 1. Creative/application counterparts

Native equivalents should continue to revisit useful WebView applications where native GPU ownership, high resolution, or lower-level media access materially changes the capability.

Current examples of this direction include:

- native audio-reactive FFT
- native A/V recorder
- native WGSL shader playground

### 2. Advanced GPU and I/O infrastructure

Continue only where the capability is genuinely distinct:

- input/output contracts
- recording and export
- platform texture sharing
- NDI
- appliance/headless runtime
- higher-performance backend-specific interop

Do not add new MIDI or OSC examples merely to repeat an existing control path.

## Validation work

The repository still benefits from a formal platform validation matrix:

- macOS / Apple Silicon
- Windows / D3D12
- Linux / Vulkan
- camera and microphone device behavior
- NDI/Syphon/Spout dependencies
- high-resolution recording limits by hardware
- packaging/signing behavior

## Known boundary

Network publishing remains a separate review area. The earlier Example 29 branch is referenced as quarantined, and Example 40 remains unresolved/under review. Stable router examples should not silently inherit that path until it is revisited and validated.

## Application direction

Junkpile should continue to make it practical to build small standalone creative tools from proven layers: processors, keyers, feedback systems, converters, recorders, routers, mixers, playback tools, shader instruments, and custom artist applications.

The repository remains implementation-agnostic at the product level. Shared patterns should be reusable without forcing all future applications into one branded runtime or one monolithic interface.
