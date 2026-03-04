# p5-tauri-ws-template

**A two-window Tauri + p5.js application connected via an embedded WebSocket relay.**

This template is a fully-commented, working starting point for building real-time creative applications where one window controls parameters and another window renders visuals — all within a single native desktop app, with no external server required.

---

## What this template demonstrates

| Window | Role | Does |
|--------|------|------|
| `controls.html` | `"controls"` | Sliders and toggles that send parameter updates |
| `canvas.html`   | `"canvas"`   | A p5.js WEBGL shader that receives and renders parameters |

Communication flows over an **embedded WebSocket relay** written in Rust, running inside the Tauri binary on `ws://127.0.0.1:2727`. No external server, no network, no install — just two windows talking to each other at 60fps.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)  
2. [Prerequisites](#prerequisites)  
3. [Project Structure](#project-structure)  
4. [Getting Started](#getting-started)  
5. [How the Two-Window System Works](#how-the-two-window-system-works)  
6. [The WebSocket Relay (Rust)](#the-websocket-relay-rust)  
7. [The Controls Window (HTML + JS)](#the-controls-window-html--js)  
8. [The Canvas Window (p5.js + GLSL)](#the-canvas-window-p5js--glsl)  
9. [Building Your Own Idea](#building-your-own-idea)  
10. [Common Patterns](#common-patterns)  
11. [Troubleshooting](#troubleshooting)  
12. [FAQ](#faq)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                   Tauri Desktop App                         │
│                                                             │
│   ┌─────────────────┐       ┌─────────────────────────┐    │
│   │  controls.html  │       │     canvas.html          │    │
│   │                 │       │                          │    │
│   │  ┌───────────┐  │  WS   │  ┌────────────────────┐ │    │
│   │  │  Sliders  │──┼──────▶│  │  p5.js + GLSL      │ │    │
│   │  │  Toggles  │  │       │  │  Fragment Shader    │ │    │
│   │  └───────────┘  │◀──────┼──│  (renders params)  │ │    │
│   │                 │       │  └────────────────────┘ │    │
│   └─────────────────┘       └─────────────────────────┘    │
│                                                             │
│            ┌──────────────────────────────┐                 │
│            │  Rust WebSocket Relay        │                 │
│            │  ws://127.0.0.1:2727         │                 │
│            │  • Tracks client roles       │                 │
│            │  • Routes text messages      │                 │
│            │  • Filters binary to canvas  │                 │
│            └──────────────────────────────┘                 │
└─────────────────────────────────────────────────────────────┘
```

**Key insight:** The two HTML windows share **no JavaScript state**. They communicate exclusively through WebSocket messages. This keeps them decoupled — either window can be refreshed or replaced independently.

---

## Prerequisites

You need a working Tauri v1 development environment.

### 1. Install Rust

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
```

### 2. Install system dependencies

**macOS:**
```bash
xcode-select --install
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt update && sudo apt install -y \
  libwebkit2gtk-4.0-dev \
  build-essential \
  curl \
  wget \
  file \
  libssl-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev
```

**Windows:**
- Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the "Desktop development with C++" workload.
- Install [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (usually pre-installed on Windows 10+).

### 3. Install Node.js

Download from [nodejs.org](https://nodejs.org/) (v18+ recommended), or use a version manager:
```bash
# Using nvm:
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 18
```

### 4. Install Tauri CLI

```bash
npm install   # installs @tauri-apps/cli from package.json
```

> **Verify your setup:** Run `npx tauri info` in the project root. It should show your Rust, Node, and system dependency versions without errors.

---

## Project Structure

```
p5-tauri-ws-template/
│
├── README.md                 ← You are here
│
├── package.json              ← Node project + Tauri CLI dependency
│
├── src/                      ← All frontend files (HTML, JS, CSS)
│   ├── controls.html         ← Control panel window
│   ├── controls.js           ← WebSocket sender + UI wiring
│   ├── canvas.html           ← Visual output window
│   ├── canvas.js             ← p5.js shader renderer + WebSocket receiver
│   └── p5.min.js             ← p5.js library (local copy)
│                               ↑ Download from: https://p5js.org/download/
│
└── src-tauri/                ← Rust + Tauri configuration
    ├── Cargo.toml            ← Rust dependencies
    ├── build.rs              ← Tauri build script (do not modify)
    ├── tauri.conf.json       ← Window definitions + app config
    └── src/
        └── main.rs           ← Rust WebSocket relay server
```

> **Important:** You need to download `p5.min.js` manually and place it in `src/`.  
> Get it from: https://p5js.org/download/ (click "p5.js complete")  
> Or via CDN: replace the `<script src="p5.min.js">` tag in `canvas.html` with:  
> `<script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.11.0/p5.min.js"></script>`

---

## Getting Started

### 1. Clone / download the template

```bash
git clone <repo-url> my-app
cd my-app
```

### 2. Install Node dependencies

```bash
npm install
```

### 3. Add p5.js

Download `p5.min.js` from [p5js.org/download](https://p5js.org/download/) and place it in `src/p5.min.js`.

### 4. Add placeholder icons

Tauri requires icon files to build. Create minimal ones:
```bash
# macOS/Linux — create 1×1 pixel PNG placeholders
mkdir -p src-tauri/icons
convert -size 32x32 xc:black src-tauri/icons/icon.png   # requires ImageMagick
cp src-tauri/icons/icon.png src-tauri/icons/32x32.png
cp src-tauri/icons/icon.png src-tauri/icons/128x128.png
```

Or copy your own icon files into `src-tauri/icons/`:
- `icon.png` (any size, used as fallback)
- `icon.icns` (macOS)
- `icon.ico` (Windows)

### 5. Run in development mode

```bash
npm run dev
```

This will:
1. Compile the Rust code (~1–2 min on first run, fast after that)
2. Launch the Tauri app with two windows: Controls (left) and Shader Output (right)
3. Enable hot-reload for the HTML/JS files

Move the sliders in the Controls window — you should see the shader update in real time in the Canvas window.

---

## How the Two-Window System Works

### The lifecycle of a parameter change

1. **User moves a slider** in `controls.html`

2. **`controls.js` fires an input event** and calls `sendParam('speed', 0.75)`

3. **A JSON message is sent** over WebSocket to the relay:
   ```json
   { "type": "param", "name": "speed", "value": 0.75 }
   ```

4. **The Rust relay receives the message** and broadcasts it to all other connected clients (the canvas window)

5. **`canvas.js` receives the message**, parses it, and updates the shared `params` object:
   ```js
   params['speed'] = 0.75;
   ```

6. **On the next p5 frame** (~16ms at 60fps), `draw()` reads `params.speed` and passes it to the shader:
   ```js
   shd.setUniform('u_time', (millis() / 1000.0) * params.speed);
   ```

7. **The GPU recomputes every pixel** using the new uniform value → visual updates

**Total latency:** typically under 5ms on the same machine.

### The hello handshake

When each window first connects, it sends:
```json
{ "type": "hello", "role": "controls" }
// or
{ "type": "hello", "role": "canvas" }
```

The relay stores this role. It uses it to:
- Route binary messages only to `"canvas"` clients (for streaming pixel data)
- (You can extend this for more sophisticated routing logic in `main.rs`)

### Message types

| `type` value | Sender | Description |
|---|---|---|
| `"hello"` | Both windows | Identifies the sender's role |
| `"param"` | controls window | A named parameter value update |

You can add your own message types. Just send any JSON and handle it in `ws.onmessage`.

---

## The WebSocket Relay (Rust)

**File:** `src-tauri/src/main.rs`

The relay is the most unusual part of this architecture — it's a WebSocket server embedded directly in the native app binary.

### Why an embedded relay?

Tauri's two windows run in separate WebView instances. They cannot share JavaScript variables directly. Options are:

| Approach | Complexity | Notes |
|---|---|---|
| Tauri event system | Low | Works but limited to Tauri's IPC protocol |
| **Embedded WebSocket relay** | Medium | Standard WebSocket API, works with any JS, full binary support |
| External Node.js server | High | Requires Node to be installed, separate process |

The embedded relay gives you the full WebSocket API in both windows, plus binary frame forwarding (useful for streaming video/audio data).

### Key code concepts in main.rs

**The ClientMap** — a thread-safe `HashMap` of all connected clients:
```rust
type ClientMap = Arc<Mutex<HashMap<SocketAddr, Client>>>;
```
`Arc` = reference-counted pointer (safe to share across threads)  
`Mutex` = mutual exclusion lock (only one task reads/writes at a time)

**Writer/Reader task split** — each connection spawns two async tasks:
```
connection → [writer task] ← channel ← [reader task] → broadcast
```
The reader processes incoming messages and pushes outgoing ones into a channel. The writer drains that channel to the socket. This prevents deadlocks.

**IPv4 + IPv6 dual binding** — the relay listens on both:
- `127.0.0.1:2727` (IPv4)
- `[::1]:2727` (IPv6)

Some operating systems (notably macOS) have their WebView connect via IPv6 even for `localhost`. Binding both ensures it always works.

### Modifying the relay

For most projects you won't need to touch `main.rs`. But if you want to:

- **Change the port:** Update `const PORT: u16 = 2727;` in `main.rs` AND `WS_URL` in both JS files.
- **Filter messages by role:** In `broadcast_text()`, check `c.role` before sending:
  ```rust
  if *addr != sender && c.role != "controls" {
      let _ = c.tx.send(Message::Text(txt.clone()));
  }
  ```
- **Add a third window:** No Rust changes needed. Just add it in `tauri.conf.json` and give it a new role string in its hello handshake.

---

## The Controls Window (HTML + JS)

**Files:** `src/controls.html`, `src/controls.js`

### Adding a new slider

**Step 1: Add the HTML** in `controls.html`:
```html
<div class="param-row">
  <label for="myParam">My Parameter</label>
  <input id="myParam" type="range" min="0" max="10" step="0.1" value="5.0">
  <span class="param-value" id="myParam-val">5.0</span>
</div>
```

**Step 2: Register it** in `controls.js` by adding the id to the `PARAMS` array:
```js
const PARAMS = [
    'hue',
    'saturation',
    // ...existing params...
    'myParam',  // ← add here
];
```

That's it for the controls side. The `wireControls()` function automatically:
- Attaches an `input` event listener to the slider
- Updates the `#myParam-val` display span
- Sends `{ "type": "param", "name": "myParam", "value": 7.3 }` on every change

### Adding a toggle (checkbox)

**Step 1: Add the HTML:**
```html
<div class="toggle-row">
  <label for="myToggle">My Toggle</label>
  <input id="myToggle" type="checkbox">
</div>
```

**Step 2: Add to `TOGGLES` array in `controls.js`:**
```js
const TOGGLES = [
    'invert',
    'pulse',
    'rotate',
    'myToggle',  // ← add here
];
```

Boolean values are sent as `true`/`false` and converted to `1.0`/`0.0` in `canvas.js` for GLSL compatibility.

---

## The Canvas Window (p5.js + GLSL)

**Files:** `src/canvas.html`, `src/canvas.js`

### p5.js in WEBGL mode

WEBGL mode enables the GPU shader pipeline:
```js
createCanvas(windowWidth, windowHeight, WEBGL);  // note the third argument
shd = createShader(VERT_SHADER, FRAG_SHADER);     // compile GLSL
shader(shd);                                       // activate shader
rect(-width/2, -height/2, width, height);         // draw full-screen quad
```

The fragment shader `FRAG_SHADER` runs on the GPU, once per pixel, 60 times per second.

### Understanding uniforms

Uniforms are how you pass data from JavaScript to GLSL:

```glsl
// In FRAG_SHADER (GLSL declaration):
uniform float u_speed;
uniform vec2  u_resolution;
```

```js
// In draw() (JavaScript, passes the value):
shd.setUniform('u_speed',      params.speed);
shd.setUniform('u_resolution', [width, height]);
```

**Types:**

| GLSL type | JS value | Example |
|---|---|---|
| `float` | `number` | `0.75` |
| `int` | `number` | `4` |
| `bool` | `number` | `1.0` or `0.0` |
| `vec2` | `[x, y]` | `[width, height]` |
| `vec3` | `[r, g, b]` | `[1.0, 0.5, 0.2]` |

### Adding a parameter to the shader

**Step 1: Declare the uniform** in `FRAG_SHADER`:
```glsl
uniform float myParam;
```

**Step 2: Use it** in the GLSL code:
```glsl
float value = sin(uv.x * myParam) * 0.5 + 0.5;
```

**Step 3: Set it from JavaScript** in the `draw()` function:
```js
shd.setUniform('myParam', params.myParam);
```

**Step 4: Set a default** in the `params` object:
```js
const params = {
    // ...existing params...
    myParam: 5.0,  // ← add default value
};
```

### The params object

```js
const params = {
    speed:      0.5,   // default value (shown before any slider is moved)
    // add your params here
};
```

When a WebSocket message arrives, canvas.js does:
```js
params[msg.name] = msg.value;
```

On the next draw() call (within 16ms), `params.speed` reflects the new value.

---

## Building Your Own Idea

### Workflow for a new project

1. **Define your parameters** — what knobs/sliders does your visual need? Write them as a list: `intensity`, `colorShift`, `warpAmount`, etc.

2. **Add them to `controls.html`** — one `<input type="range">` per parameter. Set sensible min/max/default values.

3. **Register them in `controls.js`** — add each id to `PARAMS` or `TOGGLES`.

4. **Set defaults in `canvas.js`** — add each parameter to the `params` object with its default value.

5. **Write your GLSL shader** — declare `uniform float yourParam;` for each, and use them in the fragment shader.

6. **Pass values in `draw()`** — `shd.setUniform('yourParam', params.yourParam);` for each uniform.

7. **Test** — `npm run dev`, move sliders, see results.

### Example: adding a "contrast" parameter

**controls.html:**
```html
<div class="param-row">
  <label for="contrast">Contrast</label>
  <input id="contrast" type="range" min="0" max="4" step="0.05" value="1.0">
  <span class="param-value" id="contrast-val">1.00</span>
</div>
```

**controls.js:**
```js
const PARAMS = [
    // ...existing...
    'contrast',
];
```

**canvas.js — params defaults:**
```js
const params = {
    // ...existing...
    contrast: 1.0,
};
```

**canvas.js — FRAG_SHADER:**
```glsl
uniform float u_contrast;

// In main():
col = (col - 0.5) * u_contrast + 0.5;
col = clamp(col, 0.0, 1.0);
```

**canvas.js — draw():**
```js
shd.setUniform('u_contrast', params.contrast);
```

### Swapping out the shader entirely

The template shader is a fractal noise visualiser. To use your own:

1. Replace the `VERT_SHADER` and `FRAG_SHADER` strings in `canvas.js`.
2. Keep the `u_time` and `u_resolution` uniforms — they're generally useful.
3. Remove uniforms you don't use; add new ones you do.
4. Update the `params` defaults and `setUniform()` calls in `draw()`.

The controls system and WebSocket relay work the same regardless of what shader you use.

### Beyond shaders: other p5.js renderers

The WebSocket system is completely independent of what you render. You can replace the GLSL shader with any p5.js drawing:

```js
// Instead of a shader, draw procedurally:
function draw() {
    background(0);
    fill(params.hue, params.saturation * 255, params.brightness * 255);
    ellipse(width/2, height/2, params.zoom * 200);
}
```

Or use p5's 2D canvas mode (remove the `WEBGL` argument from `createCanvas`).

### Streaming binary data (advanced)

The relay routes binary messages exclusively to `"canvas"` role clients. This makes it possible to stream raw image or audio data from the controls window to the canvas.

**Sending from controls.js:**
```js
// Get pixel data from an offscreen canvas
const imageData = ctx.getImageData(0, 0, w, h);
ws.send(imageData.data.buffer);  // send as binary ArrayBuffer
```

**Receiving in canvas.js:**
```js
ws.onmessage = async (event) => {
    if (event.data instanceof ArrayBuffer) {
        const blob = new Blob([event.data]);
        const bmp  = await createImageBitmap(blob);
        // draw bmp onto canvas...
    }
};
```

This is the pattern used in the original huff project to stream glitch-processed video frames.

---

## Common Patterns

### Pattern 1: Parameter with visual feedback

Show the current value next to the slider:
```html
<span class="param-value" id="speed-val">0.50</span>
```
The wiring in `controls.js` automatically updates `#<id>-val` on every change.

### Pattern 2: Animated time + speed

```js
// In draw():
shd.setUniform('u_time', (millis() / 1000.0) * params.speed);
```

```glsl
// In fragment shader:
float wave = sin(uv.x * 5.0 + u_time);
```

Moving the `speed` slider from 0 (frozen) to 2 (double speed) controls the animation rate.

### Pattern 3: Boolean toggle as GLSL conditional

```glsl
uniform float u_invert;  // 0.0 or 1.0

// In main():
col = mix(col, 1.0 - col, u_invert);
```

`mix(a, b, 0.0)` returns `a` (uninverted). `mix(a, b, 1.0)` returns `b` (inverted).

### Pattern 4: Re-sync on reconnect

In `controls.js`, `broadcastAll()` is called in `ws.onopen`. This means every time the connection re-establishes (including after the canvas window starts), it floods all current parameter values to sync the canvas state.

### Pattern 5: Adding a third window

1. Add a new `<window>` entry in `tauri.conf.json`:
   ```json
   {
       "label": "preview",
       "title": "Preview",
       "url": "preview.html",
       "width": 400,
       "height": 300
   }
   ```

2. Create `src/preview.html` with a WebSocket connection:
   ```js
   ws.send(JSON.stringify({ type: 'hello', role: 'preview' }));
   ```

3. Messages from other windows are forwarded to it automatically — no Rust changes needed.

---

## Troubleshooting

### "WebSocket: disconnected" / shader not updating

**Cause:** The relay hasn't started yet, or the port is blocked.

**Fix:**
1. Wait 1–2 seconds after app launch — the Rust relay starts asynchronously.
2. Check the terminal for `[template] listening on ws://127.0.0.1:2727`.
3. Make sure no other application is using port 2727.
4. On Linux, check firewall: `sudo ufw status`

### First Rust build takes forever

**This is normal.** Rust compiles all dependencies from source on the first build. Subsequent builds are incremental and take 2–5 seconds.

### Canvas stays black / shader doesn't render

**Common causes:**
1. Missing `p5.min.js` — place it in `src/` as described in [Getting Started](#getting-started).
2. GLSL compile error — open browser DevTools (right-click canvas → Inspect) and check the console for shader errors.
3. Wrong uniform name — the `setUniform()` name must exactly match the `uniform` declaration in the shader.

### Slider moves but nothing changes

1. Check the WS status pill in the controls window — must show "connected".
2. Open the canvas window's DevTools console — look for `[canvas] received: {…}` messages.
3. Verify the parameter id in `PARAMS` matches the `<input id="...">` attribute.

### "tauri info" shows missing dependencies

Follow the [Prerequisites](#prerequisites) section for your OS. On Linux, the most common missing dependency is `libwebkit2gtk-4.0-dev`.

### Port conflict

If another app uses port 2727, change the port in three places:
1. `main.rs`: `const PORT: u16 = 2727;`
2. `controls.js`: `const WS_URL = 'ws://127.0.0.1:2727';`
3. `canvas.js`: `const WS_URL = 'ws://127.0.0.1:2727';`

---

## FAQ

**Q: Why not use Tauri's built-in event system instead of WebSocket?**  
A: Tauri's event system (`emit`/`listen`) works but goes through the Rust process as a bridge. The WebSocket approach keeps everything in JavaScript, is easier to debug in browser DevTools, and naturally supports binary data (e.g. video frames).

**Q: Can I use this without Tauri — just in a browser?**  
A: The HTML/JS files work in a browser if you run a local WebSocket server. The `ws-server.js` in the original huff project is a Node.js equivalent you can use:
```bash
node src/ws-server.js  # requires: npm install ws
```
Then open `controls.html` and `canvas.html` in two browser windows.

**Q: Why does the relay bind both IPv4 and IPv6?**  
A: macOS's WebView (WKWebView) sometimes resolves `localhost` to `::1` (IPv6) even when the server only binds `127.0.0.1` (IPv4). Binding both prevents silent connection failures.

**Q: Can I add audio?**  
A: Yes. Use the p5.js Sound library or the Web Audio API in `canvas.js`. Receive parameters from the controls window the same way (speed → oscillator frequency, brightness → volume, etc.).

**Q: What's the maximum number of windows?**  
A: Tauri v1 supports multiple windows — add them to `tauri.conf.json`. Each connects as a WebSocket client. The relay broadcasts to all of them.

**Q: Can two canvas windows receive the same stream?**  
A: Yes — since binary messages are forwarded to all clients with `role="canvas"`, two canvas windows both receive every binary frame.

**Q: How do I package this for distribution?**  
A: Run `npm run build`. Tauri produces a `.dmg` (macOS), `.msi` (Windows), or `.AppImage` (Linux) in `src-tauri/target/release/bundle/`. The app is fully self-contained — no Node, Rust, or WebSocket server required on the end user's machine.

---

## Inspired by

This template is extracted and generalised from the **huff** project — a real-time datamosh and glitch-art engine built with Tauri v1 + p5.js. huff uses this same two-window + WebSocket relay architecture to stream processed video frames from a controls window to a fullscreen visual output.

---

## License

MIT — use freely in personal and commercial projects.
