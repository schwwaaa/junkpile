# Validation Status

## Static validation performed

- parsed all JSON configuration files
- parsed frontend JavaScript with `node --check`
- verified every JavaScript `getElementById` reference exists in `index.html`
- verified every frontend `invoke()` command is registered in the Tauri handler
- checked runtime asset catalog references and built-in file counts
- checked Rust source delimiter balance
- confirmed package, Cargo, and Tauri version metadata agree
- confirmed no build output, recordings, logs, or runtime state are included in the archive

## Runtime validation required

- `cargo check`
- macOS launch and Metal renderer
- Windows launch and D3D12 renderer
- Linux launch and Vulkan renderer
- state restore after application restart
- custom asset-root selection across volumes
- log-file override and unwritable-path diagnostics
- state-write behavior on Windows replacement semantics
- shutdown persistence

## Expected result

The native renderer remains active while runtime configuration, state, and logging operations are performed. Invalid live shader edits must never replace the working pipeline.
