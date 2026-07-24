# 17 · Tauri v2 GLSL Shader Playground

A standalone Tauri v2 + raw WebGL 1 example for editing complete fragment shaders, compiling them live, inspecting a terminal-style diagnostic stream, controlling shared uniforms, loading/saving shader files through native dialogs, and exporting PNG snapshots.

## What this example teaches

- Creating and replacing WebGL shader programs at runtime
- Compiling GLSL ES 1.00 inside a Tauri v2 WebView
- Preserving the last valid GPU program when a new shader fails
- Converting WebGL compiler logs into readable line diagnostics
- Debouncing automatic compilation while source text changes
- Passing reusable time, resolution, mouse, color, and generic uniforms
- Loading UTF-8 shader source through Rust, browser file input, or native drag/drop
- Saving shader text and PNG snapshots with Tauri v2 native dialogs
- Using explicit Tauri v2 capabilities and commands

## Mini shader terminal

The terminal records:

- Fragment compile and program-link stages
- Clickable errors tied to source lines
- The last valid program retained after a failed compile
- Native dialog, browser file, drag/drop, paste, save, and snapshot events
- WebView runtime errors and unhandled promise rejections
- Compatibility guidance for common pasted shader formats

The preflight inspection recognizes:

- `#version 300 es`
- WebGL 2 `out vec4` fragment outputs
- `texture()` instead of WebGL 1 `texture2D()`
- ShaderToy `mainImage()`
- ShaderToy `iTime`, `iResolution`, and `iMouse`
- `layout(...)` qualifiers
- Unsupported `#include` directives
- Missing `void main()`
- Missing float precision

A `.frag` or `.glsl` extension does not determine shader compatibility. The terminal explains the actual GLSL dialect or contract mismatch.

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
       preview           terminal diagnostics
```

## Included presets

| Preset | Technique |
|---|---|
| Domain warp | Layered value noise and fractional Brownian motion |
| Orbital rings | Polar coordinates, repetition, and radial glow |
| Cellular field | Animated nearest-point / Voronoi-style distances |
| Spectral plasma | Interfering sine fields and spectral color mixing |
| Minimal gradient | Small readable starter shader |

## Tauri v2 file flow

```text
Native open / OS file drop
          │
          ▼
Rust read_shader_file command
          │ UTF-8 source string
          ▼
Editor → compile terminal → WebGL
```

Browser file input remains available as a fallback. Native and dropped shader files are limited to `.frag`, `.glsl`, `.fs`, and `.txt`, with an 8 MiB source safety limit.

Native permissions are limited to core IPC and open/save dialogs. The Rust backend exposes:

- `read_shader_file`
- `write_binary`
- `toggle_fullscreen`

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
17-tauri-v2-glsl-shader-playground/
├── package.json
├── README.md
├── V2-FOLDER-MAP.md
├── src/
│   ├── index.html
│   ├── styles.css
│   └── app.js
└── src-tauri/
    ├── Cargo.toml
    ├── build.rs
    ├── tauri.conf.json
    ├── capabilities/
    │   └── default.json
    ├── icons/
    └── src/
        └── main.rs
```

## WebGL 1 constraints

- Use `attribute` and `varying`, not WebGL 2 `in` and `out`
- Write fragment output through `gl_FragColor`
- Declare float precision in the fragment shader
- Prefer compile-time-constant loop bounds
- Avoid WebGL 2-only language and texture features

Unused uniforms may be optimized out. The playground safely skips uploads to missing uniform locations.
