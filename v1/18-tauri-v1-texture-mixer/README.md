# 18 · Tauri v1 Texture Mixer

A standalone Tauri v1 + raw WebGL example for compositing two independent image or video sources in one fragment-shader pass.

The exact folder name is:

```text
18-tauri-v1-texture-mixer
```

## What this example teaches

- Loading local image and video files into WebView media elements
- Uploading two independent sources to WebGL textures
- Updating video textures on every render frame
- Applying separate framing and transforms to each layer
- Implementing common blend modes in GLSL ES 1.00
- Creating procedural, luminance-driven, and animated masks
- Inspecting the composite, each source, or the mask itself
- Exporting the current mixed frame through Tauri’s native save dialog

## Run

```bash
npm install
npm run dev
```

The project includes an explicit Cargo workspace boundary, so it remains independent from any `Cargo.toml` above its folder.

## Inputs

Layer A and Layer B each accept WebView-supported:

- PNG
- JPEG
- WebP
- GIF first-frame or animated decoding, depending on the WebView
- MP4
- MOV
- M4V
- WebM
- Other image/video formats supported by the operating-system WebView

Videos are muted, looped, and played inline. This avoids accidental audio monitoring and keeps the example focused on texture compositing. Each video has independent play/pause and playback-speed controls.

The app launches with two generated images, so every blend and mask control can be tested before loading media.

## Per-layer controls

Select **Layer A** or **Layer B** in the transform section, then adjust:

- Contain, cover, or stretch framing
- Opacity
- Zoom
- Horizontal and vertical pan
- Rotation
- Horizontal and vertical mirroring

**Swap A ↔ B** exchanges the complete source state, including media, transform, opacity, and video transport state.

## Blend modes

The fragment shader includes:

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

The **Mix** control determines how strongly Layer B and the selected blend operation affect the result.

**Auto crossfade** replaces the fixed mix amount with a sinusoidal animation. The crossfade happens in the shader; the slider itself does not move or produce a jumpy interface.

## Masks

Layer B can be limited by:

- No mask
- Linear wipe
- Radial mask
- Layer A luminance
- Layer B luminance
- Checker pattern
- Stripe pattern
- Animated value noise

Mask controls include threshold, feathering, scale, angle, center position, and inversion.

The **Mask** preview mode renders the final mask as grayscale, which makes it easier to understand why part of Layer B is or is not visible.

## Render path

```text
Layer A image/video ──► WebGL texture A ──► transform A ──┐
                                                         ├─► blend mode ─► mask ─► canvas
Layer B image/video ──► WebGL texture B ──► transform B ──┘
```

Both sources are sampled in one WebGL 1 fragment shader. No CPU pixel compositing occurs during normal rendering.

For video sources, the current decoded frame is uploaded with `texImage2D()` before drawing. Images are uploaded once and reused.

## Preview modes

- **Composite** — final mixed result
- **Layer A** — transformed Layer A over the selected background
- **Layer B** — transformed Layer B over the selected background
- **Mask** — grayscale mask inspection

Background choices are transparent, black, white, and checkerboard.

## Export

The app exports the current decoded frame as:

- PNG
- JPEG with adjustable quality

Available sizes:

- Current preview resolution
- 1920 × 1080
- 3840 × 2160
- Custom dimensions up to 8192 × 8192, subject to the GPU’s `MAX_VIEWPORT_DIMS`

The export is rendered at the selected dimensions rather than scaling a screenshot of the window. The currently selected background is included.

Tauri permissions are intentionally limited to:

- Native save dialog
- Binary file writing

If the Tauri global APIs are unavailable, the frontend falls back to a normal browser download.

## Presets

- **Ghost screen** — slow animated screen blend through a soft linear mask
- **Hard cut** — near-zero-feather normal wipe
- **Print mask** — multiply blend through a checker pattern
- **Signal noise** — animated difference blend through value noise

## Project structure

```text
18-tauri-v1-texture-mixer/
├── package.json
├── README.md
├── V1-FOLDER-MAP.md
├── src/
│   ├── index.html
│   ├── styles.css
│   └── app.js
└── src-tauri/
    ├── Cargo.toml
    ├── build.rs
    ├── tauri.conf.json
    ├── icons/
    └── src/
        └── main.rs
```

## Notes

- Media format support is determined by the operating-system WebView.
- Video audio is intentionally muted.
- Very large export dimensions may exceed the GPU viewport limit or available memory.
- Transparent JPEG exports are flattened by JPEG encoding; choose a black, white, or checker background for predictable JPEG output.
- This is a WebView/WebGL application. It does not create a native wgpu surface.
