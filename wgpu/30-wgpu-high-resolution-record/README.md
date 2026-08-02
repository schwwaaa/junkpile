# 30 — wgpu High-Resolution Recording

A native wgpu + Tauri 2 teaching example for recording procedural GPU output at a resolution independent from the visible preview window.

This project is intentionally based on the verified file-recording pipeline from Example 28. It does **not** depend on the paused FFmpeg network-streaming example.

## What this example adds

- True native-resolution shader rendering at the selected export size
- Full HD, QHD, 4K, 5K, and 8K presets
- H.264/MP4 and ProRes 422 HQ/MOV output
- Independent recording FPS: 24, 30, or 60
- 8K restricted to 24 or 30 FPS
- GPU maximum-texture validation before allocation
- Two-slot mapped-buffer readback ring
- Two-frame bounded FFmpeg worker queue
- Estimated raw frame size, bandwidth, GPU allocation, CPU queue size, and peak working set
- Explicit acknowledgement before starting 5K or 8K recording
- Dropped-frame telemetry instead of hiding overload
- `ffprobe` verification after finalization

## Important distinction

The renderer window is only a preview.

When `3840 × 2160` is selected, the procedural shader is rendered into a native `3840 × 2160` authoritative texture. The output is not a 720p image enlarged to 4K.

```text
Selected native resolution
        ↓
Authoritative wgpu shader texture
        ↓
Same-resolution recording texture
        ↓
2-slot mapped GPU readback ring
        ↓
2-frame bounded CPU queue
        ↓
FFmpeg
        ↓
MP4 or MOV
```

## Why the queues are smaller than Example 28

High-resolution RGBA frames are large:

| Resolution | One RGBA frame | Raw traffic at 30 FPS |
|---|---:|---:|
| 1920 × 1080 | about 7.9 MiB | about 237 MiB/s |
| 2560 × 1440 | about 14.1 MiB | about 422 MiB/s |
| 3840 × 2160 | about 31.6 MiB | about 949 MiB/s |
| 5120 × 2880 | about 56.3 MiB | about 1.65 GiB/s |
| 7680 × 4320 | about 126.6 MiB | about 3.71 GiB/s |

A deep queue at 8K can consume gigabytes before FFmpeg receives a frame. This example therefore uses:

- Two GPU readback buffers
- Two queued CPU frames

The goal is bounded memory and visible frame drops, not unbounded latency.

## Prerequisites

- Rust
- Node.js and npm
- Tauri 2 system prerequisites
- FFmpeg and ffprobe available on `PATH`

Verify FFmpeg before starting:

```bash
ffmpeg -version
ffprobe -version
```

You can override the executable paths:

```bash
export FFMPEG_PATH=/absolute/path/to/ffmpeg
export FFPROBE_PATH=/absolute/path/to/ffprobe
```

## Run

```bash
cd 30-wgpu-high-resolution-record
npm install
npm run dev
```

Two windows should open:

1. The HTML/CSS controls and telemetry window
2. The native wgpu preview window

## Test order

### 1. Verify 1080p

Use:

```text
H.264 / MP4
1920 × 1080
30 FPS
0 ms writer delay
```

Record for five seconds, stop, wait for `Complete`, and play the result.

### 2. Verify 4K

Use:

```text
H.264 / MP4
3840 × 2160
30 FPS
0 ms writer delay
```

Confirm:

- Native source changes to `3840 × 2160`
- Preview remains responsive
- Output verifies as `3840 × 2160`
- Drop counters accurately describe any pressure

### 3. Test ProRes

ProRes 422 HQ produces much larger files and can require substantially more disk bandwidth. Start with 1080p before testing 4K.

### 4. Test 5K or 8K only as a capability test

The acknowledgement checkbox is required because the readback pipeline can use hundreds of megabytes and several gigabytes per second of raw memory traffic.

An 8K failure does not mean wgpu cannot render 8K. It may mean one of these stages cannot sustain the workload in real time:

- GPU render
- GPU-to-CPU readback
- CPU memory copy
- FFmpeg conversion
- H.264 or ProRes encoding
- Disk write speed

## Output location

Recordings are written to:

```text
./recordings/
```

Filenames include codec, resolution, FPS, and timestamp:

```text
junkpile-30-h264-3840x2160-30fps-<timestamp>.mp4
junkpile-30-prores-3840x2160-30fps-<timestamp>.mov
```

## Resolution rules

- Width and height must be even
- Maximum example resolution is `7680 × 4320`
- The selected dimensions must not exceed the GPU's reported `max_texture_dimension_2d`
- 8K is limited to 24 or 30 FPS

## What this example does not claim

- It does not guarantee real-time 8K on every computer
- It does not use hardware H.264/HEVC encoders
- It does not perform deterministic offline rendering
- It does not use tiled rendering
- It does not preserve every frame when the live pipeline is overloaded

Those are separate future examples.

## Architecture lesson

High-resolution output should be treated as a resource contract, not merely a larger width and height. Every stage must disclose:

- Frame dimensions
- Pixel format
- Raw bytes per frame
- Expected bytes per second
- Number of GPU readback buffers
- Number of queued CPU frames
- Encoder profile
- Drop behavior
- Device texture limits

This example makes those costs visible before recording starts.
