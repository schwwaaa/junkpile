# Validation Record

## Completed static checks

- Project metadata and product names use filesystem-safe values.
- Tauri command names referenced by the frontend are registered in Rust.
- HTML element IDs referenced by JavaScript are present.
- JavaScript passes `node --check`.
- `appliance.json` and `io-profiles.json` parse as valid JSON.
- Appliance schema includes strict unknown-field rejection.
- Startup profile exists in the built-in I/O profile catalog.
- Profile hotkeys are unique.
- Status-file writes use a temporary file and replacement step.
- Recording output remains outside the watched source tree.
- No Example 29 or Example 40 network worker code is included.
- Vendored Syphon and Spout assets remain present.
- ZIP contains no Cargo target directory, Node modules, recordings, or generated status file.

## Pending local validation

- First Cargo compilation on macOS.
- NDI autostart discovery in official NDI Video Monitor.
- Syphon autostart discovery in a compatible receiver.
- Headless H.264 recording finalization.
- Timed shutdown with an active recorder.
- Packaged application behavior.
- Windows Spout compilation and runtime validation.
- Linux renderer/NDI/recording behavior where dependencies are available.
