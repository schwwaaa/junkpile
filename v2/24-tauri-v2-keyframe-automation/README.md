# 24 · Tauri v2 Keyframe Automation

A standalone Tauri v2/WebGL example for animating visual parameters on an editable timeline, recording live changes, and saving complete automation projects.

## What this example teaches

- Parameter automation without a timeline framework
- Per-parameter keyframe tracks
- Linear, eased, and stepped interpolation
- Forward/reverse playback, looping, and ping-pong
- Live automation recording from slider movement
- Native Tauri v2 JSON project import/export
- Native project-file drag and drop
- Local visual presets versus complete automation projects
- WebGL rendering driven by evaluated timeline state

## Run

```bash
npm install
npm run dev
```

## Main workflow

1. Press **Play** to run the included demo animation.
2. Scrub the timeline or enter a time numerically.
3. Press the diamond beside any parameter to add a keyframe.
4. Double-click a track to place a key using its current value.
5. Drag keyframe diamonds horizontally to retime them.
6. Select a keyframe to edit time, value, and interpolation.
7. Enable **Arm automation** and move sliders while the timeline plays.
8. Export the complete project as JSON.
9. Reopen it through **Import project JSON** or drop the JSON file onto the app.

## Keyboard controls

| Key | Action |
|---|---|
| Space | Play or pause |
| Left / Right | Step by the current snap amount |
| K | Key every parameter at the playhead |

## Presets and projects

A **preset** stores only the current shader mode and parameter values in WebView `localStorage`.

A **project** stores the title, duration, playback settings, shader mode, current values, parameter tracks, and every keyframe time/value/interpolation.

Project files use:

```text
name.junkpile-automation.json
```

The v2 loader also accepts project files exported from the v1 Example 24.

## Native Tauri v2 features

- Official native open/save dialogs
- Native project-file drag and drop
- Rust text-file reading for imported JSON
- Bounded binary writes for project files and PNG snapshots
- Native fullscreen command
- Explicit Tauri v2 capability permissions

## Folder

```text
24-tauri-v2-keyframe-automation
```

## Architecture

```text
Timeline clock
    ↓
Per-track keyframe lookup
    ↓
Step / linear / eased interpolation
    ↓
Live parameter state
    ↓
WebGL uniforms
    ↓
Procedural output
```

Tracks without keyframes remain under manual slider control.
