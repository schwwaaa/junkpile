# Validation

Static and executable checks completed:

- JSON metadata parses.
- JavaScript passes `node --check`.
- Frontend element IDs and Tauri command names are cross-checked.
- Rust source delimiters and module references are cross-checked.
- No build artifacts, `target`, or `node_modules` directories are included.
- The exact UDP synthetic preflight command transmitted a 1316-byte MPEG-TS packet and exited successfully.
- FFmpeg arguments retain low-latency encoding, bounded buffering, and complete stderr reporting.
- RTSP and RTMP remain pending local validation with a running media server.
- Cargo compilation requires the user's Rust environment.
