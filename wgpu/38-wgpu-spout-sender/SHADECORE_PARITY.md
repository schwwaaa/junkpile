# ShadeCore Spout Parity

## Integrated

- Windows-only Spout output
- Configurable sender name
- Runtime sender creation and release
- Dynamic dimensions
- Vertical orientation option
- Native C++ bridge
- Vendored Spout2 sources
- Clean shutdown

## Adapted for wgpu

ShadeCore sends an existing OpenGL texture with `SpoutSender::SendTexture`. Example 38 has no OpenGL texture, so it reads the wgpu texture into reusable BGRA buffers and calls `spoutDX::SendImage`, which updates a Direct3D 11 shared texture.

## Beyond ShadeCore

- Independent FPS scheduler
- Three asynchronous GPU readback slots
- Reusable CPU buffer pool
- Bounded worker queue
- Per-stage drop telemetry
- Direct3D adapter selection

## Remaining optimization

Direct wgpu/D3D texture sharing would remove CPU staging and is the preferred future high-resolution path.
