# 03 · Tauri Controls

The reusable native-wgpu application pattern for Junkpile.

## Architecture

```text
HTML/CSS controls WebView
        ↓ Tauri invoke
validated Rust commands
        ↓ bounded SyncSender
renderer-owned parameter state
        ↓ queue.write_buffer
WGSL uniform buffer
        ↓
Metal / Vulkan / DX12 surface
```

The WebView never enters the render path. It can be hidden, unfocused, or redesigned without changing the renderer.

## Included parameters

- speed
- zoom
- distortion
- hue
- brightness
- saturation
- glow
- complexity, one to eight fbm octaves
- pulse

## Run

```bash
npm install
npm run dev
```

This project should be copied when adding MIDI, OSC, audio, webcam, presets, or automation. Those inputs can all send the same `RenderCommand::SetParam` messages rather than rewriting the renderer.
