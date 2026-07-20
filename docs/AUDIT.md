# Repository audit

## Scope reviewed

The repository contains 22 independent Tauri projects across `v1/` and `v2/`. The audit compared project names, frontend files, Rust entry points, Cargo dependencies, Tauri configuration schemas, window definitions, input paths, and documentation coverage.

## Primary findings

### 1. The former root README did not match the repository

It described four p5/Tauri v1 templates and four native wgpu/Tauri v2 templates. The actual repository contains p5, raw WebGL, external GLSL, webcam, feedback, MIDI, and OSC examples. No `wgpu` dependency, WGSL renderer, or native surface module exists in the current tree.

### 2. The actual inventory is 22 examples

- 12 Tauri v1
- 10 Tauri v2
- 10 paired v1/v2 concepts
- MIDI and OSC only in v1

### 3. Rendering remains WebView-based in both generations

The v2 projects change Tauri generation, configuration, and dependency layout while retaining JavaScript/WebGL rendering.

### 4. Comment coverage was strong but inconsistent

Many rendering files already contained detailed architectural comments. Several minimal Rust entry points and some HTML entry documents lacked equivalent file-level context. Those gaps were standardized without changing rendering behavior.

### 5. One version label was incorrect

The Tauri v1 raw WebGL single-window HTML identified itself as v2 in its file comment, title, and footer. It has been corrected to v1.

### 6. Development commands should use the local npm CLI

Every project declares the matching `@tauri-apps/cli` major. The documentation now uses `npm run dev` and `npm run build` to avoid global v1/v2 CLI collisions.

## Static validation performed

- all JavaScript source files parsed with `node --check`
- all JSON project/configuration files parsed
- all expected project folders and primary source files were inventoried
- Tauri v1/v2 dependency majors were compared with their configuration schema
- all 22 examples now contain a local README
- documentation links and screenshot placeholders were generated
- version-string mismatches were scanned

## Validation not performed in this environment

Rust and Cargo were not available in the analysis environment, so `cargo check`, `npm run dev`, and `npm run build` could not be executed here. Camera, MIDI, OSC, WebSocket lifecycle, release bundling, and platform-specific behavior therefore still require runtime verification.

## Recommended next validation pass

1. Test one minimal single-window project in each Tauri generation.
2. Test one WS project in each generation, including reconnect and shutdown.
3. Test webcam and feedback on every target OS.
4. Test MIDI and OSC on the hardware/network setup developers will actually use.
5. Record results using the template in `DEVELOPMENT.md`.
6. Only then assign maturity labels such as build verified or cross-platform verified.
