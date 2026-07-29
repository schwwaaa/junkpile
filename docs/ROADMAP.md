# Roadmap after the 78-example baseline

## Completed

- Tauri v1 00–25
- Tauri v2 WebView 00–25
- Native Rust/wgpu 00–25
- modernization of early v1 and v2 projects
- consistent standalone development/build documentation
- architecture, troubleshooting, diagnostics, and machine-readable catalog

## Next repository work

1. Merge this documentation package into the latest complete repository.
2. Verify every catalog path and local README link.
3. Capture screenshots and videos for representative examples.
4. Record a formal macOS/Windows/Linux validation matrix.
5. Tag and archive the completed baseline.

## Next architecture work

Extract proven patterns into Scheng rather than merging Junkpile wholesale into an application:

- canonical parameters and actions
- optional media input/output contracts
- native capture and decoding
- texture/resource pools
- render/compute graph scheduling
- feedback/history stores
- MIDI/OSC mapping
- presets, snapshots, sequences, and projects
- window, Syphon, Spout, recording, and future network outputs

## Product direction

Use Scheng components to build small, focused standalone applications—processors, keyers, feedback units, converters, recorders, routers, mixers, playback utilities, and artist instruments. A later master suite can route and synchronize them without becoming the only place they can run.
