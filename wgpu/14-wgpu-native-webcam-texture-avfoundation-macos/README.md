# 14 — wgpu Native Webcam Texture · Direct AVFoundation revision

This revision replaces the slow macOS Nokhwa/YUYV path with a direct AVFoundation capture backend.

```text
FaceTime / USB camera
        ↓
AVCaptureSession
        ↓
AVCaptureVideoDataOutput
        ↓
32BGRA CVPixelBuffer
        ↓
row-stride-aware latest-frame copy
        ↓
Bgra8UnormSrgb wgpu texture
        ↓
WGSL processing
        ↓
Metal surface
```

The renderer remains native Rust + wgpu. The controls remain a separate Tauri WebView window.

## Run on macOS

```bash
npm install
npm run dev:metal
```

The app requests camera permission through AVFoundation. If access was previously denied, open:

```text
System Settings → Privacy & Security → Camera
```

Then enable the app and restart it.

## Capture profiles

| Profile | Selection strategy |
|---|---|
| Low latency | Prefer a native format close to 640×480 with at least 30 FPS |
| Balanced | Prefer a native format close to 1280×720 with at least 30 FPS |
| Maximum frame rate | Prioritize the highest native FPS, then the smaller conversion surface |
| Maximum definition | Prioritize the largest native format that can sustain at least 24 FPS |

AVFoundation chooses a native device format first. `AVCaptureVideoDataOutput` then delivers 32BGRA pixel buffers. The output discards late frames rather than building a latency queue.

## Why BGRA

This revision intentionally begins with BGRA because it gives us a simple, reliable performance baseline:

- no MJPEG decoder
- no YUYV-to-RGBA decoder
- no Nokhwa format negotiation
- no CPU red/blue channel swap
- direct upload into a `Bgra8UnormSrgb` wgpu texture

BGRA is not always the camera hardware's native sensor format, so AVFoundation may still perform a system conversion. The next optimization, if needed, is native NV12 plane delivery followed by WGSL YUV-to-RGB conversion.

## Diagnostics

The controls window reports:

- delivered capture FPS
- callback interval
- BGRA row-copy time
- AVFoundation-dropped frames
- native format count
- captured and uploaded frames
- latest-frame age
- renderer FPS

Healthy 30 FPS capture should generally show a callback interval near 33 ms. A 60 FPS mode should be near 16.7 ms.

## Cross-platform behavior

- **macOS:** direct AVFoundation Objective-C bridge compiled by `build.rs`
- **Windows/Linux:** the existing generic Nokhwa fallback remains available

The macOS bridge lives in:

```text
src-tauri/src/macos_camera.m
src-tauri/src/camera_avfoundation.rs
```

The generic fallback lives in:

```text
src-tauri/src/camera_nokhwa.rs
```

## macOS session configuration note

The Objective-C bridge uses `AVCaptureDeviceDiscoverySession` for camera enumeration. It does not set `AVCaptureSessionPresetInputPriority`, because that preset is unavailable to macOS applications. The selected native format and frame duration are configured directly on `AVCaptureDevice` before the input is added to the session.
