# 16 · Tauri v1 Image Texture Processor

A standalone Tauri v1 + raw WebGL 1 example for loading a still image into a GPU texture, processing it in a fragment shader, comparing the original and processed versions, and exporting the result through a native save dialog.

## What this example teaches

- Loading local image files without a Rust media decoder
- Uploading an `HTMLImageElement` or canvas into a WebGL texture
- Correcting image orientation with `UNPACK_FLIP_Y_WEBGL`
- Contain, cover, and stretch texture framing
- Zoom, pan, rotation, and mirroring in UV space
- Building several stylization modes into one fragment shader
- Comparing original and processed output with a movable split
- Rendering at a resolution independent from the preview window
- Encoding PNG or JPEG with `canvas.toBlob()`
- Writing binary image data through the Tauri v1 filesystem API

## Included processing modes

| Mode | Purpose |
|---|---|
| Clean | Color grading only |
| Duotone | Maps luminance between two colors |
| Posterize | Reduces each channel to a controlled number of levels |
| Edge ink | Estimates neighboring-pixel differences and creates an inked print |
| Chromatic split | Samples red and blue from opposing offsets |
| Halftone | Converts luminance into a rotated dot screen |
| Prismatic warp | Applies radial displacement and chromatic separation |
| Solarize | Selectively inverts bright channel values |

Every effect is blended against the graded source with the **Amount** control.

## Image flow

```text
Local image file / generated demo
             │
             ▼
       HTML image or canvas
             │
       texImage2D upload
             │
             ▼
       WebGL image texture
             │
      framing UV transform
             │
      color-grade function
             │
      selected effect mode
             │
        compare split
             │
             ▼
         preview canvas
             │
    temporary export resize
             │
       canvas.toBlob()
             │
       Tauri save dialog
             │
             ▼
        PNG or JPEG file
```

## Controls

### Source

- Choose an image through the file picker
- Drop an image on either the control target or graphics stage
- Review decoded dimensions and aspect ratio

The built-in 1024 × 1024 demo texture makes the project useful immediately after launch.

### Framing

- Contain, cover, or stretch
- Zoom
- Horizontal and vertical pan
- Rotation
- Horizontal and vertical mirroring

These operations change texture coordinates rather than modifying the source pixels.

### Color grade

- Hue rotation
- Saturation
- Brightness
- Contrast
- Gamma

### Comparison

The preview can show the original image on one side and processed output on the other. The comparison line can be vertical or horizontal. It is intentionally disabled during export.

### Export

Processed output can use:

- Original source dimensions
- 1920 × 1080
- 3840 × 2160
- Custom dimensions up to 8192 × 8192, subject to the WebGL viewport limit

The source-image button saves the decoded source without framing or shader processing. Processed exports use the current framing, effect, and grade settings.

## Run

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Project structure

```text
16-tauri-v1-image-texture-processor/
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

## Tauri permissions

Only the following native APIs are enabled:

- Native save dialog
- Binary file writing

No arbitrary filesystem reads are required because local images enter through the WebView file picker and drag-and-drop APIs.

## WebGL 1 notes

The example uses an RGBA8 image texture and the default canvas framebuffer, so it does not require floating-point texture extensions. Image decoding format support depends on the operating system WebView.

Very large exports consume significant GPU and CPU memory because the completed canvas must be encoded as one image. Tiled export is demonstrated separately in the native-wgpu collection.
