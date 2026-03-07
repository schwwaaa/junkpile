<p align="center">
  <img width="35%" height="35%" src="https://github.com/schwwaaa/junkpile/blob/main/assets/schwwaaa-junkpile-logo.jpg?raw=true"/>  
</p>

<p align="center"><em>Tauri  templates for live visual art</em></p>

---

## The Two Sets

Two sets of templates with different rendering philosophies. The p5-tauri set is stable and tested. The wgpu-tauri set is under active development — expect rough edges.

| | p5-tauri (v1) | wgpu-tauri (v2) |
|---|---|---|
| **Renderer** | p5.js WebGL inside the WebView | wgpu directly on the GPU (Metal / Vulkan / DX12) |
| **Shader language** | GLSL ES 1.0 | WGSL |
| **Tauri version** | 1.x | 2.x |
| **Status** | ✅ Stable | 🚧 In development |
| **Best for** | Rapid prototyping, p5.js familiarity | Maximum performance, native GPU |

The shader logic — a domain-warped fbm fractal — is identical between both sets. Only the language and pipeline differ.

---

## Why Tauri v1 vs v2 Matters

This is not a minor version bump. It fundamentally changes what is possible.

### Tauri v1 — WebView owns the window

In v1, the WebView renderer (WKWebView on macOS, WebView2 on Windows, WebKitGTK on Linux) owns the entire window surface. There is no way to place a native GPU surface alongside it.

- Rendering must go through the browser graphics stack (WebGL).
- On macOS, GLSL goes through OpenGL → Metal via Apple's ANGLE fork. This adds overhead and constrains you to GLSL ES 1.0.
- **wgpu cannot render to a v1 window.** This is confirmed behaviour, not a workaround that might work.
- IPC is the only bridge: JS → Tauri command → Rust, and Rust → `window.emit()` → JS.

### Tauri v2 — explicit surface allocation

In v2, Tauri separates the window from its WebView. You can attach a wgpu surface to the raw OS window handle and float a transparent WebView panel on top via the OS compositor.

- WGSL instead of GLSL. On macOS, WGSL compiles directly to Metal Shading Language.
- Zero browser overhead in the render path.
- IPC still works for control messages (sliders, MIDI, OSC → `invoke` → Rust → UNIFORMS).
- **Tauri v1 and v2 are incompatible.** Different Cargo dependencies, different `tauri.conf.json` schema, different plugin syntax. You cannot mix them in one project.

### Quick decision guide

| If you want... | Use |
|---|---|
| p5.js sketches, GLSL, browser ecosystem | p5-tauri (v1) |
| Something that works today | p5-tauri (v1) |
| Native GPU, no browser in the render path | wgpu-tauri (v2) ⚠️ in development |
| Metal on Apple Silicon | wgpu-tauri (v2) ⚠️ in development |

---

## p5-tauri Templates (Tauri v1) ✅

All four use p5.js inside the Tauri WebView. The GLSL shader is passed to `createShader()`. Controls communicate to Rust via IPC, WebSocket, midir, or rosc.

### p5-tauri-single-template

Single window. Fullscreen p5.js canvas with a floating controls panel.

```bash
cd p5-tauri-single-template && cargo tauri dev
```

### p5-tauri-ws-template

Two windows connected by an embedded WebSocket relay (port 2727).

```
controls.html ──ws://127.0.0.1:2727──► Rust WS relay ──► canvas.html
```

Both windows send a hello handshake on connect (`{ "type": "hello", "role": "controls" | "canvas" }`). The relay broadcasts text messages to all other connected clients.

```bash
cd p5-tauri-ws-template && cargo tauri dev
```

### p5-tauri-midi-template

Single window. MIDI via `midir` (CoreMIDI / ALSA / WinMM). The Web MIDI API does not work inside WKWebView — Rust owns device enumeration and message routing entirely.

**Tauri commands:** `list_midi_ports`, `connect_midi_port_by_name`, `disconnect_midi`, `debug_midi_ports`

**Default CC map:**
| CC | Param |
|---|---|
| CC 1 mod wheel | hue |
| CC 7 volume | brightness |
| CC 10 pan | saturation |
| CC 74 filter | zoom |
| CC 71 resonance | distortion |
| CC 2 | speed |
| CC 3 | glow |
| Note On | pulse flash |
| Pitch Bend | complexity |

**Troubleshooting:** Open Audio MIDI Setup → MIDI Studio. Is your device listed? For Max/MSP or Pure Data, enable the IAC Driver (double-click → "Device is online"). Click "Debug ports" in the panel to see exactly what CoreMIDI reports to Rust.

```bash
cd p5-tauri-midi-template && cargo tauri dev
```

### p5-tauri-osc-template

Single window. OSC over UDP via `rosc`, port 9000. Compatible with TouchOSC, Max/MSP, Pure Data, SuperCollider, TouchDesigner.

**Address map** (all values 0.0–1.0):
```
/hue  /zoom  /speed  /brightness  /saturation
/distortion  /complexity  /glow  /invert  /pulse
```

```bash
cd p5-tauri-osc-template && cargo tauri dev
```

---

## wgpu-tauri Templates (Tauri v2) 🚧

> **These templates are in active development and have not been fully tested across platforms. The architecture is sound and they compile, but you may encounter issues. Bug reports and PRs are welcome.**

All four use wgpu rendering directly to a native GPU surface. The WebView is a transparent overlay panel only. Shaders are WGSL.

### Known issues / caveats

- Window resize does not yet reconfigure the wgpu surface. Avoid resizing during a session — or submit a PR for `WindowEvent::Resized` handling in `renderer.rs`.
- Metal surface creation must happen on the main thread. The templates handle this correctly (init runs in `setup()`, draw loop runs on a background thread), but if you see a `get_metal_layer cannot be called in non-ui thread` panic, that is the cause.
- Not yet tested on Windows or Linux.

### Shared architecture

```
src-tauri/src/
  renderer.rs   wgpu pipeline, WGSL shader, ShaderUniforms, render loop (identical in all 4)
  main.rs       input handling + Tauri setup (the only file that differs between templates)
```

`renderer.rs` is designed as a drop-in module. To add a new input method: copy `renderer.rs` verbatim, write a new `main.rs`.

**Render loop** runs on a dedicated `std::thread` at ~60fps (vsync via `PresentMode::Fifo`). Each frame it reads `UNIFORMS` (a global `Lazy<Mutex<ShaderUniforms>>`) and uploads to the GPU via `queue.write_buffer`.

**Uniform buffer** (`ShaderUniforms`, 64 bytes, `repr(C)`):
```rust
time, hue, zoom, speed, brightness, saturation,
distortion, complexity, glow, invert, pulse, _pad,
res_x, res_y, _pad2[2]
```

### wgpu-tauri-single

Single window. WebView sliders call `set_param()` via Tauri IPC → UNIFORMS → next frame.

```bash
cd wgpu-tauri-single && cargo tauri dev
```

### wgpu-tauri-ws

Two windows. Same WebSocket relay as `p5-tauri-ws-template` — identical Rust relay code, port 2727. Controls window is a plain WebView. Canvas window is a wgpu surface with a transparent WebView status overlay.

```bash
cd wgpu-tauri-ws && cargo tauri dev
```

### wgpu-tauri-midi

Single window. Same `midir` bridge as `p5-tauri-midi-template`. MIDI callbacks update `UNIFORMS` directly — no IPC round-trip in the hot path.

**CC map:**
| CC | Param | Range |
|---|---|---|
| CC 1 | hue | 0°–360° |
| CC 7 | brightness | 0–2 |
| CC 10 | saturation | 0–1 |
| CC 74 | zoom | 0.3–5 |
| CC 71 | distortion | 0–1 |
| CC 2 | speed | 0–3 |
| CC 3 | glow | 0–2 |
| Note On | pulse flash | — |
| Pitch Bend | complexity | 1–8 octaves |

```bash
cd wgpu-tauri-midi && cargo tauri dev
```

### wgpu-tauri-osc

Single window. Same `rosc` + Tokio UDP bridge as `p5-tauri-osc-template`. OSC messages update `UNIFORMS` directly in the async listener task.

Includes a **TouchOSC layout** at `touchosc/wgpu-shader.tosc`.

**To use the layout:**
1. Open TouchOSC → File → Import Layout → select `wgpu-shader.tosc`.
2. Add an OSC UDP connection: host = your computer's IP, port = 9000.
3. Run the template.

**Address map** (all 0.0–1.0):
```
/hue  /zoom  /speed  /brightness  /saturation
/distortion  /complexity  /glow  /invert  /pulse
```

```bash
cd wgpu-tauri-osc && cargo tauri dev
```

---

## GLSL vs WGSL Reference

| Concept | GLSL ES 1.0 (p5-tauri) | WGSL (wgpu-tauri) |
|---|---|---|
| Uniform input | `uniform float u_time;` | `u.time` via `@group(0) @binding(0) var<uniform> u: Uniforms` |
| Fragment coord | `gl_FragCoord.xy` | `@builtin(position) frag_pos: vec4<f32>` |
| 2-component vector | `vec2(x, y)` | `vec2<f32>(x, y)` |
| Output colour | `gl_FragColor = vec4(...)` | `return vec4<f32>(...)` from `@fragment fn` |
| Modulo | `mod(x, y)` | `x % y` |
| Dynamic loop exit | `if (fi >= u_complexity) break;` | `if (f32(i) >= u.complexity) { break; }` |
| mix, fract, clamp | identical | identical |

The most important practical difference: GLSL ES 1.0 requires loop bounds to be compile-time constant integers. The workaround used throughout the p5 templates is to declare a fixed upper bound and early-exit with a float comparison. WGSL has no such restriction.

---

## Modifying the Shader

### p5-tauri set

Edit `FRAG_SHADER` in `sketch.js`. Add uniforms to the string literal and call `shader.setUniform('u_name', value)` in `draw()`.

GLSL ES 1.0 constraints:
- Loop bounds must be compile-time constant integers (use float comparison + break as shown)
- `precision highp float;` required at the top

### wgpu-tauri set

Edit `WGSL_SHADER` in `renderer.rs`. To add a uniform: add a field to `ShaderUniforms` (maintaining `repr(C)` alignment with explicit `_pad` fields), update the WGSL `Uniforms` struct to match byte-for-byte, and add a Tauri command in `main.rs` to expose the param to the WebView.

When in doubt about alignment, add `f32` padding and verify with `std::mem::size_of::<ShaderUniforms>()`.

---

## Prerequisites

```bash
# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Tauri CLI — both versions coexist
cargo install tauri-cli --version "^1" --locked   # for p5-tauri set
cargo install tauri-cli --version "^2" --locked   # for wgpu-tauri set

# macOS: Xcode command line tools
xcode-select --install
```

**Linux (wgpu-tauri):**
```bash
# Ubuntu/Debian
sudo apt install libvulkan1 vulkan-utils

# Arch
sudo pacman -S vulkan-icd-loader
```

**MIDI on Linux:**
```bash
sudo apt install libasound2-dev
```

**MIDI on macOS — nanoKONTROL (original):** Requires the [Korg USB-MIDI Driver](https://www.korg.com/us/support/download/). The nanoKONTROL2 is class-compliant and works without it. For Max/MSP or Pure Data virtual ports: enable the IAC Driver in Audio MIDI Setup.

---

## Project Structure

```
junkpile/
├── README.md
│
├── p5-tauri-single-template/     ┐
├── p5-tauri-ws-template/         │  Tauri v1  ·  p5.js  ·  GLSL ES 1.0  ·  ✅ stable
├── p5-tauri-midi-template/       │
├── p5-tauri-osc-template/        ┘
│
├── wgpu-tauri-single/            ┐
├── wgpu-tauri-ws/                │  Tauri v2  ·  wgpu  ·  WGSL  ·  🚧 in development
├── wgpu-tauri-midi/              │
└── wgpu-tauri-osc/               ┘  (includes touchosc/wgpu-shader.tosc)
```

---

## The fbm Fractal

All eight templates render the same visual: domain-warped layered fractional Brownian motion with HSB colouring.

Signal chain:
1. UV scaled by zoom and aspect ratio
2. Domain warp — UV offset by two fbm samples (`distortion` controls strength)
3. Three fbm layers at different frequencies and speeds, weighted 50/30/20
4. Glow vignette — brightens the centre based on radial distance
5. Optional pulse — sine-wave brightness modulation at 2.5Hz
6. HSB → RGB with hue drift over time

`complexity` controls the octave count (1–8). Higher values add finer detail at GPU cost. At 8 octaves on Apple Silicon: ~0.3ms/frame via Metal (wgpu-tauri), ~1–2ms/frame via WebGL (p5-tauri) due to the OpenGL → Metal translation layer.

---

## Syphon

`p5-tauri-syphon-template` is included but incomplete. Syphon requires macOS Objective-C FFI that goes beyond the scope of these templates. Tabled for now — PRs welcome.

---

## Contributing

The wgpu-tauri set in particular would benefit from:
- Platform testing on Windows and Linux
- Window resize handling (`WindowEvent::Resized` in `renderer.rs`)
- Additional input method templates

---

## License

MIT.
