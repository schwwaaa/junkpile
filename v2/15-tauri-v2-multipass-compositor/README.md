# 15 · Tauri v2 Multipass Compositor

A standalone Tauri v2 + raw WebGL 1 example demonstrating a reusable multipass post-processing architecture with reorderable shader passes, reusable ping-pong work buffers, persistent previous-frame history, native PNG saving, and fullscreen preview.

The renderer first draws a procedural source into an offscreen framebuffer. Enabled effects then execute in user-defined order through two alternating work targets. The completed frame is displayed and optionally copied into a separate A/B history pair for feedback on the next frame.

## What this example demonstrates

- Raw WebGL 1 rendering inside a Tauri v2 WebView
- Rendering into framebuffer-backed textures
- Reusing two work buffers for an arbitrary ordered pass chain
- Persistent previous-frame A/B history buffers
- Reordering the real GPU execution sequence at runtime
- Per-pass enable, effect selection, two parameters, and wet/dry mix
- Pipeline bypass without destroying settings
- Frozen or cleared feedback history
- Adjustable internal render scale
- Native Tauri v2 PNG save dialog
- Rust binary-file writing command
- Native fullscreen preview
- Browser download/fullscreen fallbacks outside Tauri
- Scroll-safe controls inherited from the corrected v2 layout pattern

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

Only two work framebuffers are required regardless of pass count. The history buffers are separate because the work targets are overwritten several times during the current frame.

## Included effects

| Effect | Purpose |
|---|---|
| Feedback trails | Mixes the current image with the previous completed frame |
| Kaleidoscope | Mirrored polar segmentation |
| Edge isolate | Four-tap luminance-gradient extraction |
| RGB split | Chromatic channel displacement |
| Pixelate | Quantized texture coordinates |
| Wave displace | Animated two-axis UV deformation |
| Directional blur | Nine-tap blur along an adjustable direction |
| Color grade | Hue rotation and contrast adjustment |
| Solarize | Threshold-based channel inversion |

Each of the five stack slots can use any effect. The arrows change actual execution order, so moving an effect earlier or later changes which processed texture it receives.

## Source generators

- Fluid field
- Infinite tunnel
- Cellular lattice
- Signal bands

The source remains procedural so the project is self-contained. The compositor can later accept image, video, webcam, FFT, or scene-render textures.

## Run

```bash
npm install
npm run dev
```

An explicit `[workspace]` boundary in `src-tauri/Cargo.toml` prevents unrelated parent Cargo workspaces from absorbing the project.

## First test

1. Launch the project and confirm the default four active passes.
2. Select a pass row and change its effect.
3. Move the pass earlier or later with the arrow buttons.
4. Enable **Freeze feedback history**, then disable it.
5. Try the **Analog echo** and **Meltdown** presets.
6. Press **Save PNG** and choose a native destination.
7. Press **Fullscreen preview**.

## Controls

### Pipeline

- **Bypass** skips all effects while retaining their settings.
- **Clear history** resets both persistent history buffers to black.
- **Reset** restores the default five-slot chain.
- **Save PNG** exports the current composited frame.
- **Fullscreen preview** toggles the Tauri window fullscreen state.
- **Freeze feedback history** prevents the completed frame from replacing history.
- **Render scale** changes internal framebuffer resolution independently from CSS size.

### Pass editor

Select a pass to edit:

- Effect
- Primary parameter
- Secondary parameter
- Wet/dry mix

The parameter labels change to match the selected effect.

### Presets

- Analog echo
- Prism
- Scanline
- Meltdown
- Clean chain

Presets replace the complete stack and clear stale history.

## Tauri v2 native layer

The official dialog plugin supplies the PNG save dialog:

```toml
tauri-plugin-dialog = "2"
```

The capability grants only core IPC and save-dialog access:

```json
[
  "core:default",
  "dialog:allow-save"
]
```

After the user chooses a destination, the PNG bytes are sent to the narrowly scoped Rust `write_binary` command. `toggle_fullscreen` addresses only the `main` WebView window.

## WebGL 1 constraints

The offscreen targets use RGBA8 textures for broad WebGL 1 compatibility. Repeated passes therefore clamp values to the normalized color range. HDR processing would require compatible float-texture/color-buffer extensions or a WebGL 2 implementation.

PNG capture enables `preserveDrawingBuffer` for reliable snapshot export. A production compositor focused only on maximum presentation performance may choose a dedicated export target instead.

## Project structure

```text
15-tauri-v2-multipass-compositor/
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

## Useful extensions

- Replace the procedural source with Example 12's video texture
- Drive pass parameters from Example 13's FFT bands
- Record the completed canvas with Example 14's recorder
- Add per-pass masks or a second input texture
- Load external fragment shaders
- Add project/preset JSON persistence
- Port the pass graph to WebGL 2 or WebGPU
