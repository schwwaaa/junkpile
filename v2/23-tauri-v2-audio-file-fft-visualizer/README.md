# 23 · Tauri v2 Audio File FFT Visualizer

A standalone Tauri v2 example that analyzes a local audio file with the Web Audio API, uploads the full FFT and waveform to WebGL textures, renders audio-reactive GLSL visuals, and records the result with the source audio included.

## Signal path

```text
Native/browser audio file
        ↓
HTMLAudioElement
        ↓
MediaElementAudioSourceNode
        ├── AnalyserNode → FFT + waveform byte arrays → WebGL textures
        ├── GainNode → speakers
        └── MediaStreamDestination → canvas recording audio track
```

Native-open and native-drop files use this security-safe path:

```text
Filesystem path → Rust binary reader → Tauri IPC bytes → Blob URL → audio element
```

The complete audio file is loaded into memory for this educational example. Browser-picked files use their existing Blob directly.

## Features

- Native Tauri v2 audio-file dialog
- Browser picker fallback
- Native operating-system drag and drop
- MP3, WAV, AIFF, M4A, AAC, FLAC, OGG, and OPUS where WebKit supports decoding
- Play, pause, stop, seeking, and ±10-second movement
- Playback speed from 0.25× to 2×
- Volume and mute
- Full-file or custom in/out looping
- FFT sizes from 512 to 16384
- Full FFT and waveform textures uploaded every render frame
- Sub, bass, mid, high, air, RMS, peak, and adaptive beat analysis
- Six GLSL visual modes
- Persistent ping-pong visual feedback
- 30/60 fps canvas recording with the analyzed audio included
- MediaRecorder MP4/WebM negotiation
- Pause/resume recording
- Native chunked recording saves
- Native PNG snapshots
- Native fullscreen preview
- Scroll-safe controls

## Run

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
```

On macOS, the production bundle is written under:

```text
src-tauri/target/release/bundle/
```

Unsigned applications may be blocked by Gatekeeper when distributed to another Mac. Shipping publicly normally requires code signing and notarization.

## First test

1. Press **Native open** and choose a WAV or MP3.
2. Press **Play**.
3. Scrub the timeline and change **Playback rate**.
4. Set custom loop in/out points.
5. Switch among the six visual modes.
6. Record a short clip and save it.

## Architecture notes

The browser audio element remains the transport clock. Shader animation uses the audio playhead rather than wall-clock time, so seeking immediately changes the visual state. The analyser provides both frequency-domain and time-domain byte arrays. Those arrays are uploaded as one-row luminance textures for direct sampling in GLSL ES 1.00.

The recording path combines `canvas.captureStream()` video tracks with cloned tracks from a `MediaStreamAudioDestinationNode`. Cloning prevents one completed recording from destroying the audio-analysis graph used by later recordings.

Large recording files are written to Rust in sequential 1 MiB chunks instead of one oversized IPC payload.

## Known limitations

- Actual codec/container support is determined by the operating system WebView.
- Some compressed or unusual files may fail to decode even when their filename extension is accepted.
- Native-open/drop audio is loaded fully into memory before playback.
- MediaRecorder output depends on codec support exposed by the WebView.
