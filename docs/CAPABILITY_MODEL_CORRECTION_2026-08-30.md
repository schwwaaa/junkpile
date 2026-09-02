# Capability model correction — 2026-08-30

## Why this correction exists

A documentation pass incorrectly blurred **repository location** with **architectural capability**. In particular, because the current dedicated NDI, Syphon, and Spout sender examples live under `wgpu/`, the website could be read as claiming those transports are available only to native-wgpu applications.

That claim is not supported by the repository architecture.

## Correct model: three separate concerns

### 1. Tauri generation

- Tauri v1
- Tauri v2

This controls framework configuration, permissions/capabilities, plugin conventions, window APIs, packaging integration, and IPC details.

### 2. Render ownership

- WebView / WebGL / GLSL
- native Rust / wgpu / WGSL

This controls who owns pixels, textures, GPU resources, render timing, and presentation.

### 3. Native/media services and transports

Examples include:

- files and dialogs
- camera / microphone
- MIDI / OSC
- FFmpeg decode or recording
- NDI
- Syphon
- Spout

These integrations are not synonymous with a renderer. Their implementation and frame-handoff cost depend on where the pixels live, and some framework/platform combinations impose additional constraints.

## What the current repository actually demonstrates

- `v1/` and `v2/` contain WebView examples plus selected Rust/native bridges such as MIDI/OSC and native application services.
- The current dedicated NDI/Syphon/Spout sender and routing references are in `wgpu/`.
- Therefore documentation should say **“current Junkpile reference implementation: wgpu”** rather than **“requires wgpu”**.
- The current v1/v2 collections do not contain dedicated NDI/Syphon/Spout sender examples. That absence must not be presented as an architectural prohibition.

## Documentation rule going forward

Every capability statement should identify which kind of claim it is:

1. **Framework fact** — e.g. Tauri v2 capability/permission model.
2. **Renderer fact** — e.g. wgpu owns explicit textures/buffers in the native track.
3. **Current repository implementation** — e.g. the dedicated Syphon sender is `wgpu/37`.
4. **Validation evidence** — source present, static checked, runtime tested, or unresolved.

Do not infer category 1 or 2 from category 3.
