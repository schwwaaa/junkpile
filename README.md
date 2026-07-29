<p align="center"><img width="58%" src="assets/brand/junkpile-logo-primary-on-paper.png" alt="Junkpile layered modules logo" /></p>
<p align="center"><em>Standalone creative graphics systems examples: see it, run it, understand it, modify it, build it.</em></p>

# Junkpile

Junkpile is a completed developer laboratory of **78 standalone Tauri applications**. It is organized as three parallel collections of 26 examples:

- **Tauri v1 WebView · 00–25**
- **Tauri v2 WebView · 00–25**
- **Native Rust/wgpu · 00–25**

Each project isolates one rendering, media, control, routing, automation, or output architecture. The goal is not to hide complexity behind one framework; it is to make each boundary visible enough to inspect, test, and reuse.

## The central architectural distinction

```text
Tauri v1 / v2 WebView collections        Native wgpu collection
HTML + JavaScript                         Rust
p5.js / WebGL / GLSL ES                   wgpu / WGSL
browser media elements                    native media bridges
        ↓                                         ↓
Tauri WebView                             native GPU surface
        ↓                                         ↓
WKWebView / WebView2 / WebKitGTK          Metal / Vulkan / Direct3D 12
```

Tauri 2 is used in both the v2 WebView collection and the native-wgpu collection, but **Tauri version does not determine the render path**.

## Start here

1. Open [the landing page](index.html) or [single-page developer guide](docs.html).
2. Read [development setup](docs/DEVELOPMENT.md).
3. Choose a project from [the complete 78-example matrix](docs/EXAMPLE_MATRIX.md).
4. Run inside that project:

```bash
npm install
npm run dev
```

5. Build the standalone application:

```bash
npm run build
```

## Collection guide

| Collection | Count | Render owner | Shader path | Best for |
| --- | --- | --- | --- | --- |
| Tauri v1 | 26 | WebView | GLSL ES / p5.js / WebGL | Original Tauri generation, rapid creative coding, comparison baselines |
| Tauri v2 | 26 | WebView | GLSL ES / p5.js / WebGL | Current Tauri capabilities, native file workflows, production media examples |
| Native wgpu | 26 | Rust-owned GPU surface | WGSL | Compute, native resources, backend control, 3D, high resolution, media bridges |

## What the completed library covers

- p5.js, raw WebGL, external GLSL, live shader editing, WGSL
- single-window, two-window/WebSocket, hybrid HTML-control/native-renderer, and multi-output topologies
- image, webcam, native camera, video, microphone, audio file, image sequences, and generated textures
- framebuffer feedback, fluid compute, particle compute, render graphs, mesh feedback, and temporal memory
- MIDI, OSC, Max/MSP, pointer/touch/pen, keyboard, Tauri IPC, and native drag/drop
- texture mixing, keying, live switching, multi-input compositing, projection mapping, and display routing
- glTF, skeletal animation, morph targets, raymarching, and 3D particles
- recording, PNG/JPEG output, 4K–8K targets, tiled readback, automation, presets, and JSON state

## Modernization baseline

The early v1 and v2 examples were modernized after the collections expanded. Current standards include:

- scroll-safe layouts at first launch
- fixed-width numeric readouts
- animation-frame-coalesced high-rate control messages
- reconnect-safe full-state restoration
- shader compile/link terminals and last-valid-program retention
- visible renderer, GPU, FPS, resolution, device, and connection telemetry
- clear camera/microphone permission and refresh behavior
- robust framebuffer allocation, resize, clear, and context/surface recovery
- local npm scripts and standalone Cargo workspace boundaries
- complete development and production-build documentation

See [Advancements and lessons](docs/ADVANCEMENTS_2026.md) and [Architecture](docs/ARCHITECTURE.md).

## Repository structure

```text
junkpile/
├── v1/                 26 Tauri v1 WebView examples
├── v2/                 26 Tauri v2 WebView examples
├── native-wgpu/        26 Tauri 2 + Rust/wgpu examples
├── docs/               architecture, setup, matrix, audit, lessons
├── index.html          landing page
└── docs.html           comprehensive single-page documentation
```

## Documentation index

- [Complete example matrix](docs/EXAMPLE_MATRIX.md)
- [Architecture guide](docs/ARCHITECTURE.md)
- [Tauri v1, v2, and native wgpu comparison](docs/V1_V2_ARCHITECTURE.md)
- [Advancements and modernization lessons](docs/ADVANCEMENTS_2026.md)
- [Development and platform setup](docs/DEVELOPMENT.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Repository audit](docs/AUDIT.md)
- [Adding an example](docs/ADDING_AN_EXAMPLE.md)
- [Documentation standard](docs/DOCUMENTATION_STANDARD.md)
- [Screenshot checklist](docs/SCREENSHOTS.md)
- [Roadmap](docs/ROADMAP.md)
- [Ecosystem direction](docs/ECOSYSTEM_DIRECTION.md)
- [Junkpile design principle manifest](docs/DESIGN_PRINCIPLES_MANIFEST.md)
- [Brand and logo update](docs/BRAND_UPDATE_2026-07-27.md)
- [Brand asset registry](assets/brand/README.md)
- [Machine-readable catalog](docs/examples.json)

## Identity and design system

The current Junkpile identity presents the project as a **disciplined stack of reusable experiments**. The layered symbol preserves the original accumulation metaphor while matching the documentation site’s hard-edged editorial system.

- Primary logo: `assets/brand/junkpile-logo-primary.png`
- README-safe logo: `assets/brand/junkpile-logo-primary-on-paper.png`
- Symbol and icon source: `assets/brand/junkpile-symbol.png`
- Complete rationale and rules: [Design Principle Manifest](docs/DESIGN_PRINCIPLES_MANIFEST.md)
- Asset registry: [Brand assets](assets/brand/README.md)

The previous illustrated desk logo is retained as a deprecated historical asset. The current identity is approved for digital documentation use; vector reconstruction and print-production proofing remain open tasks.

## Validation language

All 78 projects were developed and tested sequentially on the primary macOS Apple Silicon environment. This is not the same as universal cross-platform certification. Platform-specific status should remain explicit—especially Windows Spout, Linux media/device paths, packaging, and hardware-dependent inputs.

## Project ethos

A useful Junkpile example should be focused, inspectable, transparent about ownership, safe to modify, independently runnable, and capable of becoming a real standalone application.
