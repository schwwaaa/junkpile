# Changelog

## 0.1.0

- Added macOS Syphon sender built around `SyphonMetalServer`.
- Added a vendored universal Syphon framework.
- Added Objective-C ARC bridge for reusable Metal texture upload and publication.
- Added configurable source name, resolution, frame rate, vertical flip, and client gating.
- Added three-slot asynchronous wgpu readback.
- Added three reusable BGRA CPU buffers.
- Added bounded two-frame sender queue.
- Added connected-client, skipped-frame, readback, drop, and bandwidth telemetry.
- Kept native preview independent from sender lifecycle.
