# Junkpile 25 — wgpu Ultra-Resolution Export

A standalone Tauri 2 + wgpu example for rendering resolution-independent GPU artwork and exporting it as tiled 4K, 6K, 8K, or square PNG files.

The renderer window is only a live preview. Export does **not** capture or upscale that window. Instead, the same WGSL shader is rendered again into an offscreen `Rgba8UnormSrgb` texture using global output coordinates.

```text
native preview
WGSL shader ──render──► swapchain surface

high-resolution export
WGSL shader ──render tile──► RGBA8 texture
                              │
                              ├──copy──► padded MAP_READ buffer
                              │
                              └──repeat for every tile
                                            │
                                            ▼
                                dense CPU RGBA image ──► PNG
```

## What this example demonstrates

- The established two-window Junkpile architecture
  - `controls`: HTML/CSS/JavaScript WebView
  - `renderer`: separate native OS window owned directly by wgpu
- A fullscreen procedural WGSL fragment shader
- Independent preview and export render pipelines
- Export resolution that does not depend on window size
- Tiled offscreen rendering
- Global pixel coordinates across tile boundaries
- `Rgba8UnormSrgb` export textures
- Texture-to-buffer GPU copies
- 256-byte row alignment for WebGPU-compatible readback
- `MAP_READ` staging-buffer mapping
- Removal of row padding while assembling the final image
- Native PNG encoding in Rust
- Live export progress and file telemetry
- Metal, Vulkan, and Direct3D 12 backend launch scripts

## Run

```bash
npm install
npm run dev
```

Explicit backend selection:

```bash
npm run dev:metal
npm run dev:vulkan
npm run dev:dx12
```

The selected backend must be available on the operating system.

## First test

1. Launch the project and confirm the animated procedural field appears in the separate renderer window.
2. Move the field, color, and finishing sliders.
3. Enable **Freeze frame** when you want an exact still.
4. Leave the export preset at **4K**, tile size at `2048`, and samples at `1×`.
5. Click **Export PNG**.
6. Watch the tile counter and progress bar.
7. Click **Open exports** after the file is complete.

Exports are written to:

```text
Pictures/Junkpile Exports/
```

If the platform does not expose a Pictures directory, the app falls back to the home directory and then the current working directory.

## Why tiled rendering matters

A direct 8K render target is possible on many desktop GPUs, but it couples export to maximum texture dimensions and creates a large temporary GPU allocation. This example instead uses a reusable tile texture.

For a `7680 × 4320` export with `2048 px` tiles:

```text
columns = ceil(7680 / 2048) = 4
rows    = ceil(4320 / 2048) = 3
tiles   = 12
```

Only one tile texture and one staging buffer are allocated. The final dense image exists in CPU memory because PNG encoding requires all output rows.

## Global coordinates prevent seams

Each export tile receives:

- full output width and height
- tile X and Y origin
- current tile width and height
- one frozen scene-time value

The fragment shader reconstructs the global pixel position:

```text
global pixel = tile origin + local fragment position
```

All procedural noise, grain, aspect correction, and vignette calculations use that global coordinate. Neighboring tiles therefore evaluate the same continuous image instead of restarting the shader at each tile.

## Readback row alignment

Texture-to-buffer copies require `bytes_per_row` to respect the WebGPU copy alignment. The dense row size is:

```text
width × 4 bytes
```

The staging row size is rounded up to a multiple of 256 bytes:

```text
padded = ceil(dense / 256) × 256
```

After the GPU buffer is mapped, Rust copies only the dense pixel bytes from each padded row into the final image.

## Export controls

### Resolution presets

- **HD** — `1920 × 1080`
- **4K** — `3840 × 2160`
- **6K** — `5760 × 3240`
- **8K** — `7680 × 4320`
- **4K square** — `4096 × 4096`

Custom width and height values are accepted from `256` through `8192`, with a safety limit of 67.1 megapixels.

### GPU tile

- `512` — smallest allocation; highest tile count
- `1024` — conservative cross-platform setting
- `2048` — balanced default
- `4096` — fewer submissions and larger temporary resources

The requested tile size must not exceed the adapter's reported `max_texture_dimension_2d`.

### Pixel samples

- `1×` — one shader evaluation per output pixel
- `2×` — two subpixel evaluations
- `4×` — four subpixel evaluations

Higher sampling improves fine edges and small procedural details but multiplies fragment-shader cost.

## Snapshot behavior

The live preview can keep animating before export. When export begins, Rust stores the current scene time once and uses that same value for every tile. This prevents time from advancing between tiles.

The preview pauses while GPU tiles are rendered, read back, assembled, and encoded. The controls WebView remains responsive and reads progress from the shared renderer telemetry.

## Procedural scene

The built-in shader combines:

- iterative reciprocal folding
- animated domain warp
- rotating 3D fold space
- shell, ribbon, and filament density fields
- cosine palette generation
- resolution-independent star detail
- exposure and exponential tone mapping
- vignette and deterministic grain

The visual is intentionally procedural so export quality can be tested without loading external assets.

## Important files

```text
src-tauri/src/main.rs          Tauri commands and two-window lifecycle
src-tauri/src/renderer.rs      preview, tiled export, readback, image assembly, PNG write
src-tauri/src/export_scene.wgsl fullscreen procedural shader with global tile coordinates
src/index.html                 controls and export telemetry
src/app.js                     smooth IPC controls and progress polling
src/styles.css                 responsive controls-window presentation
```

## Memory notes

The final CPU image uses four bytes per pixel before PNG compression:

```text
3840 × 2160 × 4  ≈ 31.6 MiB
7680 × 4320 × 4  ≈ 126.6 MiB
8192 × 8192 × 4  = 256 MiB
```

PNG output size is usually much smaller, but compression time and memory depend on scene complexity and output dimensions.

## Platform path

- macOS: WGSL → Metal
- Linux: WGSL → Vulkan
- Windows: WGSL → Direct3D 12

wgpu and Naga handle backend translation. WGSL remains the canonical shader source.

## License

MIT.
