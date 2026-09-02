# ShadeCore Parity — Example 36

## Integrated here

- authoritative render texture
- local preview route
- preview enable/disable independent from offscreen rendering
- NDI sender
- FFmpeg file recording
- H.264 and ProRes profiles
- bounded output queues
- dropped-frame and pressure telemetry
- runtime output selection
- declarative output profiles
- configurable profile hotkeys
- strict configuration validation
- last-known-good profile list
- independent sink lifecycle and failure isolation

## Integrated in earlier native wgpu examples

- platform-aware I/O configuration foundation
- shared frame/output contract
- high-resolution recording through 8K
- custom output directory
- shader and parameter hot reload
- last-known-good shader retention
- asset discovery, persistent state, and structured logging

## Not yet integrated into this router

- Syphon sender
- Spout sender
- RTSP/RTMP streaming
- current native MIDI/OSC parity upgrades

The current Syphon, Spout, MIDI, and OSC native source folders are required for a non-destructive audit. The supplied archive contains the older v1/v2 set and does not contain those finalized native projects.
