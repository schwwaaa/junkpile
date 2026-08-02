# Junkpile 26 — wgpu I/O Config Foundation

A standalone Tauri 2 + native wgpu example that establishes the configuration layer for future Junkpile recording, streaming, NDI, Syphon, Spout, receiver, and routing examples.

This project does **not** implement those media sinks yet. It establishes the contract they will consume.

```text
io.json
   + platform override
            ↓ deep merge
strict typed Rust schema
            ↓ validation
last-known-good active state
            ↓ bounded renderer command
native wgpu diagnostic surface
```

## What this example demonstrates

- Versioned JSON schema
- Strict rejection of unknown fields
- macOS, Windows, and Linux override files
- Deep merge of base and platform configuration
- Independent render, preview, recording, and streaming dimensions
- Independent render, recording, and streaming frame rates
- Queue-capacity configuration for future CPU-frame workers
- NDI and shared-texture configuration placeholders
- Platform validation for Syphon and Spout selections
- Filesystem hot reload using the actual resolved files
- Debounced watcher events
- Last-known-good behavior after invalid edits
- Manual reload
- Built-in restore operation
- Native renderer telemetry
- A renderer visualization that changes when the active generation changes

## Run

```bash
npm install
npm run dev
```

The project follows the established Junkpile two-window native-wgpu architecture:

- `controls`: HTML/CSS/JavaScript WebView
- `renderer`: separate native OS window rendered by wgpu

## First test

1. Launch the example.
2. Confirm both windows open.
3. Confirm the controls report `configuration active`.
4. Click **Write valid change**.
5. Recording and streaming should toggle, render target FPS should change, and the generation should increment.
6. Click **Write invalid change**.
7. The controls should report a rejected configuration.
8. The previous generation should remain active and the renderer should continue.
9. Click **Restore defaults**.
10. The watcher should apply the restored files automatically.

## Manual editing

Click **Open config folder**, then edit:

```text
config/io.json
config/io.macos.json
config/io.windows.json
config/io.linux.json
```

During development, the project-local `config/` directory is used. A production bundle uses the operating system application-config directory and seeds the same defaults on first launch.

The active platform override is merged after `io.json`.

## Configuration model

### Authoritative render

```json
"render": {
  "width": 1920,
  "height": 1080,
  "targetFps": 60
}
```

This describes the frame produced by the renderer or processing graph.

### Preview

```json
"preview": {
  "enabled": true,
  "width": 1280,
  "height": 720,
  "scaling": "fit"
}
```

Valid scaling values:

- `fit`
- `fill`
- `stretch`
- `pixel`

### Recording and streaming

Each worker output has its own dimensions, FPS, and bounded queue capacity:

```json
"recording": {
  "enabled": false,
  "width": 1920,
  "height": 1080,
  "fps": 60,
  "queueCapacity": 3
}
```

The configuration deliberately prevents recording or streaming resolution from silently resizing the authoritative render target.

### Shared texture

Valid backends:

- `auto`
- `syphon`
- `spout`
- `disabled`

The platform override resolves the default backend:

- macOS → Syphon
- Windows → Spout
- Linux → disabled

No sender is created in this example. The field is validated and visualized only.

## Validation rules

- `schemaVersion` must be `1`
- Dimensions must be between `64` and `8192`
- A configured frame may not exceed 67.1 megapixels
- FPS must be between `1` and `240`
- Queue capacity must be between `1` and `16`
- Hot-reload debounce must be between `50` and `5000` milliseconds
- Unknown JSON fields are rejected
- Syphon is rejected outside macOS
- Spout is rejected outside Windows
- Enabled shared texture cannot use the `disabled` backend

## Last-known-good behavior

A failed reload updates the error telemetry but does not replace the active configuration. The renderer keeps the previous valid generation.

This behavior is essential for live systems: a malformed edit should not collapse the running application.

## Important files

```text
config/io.json                         base configuration
config/io.macos.json                   macOS override
config/io.windows.json                 Windows override
config/io.linux.json                   Linux override
src-tauri/src/config.rs                schema, merge, validation, watcher
src-tauri/src/renderer.rs              native wgpu renderer and config command
src-tauri/src/shader.wgsl              diagnostic output visualization
src-tauri/src/main.rs                  Tauri commands and window lifecycle
src/index.html                         controls and effective-state view
src/app.js                             polling and test actions
src/styles.css                         controls presentation
```

## Why this comes before FFmpeg

The later recording and streaming examples need stable answers to these questions first:

- Which dimensions belong to the renderer?
- Which dimensions belong to each sink?
- Which frame rate belongs to each sink?
- How large may a worker queue become?
- What happens when configuration is malformed?
- Which platform-specific capability is selected?
- Can configuration change while the renderer stays alive?

This example answers those questions without mixing them with codecs, subprocesses, GPU readback, or network behavior.

## Validation status

The project structure, JSON files, frontend JavaScript, and generated archive were statically checked in the creation environment. Rust compilation and runtime testing must be performed on a machine with Rust, Cargo, Tauri prerequisites, and a supported GPU; Cargo was not available in the creation environment.

## License

MIT.
