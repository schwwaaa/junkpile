# Validation

Completed in the packaging environment:

- `package.json` and `tauri.conf.json` parse as JSON.
- `Cargo.toml` parses as TOML.
- `src/app.js` and `scripts/run-backend.mjs` pass `node --check`.
- Static HTML-ID-to-JavaScript-reference validation passes.
- Rust and WGSL delimiter checks pass.
- No `smooth` WGSL identifier is present.
- No `node_modules` or Rust `target` artifacts are included.

Not completed in the packaging environment:

- `cargo check`
- Native Metal, Vulkan, DX12, or GL execution

Rust/Cargo are not installed in the packaging container. The project is pinned to the same Tauri 2 and wgpu 29 versions used by the functioning examples 00–07. Local compilation remains the authoritative validation.
