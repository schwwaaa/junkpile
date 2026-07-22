# Performance correction

The previous implementation negotiated a 1920×1080 YUYV stream through Nokhwa and delivered only about 1.5–2 FPS on an M1 Max. The renderer uploaded nearly every decoded frame and skipped none, proving that the bottleneck occurred before wgpu.

This revision changes the macOS capture boundary:

```text
Previous
AVFoundation → Nokhwa → YUYV → CPU RGBA decode → wgpu

Current
AVFoundation → 32BGRA CVPixelBuffer → row copy → BGRA wgpu texture
```

The revised diagnostics distinguish:

- callback interval: spacing between frames delivered by AVFoundation
- BGRA row copy: CPU time spent copying the pixel buffer
- dropped by AVFoundation: frames discarded by the native output
- frame age: delay between capture callback and rendering

No claim is made that this is zero-copy. It is a controlled native baseline intended to determine whether direct AVFoundation delivery restores normal camera frame rates before attempting NV12 or Metal texture-cache interop.
