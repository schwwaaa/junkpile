# 17 · Tauri v1 GLSL Shader Playground

A standalone Tauri v1 + raw WebGL 1 example for editing complete fragment shaders, compiling them live, inspecting diagnostics, controlling shared uniforms, saving shader files, and exporting PNG snapshots.

## What this example teaches

- Creating and replacing WebGL shader programs at runtime
- Compiling GLSL ES 1.00 inside the Tauri WebView
- Preserving the last valid GPU program when a new shader fails
- Normalizing WebGL compiler errors into readable line diagnostics
- Debouncing automatic compilation while source text is changing
- Passing reusable time, resolution, mouse, color, and generic uniforms
- Loading shader source through a file picker or drag-and-drop
- Saving text through Tauri v1's native save dialog and filesystem API
- Capturing the current WebGL framebuffer as a PNG


## Mini shader terminal

The editor includes a terminal-style compiler panel below the source. It records:

- Fragment compilation and program-link results
- Clickable source-line errors
- The last valid program retained after a failed compile
- File-load and paste events
- WebView runtime errors and unhandled promise rejections
- Compatibility hints for common pasted shader formats

The preflight inspection recognizes WebGL 2 / GLSL ES 3.00 declarations, `out vec4` fragment outputs, `texture()` calls, ShaderToy `mainImage`, `iTime`, `iResolution`, `iMouse`, and unsupported `#include` directives. These messages explain how the pasted source differs from this example's WebGL 1 / GLSL ES 1.00 contract.

Click any terminal error that includes a line number to select that source line in the editor.

## Shader contract

Every fragment shader receives:

```glsl
precision highp float;

varying vec2 v_uv;

uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;
uniform vec3 u_color_a;
uniform vec3 u_color_b;
uniform float u_param0;
uniform float u_param1;
uniform float u_param2;
uniform float u_param3;
```

The editor contains a complete fragment shader, including `precision`, uniforms, helper functions, and `main()`.

## Compile lifecycle

```text
Editor source
     │
     ├── automatic: 650 ms debounce
     └── manual: Compile / Cmd+Enter / Ctrl+Enter
                     │
                     ▼
              compile + link
                     │
          ┌──────────┴──────────┐
          │                     │
       success                failure
          │                     │
 replace active         retain previous
  GPU program            valid program
          │                     │
          ▼                     ▼
       preview           line diagnostics
```

A broken edit never blanks the graphics stage. The last successfully linked shader continues rendering until the source compiles again.

## Included presets

| Preset | Technique |
|---|---|
| Domain warp | Layered value noise and fractional Brownian motion |
| Orbital rings | Polar coordinates, repetition, and radial glow |
| Cellular field | Animated nearest-point / Voronoi-style distances |
| Spectral plasma | Interfering sine fields and spectral color mixing |
| Minimal gradient | Small readable starter shader |

Each preset also supplies useful values for the four generic parameters and two color uniforms.

## Editor controls

- Compile immediately
- Enable or disable automatic compilation
- Normalize brace indentation
- Reset the current built-in preset
- Insert two spaces with Tab
- Compile with Cmd+Enter or Ctrl+Enter
- Display live line and column position

## Runtime controls

- Time speed, including reverse motion
- Pause and reset time
- Internal render scale
- Optional normalized mouse input
- Four generic scalar uniforms
- Two RGB color uniforms

## File and capture flow

Shader files are read by the WebView file picker, so no native filesystem-read permission is required.

Native permissions are limited to:

- Save dialog
- File writing

Shader text is encoded with `TextEncoder` and sent through the same binary-write path used by the preceding image export examples.

Snapshots use the current internal canvas resolution and contain only the shader output.

## Run

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Project structure

```text
17-tauri-v1-glsl-shader-playground/
├── package.json
├── README.md
├── V1-FOLDER-MAP.md
├── src/
│   ├── index.html
│   ├── styles.css
│   └── app.js
└── src-tauri/
    ├── Cargo.toml
    ├── build.rs
    ├── tauri.conf.json
    ├── icons/
    └── src/
        └── main.rs
```

## WebGL 1 constraints

- Use `attribute` and `varying`, not WebGL 2 `in` and `out`
- Write fragment output through `gl_FragColor`
- Declare float precision in the fragment shader
- Prefer compile-time-constant loop bounds
- Avoid WebGL 2-only texture functions and language features

Unused uniforms may be optimized out by the shader compiler. The playground safely skips uploads to missing uniform locations.
