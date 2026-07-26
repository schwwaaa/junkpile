# Modernization notes · V1 Example 10

This pass updates the original `p5-tauri-midi-template` so it matches the current Junkpile educational and interface standards without replacing its core architecture.

## Preserved

- Original folder name
- Tauri v1
- Rust `midir` input bridge
- Tauri event emission into one WebView
- p5.js WebGL rendering
- Hardware CC, note, and pitch-bend control concepts

## Changed

- Added the current Junkpile Example 10 identity and visual shell
- Fixed controls scrolling from the initial layout pass
- Replaced the runtime p5 CDN with a pinned npm-managed local copy
- Added editable MIDI learn and persistent CC mappings
- Added manual controls for every shader parameter
- Added port refresh, debug reporting, and clear connection states
- Added note, pitch-bend, and CC meters
- Added a structured mini MIDI terminal
- Added pause, reset, presets, shortcuts, and native fullscreen
- Added responsive p5 canvas resizing and renderer telemetry
- Improved Rust message parsing with signed 14-bit pitch bend
- Added a standalone Cargo workspace boundary
- Updated identifiers, icons, documentation, and production-build guidance

## Intentional scope

This remains a focused one-window MIDI input example. It does not add OSC, recording, media loading, multiple windows, or native wgpu.
