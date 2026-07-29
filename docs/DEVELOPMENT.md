# Development and platform setup

## Required tools

- Rust installed through `rustup`
- Node.js and npm
- operating-system prerequisites for Tauri
- a supported GPU driver/backend for native-wgpu examples

Use the local CLI declared by each project:

```bash
cd <collection>/<example>
npm install
npm run dev
```

Build a production bundle:

```bash
npm run build
```

On macOS, output normally appears beneath:

```text
src-tauri/target/release/bundle
```

Distribution outside local testing may require signing and notarization.

## Independent workspaces

Every example is standalone. Its `src-tauri/Cargo.toml` should include:

```toml
[workspace]
resolver = "2"
```

This prevents Cargo from walking upward into an unrelated parent workspace.

## Collection-specific notes

### Tauri v1

Use its v1 dependency and configuration schema. Do not invoke a globally installed v2 CLI by accident.

### Tauri v2 WebView

Every configured WebView label requires capability coverage. Use current command, window, dialog, filesystem, and drag/drop APIs.

### Native wgpu

Verify adapter/backend telemetry. Environment selection may include `WGPU_BACKEND` or project-provided scripts. Surface and resource lifecycles must handle resize, minimized windows, lost/outdated surfaces, and device limits.

## Media prerequisites

- camera/microphone permission must be granted at the OS level
- MIDI hardware/virtual ports must appear in the OS MIDI system
- OSC requires matching host, UDP port, address, argument type, and firewall rules
- FFmpeg-based examples require the documented decoder/encoder dependency or bundled path
- Syphon is macOS-specific; Spout is Windows-specific

## Development checklist

1. Launch the untouched example.
2. Confirm telemetry and error panels initialize.
3. Test reset, pause, resize, and fullscreen.
4. Test input loss and reconnection where applicable.
5. Confirm a failed shader/media load does not destroy the last working state.
6. Build the production bundle.
7. Record platform, architecture, OS, device/input, and result.

## Repository hygiene

Do not commit `node_modules/`, Rust `target/`, temporary exports, recordings, decoder caches, or OS metadata. Preserve example folder names because documentation and local repositories rely on them.
