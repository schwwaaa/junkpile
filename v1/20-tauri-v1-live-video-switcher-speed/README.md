# 20 · Tauri v1 Live Video Switcher

A standalone Tauri v1 + raw WebGL example that turns four reusable media slots into a compact software video switcher. Each source can be a generated test pattern, still image, looping video, or the shared live camera. Preview and Program buses feed GPU transitions, a lower-third/logo overlay, MediaRecorder capture, and PNG export.

## Run

```bash
npm install
npm run dev
```

On macOS, approve camera permission only when you assign a camera to a source slot.

## Signal flow

```text
Source 1 ┐
Source 2 ├─→ Preview / Program buses ─→ WebGL transition ─→ overlay ─→ stage
Source 3 ┤                                                       ├─→ MediaRecorder
Source 4 ┘                                                       └─→ PNG export
```

## Source rack

All four source slots support:

- Built-in animated test pattern
- Local PNG, JPEG, WebP, GIF, MP4, MOV, or WebM media
- Shared selectable webcam
- Muted looping video playback
- Per-slot speed control for generated patterns and loaded videos
- Play/pause control for loaded videos
- Live source resolution and transport telemetry

Only one camera stream is opened. Assigning it to another source moves the live input and restores the previous slot's generated pattern.

## Switching

- Independent Preview and Program rows
- Direct Program cuts
- Classic `CUT` operation that swaps Preview and Program
- `AUTO` transition using the chosen duration
- Manual T-bar
- Optional smooth easing
- Keyboard shortcuts:
  - `1`–`4`: select Preview source
  - `C`: cut
  - `Space`: auto transition

## GPU transitions

1. Dissolve
2. Horizontal wipe
3. Vertical wipe
4. Radial reveal
5. Box reveal
6. Noise dissolve
7. Luma melt

The four source textures stay resident in WebGL. The fragment shader chooses the active Program and Preview samplers, generates the transition mask, composites the overlay texture, and applies the final fade-to-black control.

## Program graphics

- Editable title and subtitle
- Accent and text colors
- Opacity and vertical position
- Optional transparent logo/bug image
- Program-only overlay; Preview and Multiview stay clean

The text and logo are drawn into a transparent 2D canvas, uploaded as a WebGL texture, and composited in the final fragment pass.

## Output and inspection

- Program view
- Preview view
- Four-source Multiview
- Program/Preview border colors in Multiview
- Master fade to black
- 30 or 60 fps canvas capture
- WebM or MP4 negotiation depending on WebView support
- Pause/resume recording
- Native Tauri save dialog
- PNG current-frame snapshots

## macOS permissions

`src-tauri/Info.plist` includes `NSCameraUsageDescription` and `entitlements.plist` enables the camera entitlement. Camera frames remain local to the application.

## Important WebView notes

- Supported video containers/codecs depend on the operating-system WebView.
- The recording container is selected from formats reported by `MediaRecorder.isTypeSupported()`.
- Source videos are muted so autoplay can begin without a browser gesture.
- Recording captures the rendered Program canvas, including transitions, lower thirds, logo, and fade-to-black.

## Project layout

```text
20-tauri-v1-live-video-switcher/
├── package.json
├── README.md
├── src/
│   ├── index.html
│   ├── styles.css
│   └── app.js
└── src-tauri/
    ├── Cargo.toml
    ├── Info.plist
    ├── entitlements.plist
    ├── tauri.conf.json
    ├── build.rs
    ├── icons/
    └── src/main.rs
```
