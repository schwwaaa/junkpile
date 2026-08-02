# 27 — wgpu Frame & Output Contract

This native wgpu + Tauri 2 example establishes the shared frame and output-sink contract for the new Junkpile I/O series.

It does **not** record or stream a video file yet. Instead, it proves that one authoritative GPU frame can be routed through multiple independent sink implementations without putting output-specific behavior inside the renderer.

## What it demonstrates

- A renderer-owned authoritative offscreen texture
- A serializable `FrameDescriptor`
- A borrowed `VideoFrame` containing the GPU texture, view, frame index, and timestamp
- A common `FrameSink` lifecycle
- Two real GPU texture-copy sinks
- A preview sink that composites the authoritative and mirrored textures
- A bounded CPU-worker probe
- Nonblocking backpressure and dropped-frame metrics
- Per-sink enable, disable, status, dimensions, and error reporting
- Renderer operation continuing when a sink is disabled or backpressured

## Architecture

```text
WGSL source renderer
        ↓
Authoritative RGBA8 sRGB texture (1280 × 720 @ 60 fps)
        ↓ same VideoFrame contract
        ├── Recording-stage GPU mirror
        ├── Streaming-stage GPU mirror
        ├── Window preview composite
        └── Bounded CPU-worker probe
```

The right side of the native renderer window displays the two GPU mirrors. Since each mirror is a separate texture, disabling one causes only that panel to freeze. The authoritative source and the other sinks continue.

## Run

```bash
npm install
npm run dev
```

## Test procedure

1. Confirm that two windows open.
2. In the native renderer, confirm:
   - a large cyan-bordered animated source on the left;
   - a purple-bordered live mirror on the upper right;
   - a green-bordered live mirror on the lower right.
3. Click **Disable recording mirror**.
   - The purple panel should freeze.
   - The source and green panel should continue.
4. Re-enable it, then disable the streaming mirror.
   - The green panel should freeze independently.
5. Set **Worker load** to `35 ms` or `80 ms`.
   - The renderer should remain near its normal cadence.
   - The CPU worker’s dropped-frame counter should increase.
6. Return the worker load to `0 ms`.
   - New drops should stop accumulating.
7. Resize the renderer window.
   - Presentation should continue without altering the authoritative frame descriptor.
8. Click **Reset metrics**.
   - Per-sink submission, processing, and drop counters should restart; the global frame index remains monotonic.

## Source organization

```text
src-tauri/src/
├── frame.rs       Frame descriptor and borrowed VideoFrame
├── output.rs      FrameSink contract and sink implementations
├── renderer.rs    Authoritative renderer and sink routing
├── source.wgsl    Animated authoritative frame
├── preview.wgsl   Three-texture preview composite
└── main.rs        Tauri lifecycle and commands
```

## Contract boundary

`FrameDescriptor` states the media assumptions explicitly:

- width and height
- pixel format
- frame origin
- color space
- alpha behavior
- nominal frame rate

`FrameSink` provides:

- identity
- enable/disable lifecycle
- frame submission
- metrics reset
- current status

The renderer only knows that it owns a list of sinks. It does not contain recording, streaming, NDI, Syphon, or Spout logic.

## CPU-worker scope

The worker probe receives frame metadata and timestamps through a bounded queue. It intentionally does not perform GPU readback yet.

The next example will replace that probe with a real GPU-to-CPU readback pipeline and FFmpeg file recording.

## Expected result

This milestone passes when:

- both GPU mirrors update from the same source frame;
- either mirror can freeze independently;
- worker backpressure produces dropped frames without slowing or freezing rendering;
- sink status remains visible in the controls window;
- renderer resize and fullscreen behavior remain stable.
