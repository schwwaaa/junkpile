# 21 · Tauri v2 Projection Mapper

A standalone two-window projection-mapping foundation built with Tauri v2 and raw WebGL 1.

The controls WebView edits mapping state. A separate output WebView owns the WebGL canvas, camera capture, source decoding, calibration overlays, and physical display output.

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
- Native image/video open dialog
- Native operating-system drag-and-drop
- Security-safe Rust binary image loading
- Tauri asset-protocol video streaming
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
- Native monitor enumeration and display placement
- Dedicated output fullscreen control
- Hide/show output without destroying the controls window
- Native PNG snapshots
- Named local mapping presets
- JSON preset import/export
- Scroll-safe controls panel

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

## Native media paths

Images and videos intentionally use different loading routes:

```text
Image → Rust bytes → Blob URL → output WebGL texture
Video → runtime asset authorization → output video element → WebGL texture
```

This keeps image textures origin-clean while allowing videos to stream instead of being copied through IPC.

## Presets

Presets store the mesh, source transform, feathering, color compensation, calibration settings, generated-pattern choice, source speed, and framing mode.

Local media paths are intentionally not stored in presets. A preset saved while media is loaded restores the generated source and all mapping parameters.

## Camera permissions

The project includes a macOS camera usage description and camera entitlement. The first camera start may trigger an operating-system permission prompt. Device names often become available only after permission is granted.

## Notes

- Closing the output window hides it instead of destroying it; press **Show** to restore it.
- Projection geometry is rendered as real triangles. Moving mesh nodes changes the actual GPU vertex positions.
- Control updates are coalesced to one event per animation frame to avoid jumpy high-frequency input.
- PNG snapshots use the current physical output-canvas resolution.
- Native monitor movement and fullscreen operations are implemented in Rust rather than requiring broad frontend window permissions.
