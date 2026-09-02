# wgpu AV Recorder

Focused native Tauri 2 + wgpu recorder with selectable audio source.

## Audio modes

- **None** — video-only recording.
- **Microphone** — CPAL captures the selected input to a temporary 32-bit float WAV while the wgpu video recorder runs.
- **Audio file** — select any local file containing an FFmpeg-readable audio stream. The file is looped when shorter than the video recording.

The video stream is finalized first. When audio is enabled, FFmpeg then muxes audio into the completed video **without re-encoding the video stream**.

- H.264/MP4 uses AAC 256 kb/s audio.
- ProRes/MOV uses 24-bit PCM audio.
- Video duration is authoritative (`-shortest` with looped file audio).
- Temporary microphone and intermediate video files are deleted only after a successful mux. They are preserved if finalization fails.

## Video formats

- H.264 / MP4
- ProRes 422 HQ / MOV
- 1080p, 1440p, 4K, 5K, 8K where supported by the GPU
- 24, 30, 60 FPS

The recorder uses the reusable-buffer/readback pipeline developed for the high-resolution Junkpile wgpu examples and exposes GPU/readback/worker drop diagnostics.

## Requirements

- Rust
- Node.js
- Tauri 2 prerequisites
- FFmpeg + ffprobe
- Microphone permission when using live input

macOS includes `NSMicrophoneUsageDescription` in `src-tauri/Info.plist`.

## Run

```bash
npm install
npm run dev
```

## Suggested validation

### Video only

1. Leave Audio Source on **None**.
2. Record 1080p30 H.264 for 5–10 seconds.
3. Stop + finalize.
4. Confirm the output plays normally.

### Microphone

1. Choose **Microphone**.
2. Select the desired input.
3. Start recording and speak/clap while the native animation runs.
4. Stop + finalize.
5. Confirm the final file contains both video and microphone audio.
6. Check `Callback chunks dropped`; zero is ideal.

### Audio file

1. Choose **Audio file**.
2. Select WAV, AIFF, MP3, AAC/M4A, FLAC, or another file with an FFmpeg-readable audio stream.
3. The app validates the first audio stream with ffprobe.
4. Record longer than the selected audio file to confirm looping.
5. Stop + finalize and verify sync/playback.

### High resolution

Validate 4K before 5K/8K. Watch:

- scheduled capture FPS
- GPU readback FPS
- FFmpeg ingest FPS
- GPU / packer / worker drops
- capture jitter p95
- timeline delivery

Playback stutter by itself does not prove capture loss; use the diagnostics and another capable player when testing 5K/8K.

## Architecture

```text
wgpu authoritative texture
        |
        +--> native preview
        |
        +--> GPU readback --> reusable CPU buffers --> FFmpeg video encoder

Audio source:
  None
  Microphone --> CPAL --> temporary float WAV
  File ------> ffprobe validation

After video finalizes:
  video + audio --> FFmpeg mux --> final AV file
```

The post-mux design intentionally avoids a fragile live multi-pipe FFmpeg setup and keeps video capture diagnostics independent from audio capture diagnostics.
