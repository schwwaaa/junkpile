# 01 · Resize + Fullscreen

Adds the complete surface lifecycle to the raw Tauri window.

## New concepts

- Physical window dimensions and HiDPI behavior
- `WindowEvent::Resized` and `ScaleFactorChanged`
- A bounded Rust command channel between Tauri callbacks and the renderer thread
- `Surface::configure` after size changes
- Zero-sized/minimized-window protection
- Fullscreen and common output-size presets
- A resolution-aware WGSL test pattern

## Run

```bash
npm install
npm run dev
```

Resize the renderer manually and use each preset. The grid and center registration lines make stretching or stale surface configuration immediately visible.
