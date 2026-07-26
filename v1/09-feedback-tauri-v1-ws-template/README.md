# 09 · Tauri v1 Feedback WebSocket

A modernized two-window Tauri v1 example demonstrating webcam-driven raw WebGL feedback over an embedded Rust WebSocket relay.

## What it demonstrates

- Separate controls and output WebViews
- Rust WebSocket relay on `127.0.0.1:2727`
- Camera capture owned by the output WebView
- Generated calibration source before camera permission
- Two-texture ping-pong framebuffer feedback
- Echo, fluid, reaction-diffusion, thermal, mirror, and glitch simulations
- Direct pointer injection into persistent GPU state
- Complete state restoration after either WebView reconnects
- Renderer, source FPS, resolution, buffer, GPU, shader, and camera telemetry

## Signal flow

```text
controls.html
    ↓ parameter/state messages
Rust WebSocket relay
    ↓
canvas.html
    ↓
source texture → simulation shader → history A/B → display shader → output
```

The output window owns both `getUserMedia()` and WebGL. A `MediaStream` is not transferred between Tauri WebViews.

## Run

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
```

On macOS, bundles are created below:

```text
src-tauri/target/release/bundle/
```

Unsigned local builds may be blocked by Gatekeeper when moved to another machine. Public distribution requires signing and notarization.

## Controls

- Select a simulation or preset.
- Start a camera or use the generated calibration source.
- Adjust decay, source injection, speed, scale, intensity, palette, and brush radius.
- Drag inside the output window to inject state directly.
- Change history resolution to trade quality for speed.
- Use the controls window to show, focus, or fullscreen the output.

## Keyboard shortcuts

- `Space`: pause/resume
- `X`: clear history
- `R`: reset
- `S`: resend complete state
- `F`: toggle output fullscreen

## Architecture notes

The controls coalesce slider changes into at most one WebSocket batch per animation frame. On connection, the output requests a full state snapshot. This restores parameters, pause state, camera request, and history resolution after reloads or reconnects.

The Rust relay remains renderer-agnostic: text messages are broadcast to other clients, while binary messages are routed to the `canvas` role.

## Known limitations

- Camera labels may remain generic until permission is approved.
- High history resolutions increase GPU bandwidth substantially.
- Camera formats and maximum capture sizes depend on WKWebView and the device driver.
- The relay is intentionally local and unauthenticated for educational use.
