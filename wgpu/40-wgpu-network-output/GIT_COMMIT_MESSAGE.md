feat: add native wgpu network output example

- add direct UDP MPEG-TS output with a loopback destination preflight
- add RTSP TCP and RTMP FLV publishing for external media servers
- keep network failures isolated from the native renderer
- add reusable GPU readback and CPU frame-buffer pools
- bound the FFmpeg queue and expose per-stage dropped-frame telemetry
- verify FFmpeg startup before reporting the destination as active
- retain FFmpeg stderr, PID, exit status, and publisher/receiver URLs
- include a local MediaMTX configuration and VLC reader launcher
