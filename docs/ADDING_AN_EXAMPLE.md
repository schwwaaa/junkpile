# Adding an example

## Baseline first, unique example second

The repository should separate two stages:

1. **Baseline** — the smallest complete example of a technology or architecture.
2. **Unique example** — a creative behavior built on a known-good baseline.

Do not merge these stages so tightly that a developer cannot identify which code is integration and which code is artwork.

## Folder naming

Use a predictable name:

```text
<technology>-tauri-v<major>-<topology>-template
```

Examples:

```text
webgpu-tauri-v2-single-template
ndi-tauri-v2-ws-template
serial-tauri-v1-single-template
```

Use a clearer established family name when one already exists.

## Required files

Every new example must include:

- `package.json` with local Tauri CLI
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`
- commented Rust entry point
- commented frontend source
- local `README.md`
- lock files after dependency installation
- icon and bundle configuration

## Required README sections

- Purpose
- What a developer should learn
- Prerequisites
- Install, run, and build commands
- Architecture diagram
- Runtime data flow
- File map
- Inputs and outputs
- Extension checklist
- Tauri-generation notes
- Troubleshooting
- Screenshot
- Test status

## Commenting checklist

Comments should explain decisions and boundaries, not restate syntax.

Good comment topics:

- which layer owns a resource
- why a task runs in Rust or JavaScript
- message shapes and role handshakes
- shader uniform contracts
- framebuffer read/write ordering
- device lifecycle and cleanup
- version-specific APIs or config
- constraints that will break a port

## Baseline acceptance checklist

- [ ] `npm install` completes.
- [ ] `npm run dev` launches.
- [ ] `npm run build` completes.
- [ ] the core input path works.
- [ ] the visual path renders after resize.
- [ ] startup/shutdown releases devices and ports.
- [ ] code comments match behavior.
- [ ] README commands match the folder.
- [ ] diagram matches the implementation.
- [ ] platform status is explicit.

## Unique-example branch checklist

After the baseline is accepted:

- copy the baseline into a distinctly named project
- preserve the original integration path
- document the artistic behavior separately
- identify which files changed from the baseline
- include performance assumptions and failure modes
- keep controls meaningful rather than exposing every internal value
