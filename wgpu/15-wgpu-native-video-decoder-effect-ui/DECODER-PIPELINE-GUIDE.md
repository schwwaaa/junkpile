# Decoder pipeline guide

## Latest-frame boundary

The decoder does not push every frame into an unbounded queue. It replaces one shared `Arc<VideoFrame>` with the newest frame. The renderer uploads that frame when its sequence number changes.

This keeps latency bounded:

```text
fast decoder → newest frame only → renderer
```

If decoding outruns rendering, `Skipped before upload` increases. That is preferable to accumulating seconds of stale video.

## Playback pacing

FFmpeg can decode faster than real time. Rust therefore paces frame publication using:

```text
frame interval = 1 / source FPS / playback rate
```

Decode time and frame pacing are reported separately from render FPS.

## Seeking and frame stepping

A seek changes the decoder generation number, invalidating the previous worker. Playback restarts at the requested timestamp. When paused, a one-frame FFmpeg process supplies the preview frame.

## Decoder modes

- `software`: dependable baseline with no hardware-decoder request
- `auto`: passes `-hwaccel auto` to FFmpeg

Hardware auto mode may be faster for supported codecs, but FFmpeg may still download frames to system memory before emitting packed BGRA.

## Future extensions

1. Audio decoding and a master playback clock
2. Timestamped VFR frame delivery
3. Platform-native hardware frames
4. Multi-clip decoding
5. Tauri sidecar bundling
6. YUV-plane upload and WGSL conversion
