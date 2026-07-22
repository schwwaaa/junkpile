# Direct AVFoundation camera pipeline

## Capture boundary

`AVCaptureVideoDataOutput` invokes a serial delegate queue for every delivered frame. The delegate locks the `CVPixelBuffer`, reads its base address and row stride, and invokes a C-compatible Rust callback before unlocking the buffer.

The Rust callback copies only the current frame into a reusable allocation. It replaces the shared latest frame instead of appending to a queue. This keeps latency bounded when rendering or controls are temporarily busy.

## Row stride

Core Video pixel buffers may contain padding at the end of each row:

```text
logical bytes per row = width × 4
actual bytes per row  = CVPixelBufferGetBytesPerRow(...)
```

The callback copies row by row when those values differ. This prevents diagonal corruption and out-of-bounds assumptions.

## Color order

`kCVPixelFormatType_32BGRA` stores bytes in BGRA order. The renderer creates a `Bgra8UnormSrgb` texture on macOS, so sampling in WGSL produces logical RGBA values without a CPU channel swap.

## Late-frame policy

The output sets:

```objective-c
output.alwaysDiscardsLateVideoFrames = YES;
```

The app therefore favors low latency over retaining every camera frame.

## Future zero-copy direction

The current stable baseline performs one row-aware CPU copy from `CVPixelBuffer` into a reusable Rust allocation and one wgpu texture upload.

A more advanced macOS-only path can use:

```text
CVPixelBuffer
    ↓
CVMetalTextureCache
    ↓
Metal texture
```

Sharing that native Metal texture with wgpu requires backend-specific interop and should remain a separate advanced example.

## Future NV12 direction

For lower bandwidth and less AVFoundation conversion work:

```text
NV12 Y plane ─────┐
                  ├── WGSL YUV → RGB
NV12 UV plane ────┘
```

That path is more complex but moves color conversion to the GPU and retains native camera-plane data.
