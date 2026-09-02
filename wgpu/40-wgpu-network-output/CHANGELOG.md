# Changelog

## 0.1.1

- Add UDP/MPEG-TS, RTSP/TCP, and RTMP/FLV output.
- Add protocol-specific destination preflight before live GPU capture begins.
- Add a single-process FFmpeg writer with retained stderr and exit status.
- Add unique default RTSP/RTMP path `/junkpile40`.
- Add explicit publisher and receiver URLs.
- Add reusable CPU buffers, bounded queues, and per-stage drop telemetry.
- Add a startup bootstrap frame that forces FFmpeg to create the output header.
- Clean up an exited worker before restarting the same destination.
- Add low-delay H.264 settings and a forced fresh VLC process on macOS.
- Include a local MediaMTX configuration for RTSP and RTMP testing.
