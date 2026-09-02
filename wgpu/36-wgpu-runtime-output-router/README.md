# Junkpile 36 — wgpu Runtime Output Router

A native Tauri 2 + wgpu reference application that routes one authoritative GPU texture to independent preview, NDI, and FFmpeg recording sinks.

This example composes the working concepts established by Junkpile Examples 27, 28, 31, 32, and 33:

- one authoritative offscreen texture
- runtime-selectable output profiles
- local preview as a separable sink
- bounded NDI sender queue
- bounded FFmpeg recording queue
- independent sink start/stop lifecycle
- per-sink drop and pressure telemetry
- custom recording output directory
- strict JSON profile validation and hot reload
- last-known-good profile retention
- hidden-preview/offscreen output route

Streaming code from the quarantined Example 29 is intentionally not included.

## Architecture

```text
WGSL source shader
        ↓
authoritative wgpu RGBA texture
        ├── preview surface       GPU presentation
        ├── NDI readback          RGBA → BGRA → bounded worker → NDI
        └── recording readback    reusable buffers → bounded worker → FFmpeg
```

A slow or failed output does not own the renderer. Each sink can be started or stopped independently.

## Prerequisites

- Rust toolchain
- Node.js
- Tauri 2 prerequisites
- FFmpeg for file recording
- NDI SDK development files for the NDI-enabled build
- NDI Tools / Video Monitor for testing the sender

On macOS, the NDI SDK is commonly installed under one of these roots:

```text
/Library/NDI SDK for macOS
/Library/NDI SDK for Apple
/Library/NDI 6 SDK
```

For a custom location:

```bash
export NDI_SDK_DIR="/path/to/NDI SDK"
```

## Run

```bash
npm install
npm run dev
```

The standard development command enables NDI.

Renderer-only / no-NDI diagnostic build:

```bash
npm run dev:no-ndi
```

## Built-in routes

| Hotkey | Route | Preview | NDI | Recording |
|---|---|---:|---:|---:|
| `1` | Preview only · 1080p | yes | no | no |
| `2` | NDI · 1080p60 | yes | 1080p60 | no |
| `3` | Record · 1080p30 H.264 | yes | no | H.264 |
| `4` | Broadcast · NDI + H.264 | yes | 1080p30 | H.264 |
| `5` | Archive · 4K ProRes + NDI | yes | 4K30 | ProRes 422 HQ |
| `6` | Headless route · NDI 1080p60 | hidden | 1080p60 | no |

Hotkeys arm profiles; they do not silently start outputs. Click **Start active outputs** after arming.

## First validation

### NDI-only

1. Arm `NDI · 1080p60`.
2. Click **Start active outputs**.
3. Open the official NDI Video Monitor.
4. Select the source containing `Junkpile 36`.
5. Confirm the NDI frame count rises and all three NDI drop counters remain at zero.
6. Stop all outputs.

### Recording-only

1. Choose a custom output folder.
2. Arm `Record · 1080p30 H.264`.
3. Start active outputs for five to ten seconds.
4. Stop all outputs and wait for finalization.
5. Play the completed file and review cadence, jitter, and queue metrics.

### Simultaneous sinks

1. Arm `Broadcast · NDI + H.264`.
2. Start active outputs.
3. Confirm the NDI source in Video Monitor while the file sink records.
4. Stop NDI only; recording should continue.
5. Start NDI again; recording should remain uninterrupted.
6. Stop all outputs and verify the file.

### Hidden preview

1. Arm `Headless route · NDI 1080p60`.
2. The native preview window should hide.
3. Start active outputs.
4. Confirm NDI continues while the local preview is hidden.
5. Use **Show preview** to restore the window without restarting the offscreen renderer.

## Profile configuration

The editable file is:

```text
config/io-profiles.json
```

Each route declares:

- authoritative frame dimensions
- preview visibility
- recording enable state, codec, FPS, and test delay
- NDI enable state, sender name, groups, frame rate, clocking, and vertical orientation
- one profile hotkey

Invalid edits are rejected. The current list remains active until valid JSON is loaded.

Saving or reloading the profile file does not silently reconfigure an active output. Stop outputs and explicitly arm the route again.

## Failure boundaries

- NDI startup failure rolls back a file route started by the same **Start active outputs** action.
- Stopping NDI does not stop recording.
- Stopping recording does not stop NDI.
- Preview visibility does not control offscreen rendering.
- Bounded queues drop frames under pressure instead of accumulating unlimited latency.
- The paused RTSP/RTMP/UDP streaming implementation is not used by this example.

## Known scope

This is the first composed output router, not the final all-platform ShadeCore parity application.

Still pending:

- current native Syphon sender parity audit/integration
- current native Spout sender parity audit/integration and Windows validation
- controlled FFmpeg network-streaming reimplementation
- MIDI/OSC parity audit against the current native source folders

Those existing finalized source folders were not present in the supplied Junkpile archive, so this project does not fabricate replacements for them.
