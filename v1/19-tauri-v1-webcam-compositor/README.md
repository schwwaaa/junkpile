# 19 · Tauri v1 Webcam Compositor

A standalone Tauri v1 + raw WebGL 1 example for combining a live webcam with keyed background replacement, graphics overlays, recording, and native file export.

## What this example teaches

- Requesting and switching camera devices inside a Tauri v1 WebView
- Uploading live camera frames into a WebGL texture
- Building chroma-key and luminance-key mattes in GLSL ES 1.00
- Inspecting the matte independently from the final composite
- Suppressing color spill around keyed edges
- Combining camera, image/video background, and transparent overlay textures
- Capturing the final WebGL canvas with `captureStream()` and `MediaRecorder`
- Saving recordings and PNG frames through Tauri's native APIs

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

- Procedural animated backgrounds
- Image backgrounds
- Muted looping video backgrounds
- Cover, contain, and stretch framing
- Zoom and pan
- Nine-sample blur
- Two editable procedural colors

### Key matte

- No key
- Chroma key with custom or sampled key color
- Luminance key
- Threshold and softness
- Matte expansion/contraction
- Generic key-color spill suppression
- Matte inversion
- Green-screen, blue-screen, remove-dark, and remove-light presets

### Foreground

- Cover, contain, and stretch framing
- Zoom and pan
- Rotation
- Saturation, exposure, and contrast

### Overlay

- Generated broadcast-style frame
- User-loaded transparent PNG or other image
- Normal, add, screen, and multiply blending
- Opacity, scale, and pan

### Output

- Composite, matte, foreground, and background inspection views
- 30 or 60 fps canvas recording
- WebM/MP4 codec negotiation based on WebView support
- Pause/resume
- Native recording save dialog
- Native PNG snapshot export
- Browser-download fallback outside Tauri

## Run

```bash
npm install
npm run dev
```

Press **Start camera** and approve the operating-system permission prompt. For chroma keying, use a green or blue background, select the corresponding preset, then inspect **Matte** while tuning threshold and softness.

## macOS permission files

`src-tauri/Info.plist` provides `NSCameraUsageDescription` and `src-tauri/entitlements.plist` enables the camera entitlement. The bundle configuration points to the entitlement file.

## Notes

- The camera and all processing remain local.
- The WebView never routes camera audio to speakers.
- Media recording support and the exact output container depend on the installed WebView.
- The compositor keeps rendering the background when the camera is stopped.
