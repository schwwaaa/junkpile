# 31 — wgpu I/O Profile Router

A native wgpu + Tauri 2 teaching example for describing render and file-output routes as validated, hot-reloadable JSON profiles.

This example is built from two confirmed working Junkpile foundations:

- Example 26: typed I/O configuration, validation, hot reload, and last-known-good behavior
- Examples 28 and 30: bounded FFmpeg file recording and native high-resolution rendering

It does **not** reuse the paused network-streaming implementation from Example 29.

## What this example demonstrates

- Named I/O profiles stored in `config/io-profiles.json`
- Strict typed JSON with unknown-field rejection
- Unique profile IDs and validated default profile
- Last-known-good behavior after invalid edits
- Debounced filesystem hot reload
- Explicit profile arming before route changes
- Native source reconfiguration when a profile is armed
- GPU preview route that remains active
- Optional bounded FFmpeg file route
- H.264/MP4 and ProRes/MOV profiles
- 1080p, 4K, 5K, and 8K profiles
- GPU texture-limit validation
- Profile changes blocked while recording or finalizing
- FFmpeg and ffprobe verification inherited from the stable recorder

## Architecture

```text
config/io-profiles.json
        ↓ parse + validate
last-known-good profile registry
        ↓ arm one profile
native authoritative wgpu texture
        ├── GPU window preview
        └── optional mapped readback
                ↓ bounded queue
             FFmpeg file worker
                ↓
             MP4 or MOV
```

The control panel never sends arbitrary dimensions or codec settings to the renderer. It selects a profile ID. Rust resolves that ID against the validated profile registry and uses the stored settings.

## Profile schema

```json
{
  "id": "delivery-4k",
  "label": "Delivery · 4K H.264",
  "description": "Native 4K render and H.264 recording.",
  "frame": {
    "width": 3840,
    "height": 2160
  },
  "recording": {
    "enabled": true,
    "codec": "h264",
    "fps": 30,
    "workerDelayMs": 0
  }
}
```

Supported codecs:

```text
h264
prores
```

Supported recording frame rates:

```text
24
30
60
```

The renderer itself continues running at 60 Hz. The recording route captures at the profile's configured output frame rate.

## Built-in profiles

- Preview only · 1080p
- Delivery · 1080p H.264
- Delivery · 4K H.264
- Archive · 4K ProRes
- Stress test · 5K H.264
- Stress test · 8K H.264 at 24 FPS

## Prerequisites

- Rust
- Node.js and npm
- Tauri 2 system prerequisites
- FFmpeg and ffprobe on `PATH`

Verify the tools before starting:

```bash
ffmpeg -version
ffprobe -version
```

Optional executable overrides:

```bash
export FFMPEG_PATH=/absolute/path/to/ffmpeg
export FFPROBE_PATH=/absolute/path/to/ffprobe
```

## Run

```bash
cd 31-wgpu-io-profile-router
npm install
npm run dev
```

Two windows should open:

1. HTML/CSS profile and telemetry controls
2. Native wgpu renderer preview

## Test sequence

### 1. Preview-only route

The default profile is `Preview only · 1080p`.

Confirm:

- The route graph shows preview only
- The file-route button is disabled
- The native preview continues rendering

### 2. Arm and record 1080p

1. Select `Delivery · 1080p H.264`
2. Click **Arm selected profile**
3. Confirm the armed badge and route graph update
4. Click **Start file route**
5. Record for about five seconds
6. Click **Stop and finalize**
7. Wait for `Complete`
8. Play the verified MP4

### 3. Change profiles

Arm `Delivery · 4K H.264` or `Archive · 4K ProRes` while idle.

The native authoritative texture and recording stage should reconfigure immediately. Profile changes are rejected while a recording is active or finalizing.

### 4. Verify hot reload

Open the config folder from the controls and edit:

```text
config/io-profiles.json
```

Change a label or add a valid profile. Save the file. The generation and profile list should update without restarting.

Then deliberately make the JSON invalid. The UI should show the validation error while the previously valid profile registry remains usable.

Use **Restore built-ins** to recover the original file.

## Output location

Recordings are written to:

```text
./recordings/
```

Example filenames:

```text
junkpile-31-h264-1920x1080-30fps-<timestamp>.mp4
junkpile-31-prores-3840x2160-30fps-<timestamp>.mov
```

## Validation rules

- `schemaVersion` must be `1`
- Profile IDs must be unique
- `defaultProfile` must reference an existing profile
- Dimensions must be even
- Maximum profile dimensions are `7680 × 4320`
- Recording FPS must be `24`, `30`, or `60`
- 8K is limited to 24 or 30 FPS
- Worker delay must be between 0 and 500 ms
- Unknown JSON fields are rejected
- The selected dimensions must fit the GPU's reported texture limit

## Why this matters

A reusable I/O system should not require every application to hardcode its delivery settings. A small processor, recorder, feedback instrument, or routing utility should be able to load a known profile and expose the same predictable route contract.

This example proves a focused version of that model:

> Configuration chooses the route, Rust validates it, the renderer prepares it, and each sink remains responsible for its own lifecycle and backpressure.

Future examples can extend the same profile format with NDI and platform-native shared-texture outputs after those individual sinks are independently verified.
