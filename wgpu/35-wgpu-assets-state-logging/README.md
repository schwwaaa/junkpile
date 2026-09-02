# Junkpile 35 — wgpu Assets, State + Logging

A native Tauri 2 + wgpu example that isolates the runtime-infrastructure concepts used by ShadeCore:

- explicit asset-root discovery
- platform-aware configuration overlays
- persistent runtime selection state
- structured subsystem logging
- editable shader assets with last-known-good reload behavior

The example keeps one native wgpu renderer and one HTML/CSS controls window. The renderer remains independent from the files, state, and logging systems that configure and describe it.

## What this example demonstrates

### Asset authority

At startup, the runtime resolves its editable asset root in this order:

1. `--assets <absolute path>` passed to the executable
2. `JUNKPILE_ASSETS`
3. `SHADECORE_ASSETS` compatibility alias
4. the asset root stored in `runtime-state.json`
5. the platform application-config directory

The UI displays the winning source and every resolved path. A custom root can be prepared by cloning the active assets into an absolute path and selecting it for the next launch.

### Platform-aware runtime configuration

The active asset root contains:

```text
runtime.json
runtime.macos.json
runtime.windows.json
runtime.linux.json
```

`runtime.json` is loaded first. The current operating-system file is then merged over it and strictly validated.

Runtime policy is startup-owned. Editing a runtime config file produces a structured `restart_required` event. Shader and parameter files remain live-reloadable.

### Persistent runtime state

The application atomically saves:

- active shader
- active profile
- parameter target values
- next-launch asset root

State is restored only after the active asset catalog has been validated. If a saved shader or profile no longer exists, the restore is rejected and the valid startup defaults continue running.

Autosave runs on a dedicated thread. **Clear state file** pauses autosave for the current session; **Save state now** writes a fresh state file and resumes autosave.

### Structured logging

Runtime events are stored as JSON Lines. Each event contains:

```json
{
  "timestampUnixMs": 0,
  "level": "info",
  "subsystem": "assets",
  "event": "next_root_selected",
  "message": "custom asset root saved for the next launch",
  "fields": {}
}
```

The log destination resolves in this order:

1. `--log-file <absolute path>`
2. `JUNKPILE_LOG_FILE`
3. `SHADECORE_LOG_FILE` compatibility alias
4. the platform application-config directory

A bounded in-memory ring drives the UI while the JSONL file remains the durable record.

## Signal flow

```text
CLI / environment / saved state
              ↓
      asset-root resolver
              ↓
runtime.json + platform override
              ↓
 validated shaders + parameters
              ↓
      native wgpu renderer
          ↙           ↘
atomic runtime state   structured JSONL events
```

## Project structure

```text
35-wgpu-assets-state-logging/
├── assets/
│   ├── runtime.json
│   ├── runtime.macos.json
│   ├── runtime.windows.json
│   ├── runtime.linux.json
│   ├── render.json
│   ├── params.json
│   └── shaders/
├── src/
│   ├── index.html
│   ├── app.js
│   └── styles.css
└── src-tauri/
    └── src/
        ├── assets.rs
        ├── runtime.rs
        ├── watcher.rs
        ├── renderer.rs
        ├── preview.rs
        ├── frame.rs
        ├── config.rs
        └── main.rs
```

## Run

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## First validation pass

1. Launch the example and confirm both windows appear.
2. Select a different shader and profile.
3. Move each parameter, including setting **Spin speed** to zero.
4. Wait for the autosave count to increase.
5. Close and reopen the application.
6. Confirm the shader, profile, and parameter targets are restored.
7. Emit info, warning, and error test events.
8. Open the JSONL log and confirm the events are recorded as separate JSON objects.
9. Toggle a valid shader edit and confirm the live pipeline reloads.
10. Write an invalid shader and confirm the prior pipeline continues rendering.

## Test a custom asset root

Enter an absolute directory in the UI and click:

```text
Clone active assets + use next launch
```

Restart the application. The custom directory should become the active root and the authority source should read `persisted runtime state`.

Environment-variable tests:

```bash
JUNKPILE_ASSETS="/absolute/path/to/assets" npm run dev
```

```bash
JUNKPILE_LOG_FILE="/absolute/path/to/junkpile-runtime.jsonl" npm run dev
```

ShadeCore-compatible aliases are also supported:

```bash
SHADECORE_ASSETS="/absolute/path/to/assets" npm run dev
SHADECORE_LOG_FILE="/absolute/path/to/runtime.jsonl" npm run dev
```

## Runtime ownership rules

- Startup authority selects the active asset root.
- The current asset root cannot change underneath the running watcher and renderer.
- `render.json.active_frag` controls startup only.
- Live shader selection remains authoritative after launch.
- Saving a WGSL file reloads that file without changing the active shader.
- Runtime config changes require restart.
- Invalid shader/config candidates never replace the last-known-good pipeline.
- The state file stores user selections, not rendered frames or generated media.
- Log-file failure does not stop the renderer; the UI reports the file error while retaining in-memory events.

## Known limitations

- Custom asset-root selection uses an absolute text path rather than a native folder picker so the example remains dependency-light.
- Runtime policy is resolved at startup; it is intentionally not hot-swapped.
- State replacement is atomic where the operating system allows overwrite-by-rename. Windows uses a remove-and-rename fallback.
- The current example persists shader/profile/parameter selection but not renderer-window position.
- Rust compilation and runtime validation must be completed on each target operating system.
