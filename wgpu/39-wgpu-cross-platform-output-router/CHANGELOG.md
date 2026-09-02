# Changelog

## 0.1.0

- Add a cross-platform runtime output router built from the verified Example 36, 37, and 38 foundations.
- Route one authoritative wgpu texture to preview, NDI, recording, and platform-native texture sharing.
- Use Syphon on macOS and Spout on Windows behind a common profile and status contract.
- Add bounded per-sink queues and independent start/stop controls.
- Add transactional start-all behavior with rollback when a later sink fails.
- Add seven editable route profiles and hotkeys.
- Preserve custom recording directories and high-resolution recording diagnostics.
- Bundle the Syphon framework and vendor the Spout2 source bridge.
- Exclude the unresolved FFmpeg network-streaming implementation.
