# Validation status

## Completed in the packaging environment

- `package.json` parsing
- `tauri.conf.json` parsing
- `Cargo.toml` parsing
- JavaScript syntax checks with Node
- HTML-to-JavaScript ID reference checks
- Rust source structural checks
- WGSL delimiter checks
- WGSL reserved-name checks for previously encountered `smooth` collision
- WGSL left-hand swizzle-assignment checks
- wgpu 29 pipeline-layout form (`Some(&layout)`, `immediate_size: 0`)
- wgpu 29 surface presentation form (`frame.present()`)
- ZIP integrity test

## Not available in the packaging environment

Rust and Cargo are not installed, and outbound DNS is unavailable. Therefore `cargo check`, WGSL compilation through Naga/wgpu, and a real GPU launch could not be performed here.

Your local run is the authoritative compiler and runtime validation:

```bash
npm install
npm run dev:metal
```

The project is pinned to the same versions used by the functioning examples 08–10:

```text
tauri       2.11.5
tauri-build 2.6.3
wgpu        29.0.4
```
