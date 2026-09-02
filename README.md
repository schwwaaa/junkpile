<p align="center">
  <img width="220" src="assets/brand/junkpile-amorphous-icon.png" alt="Junkpile amorphous graphics mark">
</p>

<h1 align="center">Junkpile</h1>

<p align="center"><strong>Standalone coding examples for creative graphics, live media, and native GPU application development.</strong></p>

Junkpile is a growing reference library of independently runnable desktop applications. It keeps three complementary development paths visible instead of pretending they are interchangeable:

- **Tauri v1 WebView** — HTML, JavaScript, p5.js, WebGL, GLSL, browser media, and native Rust bridges.
- **Tauri v2 WebView** — the same accessible browser-rendered graphics path with the current Tauri application model.
- **Tauri v2 + native Rust/wgpu** — Rust-owned GPU surfaces, WGSL, compute, explicit GPU resources, native media paths, high-resolution rendering, recording, and the repository's current dedicated output-routing references.

Each project is intentionally isolated. Pick one baseline, run it, understand its boundaries, and modify only the layer you need.

## Start here

The browser documentation is the easiest entry point:

- [`index.html`](index.html) — project overview and architecture map
- [`docs.html`](docs.html) — installation, technical comparison, architecture, native I/O, status, and searchable catalog
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — deeper system architecture
- [`docs/EXAMPLE_MATRIX.md`](docs/EXAMPLE_MATRIX.md) — repository-wide project matrix
- [`wgpu/README.md`](wgpu/README.md) — native wgpu progression and current I/O stack

## Quick start

Clone the repository, choose one project, and work inside that project directory:

```bash
git clone https://github.com/schwwaaa/junkpile.git
cd junkpile

# WebView example
cd v2/12-tauri-v2-video-texture-player

# or native wgpu example
# cd wgpu/43-wgpu-av-recorder

npm install
npm run dev
```

Build the selected standalone application with:

```bash
npm run build
```

Do not treat the repository root as a JavaScript workspace. Each example owns its own dependencies, Tauri configuration, Rust crate, runtime assets, and build behavior.

## Repository structure

```text
junkpile/
├── index.html          Static project overview
├── docs.html           Canonical browser documentation
├── README.md           Repository entry point
├── assets/             Website identity, CSS, JavaScript, icons
├── docs/               Technical reference and example database
├── scripts/            Documentation/audit tooling
├── v1/                 Tauri v1 WebView projects
├── v2/                 Tauri v2 WebView projects
└── wgpu/               Native Rust/wgpu projects
```

The collections are not required to evolve at the same rate. The WebView tracks emphasize approachable creative coding and browser media. The native wgpu track explores lower-level GPU ownership, media, recording, interop, and runtime infrastructure. External transports such as NDI, Syphon, Spout, and FFmpeg should be understood as application I/O integrations rather than capabilities owned by wgpu itself.

## Choose a rendering path

| Path | Pixel ownership | Primary languages | Best fit |
|---|---|---|---|
| Tauri v1 WebView | JavaScript/WebGL inside the OS WebView | HTML, CSS, JavaScript, GLSL, Rust bridges | Existing Tauri 1 code, p5.js, browser media, rapid prototyping |
| Tauri v2 WebView | JavaScript/WebGL inside the OS WebView | HTML, CSS, JavaScript, GLSL, Rust bridges | Current Tauri APIs, permissions, dialogs, multi-window applications |
| Tauri v2 + native Rust/wgpu | Rust-owned native GPU surface | Rust, WGSL, optional HTML controls | Compute, explicit GPU resources, current native high-resolution/recording references, renderer-owned output contracts |

**Tauri v2 does not automatically mean native GPU rendering.** The `v2/` projects still render inside a WebView. Native rendering is explicit in `wgpu/`.

## The native wgpu progression

The native track now extends well beyond the original surface/shader foundations.

```text
Surface + WGSL + controls
        ↓
textures + feedback + multipass + compute
        ↓
camera + video + audio + MIDI + OSC
        ↓
compositing + 3D + deformation + export
        ↓
frame/output contracts + FFmpeg recording
        ↓
high-resolution profiles + NDI + preview modes
        ↓
Syphon / Spout / multi-output routing
        ↓
appliance runtime + AV recording + WGSL tooling
```

The public catalog follows the project numbers already present in `wgpu/`. Example 29 is not present in the current tree; later projects explicitly identify that earlier network-streaming experiment as quarantined. Example 40 is retained as an unresolved network-output experiment and should not be treated as a stable routing baseline.

## Media and I/O model

Junkpile should keep three questions separate: **which Tauri generation is used, who owns the rendered pixels, and which native/media services are attached**. The newer wgpu projects demonstrate an especially explicit model in which the renderer owns one authoritative frame and outputs are independent consumers; this is the current reference architecture, not an exclusivity rule for the transports themselves.

Current wgpu I/O reference path:

```text
Inputs
camera · video · audio · MIDI · OSC · files · UI
        ↓
Canonical application state
        ↓
Native wgpu render / compute graph
        ↓
Authoritative GPU texture
        ├── local preview
        ├── file recording
        ├── NDI
        ├── Syphon (macOS)
        ├── Spout (Windows)
        └── other bounded output workers
```

A WebView application would use a different renderer-to-native handoff when attaching the same class of external transport.

Slow outputs are expected to drop or backpressure within bounded queues rather than stall the renderer. The exact implementation differs by project; see the local README before copying a sink into another application.

## Native AV recording

`wgpu/43-wgpu-av-recorder` combines the high-resolution native recording path with selectable audio:

- video-only recording
- microphone capture through CPAL
- local audio-file input
- H.264/MP4 with AAC audio
- ProRes 422 HQ/MOV with 24-bit PCM audio
- video stream copied during final A/V mux rather than re-encoded
- bounded GPU readback / worker diagnostics inherited from the native recorder series

FFmpeg and `ffprobe` are required for the native file-recording examples.

## Platform-specific outputs

| Capability | Platform / dependency |
|---|---|
| Native wgpu | Metal on macOS, Vulkan/DX12 where supported on other platforms |
| Syphon | macOS-only transport; current dedicated Junkpile sender reference is under `wgpu/` |
| Spout | Windows-only transport; current dedicated Junkpile sender reference is under `wgpu/` |
| NDI | NDI SDK/runtime required; current dedicated Junkpile sender reference is under `wgpu/` |
| FFmpeg recording | FFmpeg + ffprobe |
| Camera / microphone | OS permission plus available capture device |
| MIDI | Native MIDI device or virtual port |
| OSC | Reachable UDP endpoint |

Cross-platform architecture does not imply that every project has been runtime-verified on every operating system. Read the project README and any `VALIDATION.md` file for the evidence attached to that example.

## Development rule: preserve the baseline

Before combining projects, keep a clean copy or commit. Change one boundary at a time:

- input or capture source
- playback / transport state
- shader or compute pipeline
- parameter/control model
- GPU resource ownership
- output or recording sink
- window topology
- runtime configuration

This is what keeps Junkpile useful as a laboratory rather than a single monolithic application.

## Documentation policy

The website and Markdown docs are generated from the repository as it exists, not from a fixed advertised example total. New projects can be added without rewriting marketing copy simply to update a count.

When a project is experimental or unresolved, the documentation should say so explicitly. A source tree, static audit, successful compile, and runtime validation are different evidence levels.

## License

MIT. See [`LICENSE`](LICENSE).
