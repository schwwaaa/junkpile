# 23 · Tauri v1 Audio File FFT Visualizer

A standalone Tauri v1 example that turns a local audio file into a GPU-driven visual performance and recording source.

Unlike Example 13, which analyses a live microphone, this project has a real media timeline. The audio playhead drives transport, seeking, loop regions, playback rate, spectral analysis, WebGL animation, and recorded output.

## What this example demonstrates

- Loading local audio through a browser file picker or drag and drop
- Reusing one `HTMLAudioElement` for multiple files
- Connecting a media element to Web Audio with `createMediaElementSource()`
- Uploading the complete FFT and waveform to WebGL textures every frame
- Reducing the spectrum into sub, bass, mid, high, air, RMS, and beat values
- Synchronizing shader time to the audio playhead
- Recording a WebGL canvas together with the analysed audio track
- Saving recordings and PNG frames through the Tauri v1 dialog/filesystem APIs

## Signal path

```text
Local audio file
      ↓
HTMLAudioElement
      ↓
MediaElementAudioSourceNode
      ↓
AnalyserNode ───────────────→ output volume → speakers
      │
      ├─ FFT byte array ───→ WebGL spectrum texture
      ├─ waveform array ───→ WebGL waveform texture
      ├─ frequency bands ──→ GLSL uniforms
      └─ audio stream ─────→ MediaRecorder
                                  ↑
WebGL canvas.captureStream() ─────┘
```

The analyser is connected to a `MediaStreamAudioDestinationNode`, allowing the canvas video and the original analysed audio to be recorded together.

## Features

### Audio source and transport

- MP3, WAV, AIFF, M4A, AAC, FLAC, OGG, and OPUS where supported by the system WebView
- File picker and drag-and-drop loading
- Play, pause, stop, seek, and ±10-second movement
- Playback rates from 0.25× to 2×
- Output volume and mute
- Full-file looping
- Custom loop-in and loop-out points
- File, duration, format, and sample-rate telemetry

### Analysis

- FFT sizes from 512 to 16384
- Analyser smoothing
- Visual sensitivity
- Independent band attack and release
- Sub: 20–60 Hz
- Bass: 60–250 Hz
- Mid: 250 Hz–2 kHz
- High: 2–8 kHz
- Air: 8 kHz–Nyquist
- RMS and peak dB estimation
- Adaptive low-frequency beat detector
- Spectrum and waveform monitors
- Complete FFT and waveform textures—not only four coarse uniforms

### Visuals

- Spectrum rings
- Waveform tunnel
- Frequency terrain
- Aurora field
- Beat grid
- Spectral ribbons
- Ping-pong visual feedback
- Feedback zoom
- Intensity, motion, frequency scale, hue, saturation, brightness, and contrast

### Capture

- 30 or 60 fps canvas recording
- 12, 24, or 40 Mbps video bitrate
- MP4/H.264/AAC when the WebView exposes it
- WebM VP9/VP8 + Opus fallback
- Pause and resume
- Recording duration and approximate size telemetry
- Native save dialog
- PNG current-frame export
- Browser download fallback when the global Tauri API is unavailable

## Project structure

```text
23-tauri-v1-audio-file-fft-visualizer/
├── package.json
├── README.md
├── src/
│   ├── index.html       interface, transport, meters, and canvas
│   ├── styles.css       responsive control panel and stage
│   └── app.js           audio graph, analysis, WebGL, recording, and export
└── src-tauri/
    ├── Cargo.toml
    ├── build.rs
    ├── tauri.conf.json
    ├── icons/
    └── src/main.rs
```

## Run

```bash
npm install
npm run dev
```

Then:

1. Choose or drop an audio file.
2. Press **Play**.
3. Select a visual mode.
4. Adjust sensitivity if the meters are too quiet or saturated.
5. Use **Set in** and **Set out** to create a loop region.
6. Press **Record** to capture the visual and file audio together.

## Important implementation details

### The media source node is created once

A given `HTMLAudioElement` can only be connected to one `MediaElementAudioSourceNode`. This example keeps the element and node alive, replacing only the element's source URL when another file is loaded.

### Shader time follows the file

`u_time` receives `audio.currentTime`, not only wall-clock time. Pausing freezes timeline-driven motion, seeking jumps the visual timeline, and changing playback speed changes the animation rate with the audio.

### Volume does not change analysis sensitivity

The analyser feeds the output and recording branches. Speaker volume is applied after analysis, so muting the speakers does not eliminate the FFT or recorded audio. Use **Sensitivity** to change visual response.

### Codec availability is platform-dependent

MediaRecorder support is determined at runtime. A WebView may support WebM but not MP4, or may expose recording differently across macOS, Windows, and Linux.

## Troubleshooting

### A file loads but Play does nothing

Try another audio format. File-extension support does not guarantee that the operating system WebView has the required codec. WAV and MP3 are useful first tests.

### The meters remain flat

Press Play once so the user gesture can resume the Web Audio context. Also confirm that **Sensitivity** is above 1.0 and the file contains audible signal.

### Recording contains video but no audio

Start playback once before recording so the Web Audio graph exists. The recorder can capture an idle canvas before the audio graph has been created, but no audio track will exist yet.

### The save button remains disabled

The button activates only after MediaRecorder has fully stopped and assembled the final Blob.

### Seeking sounds delayed

Some compressed files seek only to codec key or packet boundaries. WAV generally provides the most exact transport response.

## Scope

This example intentionally focuses on local file analysis. It does not decode audio in Rust, calculate an offline waveform overview, or perform multitrack mixing. Those would be separate examples or future expansions.
