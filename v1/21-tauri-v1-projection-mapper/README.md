# 21 · Tauri v1 Projection Mapper

A standalone two-window projection-mapping foundation built with Tauri v1 and raw WebGL 1.

The controls WebView edits the mapping state. A separate output WebView owns the WebGL canvas, source media, camera capture, fullscreen state, display placement, and PNG export.

## Signal path

```text
Image / video / camera / generated pattern
                    ↓
           Source framing + transform
                    ↓
       Editable 2×2 / 3×3 / 5×5 mesh
                    ↓
         Edge feather + black-level trim
                    ↓
         Calibration grid / point overlay
                    ↓
          Dedicated projection window
```

## Included

- Separate controls and projection-output windows
- Generated calibration, color, ring, and moving-bar sources
- Local image and looping-video loading
- Selectable webcam input
- Per-source speed and contain/cover/stretch framing
- Four-corner pinning through the 2×2 grid
- 3×3 and 5×5 subdivision meshes for irregular surfaces
- Direct node dragging
- Numeric X/Y adjustment for the selected node
- Arrow-key point nudging
- Optional boundary locking
- Source zoom, pan, rotation, and mirroring
- Independent left/right/top/bottom edge feathering
- Black-level compensation, brightness, and gamma
- Output calibration grid, center crosshair, and mesh-point markers
- Output blackout
- Monitor enumeration and display placement
- Dedicated output fullscreen control
- Hide/show output without destroying the mapping window
- Native PNG snapshots
- Named local mapping presets
- JSON preset import/export

## Run

```bash
npm install
npm run dev
```

The application opens two windows:

1. **Projection Mapper Controls** — keep this on the operator display.
2. **Projection Output** — move this to the projector or secondary display.

For multi-display use:

1. Select a display in **Output window**.
2. Press **Move to display**.
3. Press **Fullscreen output**.
4. Enable **Output grid** while aligning the physical surface.
5. Disable calibration before presenting content.

## Mesh editor

The green dashed rectangle marks the normal output bounds. Nodes may move beyond those bounds when overscan or off-screen cropping is useful.

- Drag a node to reposition it.
- Double-click a node to restore only that node.
- Use arrow keys for fine movement.
- Hold Shift with an arrow key for larger movement.
- Choose **2 × 2 corners** for standard four-corner pinning.
- Choose **3 × 3** or **5 × 5** for curved or irregular projection surfaces.

## Presets

Presets store the mesh, source transform, feathering, color compensation, calibration settings, generated-pattern choice, source speed, and framing mode.

Loaded image/video object URLs are intentionally not persisted because those URLs are valid only for the current application session. A preset that was saved while media was loaded restores the generated source and all mapping parameters.

## Camera permissions

The project includes the macOS camera usage description and camera entitlement inherited from the tested camera examples. The first camera start may trigger an operating-system permission prompt. Device names often become available only after permission is granted.

## Notes

- The output window intercepts its close action and hides itself, allowing **Show** to restore it.
- Projection geometry is rendered as real triangles. Changing mesh nodes changes the actual GPU vertex positions.
- The control panel sends updates through Tauri events at most once per animation frame to avoid jumpy high-frequency input.
- PNG snapshots are captured at the current physical output-canvas resolution.
