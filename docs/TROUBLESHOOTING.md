# Troubleshooting

## Wrong Tauri CLI generation

Symptom: configuration-schema errors, unknown fields, or dependency resolution that mentions the wrong major.

Use the local npm script from inside the project:

```bash
npm install
npm run dev
```

Do not launch a v1 project with a global v2 CLI or a v2 project with a global v1 CLI.

## WebSocket port already in use

Symptom: controls and canvas remain disconnected, while the Rust console reports a bind error.

Only one WS example can use port `2727` at a time. Stop the other app or change:

- `PORT` in `src-tauri/src/main.rs`
- `WS_URL` in both frontend clients

## Shader compilation failure

Read the exact GLSL compiler log. Common WebGL 1 constraints include:

- GLSL ES 1.0 syntax
- compile-time constant loop bounds
- matching varying declarations
- expected precision declarations
- no unsupported WebGL 2 functions or types
- uniform names matching the JavaScript upload code

## Blank p5 canvas

- Confirm the p5.js CDN request succeeded.
- Check the CSP permits cdnjs.
- Open developer tools for JavaScript errors.
- Confirm `createCanvas(..., WEBGL)` and shader compilation completed.

## Blank raw WebGL canvas

- Check `canvas.getContext("webgl")` returned a context.
- Check both shader stages compiled and the program linked.
- Check the canvas width/height are nonzero.
- Check `gl.viewport()` matches the drawing buffer.
- Check the full-screen quad buffer and attribute location.

## Camera permission or device failure

- Grant permission at the OS level.
- Refresh the device list after the first permission grant; labels may be hidden before permission.
- Stop other applications that may own the device.
- Confirm the hidden video element reaches a ready state.
- Confirm `texImage2D()` receives a valid video frame.

## Feedback clears after resize

This is expected. Framebuffer textures are recreated at the new dimensions, so accumulated state is lost. Preserve state only by explicitly resampling the old buffer into the new one.

## MIDI device missing

Use the example's debug action to print the exact port names Rust sees. Match by the reported name rather than the marketing name on the hardware.

## OSC sender appears connected but nothing moves

OSC over UDP has no connection handshake. Verify host, port, address, and argument type. Use the on-screen log to distinguish unmapped addresses from packets that never arrived.
