# Validation Record

## Static checks completed

- `package.json` parsed
- `tauri.conf.json` parsed
- `config/io-profiles.json` parsed
- JavaScript syntax checked with Node.js
- every `byId()` frontend reference resolves to an HTML element
- Rust delimiter balance checked across all source modules
- Tauri command names cross-checked against frontend calls
- NDI source module copied from the locally confirmed working Example 32 implementation
- NDI macOS rpath build script preserved
- recording modules copied from the working Example 31 revision
- old Example 31 product identifiers and default output paths removed
- build artifacts excluded

## Runtime checks required locally

1. Compile with the installed NDI SDK.
2. Confirm all six profiles arm.
3. Confirm NDI-only monitoring.
4. Confirm recording-only output and finalization.
5. Confirm simultaneous NDI and recording.
6. Stop each sink independently while the other continues.
7. Confirm hidden preview does not stop NDI.
8. Confirm invalid profile JSON preserves the previous valid list.
9. Confirm custom output directory persistence.

## Environment limitation

Cargo and the native NDI SDK are unavailable in the artifact-generation environment, so Rust compilation and native runtime validation must occur on the target machine.
