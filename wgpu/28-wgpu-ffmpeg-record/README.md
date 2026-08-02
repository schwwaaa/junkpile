# 28 — wgpu FFmpeg File Recording

This native wgpu + Tauri 2 example replaces Example 27's simulated CPU worker with a real GPU-to-CPU readback pipeline and FFmpeg file writer.

It records the same authoritative GPU frame used by the native preview, but recording resolution and frame rate are independent from both the renderer and the window.

## What it demonstrates

- One authoritative `1280 × 720 @ 60 fps` wgpu texture
- A separate recording-stage GPU texture
- Recording resolutions of `1280 × 720`, `960 × 540`, and `640 × 360`
- Recording frame rates of `60`, `30`, and `24 fps`
- A three-slot mapped-buffer readback ring
- Correct 256-byte row alignment for texture-to-buffer copies
- Removal of GPU row padding before FFmpeg submission
- A bounded four-frame CPU worker queue
- Nonblocking GPU and worker backpressure
- H.264/MP4 through `libx264`
- ProRes 422 HQ/MOV through `prores_ks`
- FFmpeg stderr capture
- Clean stdin closure and process finalization
- Non-empty output validation and optional `ffprobe` inspection
- Visible per-stage metrics and errors
- An optional writer delay that deliberately demonstrates dropped frames without blocking rendering

## Architecture

```text
WGSL source renderer
        ↓
Authoritative GPU texture
1280 × 720 @ 60 fps
        ↓ sampled and scaled
Independent recording texture
        ↓ selected capture cadence
Three mapped readback buffers
        ↓ padded rows removed
Packed RGBA CPU frame
        ↓ bounded queue
FFmpeg worker thread
        ↓
H.264 MP4 or ProRes MOV
```

The native renderer window shows:

- the authoritative source in the large cyan panel;
- the independent recording texture in the red panel.

The recording texture remains a GPU texture. CPU readback occurs only when a recording is active and the selected recording cadence requests a frame.

## Prerequisites

### Rust and Tauri

Use the same Rust and Tauri 2 setup as the existing native wgpu examples.

### FFmpeg

`ffmpeg` must be available on `PATH`.

```bash
ffmpeg -version
```

You can also point directly to a custom executable:

```bash
export FFMPEG_PATH=/absolute/path/to/ffmpeg
```

`ffprobe` is optional. When available, the example reports codec, dimensions, frame rate, duration, and final size after recording.

```bash
export FFPROBE_PATH=/absolute/path/to/ffprobe
```

## Run

```bash
npm install
npm run dev
```

## Primary test

1. Confirm that both windows open.
2. Confirm that FFmpeg reports **Available** in the controls window.
3. Leave the defaults:
   - H.264 / MP4
   - `960 × 540`
   - `30 fps`
   - `0 ms` writer delay
4. Click **Start recording**.
5. Let it run for approximately five seconds.
6. Click **Stop and finalize**.
7. Wait for the recorder badge to change from **Finalizing** to **Complete**.
8. Click **Open recordings folder**.
9. Play the resulting MP4 and confirm:
   - animation is present;
   - the file dimensions are `960 × 540`;
   - playback is approximately the recorded duration;
   - the native renderer remained responsive throughout.

Recordings are written to:

```text
./recordings/
```

relative to the process working directory.

## ProRes test

1. Select **ProRes 422 HQ / MOV**.
2. Select a recording size and frame rate.
3. Record for several seconds.
4. Stop and wait for **Complete**.
5. Confirm that a `.mov` file was created and that the verification panel reports `prores`.

ProRes files are significantly larger than H.264 files. This is expected.

## Backpressure test

1. Select `1280 × 720 @ 60 fps`.
2. Set **Writer delay** to `35 ms` or `80 ms`.
3. Start recording.
4. Observe:
   - worker pending frames increase;
   - worker drops increase;
   - GPU drops may increase under heavy pressure;
   - the native renderer continues animating and responding normally.
5. Stop and finalize.

The artificial delay exists only to make the live-safe backpressure policy visible. Normal recording should use `0 ms`.

## Metrics

| Metric | Meaning |
|---|---|
| Capture requests | Frames requested by the independent recording cadence |
| GPU readbacks | Mapped GPU buffers successfully converted into packed CPU frames |
| Encoded frames | Frames written completely into FFmpeg stdin |
| GPU drops | Capture requests skipped because all readback slots were busy |
| Worker drops | Packed frames rejected because the FFmpeg worker queue was full |
| Worker pending | Frames currently queued for FFmpeg |
| Readback slots busy | GPU buffers currently waiting for mapping completion |
| Raw bytes piped | Uncompressed RGBA bytes written to FFmpeg |
| Final file size | Encoded file size after FFmpeg exits |

## Source organization

```text
src-tauri/src/
├── frame.rs       Shared frame descriptor and borrowed VideoFrame
├── output.rs      FrameSink contract and native preview sink
├── recording.rs   Recording texture, readback ring, FFmpeg worker, verification
├── renderer.rs    Authoritative renderer and recording routing
├── source.wgsl    Animated authoritative frame
├── scale.wgsl     Source-to-recording texture scaling pass
├── preview.wgsl   Source and recording-stage window composite
└── main.rs        Tauri lifecycle and commands
```

## Readback lifecycle

Each readback slot moves through:

```text
Idle
  → texture-to-buffer copy encoded
  → map scheduled on command submission
  → GPU completion callback
  → mapped bytes copied row by row
  → buffer unmapped
  → Idle
```

The mapping callback only sends a small completion message. Copying and padding removal happen during the render loop's nonblocking poll stage.

## Stop and finalization behavior

When **Stop and finalize** is pressed:

1. New capture requests stop.
2. Already submitted GPU readbacks are allowed to complete.
3. Their packed frames are offered to the worker.
4. The worker channel closes.
5. FFmpeg receives EOF on stdin.
6. FFmpeg writes the container trailer and exits.
7. The output file is checked for nonzero size.
8. `ffprobe` details are displayed when available.

Do not force-quit the application while a recording is finalizing if the output file matters.

## Current scope

This example intentionally has no audio track. It establishes the video-frame recording contract first.

A later example can add:

- synchronized audio input;
- timestamp-aware pacing;
- recording profiles loaded from the shared I/O configuration system;
- simultaneous recording and network streaming;
- hardware encoder selection;
- frame duplication policies for maintaining wall-clock duration under drops.

## Expected result

Milestone 3 passes when:

- H.264 recording creates a playable non-empty MP4;
- ProRes recording creates a playable non-empty MOV;
- recording resolution is independent from the authoritative renderer and preview window;
- stopping produces a finalized file;
- deliberate writer pressure produces dropped-frame metrics without freezing rendering;
- resizing and fullscreen presentation remain stable while recording.
