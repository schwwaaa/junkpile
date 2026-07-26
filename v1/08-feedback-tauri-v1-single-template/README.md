# 08 · Tauri v1 Feedback Single Window

A focused foundation for persistent GPU feedback inside one Tauri v1 WebView. A webcam or generated source is injected into a pair of alternating WebGL framebuffer textures, allowing each frame to read and transform the previous one.

This folder intentionally retains its original repository name:

```text
feedback-tauri-v1-single-template
```

The visible example number is **08** so it aligns with the complete Junkpile Tauri v1 Essentials sequence.

## What this example teaches

- Creating a full-screen raw WebGL quad
- Allocating two persistent framebuffer textures
- Alternating their read/write roles every frame
- Uploading webcam or Canvas 2D frames with `gl.texImage2D()`
- Separating simulation and display shaders
- Using source luminance and edges to drive temporal systems
- Implementing trails, advection, reaction-diffusion, heat diffusion, symmetry, and glitch memory
- Injecting state directly with pointer input
- Reallocating feedback buffers safely when the window or quality setting changes
- Diagnosing shader compilation, program linking, framebuffer completeness, and WebGL context loss
- Packaging camera permissions for macOS

## Signal flow

```text
Webcam or generated source
            ↓
       source texture
            ↓
previous history texture ──┐
                           ├── simulation shader ──→ next history texture
                           │                              ↓
                           └──────────────────────── display shader
                                                          ↓
                                                     WebGL canvas
```

The two history textures exchange roles after each simulation pass:

```text
Frame N:   history A → simulation → history B → display
Frame N+1: history B → simulation → history A → display
```

Camera frames and feedback textures remain entirely inside the WebView. Rust only launches the application and toggles native fullscreen.

## Run

```bash
npm install
npm run dev
```

The generated calibration source starts immediately. Press **Start camera** to replace it with a live input.

## Production build

```bash
npm run build
```

On macOS, generated bundles are placed under:

```text
src-tauri/target/release/bundle/
```

Public distribution generally requires Apple signing and notarization. The project includes camera usage text and the camera sandbox entitlement.

## Modes

| Mode | Feedback behavior |
|---|---|
| Echo Trail | Decays the previous frame and reinjects the source |
| Fluid Smear | Advects history through a curl field stirred by source edges |
| Reaction-Diffusion | Uses source luminance to inject Gray-Scott activator |
| Thermal | Treats source brightness as heat that diffuses outward |
| Mirror Echo | Folds source and history into six-way symmetry |
| Glitch Memory | Displaces and color-separates accumulated frames |

## Main controls

| Section | Control | Purpose |
|---|---|---|
| Source | Device | Selects a camera input |
| Source | Request | Requests 480p, 720p, 1080p, or highest available |
| Source | Framing | Chooses contain, cover, or stretch mapping |
| Source | Mirror | Reverses the source horizontally |
| Feedback | Decay | Controls how long previous frames persist |
| Feedback | Source mix | Controls how strongly new source frames enter the state |
| Feedback | Simulation speed | Advances time-based and iterative behavior |
| Feedback | Flow scale | Changes the spatial frequency used by flow modes |
| Feedback | Intensity | Scales source injection and visual energy |
| Display | Hue drift / palette | Colors the accumulated state |
| Display | History resolution | Allocates the two feedback textures at 25–100% of canvas resolution |
| Brush | Radius | Controls pointer-based state injection |

Keyboard shortcuts:

| Key | Action |
|---|---|
| Space | Pause or resume simulation updates |
| X | Clear feedback history |
| R | Restore defaults and reset simulation time |
| F | Toggle native-window fullscreen |

## Project structure

```text
feedback-tauri-v1-single-template/
├── README.md
├── MODERNIZATION-NOTES.md
├── package.json
├── src/
│   ├── index.html
│   ├── sketch.js
│   └── styles.css
└── src-tauri/
    ├── Cargo.toml
    ├── Info.plist
    ├── entitlements.plist
    ├── tauri.conf.json
    └── src/main.rs
```

## Why two shader programs?

The **simulation shader** reads the source and previous history, then writes the next state. The **display shader** interprets and tone-maps that state for the screen.

Keeping these separate prevents display-only color work from altering the simulation data and makes reaction-diffusion modes possible without contaminating the chemical channels.

## Generated source

Before camera permission, an animated Canvas 2D calibration pattern is uploaded through the same texture path as a webcam frame. This allows every mode, preset, buffer setting, and pointer interaction to be tested without external hardware.

## Known limitations

- Camera resolutions are requests; WebKit and the operating system choose the actual format.
- Higher history resolution increases GPU fill cost substantially.
- Feedback textures use RGBA8 for broad WebGL 1 compatibility rather than floating-point render targets.
- Reaction-diffusion behavior changes with history resolution and frame rate.
- Pausing freezes the simulation but leaves the camera open.
- Windows and Linux camera behavior should be tested independently.
