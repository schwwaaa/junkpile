# Documentation and commenting standard

## Goal

A developer should be able to answer four questions without reverse-engineering the whole project:

1. What does this example prove?
2. Which process or layer owns each responsibility?
3. How does a user action or device message reach the renderer?
4. Where should a developer make the first safe modification?

## Code comments

Use file headers to describe architecture and section comments to mark the path through the implementation.

Prefer comments that explain:

- intent
- ownership
- lifecycle
- contracts
- ordering constraints
- version differences
- extension points

Avoid comments that merely translate a line of code into English.

## Documentation/code alignment

When code changes, update all affected locations:

- local project README
- root example matrix if architecture/status changed
- architecture guide if a shared pattern changed
- comments beside the changed implementation
- screenshot if visible behavior changed

## Terminology

Use these terms consistently:

- **single-window** — controls and renderer share one WebView document
- **two-window** — controls and canvas are separate Tauri windows
- **relay** — Rust loopback WebSocket server
- **renderer** — JavaScript/p5/WebGL code that produces pixels
- **shader source** — GLSL text compiled by WebGL
- **feedback state** — persistent texture data carried between frames
- **baseline** — minimal complete technology demonstration
- **unique example** — an artistic/application behavior derived from a baseline

## Diagrams

Mermaid diagrams are the canonical editable source. Keep them small enough to render in GitHub and include exact transport names or ports when those details are architectural.

## Test claims

Use evidence-based labels. Do not claim stable, cross-platform, or production-ready without a recorded test matrix.
