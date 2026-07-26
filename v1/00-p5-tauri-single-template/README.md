# 00 · Tauri v1 p5.js Single Window

A focused foundation for running a p5.js WebGL shader and its HTML controls inside one Tauri v1 WebView.

This folder intentionally retains its original repository name:

```text
p5-tauri-single-template
```

The visible example number is **00** so it aligns with the complete Junkpile Tauri v1 Essentials sequence.

## What this example teaches

- Hosting a p5.js sketch inside Tauri v1
- Attaching a p5 canvas to a specific HTML layout region
- Running a GLSL ES 1.00 fragment shader through `createShader()`
- Sending HTML slider values directly into a shared JavaScript object
- Uploading that state as shader uniforms every frame
- Resizing a WebGL canvas with its containing panel
- Calling one small Rust command from JavaScript to control the native window

## Signal flow

```text
HTML range / checkbox
        ↓
     params{}
        ↓
   p5 draw loop
        ↓
 shader.setUniform()
        ↓
 GLSL fragment shader
        ↓
 WebGL canvas in the same WebView
```

There is no WebSocket or inter-window message relay. Controls and rendering share one page and one JavaScript thread.

## Run

```bash
npm install
npm run dev
```

`npm run dev` copies the pinned p5.js build from `node_modules` into `src/vendor/` before Tauri launches. The application therefore does not depend on a CDN at runtime.

## Production build

```bash
npm run build
```

On macOS, the generated bundles are placed under:

```text
src-tauri/target/release/bundle/
```

Unsigned builds may trigger Gatekeeper on another Mac. Distribution outside local development generally requires Apple signing and notarization.

## Controls

| Section | Parameter | Purpose |
|---|---|---|
| Color | Hue shift | Rotates the shader palette |
| Color | Saturation | Moves from monochrome to vivid color |
| Color | Brightness | Multiplies final output brightness |
| Motion | Zoom | Scales shader coordinates |
| Motion | Speed | Advances the animation clock |
| Motion | Distortion | Strengthens domain warping |
| Pattern | Complexity | Changes the fBm octave count |
| Pattern | Symmetry | Changes rotational folding |
| Pattern | Glow | Brightens the center of the field |
| Switches | Invert | Inverts the final color |
| Switches | Pulse | Enables rhythmic brightness modulation |
| Switches | Rotate | Rotates the complete coordinate field |

Keyboard shortcuts:

| Key | Action |
|---|---|
| Space | Pause or resume animation |
| R | Restore defaults and reset time |
| F | Toggle native-window fullscreen |

## Project structure

```text
p5-tauri-single-template/
├── README.md
├── MODERNIZATION-NOTES.md
├── package.json
├── scripts/
│   └── sync-p5.mjs
├── src/
│   ├── index.html
│   ├── sketch.js
│   ├── styles.css
│   └── vendor/
│       └── p5.min.js        generated after npm install
└── src-tauri/
    ├── Cargo.toml
    ├── tauri.conf.json
    └── src/main.rs
```

## Add a new shader parameter

1. Add a range input and matching `<output>` in `src/index.html`.
2. Add its default to `DEFAULT_PARAMS` in `src/sketch.js`.
3. Add its ID to `SLIDER_IDS`.
4. Declare a matching uniform in `FRAG_SHADER`.
5. Upload the value in `draw()` with `shaderProgram.setUniform()`.
6. Use the uniform in the shader.

This explicit path is intentionally visible. Later examples introduce multiple windows, IPC, media inputs, feedback buffers, recording, routing, and automation.

## GLSL ES 1.00 note

WebGL 1 requires fixed compile-time loop bounds. The `fbm()` function loops to a fixed maximum of eight iterations and exits early using the float `u_complexity` uniform. This is a common WebGL 1 pattern.

## Known limitations

- This example is deliberately single-window.
- It uses p5.js WebGL rather than native wgpu.
- `pixelDensity(1)` prioritizes predictable performance over retina-resolution rendering.
- Shader compile diagnostics are basic here; the dedicated shader playground examples provide a full mini terminal.
