# 24 · Tauri v1 Keyframe Automation

A standalone Tauri v1/WebGL example for animating visual parameters on an editable timeline.

## What this example teaches

- Parameter automation without a framework
- Per-parameter keyframe tracks
- Linear, eased, and stepped interpolation
- Timeline playback, reverse playback, looping, and ping-pong
- Live automation recording from slider movement
- Project serialization and restoration
- Local visual presets versus complete automation projects
- WebGL rendering driven by the evaluated timeline state

## Run

```bash
npm install
npm run dev
```

## Main workflow

1. Press **Play** to run the included demo animation.
2. Scrub the timeline or enter a time numerically.
3. Press the diamond beside any parameter to add a keyframe.
4. Double-click a track to place a keyframe using its current value.
5. Drag keyframe diamonds horizontally to retime them.
6. Select a keyframe to edit its time, value, and interpolation.
7. Enable **Arm automation** and move sliders while the timeline plays to record changes.
8. Export the complete project as JSON.

## Keyboard controls

| Key | Action |
|---|---|
| Space | Play or pause |
| Left / Right | Step by the current snap amount |
| K | Key every parameter at the playhead |

## Presets and projects

A **preset** stores only the current shader mode and parameter values. Presets are stored in WebView `localStorage`.

A **project** stores:

- Project title
- Timeline duration
- Playback rate
- Loop and ping-pong settings
- Shader mode
- Current values
- Every parameter track
- Every keyframe time, value, and interpolation type

Project files use the extension pattern:

```text
name.junkpile-automation.json
```

## Folder

```text
24-tauri-v1-keyframe-automation
```

## Architecture

```text
Timeline clock
    ↓
Per-track keyframe lookup
    ↓
Interpolation: step / linear / ease
    ↓
Live parameter state
    ↓
WebGL uniforms
    ↓
Procedural shader output
```

The renderer remains active when a track has no keys. Unautomated parameters stay under manual slider control.
