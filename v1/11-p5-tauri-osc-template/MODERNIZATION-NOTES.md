# Modernization notes — V1 Example 11

Folder preserved: `p5-tauri-osc-template`

## Original lesson preserved

- Tauri v1
- Rust-owned UDP input
- `rosc` packet decoding
- Tauri events into JavaScript
- p5.js WebGL rendering
- OSC-address-driven visual parameters

## Modernized

- Current Junkpile Example 11 identity and interface
- Reliable initial control-panel scrolling
- Local npm-managed p5.js instead of a runtime CDN
- Restartable listener with local/LAN bind modes and editable port
- Clean shutdown and thread replacement when restarting
- Endpoint hints for loopback and LAN use
- Built-in encoded OSC test burst
- Structured argument, sender, packet-rate, and bundle telemetry
- Editable exact or wildcard address routes
- Four scaling modes
- OSC learn and persistent routes
- Manual fallback sliders and visual presets
- Stable numeric readouts
- Responsive p5 canvas, pause/reset/fullscreen, and keyboard shortcuts
- Signed and non-float OSC type inspection
- Standalone Cargo workspace boundary
- Correct product identifier, icons, and complete production documentation

## Deliberately not added

- OSC output
- Authentication
- Multiple listener ports
- Multiple windows
- Recording/export
- Native wgpu rendering

Those belong in later, more advanced examples. Example 11 remains a focused native-input bridge.
