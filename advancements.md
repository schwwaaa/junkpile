# Junkpile advancements — 2026

Junkpile began as a collection of compact Tauri/WebGL examples and has grown into a broader application laboratory spanning accessible WebView graphics and explicit native GPU/media systems.

## The major architectural shift

The most important change is the addition and expansion of the native Rust/wgpu path.

The project now makes three ideas visible at once:

1. WebView creative-coding applications remain useful and approachable.
2. Tauri 2 changes application/permission APIs but does not itself make WebView pixels native GPU pixels.
3. Native wgpu requires Rust to own the GPU surface, resources, and render timing explicitly. The current wgpu projects often also own media/output lifecycles, but native I/O bridges are not inherently exclusive to that renderer.

## Native GPU foundations

The early native projects establish:

- surface creation and backend diagnostics
- resize/HiDPI/fullscreen recovery
- WGSL pipelines and uniforms
- HTML control → Rust state bridges
- texture upload
- feedback
- multipass rendering
- high-resolution render targets
- compute and 3D techniques

## Native media and control

The native collection then adds:

- direct camera capture on macOS
- FFmpeg video decoding
- audio analysis
- MIDI parameter routing
- OSC control
- multi-input compositing
- glTF, skeletal, morph, and mesh-deformation systems

This closes much of the conceptual distance between a graphics demo and a real standalone media application.

## High-resolution output

The native export/recording work establishes an important distinction between preview size and authoritative output resolution.

A small local window can present a render that is internally generated at 4K, 5K, 8K-class, or another supported size. GPU limits, readback bandwidth, CPU packing, encoder throughput, storage, and playback capability are treated as separate constraints rather than hidden behind one “resolution” control.

## Recording architecture

The recording lineage progresses from a generic frame/output contract to real FFmpeg file writing, then high-resolution recording, profile-driven routing, multi-output runtime systems, and A/V recording.

Core patterns include:

- authoritative offscreen GPU texture
- mapped-buffer readback ring
- 256-byte row-alignment handling
- reusable CPU buffers
- bounded worker queues
- nonblocking drop telemetry
- H.264 and ProRes output
- `ffprobe` verification
- audio/video finalization without re-encoding the completed video stream

## Output routing

The newer **wgpu I/O reference examples** establish preview as only one possible sink in that renderer-owned architecture.

In those current wgpu references, a single authoritative GPU frame can feed independent outputs such as:

- local preview
- file recording
- NDI
- Syphon on macOS
- Spout on Windows

The renderer should remain alive if one external sink is slow, unavailable, or intentionally disabled.

## Runtime infrastructure

Junkpile now includes application-level infrastructure that is easy to omit from isolated graphics demos:

- typed JSON configuration
- platform overrides
- hot reload
- last-known-good state
- persistent runtime state
- structured logging
- asset-root selection
- output profiles
- hidden/windowless operation
- health reporting

These patterns make the examples more directly useful when building installations, dedicated media appliances, and focused artist tools.

## Native counterparts

Recent work also revisits WebView application concepts in native form, including:

- audio-reactive FFT
- A/V recording
- WGSL shader editing/playground workflows

This parity work is intentionally complementary. The project benefits from both easy-to-modify WebView examples and native implementations capable of scaling toward the machine's GPU and media limits.

## Status discipline

The newer documentation explicitly separates working foundations from unresolved experiments.

- Example 29 is absent from the current tree and referenced by later projects as a quarantined network-streaming branch.
- Example 40 remains an unresolved network-output experiment.
- Later stable router/appliance examples intentionally exclude that unresolved network path.

The goal is transparency: a project can remain useful research without being presented as a production-ready baseline.
