# Junkpile 33 — wgpu Preview Output Modes

A focused native-wgpu example that ports ShadeCore's preview/presentation concepts into the Junkpile I/O track.

The renderer always draws into one authoritative offscreen texture. The local window is only a presentation sink and can independently use Fit, Fill, Stretch, Pixel, or Off without changing the source texture.

## What this example demonstrates

- Native Rust + wgpu renderer
- Tauri 2 controls window plus a separate native GPU surface
- Authoritative render resolution independent from window resolution
- Fit presentation with letterboxing
- Fill presentation with centered cropping
- Stretch presentation with independent X/Y scaling
- Pixel presentation at centered 1:1 source pixels
- Nearest-neighbor sampling in Pixel mode
- Preview enable/disable without stopping the offscreen renderer
- Configurable keyboard shortcuts
- Strict versioned JSON configuration
- Invalid configuration rejection while the current runtime remains active
- Live geometry and visibility telemetry
- Resizable and fullscreen presentation window

## Run

```bash
npm install
npm run dev
```

Two windows open:

1. **Controls** — mode buttons, source resolution, live geometry, configuration path, and telemetry.
2. **Native Surface** — the independent wgpu preview window.

## First test

1. Select `640 × 480 · 4:3` as the source.
2. Resize the native preview window so it is wide.
3. Switch between:
   - **Fit** — the complete source remains visible with black side bars.
   - **Fill** — the window is covered and the top/bottom source area is cropped.
   - **Stretch** — the diagnostic circle visibly distorts.
   - **Pixel** — the 640 × 480 source remains centered at exact 1:1 pixels.
4. Click **Hide preview**.
5. Confirm the native window disappears while **Authoritative frames** and **Hidden frames** continue increasing.
6. Click **Show preview** and confirm the current animation returns rather than restarting.
7. Toggle renderer fullscreen and repeat the four modes.

## Default hotkeys

Hotkeys work while the controls window has focus.

| Action | Default KeyboardEvent.code |
|---|---|
| Fit | `Digit7`, `Numpad7` |
| Fill | `Digit8`, `Numpad8` |
| Stretch | `Digit9`, `Numpad9` |
| Pixel | `Digit0`, `Numpad0` |
| Preview on/off | `KeyP` |
| Renderer fullscreen | `KeyF` |

## Configuration

The source template is included at:

```text
config/preview.json
```

On first launch it is copied to the operating system's application-config directory. The exact active path appears in the controls window.

Example:

```json
{
  "schema_version": 1,
  "enabled": true,
  "scale_mode": "fit",
  "source": {
    "width": 1280,
    "height": 720
  },
  "hotkeys": {
    "fit": ["Digit7", "Numpad7"],
    "fill": ["Digit8", "Numpad8"],
    "stretch": ["Digit9", "Numpad9"],
    "pixel": ["Digit0", "Numpad0"],
    "toggle_preview": ["KeyP"],
    "fullscreen": ["KeyF"]
  }
}
```

Edit the active file and click **Reload JSON**. Unknown fields, unsupported schema versions, invalid dimensions, and empty hotkey arrays are rejected. A failed reload does not replace the current working runtime state.

## Presentation math

### Fit

```text
scale = min(window_width / source_width, window_height / source_height)
```

The complete source remains visible. Unused destination area is black.

### Fill

```text
scale = max(window_width / source_width, window_height / source_height)
```

The destination is covered completely. Source edges outside the window are cropped.

### Stretch

```text
scale_x = window_width / source_width
scale_y = window_height / source_height
```

The source fills the window without preserving aspect ratio.

### Pixel

```text
scale = 1.0
```

The source is centered without scaling. Source pixels outside a smaller window are cropped; unused area in a larger window is black.

## Architecture

```text
WGSL source shader
        ↓
authoritative offscreen wgpu texture
        ↓
preview presentation shader
        ↓
Fit / Fill / Stretch / Pixel
        ↓
resizable native surface
```

Disabling preview removes only the final presentation stage:

```text
WGSL source shader
        ↓
authoritative offscreen wgpu texture
        ↓
rendering continues; no local presentation
```

This is the same core separation used by ShadeCore: preview behavior belongs to a presenter and must not resize, crop, or otherwise redefine the authoritative render target.

## Important distinction

This example does not record, stream, publish NDI, Syphon, or Spout. It isolates the local presentation contract so those outputs can continue to consume the authoritative texture independently in later unified-router examples.

## Build

```bash
npm run build
```

## Files

```text
config/preview.json                  editable default configuration
src/index.html                       controls interface
src/app.js                           commands, telemetry, hotkeys
src/styles.css                       controls styling
src-tauri/src/config.rs              strict JSON configuration
src-tauri/src/frame.rs               authoritative frame descriptor
src-tauri/src/main.rs                Tauri windows and commands
src-tauri/src/renderer.rs            offscreen renderer and surface lifecycle
src-tauri/src/preview.rs             preview sink and geometry telemetry
src-tauri/src/source.wgsl            aspect-sensitive diagnostic source
src-tauri/src/preview.wgsl           ShadeCore-style presentation shader
```
