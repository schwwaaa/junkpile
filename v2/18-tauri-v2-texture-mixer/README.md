# 18 · Tauri v2 Texture Mixer

A standalone Tauri v2 + raw WebGL example for compositing two independent image or video sources in one fragment-shader pass.

The exact folder name is:

```text
18-tauri-v2-texture-mixer
```

## What this example teaches

- Loading local images and videos through Tauri v2 native dialogs
- Handling native operating-system drag and drop
- Returning image bytes through Tauri IPC so WebGL receives origin-clean Blob URLs
- Authorizing local video paths for Tauri's asset protocol
- Uploading two independent sources to WebGL textures
- Applying separate framing and transforms to each layer
- Implementing common blend modes and masks in GLSL ES 1.00
- Exporting a current mixed frame through native save dialogs

## Run

```bash
npm install
npm run dev
```

The project contains an explicit Cargo workspace boundary, so it remains independent from any parent `Cargo.toml`.

## Inputs

Layer A and Layer B each support images or videos. Use **Native open**, **Browser open**, or drop a file onto the corresponding layer card. When a native drop occurs outside a card, it is routed to the currently active layer.

Supported extensions include:

- PNG, JPEG, WebP, GIF, BMP, TIFF, AVIF
- MP4, MOV, M4V, WebM, MKV, AVI, OGV, OGG

Actual decoding support is determined by the operating-system WebView.

Images and videos use different secure loading paths:

```text
Native image → Rust binary read → IPC Response → Blob URL → WebGL texture
Native video → runtime asset authorization → convertFileSrc() → HTML video → WebGL texture
```

This prevents the WebKit `SecurityError: The operation is insecure` problem that can occur when an asset-protocol image is uploaded directly to WebGL.

Videos are muted, looped, and played inline. Each video has independent play/pause and playback-speed controls.

The app launches with two generated images, so the complete mixer can be tested before loading media.

## Per-layer controls

Select **Layer A** or **Layer B**, then adjust:

- Contain, cover, or stretch framing
- Opacity
- Zoom
- Pan X/Y
- Rotation
- Horizontal and vertical mirroring

**Swap A ↔ B** exchanges the complete source state, including media, transform, opacity, and video transport.

## Blend modes

1. Normal
2. Add
3. Multiply
4. Screen
5. Overlay
6. Hard light
7. Difference
8. Exclusion
9. Lighten
10. Darken
11. Color dodge

The **Mix** control determines how strongly Layer B and the selected blend operation affect the result. **Auto crossfade** animates that amount in the shader without moving the slider.

## Masks

Layer B can be limited by:

- None
- Linear
- Radial
- Layer A luminance
- Layer B luminance
- Checker
- Stripes
- Animated noise

Mask controls include threshold, feathering, scale, angle, center position, and inversion. The mask inspection view displays the final mask in grayscale.

## Render path

```text
Layer A image/video ─► texture A ─► transform A ─┐
                                                  ├─► blend ─► mask ─► canvas
Layer B image/video ─► texture B ─► transform B ─┘
```

No CPU pixel compositing occurs during normal rendering. Video frames are uploaded before drawing; still images remain resident as GPU textures.

## Export

The current composition can be exported as PNG or JPEG at:

- Preview resolution
- 1920 × 1080
- 3840 × 2160
- Custom dimensions up to 8192 × 8192, subject to GPU limits

Large exports are written to Rust in sequential 1 MiB chunks. Browser download is retained as a fallback outside Tauri.

## Tauri v2 architecture

- `withGlobalTauri` exposes the vanilla JavaScript APIs
- The official dialog plugin supplies native open/save dialogs
- A capability file explicitly grants only core IPC and dialog permissions
- Native image bytes use `tauri::ipc::Response`
- Native videos are authorized per file for the asset protocol
- Fullscreen is controlled through a Rust command

## Project structure

```text
18-tauri-v2-texture-mixer/
├── package.json
├── README.md
├── V2-FOLDER-MAP.md
├── src/
│   ├── index.html
│   ├── styles.css
│   └── app.js
└── src-tauri/
    ├── Cargo.toml
    ├── build.rs
    ├── tauri.conf.json
    ├── capabilities/default.json
    ├── icons/
    └── src/main.rs
```

## Notes

- Video audio is intentionally muted.
- Very large exports may exceed GPU viewport or memory limits.
- Large or unusually encoded videos can expose WebKit duration/codec limitations.
- Transparent JPEG output is flattened by the JPEG encoder.
- This remains a WebView/WebGL application; it does not create a native wgpu surface.
