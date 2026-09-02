# ShadeCore Parity — Example 39

## Integrated concepts

- One authoritative render texture
- Native preview as an independent sink
- Preview enable/disable while offscreen rendering continues
- FFmpeg H.264 and ProRes recording
- Independent recording lifecycle
- NDI sender with bounded queue and BGRA conversion
- Syphon sender on macOS
- Spout sender on Windows
- Runtime output profiles
- Platform-aware output behavior
- Hot-reloaded strict JSON configuration
- Per-sink dropped-frame and queue telemetry
- Failure isolation between outputs
- Runtime output start/stop controls
- Custom recording output directory

## Platform-share translation

ShadeCore publishes an OpenGL texture directly. This wgpu example currently uses staging bridges:

- macOS: wgpu → CPU BGRA → Metal texture → Syphon
- Windows: wgpu → CPU BGRA → D3D11 shared texture → Spout

The lifecycle and routing contract are preserved, but direct zero-copy backend interoperability remains a future optimization.

## Deliberately excluded

- FFmpeg RTSP/RTMP streaming, because the current Junkpile port remains unresolved and quarantined
- Duplicate MIDI and OSC examples; those already exist in the native wgpu set and require a separate source-level parity audit
- Receiver-side Syphon, Spout, or NDI, because ShadeCore implements senders only
