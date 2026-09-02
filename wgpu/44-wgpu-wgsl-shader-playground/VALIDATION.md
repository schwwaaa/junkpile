# Validation Record

## Completed static checks

- `package.json` parses successfully.
- `tauri.conf.json` parses successfully.
- `assets/render.json` and `assets/params.json` parse successfully.
- All shader paths in `render.json` exist.
- All shader/profile relationships in `params.json` resolve.
- All twelve WGSL files contain the required vertex, fragment, uniform-binding, and parameter-vector contract.
- Every JavaScript `byId()` reference resolves to an HTML element.
- Every JavaScript `invoke()` command is registered by the Rust Tauri handler.
- JavaScript syntax passes `node --check`.
- Rust source delimiter balance is clean.
- The package contains no `target`, `node_modules`, recordings, or generated runtime-asset directories.
- The final ZIP passes archive integrity testing.

## Pending local checks

- First Cargo compilation.
- Native Open, Save, and Save As dialogs on macOS, Windows, and Linux.
- Manual compilation and auto-compile debounce.
- Invalid WGSL retention of the last-known-good pipeline.
- Saving a preset without changing active preset/profile state.
- Pause, resume, and time reset.
- 1080p, 4K, 5K, and 8K PNG exports.
- Fullscreen and resize behavior.
- Peak-profile performance on representative GPUs.
