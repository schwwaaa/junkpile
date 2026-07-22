# 20.1 · wgpu Multi-Input Compositor

A standalone Tauri 2 + Rust/wgpu convergence example that combines the input systems developed in examples 14–19 into one native render graph.

```text
Native webcam ─────────────┐
FFmpeg video frames ───────┤
Video-file audio FFT ──────┤
Microphone FFT ────────────┤
MIDI registry ─────────────┤
OSC registry ──────────────┤
Gesture pad ───────────────┘
               ↓
shared Rust snapshots and latest-frame boundaries
               ↓
source composite → HDR feedback → tone-mapped surface
               ↓
Metal / Vulkan / DX12
```

## Run

```bash
npm install
npm run dev:metal
```

Automatic backend selection:

```bash
npm run dev
```

## Prerequisites

- Rust toolchain
- Node.js/npm
- FFmpeg and ffprobe on `PATH`
- Camera and microphone permission when those sources are started

macOS:

```bash
brew install ffmpeg
npm run dev:metal
```

## 20.1 additions

### Full video transport

The video input now includes:

- Timeline scrubber
- Current-time and duration display
- Play, pause, stop
- Previous/next frame stepping
- Looping
- Playback rates from `0.25×` through `4×`
- Software or FFmpeg hardware-auto decode mode

Every transport action is mirrored to the video-audio decoder so its FFT and audible preview restart from the same source position.

### Three FFT sources

The Audio FFT source can be:

```text
Microphone / input
Video-file audio
Microphone + video-file audio
```

Microphone and video audio use independent analyzers. Mixed mode combines their spectra, waveform data, bands, level, and transient information without requiring both sources to use the same hardware sample rate.

### Audible video-audio preview

Video-file audio can be previewed through the system's default output device. The same decoded samples drive the video FFT at the output callback's playback clock.

```text
FFmpeg audio decode
       ↓
bounded interleaved sample ring
       ↓
CPAL output callback
       ├── optional audible output
       └── mono FFT analysis chunks
```

The **Preview video-file audio** checkbox mutes or unmutes only the video's soundtrack. Microphone samples are never routed to the output device, including in mixed FFT mode, which avoids a microphone-monitoring feedback loop.

## Existing media inputs

- Direct AVFoundation BGRA webcam capture on macOS
- Nokhwa native-camera fallback on non-macOS systems
- FFmpeg/ffprobe decoded BGRA video frames
- Independent latest-frame boundaries so camera/video cannot create unbounded frame queues

## Structured control data

- CPAL microphone capture with RustFFT analysis
- FFmpeg video-audio decode with CPAL preview and RustFFT analysis
- MIDI notes, pitch bend, pressure, and learned parameter mappings through `midir`
- OSC messages and bundles through `rosc`
- Pointer/touch/pen gestures normalized in the controls WebView and retained in Rust

## Native render graph

1. Camera/video source composite
2. Audio-, MIDI-, OSC-, and gesture-driven distortion
3. HDR ping-pong feedback using `Rgba16Float`
4. Tone mapping and presentation to the native surface

## First test

1. Open a video with an audio track.
2. Confirm the video transport and audible soundtrack work.
3. Select **Video-file audio** as the FFT source and confirm the audio-reactive image changes.
4. Disable **Preview video-file audio** and confirm the image remains reactive while the soundtrack is muted.
5. Start a microphone and select **Microphone + video-file audio**.
6. Confirm only the video soundtrack is audible; the microphone remains analysis-only.
7. Add camera, MIDI, OSC, and gesture input as desired.

## Notes

- Audio/video synchronization is restart-based: seek, rate, play, pause, stop, and open operations restart both decoder paths from the same source position.
- The video-audio decoder uses FFmpeg `atempo` filtering so its audible duration follows video playback-rate changes.
- The output callback consumes the audio ring even when preview is muted, keeping video-audio FFT timing tied to playback rather than decode speed.
- This is a convergence example, not a finished VJ application.
