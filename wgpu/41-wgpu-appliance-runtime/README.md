# 41 · wgpu Appliance Runtime

A native Tauri 2 + wgpu example for running Junkpile as an unattended media appliance.

The application creates one authoritative GPU texture and can route it to:

- Optional native preview
- NDI
- Syphon on macOS or Spout on Windows
- H.264 or ProRes file recording

Both application windows can remain hidden while offscreen rendering and external outputs continue.

## Purpose

This example demonstrates the operational layer needed for installations, dedicated playback/capture machines, gallery systems, embedded workstations, and distributed render nodes:

- Configuration-driven startup
- Optional output autostart
- Windowless operation
- CLI overrides
- Continuous machine-readable health snapshots
- Timed runs
- Clean multi-output shutdown
- Runtime inspection without restarting the renderer

The unresolved network-streaming examples are not included.

## Requirements

Core:

- Rust
- Node.js
- Tauri CLI 2
- FFmpeg for recording

Optional outputs:

- NDI SDK and runtime for NDI
- Syphon framework on macOS, bundled in the project
- Spout2 build requirements on Windows

## Development modes

### Normal control mode

```bash
npm install
npm run dev
```

The controls window opens. The appliance configuration is loaded, but outputs do not autostart with the built-in defaults.

### Headless NDI + Syphon/Spout appliance

```bash
npm run dev:appliance
```

Equivalent application arguments:

```text
--headless --autostart --profile headless-shared-1080p60
```

Both windows are hidden. NDI and the platform-native sharing sink start automatically. Stop the development process with `Ctrl+C`.

### Headless NDI + H.264 capture appliance

```bash
npm run dev:capture
```

Equivalent arguments:

```text
--headless --autostart --profile headless-capture-1080p30
```

The runtime writes a finalized H.264 file to the configured recording folder while also publishing NDI.

## Appliance configuration

Edit:

```text
config/appliance.json
```

Built-in configuration:

```json
{
  "schemaVersion": 1,
  "startupProfile": "headless-shared-1080p60",
  "autoStartOutputs": false,
  "controlsVisible": true,
  "previewPolicy": "profile",
  "heartbeatMs": 1000,
  "statusFile": "appliance-status.json",
  "exitAfterSeconds": null
}
```

### Fields

| Field | Purpose |
|---|---|
| `startupProfile` | I/O profile armed during startup |
| `autoStartOutputs` | Starts all external outputs enabled by the startup profile |
| `controlsVisible` | Initial controls-window state |
| `previewPolicy` | `profile`, `hidden`, or `visible` |
| `heartbeatMs` | Status-file update interval, 200–60000 ms |
| `statusFile` | Absolute path or path relative to the appliance config directory |
| `exitAfterSeconds` | Optional timed shutdown; `null` runs indefinitely |

Use **Apply appliance config** after editing. Applying the configuration:

1. Stops active outputs and waits for recording finalization.
2. Reloads and validates `appliance.json`.
3. Arms the requested I/O profile.
4. Applies controls and preview visibility.
5. Starts outputs when autostart is enabled.
6. Writes a fresh status snapshot.

## CLI overrides

Supported application arguments:

```text
--profile <id>
--autostart
--no-autostart
--headless
--show-controls
--hide-controls
--show-preview
--hide-preview
--profile-preview
--status-file <path>
--exit-after <seconds>
```

CLI values override `appliance.json` for the current launch without rewriting the file.

## Machine-readable status

The runtime continuously writes a JSON status snapshot. In development, the default is:

```text
config/appliance-status.json
```

The file includes:

- Startup and active profiles
- Applied CLI overrides
- Uptime and heartbeat timestamp
- Window policies
- Output-active state
- Renderer and GPU information
- Recording status and drop diagnostics
- NDI status and queue telemetry
- Syphon/Spout status and queue telemetry
- Configuration watcher status
- Last runtime event and error

The file is written through a temporary file and replacement step so external monitoring tools do not normally read a partially serialized snapshot.

## Window behavior

- Closing the controls window performs a clean multi-output shutdown.
- Closing the preview window hides presentation while offscreen rendering continues.
- **Hide controls** intentionally removes the UI while the runtime continues; use Ctrl+C during development to stop a fully hidden run.
- **Show preview** temporarily restores local inspection.
- **Stop outputs and exit** finalizes recording, stops all external sinks, writes final status, and exits.
- In a fully hidden development launch, use `Ctrl+C` when no controls window is available.

## Included profiles

The I/O profiles remain editable in:

```text
config/io-profiles.json
```

Notable appliance profiles:

- `headless-shared-1080p60` — hidden preview, NDI + Syphon/Spout
- `headless-capture-1080p30` — hidden preview, NDI + H.264 recording
- `broadcast-1080p30` — preview, NDI, Syphon/Spout, and recording
- `archive-4k30` — demanding 4K ProRes + NDI + platform share route

## Recommended validation

1. Run `npm run dev`.
2. Confirm `appliance-status.json` updates every second.
3. Change `heartbeatMs` to `500`, apply the appliance config, and confirm faster updates.
4. Set `previewPolicy` to `hidden`, apply, and confirm offscreen frame counts continue.
5. Set `controlsVisible` to `false`, apply, and confirm the controls window hides.
6. Run `npm run dev:appliance` and verify NDI plus Syphon/Spout externally.
7. Run `npm run dev:capture`, allow a short recording, stop with the UI in normal mode or use a timed run, and verify file finalization.
8. Set `exitAfterSeconds` to a short value and verify clean automatic shutdown.

## Known limitations

- This is an offscreen/hidden-window runtime, not a platform-specific display-server-free GPU context. A native surface is still created and then hidden.
- NDI development builds require the NDI SDK and runtime.
- Spout remains pending full Windows validation.
- Syphon/Spout resolutions above 1080p can become bandwidth-limited because the current route stages frames through CPU memory.
- Network output is intentionally excluded until its separate implementation is resolved.
