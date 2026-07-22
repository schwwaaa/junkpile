# Validation status

## Completed in the generation environment

- `package.json` and `tauri.conf.json` JSON parsing
- `Cargo.toml` parsing
- JavaScript syntax checks with Node.js
- HTML parsing
- Rust delimiter and string/comment-aware structural checks
- WGSL delimiter structural checks
- Embedded PNG integrity check
- Scan for obsolete calls previously encountered during wgpu 29 migration
- ZIP integrity tests

## Requires local validation

The generation environment does not contain Rust/Cargo and cannot download a toolchain because outbound DNS is unavailable. Therefore `cargo check`, shader-module validation by wgpu/Naga, and live GPU execution must be performed locally.

Recommended order:

```bash
cd 04-wgpu-image-texture && npm install && npm run dev
cd ../05-wgpu-ping-pong-feedback && npm install && npm run dev
cd ../06-wgpu-multipass-render-graph && npm install && npm run dev
cd ../07-wgpu-high-resolution-lab && npm install && npm run dev
```

Test `07` at window resolution and 1080p before selecting 4K or 8K.
