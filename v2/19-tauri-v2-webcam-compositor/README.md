# 19 · Tauri v2 Webcam Compositor

A standalone Tauri v2 + raw WebGL 1 example for combining a live webcam with background replacement, key mattes, graphics overlays, recording, and native export.

## What this example teaches

- Requesting and switching camera devices inside a Tauri v2 WebView
- Uploading live camera frames into a WebGL texture
- Building chroma-key and luminance-key mattes in GLSL ES 1.00
- Inspecting the matte separately from the final composite
- Suppressing key-color spill around foreground edges
- Combining camera, procedural/image/video backgrounds, and transparent overlays
- Using native Tauri v2 open/save dialogs and operating-system drag/drop
- Reading native images through Rust binary IPC so WebGL receives origin-clean Blob URLs
- Streaming native videos through Tauri's asset protocol
- Capturing the final WebGL canvas with `captureStream()` and `MediaRecorder`
- Saving large recordings through bounded 1 MiB IPC chunks

## Signal chain

```text
Camera texture
  ↓
Foreground framing + color grade
  ↓
Chroma/luminance key matte
  ↓
Background (procedural, image, or video)
  ↓
Transparent overlay
  ↓
WebGL preview → MediaRecorder / PNG export
```

## Features

### Camera

- Device enumeration and switching
- 640×480, 720p, 1080p, or highest-available constraints
- Horizontal mirroring
- Live input dimensions and uploaded-frame count
- macOS camera permission metadata and entitlement

### Background

- Four procedural animated backgrounds
- Native or browser image loading
- Native or browser looping-video loading
- Native operating-system drop handling
- Cover, contain, and stretch framing
- Zoom, pan, blur, and motion/playback speed
- Two editable procedural colors

### Key matte

- No key
- Chroma key with custom or sampled key color
- Luminance key
- Threshold and softness
- Matte expansion/contraction
- Generic spill suppression
- Matte inversion
- Green-screen, blue-screen, remove-dark, and remove-light presets

### Foreground

- Cover, contain, and stretch framing
- Zoom and pan
- Rotation
- Saturation, exposure, and contrast

### Overlay

- Generated broadcast-style frame
- Native or browser transparent-image loading
- Drop an image over the Overlay control section to route it there
- Normal, add, screen, and multiply blending
- Opacity, scale, and pan

### Output

- Composite, matte, foreground, and background inspection views
- Native fullscreen preview
- 30 or 60 fps canvas recording
- WebM/MP4 codec negotiation based on WebView support
- Pause/resume recording
- Native recording save dialog
- Chunked writing for large recordings
- Native PNG snapshot export
- Browser-download fallback outside Tauri

## Native media paths

Images and videos intentionally use different native paths:

```text
Native image → Rust bytes → Blob URL → WebGL texture
Native video → authorized asset URL → video element → WebGL texture
```

This prevents WKWebView from marking native image textures as insecure while preserving streaming playback for video files.

## Run

```bash
npm install
npm run dev
```

Press **Start camera** and approve the operating-system permission prompt. For chroma keying, use a green or blue background, select the corresponding preset, then inspect **Matte** while tuning threshold and softness.

## macOS permission files

`src-tauri/Info.plist` provides `NSCameraUsageDescription`, and `src-tauri/entitlements.plist` enables the camera entitlement. The bundle configuration points to the entitlement file.

## Notes

- The camera and all processing remain local.
- The WebView never routes camera audio to speakers.
- Media recording support and the exact output container depend on the installed WebView.
- Dropped media defaults to the background unless it is dropped over the Overlay controls.
- The compositor keeps rendering its background when the camera is stopped.
