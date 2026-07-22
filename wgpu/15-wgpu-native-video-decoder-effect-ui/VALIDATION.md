# Validation status

Completed in the packaging environment:

- JSON parsing
- TOML parsing
- JavaScript syntax checking
- HTML element/reference checking
- Rust delimiter and known wgpu 29 pattern checks
- WGSL reserved-keyword and illegal swizzle-assignment checks
- ZIP integrity testing

Not available in the packaging environment:

- Cargo compilation
- Local FFmpeg process execution
- GPU playback validation

The authoritative test is a local `npm run dev:metal` run with `ffmpeg` and `ffprobe` available on `PATH`.

- RGB separation now uses source-pixel units and is clamped to 0–256 px.

## Effect-control UI revision

- Processing mode selection updates the visible effect-control set.
- Clean source shows no effect-only sliders.
- RGB separation exposes Effect strength and source-pixel separation.
- Pixel blocks exposes Block size.
- Posterize exposes Posterize levels.
- Unique effect parameters retain defensive auto-activation logic if moved programmatically.
