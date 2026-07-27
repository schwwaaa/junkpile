# 12 — Tauri v2 Video Texture Player

A standalone Tauri v2 example for loading local video, decoding it in the WebView, uploading newly presented frames into a WebGL texture, applying GLSL processing, retaining temporal feedback, and exporting PNG snapshots.

## Signal flow

```text
Native file dialog / OS drop / browser file
                    ↓
        video decoder in WebView
                    ↓
        WebGL video texture upload
                    ↓
       effect pass + ping-pong feedback
                    ↓
             display + PNG export
```

## Features

- Native file selection through the Tauri dialog plugin
- Browser file input fallback
- Tauri v2 native drag-and-drop path handling
- Authorized asset-protocol streaming for native video paths
- Playback, restart, frame step, timeline, and rate controls
- Fit, transform, effect, grading, and feedback controls
- Source FPS, render FPS, frame, decoder, and resolution telemetry
- Native fullscreen and PNG snapshot saving

## Run

```bash
npm install
npm run dev
```

Supported playback depends on the operating system WebView and its installed codecs. MP4/H.264, MOV, and WebM support can vary by platform.

## Production build

```bash
npm run build
```
