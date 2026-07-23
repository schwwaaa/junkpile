# Junkpile · Tauri v1 Essentials Folder Map

These are the exact folder names to use locally. The original Examples 00–11 retain their established repository names. The newer essentials use numbered folder names.

| # | Exact folder name | Primary lesson |
|---:|---|---|
| 00 | `p5-tauri-single-template` | Basic p5.js canvas in one Tauri v1 WebView |
| 01 | `p5-tauri-ws-template` | Separate p5.js controls and canvas windows connected through a Rust WebSocket relay |
| 02 | `webgl-tauri-v1-single-template` | Direct WebGL rendering without p5.js |
| 03 | `webgl-tauri-v1-ws-template` | Raw WebGL output controlled from a separate WebView window |
| 04 | `glsl-tauri-v1-single-template` | External GLSL shader files in one window |
| 05 | `glsl-tauri-v1-ws-template` | External GLSL workflow with separate controls and output |
| 06 | `webcam-tauri-v1-single-template` | Webcam capture uploaded into a WebGL texture |
| 07 | `webcam-tauri-v1-ws-template` | Webcam graphics with separate controls and output |
| 08 | `feedback-tauri-v1-single-template` | Ping-pong framebuffer feedback in one window |
| 09 | `feedback-tauri-v1-ws-template` | Feedback renderer with separated controls and output |
| 10 | `p5-tauri-midi-template` | Rust `midir` bridge for MIDI control |
| 11 | `p5-tauri-osc-template` | Rust `rosc` UDP bridge for OSC control |
| 12 | `12-tauri-v1-video-texture-player` | Local video playback, transport, GLSL processing, and feedback |
| 13 | `13-tauri-v1-audio-reactive-fft` | Microphone input, FFT/waveform textures, smoothing, and beat detection |
| 14 | `14-tauri-v1-canvas-recorder` | MediaRecorder capture, microphone audio, PNG snapshots, and native saving |
| 15 | `15-tauri-v1-multipass-compositor` | Reorderable shader stack, ping-pong work buffers, and frame history |
| 16 | `16-tauri-v1-image-texture-processor` | Still-image texture processing, comparison, grading, and PNG/JPEG export |

## Suggested repository placement

```text
junkpile/
└── v1/
    ├── p5-tauri-single-template/
    ├── p5-tauri-ws-template/
    ├── webgl-tauri-v1-single-template/
    ├── webgl-tauri-v1-ws-template/
    ├── glsl-tauri-v1-single-template/
    ├── glsl-tauri-v1-ws-template/
    ├── webcam-tauri-v1-single-template/
    ├── webcam-tauri-v1-ws-template/
    ├── feedback-tauri-v1-single-template/
    ├── feedback-tauri-v1-ws-template/
    ├── p5-tauri-midi-template/
    ├── p5-tauri-osc-template/
    ├── 12-tauri-v1-video-texture-player/
    ├── 13-tauri-v1-audio-reactive-fft/
    ├── 14-tauri-v1-canvas-recorder/
    ├── 15-tauri-v1-multipass-compositor/
    └── 16-tauri-v1-image-texture-processor/
```

## Current total

**17 Tauri v1 essentials: Examples 00–16.**
