<p align="center">
  <img width="45%" height="45%" src="https://github.com/schwwaaa/junkpile/blob/main/assets/schwwaaa-junkpile-logo.jpg?raw=true"/>  
</p>

<p align="center"><em>A collection of templates for building native desktop creative applications</em></p> 

---

## Templates

These templates are extracted from real projects. Each one is fully functional, fully commented, and designed to be a working starting point rather than a toy example.

### [`p5-tauri-single-template`](./p5-tauri-single-template)

A single-window application. Controls panel on the left, p5.js WEBGL canvas on the right — everything in one HTML page.

```
┌─────────────────┬──────────────────────────────┐
│  Sliders and    │   p5.js WEBGL                │
│  toggles        │   Fragment shader            │
│                 │                              │
│  writes into    │   reads params{} every frame │
│  params{}       │                              │
└─────────────────┴──────────────────────────────┘
```

**Use this when** you want everything in one place — a self-contained creative tool, instrument, or explorer.

**Stack:** Tauri v1 · p5.js · GLSL ES 1.0 · minimal Rust (no async, no relay)

---

### [`p5-tauri-ws-template`](./p5-tauri-ws-template)

A two-window application. A controls window and a separate fullscreen visual window, connected by an embedded WebSocket relay written in Rust.

```
┌─────────────────┐   ws://127.0.0.1:2727   ┌─────────────────┐
│  controls.html  │ ──────────────────────▶ │   canvas.html   │
│  Sliders send   │                         │   Shader reads  │
│  JSON params    │ ◀────────────────────── │   received      │
└─────────────────┘    Rust relay routes    └─────────────────┘
```

**Use this when** you need the visual output on a separate screen from the controls — performances, installations, live VJ setups.

**Stack:** Tauri v1 · p5.js · GLSL ES 1.0 · Rust WebSocket relay (Tokio + tungstenite)

---

## Choosing a template

| | Single-window | Two-window |
|---|---|---|
| Setup complexity | Low | Medium |
| Separate output window | ✗ | ✓ |
| Second monitor / projector | ✗ | ✓ |
| Parameter communication | Direct JS object | WebSocket JSON |
| Rust complexity | Minimal | WebSocket relay |
| First compile time | Fast | Slower (more deps) |

---

## Shared prerequisites

Both templates require a working Tauri v1 environment.

**1. Rust**
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
```

**2. System dependencies**

macOS:
```bash
xcode-select --install
```

Linux (Ubuntu / Debian):
```bash
sudo apt update && sudo apt install -y \
  libwebkit2gtk-4.0-dev build-essential curl wget \
  libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
```

Windows: [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the "Desktop development with C++" workload, plus [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).

**3. Node.js** v18+ from [nodejs.org](https://nodejs.org/)

**Verify your setup:**
```bash
npx @tauri-apps/cli info
```

---

## Getting started

```bash
# Pick a template
cd p5-tauri-single-template
# or
cd p5-tauri-ws-template

# Install the Tauri CLI
npm install

# Run in dev mode (hot-reload for HTML/JS, Rust recompiles on change)
npm run dev
```

The first Rust build takes 1–2 minutes. After that, incremental builds take a few seconds.

---

## Shared GLSL note

Both templates use **GLSL ES 1.0** (WebGL1), which is what Tauri's embedded WebView provides on all platforms. The main constraint worth knowing upfront:

**Loop bounds must be compile-time constant integers.** You cannot use a uniform as a loop limit. The workaround — used in both templates — is to always loop the maximum number of iterations and use a float counter to break early:

```glsl
float fi = 0.0;
for (int i = 0; i < 8; i++) {   // 8 = constant
    if (fi >= u_complexity) break;
    // ... accumulate ...
    fi += 1.0;
}
```

All uniforms must also be `float` — no `int` or `bool` uniform types in ES 1.0.

---

## Inspired by

These templates are extracted and generalised from **huff** — a real-time datamosh and glitch-art engine built with Tauri v1 + p5.js. The two-window WebSocket relay architecture comes directly from that project.
