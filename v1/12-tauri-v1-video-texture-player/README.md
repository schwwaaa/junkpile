# 12 — Tauri v1 Video Texture Player

A standalone Tauri v1 application that loads a local video file, uploads each decoded frame to a WebGL texture, processes it with GLSL ES, and displays the result in real time.

This is the first added project after the original twelve Tauri v1 essentials. It fills the gap between the existing webcam examples and a practical media-file workflow.

## What it demonstrates

- Local video selection through the WebView file picker
- Drag-and-drop video loading when supported by the platform WebView
- `<video>` decoding with an object URL; the source file never leaves the computer
- Per-frame `texImage2D` upload into WebGL
- GLSL effects operating on a video `sampler2D`
- Ping-pong framebuffers for persistent visual feedback
- Playback, looping, seeking, rate, volume, mute, and frame-step controls
- Contain, cover, and stretch framing modes
- High-DPI canvas resizing with a capped device-pixel ratio

## Architecture

```text
local video file
      │
      ▼
HTML <video> decoder
      │ current decoded frame
      ▼
WebGL video texture
      │
      ▼
GLSL effect pass ───── previous feedback texture
      │                       ▲
      ▼                       │
ping-pong framebuffer A/B ────┘
      │
      ▼
WebGL canvas in the Tauri v1 WebView
```

Tauri v1 owns the window through its WebView. Rendering therefore remains inside the browser graphics stack; Rust only launches the desktop shell in this example.

## Run

```bash
npm install
npm run dev
```

Then choose **Load video file** and select an MP4, MOV, WebM, or another format supported by the operating system WebView.

## Controls

- **Space:** play or pause
- **Left arrow:** seek backward five seconds
- **Right arrow:** seek forward five seconds
- **Restart:** return to the beginning and clear feedback
- **+1 frame:** pause and advance by an estimated 1/30 second

The frame-step button is intentionally approximate because ordinary browser video APIs do not expose a guaranteed source-frame rate.

## Format support

Video decoding is provided by the platform WebView:

- macOS: WKWebView / AVFoundation-supported formats
- Windows: WebView2 / installed media capabilities
- Linux: WebKitGTK / installed GStreamer codecs

A file that works in one operating system may require a different codec on another. H.264 MP4 is generally the most portable practical choice, but licensing and installed codec availability can still vary.

## Source files

```text
src/
  index.html      controls, canvas, hidden video element
  styles.css      controls-window presentation
  app.js          media transport, WebGL, GLSL, feedback

src-tauri/
  src/main.rs     minimal Tauri v1 application shell
  tauri.conf.json window, CSP, and bundle configuration
```

## Next logical essentials

- Audio-reactive FFT input
- Browser-canvas recording and export
- Multi-pass post-processing graph
- Tauri filesystem/dialog asset loading
