# External GLSL Shader · Tauri v2 · Single Window

> **Baseline:** external GLSL file baseline  
> **Tauri:** 2.x  
> **Window topology:** single window  
> **Input:** DOM controls + shader file  
> **Renderer:** raw WebGL 1 with a fragment shader loaded from `shader.frag`

## Purpose

A raw WebGL baseline that separates the artwork into an editable `.frag` file. The app loads, compiles, and reports shader errors at runtime; the two-window form can also send replacement shader source from the controls window.

This example is intentionally a baseline: it exposes the complete path from input to pixels without introducing an application-specific product architecture. Start here, confirm the baseline works, then replace the visual or input mapping with your own idea.

## What you should learn

- Fetch a shader asset from the Tauri frontend bundle.
- Compile replacement shader source at runtime and preserve the last valid program on failure.
- Surface GLSL compiler messages in the interface.
- Keep shader source separate from application and transport code.

## Architecture

```mermaid
flowchart LR
  Controls[DOM controls] --> Params[Shared params object]
  Params --> Render[JavaScript render loop]
  Render --> Shader[raw WebGL 1 with a fragment shader loaded from `shader.frag`]
  Shader --> Canvas[Canvas in one Tauri V2 window]
```

### Runtime data flow

1. The HTML creates the controls and canvas layout in one WebView document.
2. Input handlers write directly into the shared `params` object.
3. The JavaScript fetches `shader.frag`, compiles it, and reports compiler errors without discarding the last valid program.
4. The rendering path uploads the documented uniform contract on every frame.

## Prerequisites

1. Install the operating-system dependencies required by Tauri.
2. Install a current Rust toolchain with `rustup`.
3. Install Node.js and npm.
4. Install project dependencies from this directory.

```bash
npm install
npm run dev
```

Build an installable application with:

```bash
npm run build
```

## Controls and inputs

Shader file loading plus `hue`, `saturation`, `brightness`, `zoom`, `speed`, `distortion`, `complexity`, `symmetry`, `glow`, `invert`, `pulse`, and `rotate`.

The HTML control defaults and the JavaScript `params` defaults are intended to match. When adding a parameter, update both so a fresh launch and the first user interaction produce the same state.

## File map

| File | Responsibility |
|---|---|
| `package.json` | Node scripts and the project-local Tauri CLI version. |
| `src/index.html` | Single-window controls, canvas layout, and script loading. |
| `src/shader.frag` | Runtime-loaded GLSL ES 1.0 fragment shader. |
| `src/sketch.js` | Visual state, shaders, rendering loop, and UI/input integration. |
| `src-tauri/Cargo.toml` | Rust package metadata and native dependencies. |
| `src-tauri/build.rs` | Project metadata or source file. |
| `src-tauri/src/main.rs` | Tauri entry point. |
| `src-tauri/tauri.conf.json` | Tauri 2 window, frontend, security, and bundle configuration. |

Generated schemas, icon assets, and lock files are omitted from this table because they do not define the example's runtime architecture.

## Tauri 2.x notes

This project uses Tauri 2: `tauri = "2"`, the v2 configuration schema, top-level product metadata, `build.frontendDist`, and the v2 `app` configuration object. The visual pipeline still runs inside the WebView; Tauri 2 does not make this example a native wgpu renderer.

Read [`../../docs/V1_V2_ARCHITECTURE.md`](../../docs/V1_V2_ARCHITECTURE.md) for the repository-wide comparison.

## Extending the example

1. Replace `src/shader.frag` while preserving the documented uniform contract.
2. Change the uniform contract only after updating the JavaScript upload path.
3. Use the compile-error overlay as the starting point for a richer shader editor.

Before adding a unique behavior, preserve a runnable baseline commit or branch. This makes it possible to distinguish framework/integration failures from failures introduced by the new visual idea.

## Troubleshooting

| Symptom | Check |
|---|---|
| App does not start | Confirm the OS-specific Tauri prerequisites, run `npm install`, then run `npm run dev` from this project directory. |
| Blank or frozen canvas | Open the WebView developer tools, check shader compiler output, and confirm WebGL is available. |
| Replacement shader fails | Read the compiler overlay and preserve the expected uniform names and GLSL ES 1.0 syntax. |

## Screenshot placeholder

Add a screenshot after the example has been run on a target platform:

```text
docs/images/glsl-tauri-v2-single-template.png
```

Then replace this section with:

```markdown
![External GLSL Shader · Tauri v2 · Single Window running](../../docs/images/glsl-tauri-v2-single-template.png)
```

## Related examples

- Browse the complete comparison in [`../../docs/EXAMPLE_MATRIX.md`](../../docs/EXAMPLE_MATRIX.md).
- Use the paired Tauri 1 version to compare framework-generation changes.
- Use the paired two-window version to compare direct state with transport-based state.
