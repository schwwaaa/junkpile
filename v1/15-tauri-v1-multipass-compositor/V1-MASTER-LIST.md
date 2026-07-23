# Junkpile · Tauri v1 Essentials Master List

| # | Project | Primary lesson |
|---:|---|---|
| 00 | p5.js Single Window | Basic p5.js canvas in one Tauri v1 WebView |
| 01 | p5.js Two-Window WebSocket | Separate controls and canvas windows connected through a Rust WebSocket relay |
| 02 | Raw WebGL Single Window | Direct WebGL rendering without p5.js |
| 03 | Raw WebGL Two-Window WebSocket | Raw WebGL output controlled from a separate WebView window |
| 04 | External GLSL Single Window | Loading and running external GLSL shader files |
| 05 | External GLSL Two-Window | External shader workflow with separated controls and output |
| 06 | Webcam Texture Single Window | Camera capture uploaded into a WebGL texture |
| 07 | Webcam Texture Two-Window | Camera graphics with a separate controls window |
| 08 | Video Feedback Single Window | Ping-pong framebuffer feedback in one window |
| 09 | Video Feedback Two-Window | Feedback renderer with separated controls and output |
| 10 | MIDI Input | Rust `midir` bridge controlling p5.js/WebGL parameters |
| 11 | OSC Input | Rust `rosc` UDP bridge for external control applications |
| 12 | Video Texture Player | Local video decoding, transport, GLSL processing, and feedback |
| 13 | Audio-Reactive FFT | Microphone input, Web Audio analysis, FFT/waveform textures, and beat detection |
| 14 | Canvas Recorder | `captureStream`, MediaRecorder, optional microphone audio, PNG snapshots, and native file saving |
| 15 | Multipass Compositor | Reorderable shader stack, ping-pong work buffers, and persistent frame history |

## Current total

**16 Tauri v1 essentials: Examples 00–15.**
