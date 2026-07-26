# 05 · Tauri v1 External GLSL WebSocket

A two-window raw-WebGL example where the fragment shader is stored as an external project file, selected from the controls window, sent through an embedded Rust WebSocket relay, and compiled in a separate output WebView.

The repository folder remains:

```text
glsl-tauri-v1-ws-template
```

The visible number is **05** in the Junkpile Tauri v1 Essentials sequence.

## What this example teaches

- Loading an external `src/shader.frag` project asset
- Reading local `.frag` / `.glsl` files in the controls WebView
- Sending shader source and uniform state through a Rust WebSocket relay
- Compiling and linking replacement fragment shaders in a separate output window
- Keeping the last valid GPU program active after a failed replacement
- Reporting compiler results back to the controls window
- Re-synchronizing shader source and parameter state after either window reconnects
- Controlling a second native Tauri v1 window

## Signal flow

```text
src/shader.frag or local shader file
                  ↓
           Controls WebView
                  ↓ JSON source + uniforms
     ws://127.0.0.1:2727
                  ↓
          Embedded Rust relay
                  ↓
            Output WebView
                  ↓
       WebGL compile + link
                  ↓
             gl.drawArrays()
```

## Run

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
```

On macOS, bundles are written under:

```text
src-tauri/target/release/bundle/
```

Public distribution usually requires Apple signing and notarization.

## Shader workflow

The default shader is:

```text
src/shader.frag
```

The controls window can:

- open a `.frag`, `.glsl`, `.fs`, or text file;
- accept a dropped shader file;
- resend the current source;
- restore the project shader;
- display output compiler/linker results.

A failed shader does **not** replace the active program. The output window displays the compiler error while the previous valid shader continues rendering.

## Shader contract

Replacement source targets **GLSL ES 1.00 / WebGL 1** and should include:

```glsl
precision highp float;
varying vec2 vTexCoord;

void main() {
    gl_FragColor = vec4(vTexCoord, 0.0, 1.0);
}
```

The renderer supplies:

```glsl
uniform float u_time;
uniform vec2  u_resolution;
uniform float u_hue;
uniform float u_saturation;
uniform float u_brightness;
uniform float u_zoom;
uniform float u_distortion;
uniform float u_rotate;
uniform float u_complexity;
uniform float u_symmetry;
uniform float u_glow;
uniform float u_invert;
uniform float u_pulse;
```

Unused uniforms are safe; WebGL simply optimizes them away.

## Common imported-shader problems

The controls terminal points out common mismatches:

- `#version 300 es`
- custom `out vec4` fragment outputs
- `texture()` instead of `texture2D()`
- ShaderToy `mainImage()`
- ShaderToy `iTime`, `iResolution`, or `iMouse`
- `layout(...)` qualifiers
- unresolved `#include` directives
- missing `void main()`
- missing float precision declaration

## State recovery

When the output reconnects it sends `request_state`. The controls respond with:

1. the complete uniform snapshot;
2. paused/running state;
3. the current shader source and metadata.

This prevents an output reload from silently returning to stale controls or the wrong shader.

## Keyboard shortcuts

| Key | Action |
|---|---|
| Space | Pause/resume |
| R | Reset uniforms and time |
| S | Resend all state and shader source |
| O | Open shader picker |
| C | Recompile current shader |
| F | Toggle output fullscreen |

## Project structure

```text
glsl-tauri-v1-ws-template/
├── README.md
├── MODERNIZATION-NOTES.md
├── package.json
├── src/
│   ├── controls.html
│   ├── controls.css
│   ├── controls.js
│   ├── canvas.html
│   ├── canvas.css
│   ├── canvas.js
│   └── shader.frag
└── src-tauri/
    ├── Cargo.toml
    ├── tauri.conf.json
    └── src/main.rs
```

## Why this remains separate

Example 03 demonstrates two-window raw WebGL with an inline shader. Example 05 adds a transferable external-shader workflow: shader source can be edited, generated, exchanged, rejected safely, and re-synchronized independently of the application code.

## Known limitations

- Imported source is held in memory and does not overwrite `src/shader.frag`.
- The source must fit WebGL 1 / GLSL ES 1.00.
- Controls are based on the default uniform contract rather than arbitrary uniform reflection.
- Very large shader strings are sent as WebSocket text messages; this example is intended for normal fragment-shader source sizes.
- The relay is local-only and intentionally unauthenticated.
