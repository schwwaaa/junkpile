# p5-tauri-single-template

**A single-window Tauri + p5.js application with a GLSL fragment shader controlled by an inline panel.**

This is the simpler companion to the two-window WebSocket relay template. Everything lives in one window: a controls panel on the left writes directly into a shared JavaScript object, and a p5.js WEBGL canvas on the right reads from it every frame.

---

## When to use this template vs. the two-window template

| | Single-window | Two-window (WebSocket relay) |
|---|---|---|
| **Setup complexity** | Minimal — one HTML file, minimal Rust | More involved — relay server in Rust |
| **Controls + canvas** | Same window, side by side | Separate native windows |
| **Second monitor output** | ✗ | ✓ |
| **Parameter communication** | Direct JS object write | WebSocket JSON messages |
| **Good for** | Tools, instruments, explorers | Performances, installations, live VJ |

**Rule of thumb:** if you need the visual on a separate screen from the controls, use the two-window template. Otherwise, use this one.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                  index.html (one window)                 │
│                                                          │
│  ┌───────────────┐   params{}   ┌──────────────────────┐ │
│  │ Controls panel│ ──────────▶ │  p5.js WEBGL canvas  │ │
│  │               │  (direct JS │  Fragment shader      │ │
│  │  Sliders and  │   object    │  reads params{}       │ │
│  │  toggles      │   write)    │  every frame          │ │
│  └───────────────┘             └──────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

**Key simplification:** Because controls and canvas share the same JavaScript context, a slider's `oninput` handler writes directly into `params`. The `draw()` loop reads `params` on the next frame (~16ms). No WebSocket, no relay, no async messaging.

---

## Project structure

```
p5-tauri-single-template/
│
├── README.md
├── package.json
│
├── src/
│   ├── index.html      ← Window layout + controls panel HTML
│   └── sketch.js       ← params object · GLSL shaders · p5 setup/draw · UI wiring
│
└── src-tauri/
    ├── Cargo.toml      ← Minimal Rust deps (no WebSocket crates needed)
    ├── build.rs
    ├── tauri.conf.json ← Single window definition
    └── src/
        └── main.rs     ← Minimal — just launches the window
```

---

## Prerequisites

Same as the two-window template. You need:

1. **Rust** — `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
2. **System dependencies** for your OS (see below)
3. **Node.js** v18+

**macOS:** `xcode-select --install`

**Linux (Ubuntu/Debian):**
```bash
sudo apt update && sudo apt install -y \
  libwebkit2gtk-4.0-dev build-essential curl wget \
  libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
```

**Windows:** Visual Studio Build Tools (C++ workload) + WebView2

---

## Getting started

```bash
# 1. Install Node dependencies (Tauri CLI)
npm install

# 2. Run in development mode (hot-reload for HTML/JS)
npm run dev

# 3. Build for distribution
npm run build
```

First Rust compile takes 1–2 minutes. Subsequent builds are incremental (a few seconds).

---

## How it works

### Parameter flow

```
User moves slider
      │
      ▼
input event fires (controls.js wireControls())
      │
      ▼
params['speed'] = 0.75   ← direct object write, no messaging
      │
      ▼ (next frame, ≤16ms)
draw() reads params.speed
      │
      ▼
shd.setUniform('u_time', (millis()/1000) * params.speed)
      │
      ▼
GPU recomputes every pixel with new uniform value
```

### The `params` object

`params` in `sketch.js` is the single source of truth. It has two roles:

- **Defaults** — the values shown on first load, before any slider is touched
- **Live state** — updated by `wireControls()` on every slider/checkbox change

```js
const params = {
    speed:      0.5,   // matches the slider's default `value` attribute
    saturation: 0.8,
    // ...
};
```

### The layout

`index.html` uses a CSS flexbox row:
- `#panel` — fixed 260px left column, contains all `<input>` elements
- `#canvas-container` — grows to fill the rest, p5 appends its canvas here

The canvas is attached to the container with `cnv.parent('canvas-container')` in `setup()`.

### The Rust side

`main.rs` is intentionally minimal — it has no WebSocket relay, no async tasks, no Tokio. It just runs `tauri::Builder::default().run(...)`. All logic is in JavaScript.

---

## Adding a new parameter — complete checklist

### Slider parameter

**1. Add the HTML in `index.html`:**
```html
<div class="param-row">
  <label for="myParam">My Param</label>
  <input id="myParam" type="range" min="0" max="10" step="0.1" value="5.0">
  <span class="param-value" id="myParam-val">5.0</span>
</div>
```

**2. Add to `PARAMS` array in `sketch.js`:**
```js
const PARAMS = [
    // ...existing...
    'myParam',
];
```

**3. Add default to `params` object in `sketch.js`:**
```js
const params = {
    // ...existing...
    myParam: 5.0,
};
```

**4. Declare uniform in `FRAG_SHADER`:**
```glsl
uniform float u_myParam;
```

**5. Pass in `draw()`:**
```js
shd.setUniform('u_myParam', params.myParam);
```

**6. Use in GLSL:**
```glsl
float value = sin(uv.x * u_myParam);
```

### Toggle (checkbox) parameter

**1. Add HTML:**
```html
<div class="toggle-row">
  <label for="myToggle">My Toggle</label>
  <input id="myToggle" type="checkbox">
</div>
```

**2. Add to `TOGGLES` array, add default (0.0 or 1.0) to `params`:**
```js
const TOGGLES = ['invert', 'pulse', 'rotate', 'myToggle'];
const params  = { ..., myToggle: 0.0 };
```

**3. Declare, pass, and use as before.** In GLSL, use `mix()` to apply it conditionally:
```glsl
col = mix(col, 1.0 - col, u_myToggle); // applies when u_myToggle = 1.0
```

---

## GLSL ES 1.0 constraints (important)

Tauri's WebView uses WebGL1 (GLSL ES 1.0). Key limitations:

**No dynamic loop bounds.** You cannot do:
```glsl
// WRONG — u_complexity is a uniform, not a compile-time constant
for (int i = 0; i < int(u_complexity); i++) { ... }
```

**The fix** — always loop the maximum count, break with a float counter:
```glsl
float fi = 0.0;
for (int i = 0; i < 8; i++) {   // 8 = compile-time constant
    if (fi >= u_complexity) break;
    // ... accumulate ...
    fi += 1.0;
}
```

**No int/bool uniforms.** All uniforms must be `float`. Pass booleans as `0.0`/`1.0`.

**No dynamic array indexing.** Array indices must be constants or loop variables.

---

## Replacing the shader

To use a completely different visual:

1. Replace `VERT_SHADER` and `FRAG_SHADER` strings in `sketch.js`
2. Keep `u_time` and `u_resolution` — they're universally useful
3. Remove uniforms you don't need; add new ones you do
4. Update `params`, the `setUniform()` calls in `draw()`, and the HTML sliders

The controls wiring and layout are completely independent of what shader you use.

## Using p5 2D mode instead of a shader

Remove the `WEBGL` argument from `createCanvas` and remove the shader setup:

```js
function setup() {
    const container = document.getElementById('canvas-container');
    const cnv = createCanvas(container.clientWidth, container.clientHeight); // no WEBGL
    cnv.parent('canvas-container');
}

function draw() {
    background(0);
    fill(params.hue, params.saturation * 255, params.brightness * 255);
    ellipse(width / 2, height / 2, params.zoom * 100);
}
```

The `wireControls()` wiring, `params` object, and layout all work identically — just swap out the rendering code.

---

## Troubleshooting

**Canvas is black / shader doesn't compile**  
Open DevTools (right-click → Inspect in the Tauri window during `npm run dev`) and check the console. GLSL compile errors appear there with line numbers.

**Slider moves but nothing changes**  
Check that the slider's `id` attribute matches the string in the `PARAMS` array exactly (case-sensitive).

**Canvas doesn't fill its column / wrong size**  
`cnv.parent('canvas-container')` in `setup()` must match the container div's id. Also ensure `#canvas-container` has `flex: 1` in CSS so it expands to fill available space.

**First build is very slow**  
Normal — Rust compiles all dependencies from source on the first build. Subsequent builds are fast.

---

## License

MIT
