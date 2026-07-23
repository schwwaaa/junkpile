# 15 · Tauri v1 Multipass Compositor

A standalone Tauri v1 + raw WebGL 1 example demonstrating a reusable multipass post-processing architecture.

The project renders a procedural source shader into an offscreen texture, executes an ordered list of effect passes through two reusable framebuffer targets, stores the completed frame in a separate history target, and finally presents the result in the Tauri WebView.

## What this example teaches

- Rendering into textures with WebGL framebuffers
- Alternating between two work buffers instead of allocating one texture per effect
- Building an effect chain whose order changes the final image
- Keeping previous-frame history separate from current-frame work buffers
- Using one general-purpose effect shader for multiple post-processing operations
- Separating source generation, processing, history, and presentation
- Resizing all offscreen textures with the visible canvas
- Managing WebGL resources inside a Tauri v1 WebView

## Signal flow

```text
Procedural source shader
        │
        ▼
Source framebuffer
        │
        ▼
Pass 1 ──► Work A
        │
Pass 2 ──► Work B
        │
Pass 3 ──► Work A
        │
Pass 4 ──► Work B
        │
Pass 5 ──► Work A
        │
        ├──────────────► Screen
        │
        └──────────────► History write buffer
                              │
                       swap A/B next frame
```

Only two work framebuffers are required regardless of the number of active passes. A pass always reads from one texture and writes to the other, so WebGL never samples from and renders into the same texture simultaneously.

## Included passes

| Pass | Purpose |
|---|---|
| Feedback trails | Mixes the current image with the previous completed frame |
| Kaleidoscope | Converts the image into mirrored polar segments |
| Edge isolate | Estimates a luminance gradient from neighboring texels |
| RGB split | Samples the red and blue channels at opposing offsets |
| Pixelate | Quantizes texture coordinates into adjustable cells |
| Wave displace | Applies animated horizontal and vertical UV displacement |
| Directional blur | Performs a nine-tap blur along an adjustable angle |
| Color grade | Rotates hue and changes contrast |
| Solarize | Inverts channels above an adjustable threshold |

Each of the five stack slots can use any included pass. Slots can be enabled, disabled, selected, tuned, or reordered while the renderer is running.

## Source generators

- Fluid field
- Infinite tunnel
- Cellular lattice
- Signal bands

These sources are intentionally procedural so the example remains self-contained. The same compositor architecture can accept a webcam texture, video texture, image texture, or another rendered scene instead.

## Controls

### Pipeline

- **Bypass** temporarily skips all effect passes without deleting their settings.
- **Clear history** resets both persistent feedback buffers to black.
- **Freeze feedback history** stops updating the previous-frame texture.
- **Render scale** changes the internal framebuffer resolution independently from the CSS size of the window.

### Pass stack

The pass at the top runs first. Moving a pass changes which texture it receives and therefore changes the visual result.

Select a pass row to edit:

- Effect type
- Primary effect parameter
- Secondary effect parameter
- Wet/dry mix

### Presets

- Analog echo
- Prism
- Scanline
- Meltdown
- Clean chain

Presets replace the full pass configuration and clear stale feedback history.

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
15-tauri-v1-multipass-compositor/
├── package.json
├── README.md
├── V1-MASTER-LIST.md
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

## Architecture notes

### Why the history buffers are separate

A feedback pass needs the completed image from the preceding frame. The two work buffers are overwritten several times during the current frame, so they cannot also serve as stable history. Two additional history buffers are therefore alternated once per completed frame.

### Why the stack uses a single effect shader

Every pass shares the same inputs:

- Current texture
- Previous-frame history texture
- Resolution
- Time
- Effect identifier
- Two effect parameters
- Wet/dry mix

Using one program keeps the example compact and makes pass reordering straightforward. A production compositor can instead compile one shader program per effect when specialized uniforms or heavier operations are needed.

### WebGL 1 constraints

This example uses RGBA8 textures because they work broadly in WebGL 1 without requiring floating-point framebuffer extensions. Repeated processing can therefore clamp bright values. HDR post-processing would require compatible floating-point texture and color-buffer extensions or a WebGL 2 implementation.

## Extending the example

Useful next modifications include:

- Replace the source generator with the video texture from Example 12
- Drive pass parameters with FFT bands from Example 13
- Capture the final canvas with the recorder architecture from Example 14
- Load fragment shader source from external files
- Add per-pass masking textures
- Add blend modes between passes
- Add a second input texture for compositing two video sources
