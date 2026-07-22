# 00 · wgpu Surface Probe

The smallest native-rendering example in Junkpile.

## What it proves

- Tauri 2 owns the application event loop and HTML controls window.
- `tauri::window::WindowBuilder` creates a raw native renderer window.
- wgpu creates a `Surface` from that window's raw handles.
- The active adapter and backend are reported to the WebView through a Tauri command.
- Resize, minimized-window protection, surface reconfiguration, and basic loss recovery are implemented.

The renderer window contains **no WebView, canvas, WebGL, or browser render path**.

## Run

```bash
npm install
npm run dev
```

## Expected backend

- macOS: Metal
- Windows: DX12 or Vulkan, depending on the adapter and wgpu selection
- Linux: Vulkan or GLES, depending on installed drivers

## Read next

Continue to `01-wgpu-resize-fullscreen` for a visible resolution-aware WGSL test pattern and window-size controls.
