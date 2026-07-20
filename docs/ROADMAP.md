# Roadmap

## Phase 1 — establish trustworthy baselines

- [x] inventory every current example
- [x] correct the root architecture description
- [x] add local documentation and diagrams to all examples
- [x] align missing code comments with the documentation
- [x] add a machine-readable example catalog
- [x] add a repeatable static audit script
- [ ] run development and release builds on macOS
- [ ] run development and release builds on Windows
- [ ] run development and release builds on Linux
- [ ] record camera, MIDI, OSC, and WebSocket lifecycle results
- [ ] add screenshots after runtime verification

## Phase 2 — close baseline gaps

1. Port the MIDI baseline to Tauri v2, including explicit v2 command/event permissions.
2. Port the OSC baseline to Tauri v2.
3. Add a WebGPU-in-WebView baseline as its own family.
4. Add a native wgpu baseline only after its surface/window architecture is proven and documented separately from WebView rendering.
5. Add automated CI checks for JavaScript, JSON, Rust formatting, and `cargo check` on a representative platform matrix.

## Phase 3 — unique examples built from accepted baselines

### Camera feedback instrument

Derived from the feedback two-window baseline. Add scene presets, MIDI/OSC control, recording, and projector-safe output while preserving the documented ping-pong core.

### Shader performance console

Derived from the GLSL two-window baseline. Add a shader editor, saved uniform layouts, compile history, and OSC control without hiding the runtime shader contract.

### MIDI scene sequencer

Derived from the MIDI baseline. Add controller learn, scene interpolation, and deterministic preset recall while keeping native device ownership in Rust.

### Networked visual node

Derived from the OSC and two-window baselines. Add explicit network configuration, sender allowlisting, and message schemas suitable for multiple visual machines.

## Rule for Phase 3

Do not call a unique project a new baseline. Its README should link to the baseline it derives from and list the application-specific changes.
