# 04 · Tauri v1 External GLSL Single Window

A focused raw-WebGL example where the fragment shader is stored as a real external project file and can be replaced at runtime without rebuilding the Tauri application.

This folder intentionally retains its original repository name:

```text
glsl-tauri-v1-single-template
```

The visible example number is **04** so it aligns with the complete Junkpile Tauri v1 Essentials sequence.

## What this example teaches

- Fetching an external `.frag` project asset at startup
- Reading a local GLSL file with the browser file API
- Compiling and linking replacement fragment shaders at runtime
- Keeping the last valid WebGL program active after a compile failure
- Understanding the uniform contract between JavaScript and an external shader
- Separating shader source from the application shell and renderer logic
- Reporting compiler and linker failures without turning the output into a blank window
- Controlling a native Tauri v1 window from JavaScript

## Signal flow

```text
src/shader.frag or local .frag/.glsl file
                    ↓
             fetch() / FileReader
                    ↓
       WebGL compile + program link
                    ↓
HTML controls → params → uniforms
                    ↓
             gl.drawArrays()
                    ↓
        WebGL canvas in one WebView
```

There is no WebSocket, second window, p5.js renderer, or native GPU surface.

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

Unsigned applications can trigger Gatekeeper on another Mac. Public distribution generally requires Apple signing and notarization.

## External shader workflow

The default fragment shader is:

```text
src/shader.frag
```

At startup, `src/sketch.js` requests that file with `fetch()` and compiles it. You can then:

- Press **Open shader** and select a `.frag`, `.glsl`, `.fs`, or text file.
- Drag a shader file into the renderer.
- Press **Recompile** to retry the currently loaded source.
- Press **Use project shader** or **Reload default** to fetch `shader.frag` again.

If a replacement fails, the diagnostics panel reports the compiler output and the previous valid shader continues rendering.

## Shader contract

A replacement fragment shader must target **GLSL ES 1.00 / WebGL 1** and should include:

```glsl
precision highp float;
varying vec2 vTexCoord;

void main() {
    gl_FragColor = vec4(vTexCoord, 0.0, 1.0);
}
```

The renderer supplies these uniforms:

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

A shader does not need to use every uniform. WebGL optimizes unused uniforms away, and the renderer safely skips missing locations.

## Common compatibility problems

The diagnostics panel recognizes several common reasons an imported shader may fail:

- `#version 300 es` WebGL 2 source
- Custom `out vec4` fragment outputs instead of `gl_FragColor`
- `texture()` instead of WebGL 1 `texture2D()`
- ShaderToy `mainImage()` and `iTime` / `iResolution` conventions
- `layout(...)` qualifiers
- `#include` directives
- Missing `void main()`
- Missing float precision declaration

The dedicated shader-playground examples later add full source editing and richer line navigation.

## Controls

| Section | Parameter | Purpose |
|---|---|---|
| Color | Hue shift | Rotates the default shader palette |
| Color | Saturation | Moves from monochrome to vivid color |
| Color | Brightness | Multiplies final output brightness |
| Motion | Zoom | Scales shader coordinates |
| Motion | Speed | Advances the accumulated animation clock |
| Motion | Distortion | Strengthens domain warping |
| Pattern | Complexity | Changes the default fBm octave count |
| Pattern | Symmetry | Changes rotational folding |
| Pattern | Glow | Brightens the center of the field |
| Switches | Invert | Inverts the default shader output |
| Switches | Pulse | Enables rhythmic brightness modulation |
| Switches | Rotate | Rotates the complete coordinate field |

Loaded shaders can ignore or reinterpret these values.

Keyboard shortcuts:

| Key | Action |
|---|---|
| Space | Pause or resume animation |
| R | Restore uniform defaults and reset time |
| C | Recompile the loaded shader source |
| O | Open the shader-file picker |
| F | Toggle native-window fullscreen |

## Project structure

```text
glsl-tauri-v1-single-template/
├── README.md
├── MODERNIZATION-NOTES.md
├── package.json
├── src/
│   ├── index.html
│   ├── shader.frag
│   ├── sketch.js
│   └── styles.css
└── src-tauri/
    ├── Cargo.toml
    ├── tauri.conf.json
    └── src/main.rs
```

## Why this remains a separate example

Example 02 embeds its fragment source directly in JavaScript. Example 04 establishes the external-asset workflow used by larger shader projects:

- shader code can be edited in a dedicated editor;
- shader files can be generated by another tool;
- source can be versioned or exchanged independently;
- the application shell does not need to be rebuilt to try a replacement.

## Known limitations

- The local file picker loads source into memory; it does not overwrite `src/shader.frag`.
- The imported source must be compatible with WebGL 1 / GLSL ES 1.00.
- The controls expose the default uniform contract rather than dynamically generating controls for arbitrary uniforms.
- Browser file APIs do not reveal the original file path to JavaScript.
- This example intentionally remains single-window and uses browser WebGL rather than native wgpu.
