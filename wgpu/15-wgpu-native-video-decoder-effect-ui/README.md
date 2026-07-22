# 15 — wgpu Native Video Decoder

A standalone Tauri 2 + Rust + wgpu example that decodes local video files through FFmpeg, publishes only the newest decoded BGRA frame, and uploads that frame to a native Metal / Vulkan / DX12 texture.

```text
video file
   ↓
ffprobe metadata inspection
   ↓
FFmpeg decoding process
   ↓
packed BGRA frames over stdout
   ↓
latest-frame boundary in Rust
   ↓
Bgra8UnormSrgb wgpu texture
   ↓
WGSL processing
   ↓
native GPU surface
```

## Prerequisites

The project requires both `ffmpeg` and `ffprobe` on `PATH`.

macOS with Homebrew:

```bash
brew install ffmpeg
```

Confirm both commands are visible:

```bash
ffmpeg -version
ffprobe -version
```

## Run

```bash
npm install
npm run dev:metal
```

Or allow wgpu to choose the backend:

```bash
npm run dev
```

## Included transport controls

- Native file picker
- Play and pause
- Stop and return to zero
- Timeline seek
- Previous/next frame while paused
- Looping
- 0.25× through 4× playback
- Software decoding baseline
- FFmpeg hardware-acceleration auto mode

## Included GPU processing

- Clean source
- Edge extraction
- Luma displacement
- RGB separation
- Posterize
- Pixel blocks
- Scanlines
- Contain, cover, and stretch
- Linear and nearest sampling
- Quarter-turn rotation and mirroring

## Why an FFmpeg process?

This example deliberately tests a stable native media boundary without making the Rust crate depend on a particular FFmpeg development-library installation. Rust owns the process, frame pacing, latest-frame publication, transport commands, diagnostics, and GPU upload. FFmpeg owns codec demuxing and decoding.

A production application could bundle FFmpeg as a Tauri sidecar or replace the process boundary with platform APIs such as VideoToolbox, Media Foundation, or GStreamer. This project keeps that decoder boundary explicit so future developers can replace it without rewriting the renderer.

## Current scope

- Video-only playback; audio is disabled in the decoder process.
- Seeking uses FFmpeg input seeking and is intended for responsive exploration, not sample-accurate editorial work.
- Variable-frame-rate files are paced using the average frame rate reported by `ffprobe`.
- The renderer receives packed BGRA frames. A future hardware-native path could import decoded surfaces or YUV planes directly.

### RGB separation

The RGB separation control is measured in **source pixels**, not normalized UV units. This keeps a value such as `24 px` visually consistent across source resolutions. Red is sampled in one direction, green from the original coordinate, and blue in the opposite direction.

## Effect-aware controls

The controls window now exposes only parameters used by the selected Processing mode. Global image controls remain visible at all times. For example, selecting **RGB separation** reveals both **Effect strength** and **RGB separation (source px)**; selecting **Clean source** hides effect-only parameters so they cannot appear broken while inactive.
