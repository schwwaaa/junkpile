# 25 · Tauri v2 Multi-Display Output Manager

The final Tauri v2 Essential demonstrates how one controls WebView can manage three independent native WebGL output windows at the same time.

## What it demonstrates

- One controls window plus three persistent output windows
- Monitor enumeration through native Rust/Tauri v2 commands
- Moving and resizing each output to a selected display
- Per-output fullscreen, show, hide, focus, blackout, and snapshot actions
- Four procedural WebGL source routes shared by all outputs
- Independent source routing for every output
- One synchronized master epoch with per-output speed and phase offsets
- Independent zoom, pan, rotation, mirroring, grading, gamma, feathering, grid, and HUD controls
- Global show/hide, fullscreen/windowed, blackout/restore, and synchronization actions
- Complete layout storage in `localStorage`
- JSON layout import/export
- Chunked native PNG saving for large output windows
- Coalesced event broadcasts so slider movement does not flood Tauri IPC
- Output close requests hide the output instead of destroying its WebGL context

## Window architecture

```text
controls WebView
    │
    ├── multi-display-state ──► output-1 WebView / WebGL
    ├── multi-display-state ──► output-2 WebView / WebGL
    └── multi-display-state ──► output-3 WebView / WebGL

controls ── invoke ──► Rust monitor/window commands
outputs  ── status events ──► controls telemetry
```

Each output owns its own WebGL context. The controls window broadcasts one compact state object, and every output selects only the configuration matching its own Tauri label.

## Procedural source bank

- **A — Domain field:** layered procedural noise and domain warping
- **B — Orbital grid:** radial rings, spokes, and moving glow
- **C — Signal ribbons:** animated line fields and scan structure
- **D — Calibration pulse:** grid, crosshair, and radial test signal

## First test

1. Run the project.
2. Press **Refresh displays**.
3. Assign Outputs 1–3 to different displays where available.
4. Press **Move** for each output.
5. Choose a different source route for each output.
6. Press **Fullscreen** for each output.
7. Change the master speed and individual phase offsets.
8. Save the complete arrangement as a local layout.
9. Export the layout as JSON and capture a snapshot from each output.

## Run

```bash
npm install
npm run dev
```

## Tauri v2 implementation notes

- All four windows are declared in `src-tauri/tauri.conf.json`.
- Outputs 2 and 3 start hidden but are still persistent native windows.
- Native Rust commands enumerate displays and manage output visibility, placement, size, and fullscreen state.
- Cross-window control and telemetry use Tauri v2 events.
- Snapshot dialogs use the official dialog plugin; PNG bytes are written through bounded Rust IPC chunks.
- Closing an output hides it instead of destroying the WebView and WebGL context.
- The controls page scrolls normally even when all three expanded output cards exceed the viewport.
- The explicit `[workspace]` table prevents an unrelated parent Cargo workspace from absorbing this example.
