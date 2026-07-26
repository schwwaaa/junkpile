# 02 · Tauri v1 Raw WebGL Single Window

A focused foundation for running a GLSL ES 1.00 shader through raw WebGL inside one Tauri v1 WebView.

This folder intentionally retains its original repository name:

```text
webgl-tauri-v1-single-template
```

The visible example number is **02** so it aligns with the complete Junkpile Tauri v1 Essentials sequence.

## What this example teaches

- Creating a WebGL 1 context without p5.js or another graphics framework
- Compiling vertex and fragment shader stages
- Linking a complete GPU program
- Uploading full-screen quad geometry into an array buffer
- Resolving vertex attributes and shader uniforms
- Driving a render loop with `requestAnimationFrame()`
- Resizing the real WebGL drawing buffer with its containing panel
- Recovering from WebGL context loss
- Calling a small Rust command from JavaScript to control the native window

## Signal flow

```text
HTML range / checkbox
        ↓
     params{}
        ↓
requestAnimationFrame()
        ↓
gl.uniform*()
        ↓
gl.drawArrays()
        ↓
GLSL fragment shader
        ↓
WebGL canvas in the same WebView
```

There is no WebSocket, inter-window relay, p5.js renderer, or native GPU surface.

## Run

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
```

On macOS, generated bundles are placed under:

```text
src-tauri/target/release/bundle/
```

Unsigned builds may trigger Gatekeeper on another Mac. Public distribution generally requires Apple signing and notarization.

## Controls

| Section | Parameter | Purpose |
|---|---|---|
| Color | Hue shift | Rotates the shader palette |
| Color | Saturation | Moves from monochrome to vivid color |
| Color | Brightness | Multiplies final output brightness |
| Motion | Zoom | Scales shader coordinates |
| Motion | Speed | Advances the accumulated animation clock |
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
| C | Recompile the shader program |
| F | Toggle native-window fullscreen |

## Project structure

```text
webgl-tauri-v1-single-template/
├── README.md
├── MODERNIZATION-NOTES.md
├── package.json
├── src/
│   ├── index.html
│   ├── sketch.js
│   └── styles.css
└── src-tauri/
    ├── Cargo.toml
    ├── tauri.conf.json
    └── src/main.rs
```

## Raw WebGL bootstrap

The complete setup is visible in `src/sketch.js`:

1. `canvas.getContext('webgl')`
2. `gl.createShader()` and `gl.compileShader()`
3. `gl.createProgram()` and `gl.linkProgram()`
4. `gl.createBuffer()` for a four-vertex full-screen quad
5. `gl.getAttribLocation()` and `gl.vertexAttribPointer()`
6. `gl.getUniformLocation()` and `gl.uniform*()` every frame
7. `gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)`

The small diagnostics panel reports shader compilation and link status. The dedicated shader-playground examples later provide source editing and richer error parsing.

## Add a new shader parameter

1. Add a range input and matching `<output>` in `src/index.html`.
2. Add its default to `DEFAULT_PARAMS` in `src/sketch.js`.
3. Add its ID to `SLIDER_IDS`.
4. Declare a matching uniform in `FRAG_SHADER`.
5. Upload it in `render()` with `uniform1f()` or `uniform2f()`.
6. Use the uniform in the shader.

## GLSL ES 1.00 note

WebGL 1 requires fixed compile-time loop bounds. The `fbm()` function loops to a fixed maximum of eight iterations and exits early using the float `u_complexity` uniform.

## Known limitations

- This example is deliberately single-window.
- It uses browser WebGL rather than native wgpu.
- The drawing buffer uses CSS-pixel dimensions for predictable performance.
- Uniform locations are resolved by the helper during each frame to keep the educational path obvious; production engines usually cache them.
