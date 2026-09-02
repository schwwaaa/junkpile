# Changelog

## 0.1.0

- Added one authoritative wgpu texture routed to preview, NDI, and FFmpeg recording.
- Added strict schema-versioned runtime output profiles.
- Added independent and combined output start/stop controls.
- Added profile hotkeys that arm but do not auto-start outputs.
- Added NDI sender configuration, drop telemetry, and runtime state.
- Preserved the high-resolution reusable-buffer FFmpeg recording pipeline.
- Preserved persistent custom recording output folders.
- Added hidden-preview/offscreen NDI profile.
- Added transactional profile arming and partial-start rollback.
- Excluded the quarantined network-streaming implementation.
