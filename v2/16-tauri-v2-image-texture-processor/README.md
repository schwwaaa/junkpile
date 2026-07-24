# 16 · Tauri v2 Image Texture Processor

A standalone Tauri v2 + raw WebGL 1 example for loading still images, processing them in a fragment shader, comparing original and processed results, and exporting full-resolution PNG or JPEG files.


## Native image loading

Native-open and operating-system drop paths are read by Rust and returned to the WebView as an optimized binary IPC response. The frontend creates a temporary Blob URL before uploading the image to WebGL. This avoids WKWebView origin-security errors that can occur when an `asset:` URL is used directly as a WebGL texture source.

## Run

```bash
npm install
npm run dev
```

## What it demonstrates

- Official Tauri v2 native open/save dialogs
- Runtime asset-protocol authorization for selected and dropped image paths
- Native Tauri WebView drag/drop events with browser fallback
- Raw WebGL image texture upload
- Contain, cover, and stretch framing
- Zoom, pan, rotation, and mirroring
- Original/processed split comparison
- Duotone, posterize, edge ink, chromatic split, halftone, prismatic warp, and solarize effects
- Hue, saturation, brightness, contrast, and gamma grading
- Source-resolution, 1080p, 4K, and custom exports up to 8192 × 8192 when supported by the GPU
- PNG and JPEG encoding
- Chunked native image writing for large exports
- Native fullscreen preview
- Scroll-safe controls inherited from the corrected v2 examples

## Signal path

```text
Native/browser image
        ↓
WebView image decoder
        ↓
WebGL texture
        ↓
Framing transform
        ↓
Color grade + stylization shader
        ↓
Preview / comparison / PNG-JPEG export
```

## Native loading

The initial asset-protocol scope is empty. When the user selects or drops an image, Rust canonicalizes the path, confirms that it is a supported file, authorizes that exact file for the current session, and returns the path to the WebView. The frontend converts it with `convertFileSrc()`.

## Export behavior

Processed exports temporarily resize the WebGL canvas to the requested dimensions, render without the comparison guide, encode the result, then restore the preview size. Original exports use a temporary 2D canvas at the source image dimensions.

Large native exports are written through sequential 1 MiB chunks rather than one oversized IPC message.

## Known constraints

- Maximum export dimensions depend on `MAX_VIEWPORT_DIMS` for the active WebGL context.
- Animated GIFs are treated as their currently decoded image frame.
- Image formats still depend on WebKit/WebView decoder support.
- Very large source images can consume substantial CPU and GPU memory during decoding and export.

## Folder

```text
16-tauri-v2-image-texture-processor
```
