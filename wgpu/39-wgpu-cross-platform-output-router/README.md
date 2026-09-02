# 39 · wgpu Cross-Platform Output Router

A native Tauri 2 + wgpu reference application that renders one authoritative GPU texture and routes it at runtime to multiple independent output sinks:

- Native preview
- NDI
- FFmpeg file recording
- Syphon on macOS
- Spout on Windows

This is the composition step after the isolated recording, NDI, preview, Syphon, and Spout examples. It deliberately excludes the quarantined FFmpeg RTSP/RTMP streaming implementation.

## Architecture

```text
Authoritative wgpu RGBA texture
├── Preview sink                    GPU presentation
├── NDI sink                        wgpu readback → BGRA → NDI worker
├── Platform-share sink
│   ├── macOS: Syphon               wgpu readback → BGRA → Metal → Syphon
│   └── Windows: Spout              wgpu readback → BGRA → D3D11 → Spout
└── Recording sink                  scaled texture → readback → FFmpeg
```

Every external output has its own lifecycle, bounded queue, status, and drop counters. A failing sink is intended to leave the authoritative renderer and other sinks running.

## Included profiles

| Hotkey | Route |
|---|---|
| `1` | Preview-only 1080p |
| `2` | Syphon/Spout 1080p60 |
| `3` | NDI 1080p60 |
| `4` | H.264 recording 1080p30 |
| `5` | NDI + Syphon/Spout + H.264 at 1080p30 |
| `6` | 4K30 ProRes + NDI + Syphon/Spout |
| `7` | Hidden preview with NDI + Syphon/Spout at 1080p60 |

Arming a profile configures the route. It does not automatically start external outputs.

## Requirements

### Common

- Rust stable
- Node.js
- Tauri CLI 2
- FFmpeg for recording

### NDI

Install the full NDI SDK, not only NDI Tools. On macOS, the build searches standard SDK locations or uses:

```bash
export NDI_SDK_DIR="/Library/NDI SDK for Apple"
```

### macOS Syphon

The universal `Syphon.framework` is bundled in `src-tauri/vendor/`. The project builds an Objective-C ARC bridge and embeds development and bundle-compatible runtime paths.

### Windows Spout

Install:

- Visual Studio 2022 Build Tools
- Desktop development with C++
- CMake

The project vendors the Spout2 source and builds a static Direct3D 11 bridge.

## Run

Full router:

```bash
npm install
npm run dev
```

Platform share without NDI:

```bash
npm run dev:no-ndi
```

Renderer, preview, and recording only:

```bash
npm run dev:renderer-only
```

## Recommended macOS test

1. Run `npm run dev`.
2. Arm profile `5`.
3. Click **Start active outputs**.
4. Select the NDI source in NDI Video Monitor.
5. Select the Syphon source in a Syphon receiver.
6. Confirm the recording file is being written.
7. Stop Syphon only; confirm NDI and recording continue.
8. Restart Syphon, then stop all outputs.
9. Verify the finalized recording.

## Recommended Windows test

1. Run `npm run dev` or `npm run dev:no-ndi`.
2. Arm profile `2` first.
3. Start Spout and select `Junkpile 39` in a Spout receiver or OBS Spout2 Capture.
4. Confirm 1080p60 is stable.
5. Test profile `5` for simultaneous recording, NDI, and Spout.
6. If a multi-GPU system selects the wrong adapter, edit `platformShare.adapterIndex` in the JSON profile.

## Configuration

The application seeds and watches a writable `io-profiles.json` in the operating system application-config directory. The active path is shown in the controls window.

Each profile declares:

```json
{
  "frame": { "width": 1920, "height": 1080 },
  "preview": { "enabled": true },
  "recording": {
    "enabled": true,
    "codec": "h264",
    "fps": 30,
    "workerDelayMs": 0
  },
  "ndi": {
    "enabled": true,
    "name": "Junkpile 39 NDI",
    "groups": null,
    "clockVideo": true,
    "fpsN": 30,
    "fpsD": 1,
    "vflip": false
  },
  "platformShare": {
    "enabled": true,
    "name": "Junkpile 39",
    "onlyWhenClients": true,
    "adapterIndex": -1,
    "fpsN": 30,
    "fpsD": 1,
    "vflip": false
  }
}
```

`onlyWhenClients` applies to Syphon. `adapterIndex` applies to Spout. They remain in the common schema so the same profile file can move between operating systems.

## Performance note

The current NDI, Syphon, and Spout implementations each use an independent GPU readback path. Simultaneous routes therefore multiply memory bandwidth. The 1080p profiles are the primary stable target. The 4K profile intentionally exposes pressure on peak hardware.

The confirmed Syphon behavior is:

- 1080p: smooth
- Above 1080p: functional but increasingly choppy with the current wgpu → CPU → Metal staging path

This is a staging-path limit, not a failure of Syphon discovery or publication.

## Streaming status

FFmpeg RTSP/RTMP streaming is not included. Example 29 remains quarantined because UDP pacing, RTSP 400 responses, and RTMP broken-pipe failures were not resolved reliably. This router does not import that code.
