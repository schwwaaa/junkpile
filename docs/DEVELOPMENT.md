# Development and platform setup

## Required tools

Base requirements:

- Rust installed through `rustup`
- Node.js and npm
- operating-system prerequisites for Tauri
- current GPU drivers

Use the local scripts declared by each project:

```bash
cd <collection>/<example>
npm install
npm run dev
```

Build a production bundle:

```bash
npm run build
```

Typical Tauri bundle output lives beneath:

```text
src-tauri/target/release/bundle/
```

Public distribution may additionally require code signing, notarization, installer configuration, and platform-specific entitlements.

## Independent workspaces

Every example is intended to remain standalone. Rust projects commonly include:

```toml
[workspace]
resolver = "2"
```

This keeps Cargo from accidentally inheriting an unrelated parent workspace.

## Platform prerequisites

### macOS

```bash
xcode-select --install
```

Native wgpu normally uses Metal. Camera/microphone examples need the corresponding usage descriptions/permissions. Syphon examples are macOS-specific.

### Windows

Install current Visual Studio Build Tools with the Desktop development with C++ workload, WebView2, and current GPU drivers. Native wgpu can use Direct3D 12. Spout examples additionally require the documented Spout build/runtime prerequisites.

### Linux

Install the Tauri/WebKitGTK development packages for the distribution plus a functional Vulkan or supported graphics stack. Package names vary by distribution.

## Collection-specific notes

### Tauri v1

Use the v1 dependency/configuration schema. Do not invoke a Tauri 2 CLI/configuration pattern against a v1 project.

### Tauri v2 WebView

Use the v2 configuration schema, explicit capabilities, current dialog/window APIs, and current Tauri IPC/event behavior.

### Native wgpu

Read adapter/backend telemetry before debugging application logic. Native projects must correctly handle:

- resize/reconfigure
- HiDPI
- minimized/zero-size windows
- lost/outdated/timeout surface states
- device texture limits
- uniform/storage-buffer alignment
- mapped-buffer row alignment for readback

## Media and I/O prerequisites

| Feature | Requirement |
|---|---|
| Camera | OS camera permission and available capture device |
| Microphone / FFT | OS microphone permission and input device |
| MIDI | Connected hardware or virtual MIDI port |
| OSC | Matching host/UDP port/address plus firewall permission |
| FFmpeg decode/record | FFmpeg; recording verification also uses ffprobe |
| NDI | NDI SDK/runtime for NDI-enabled builds |
| Syphon | macOS + bundled/compatible Syphon components |
| Spout | Windows + compatible Spout/Direct3D environment |
| glTF/media | Valid local assets supported by the example |

## Native recording validation

When testing the FFmpeg recording lineage (28, 30, 31, 36, 39, 43):

1. Begin with 1080p and a conservative frame rate.
2. Confirm the preview remains responsive while recording.
3. Watch readback/worker queue pressure and dropped frames.
4. Finalize cleanly.
5. Verify the output with `ffprobe`.
6. Test playback in more than one player before assuming a file cadence problem is an encode failure.
7. Increase resolution only after the lower-resolution path is stable.

High-resolution capability is hardware-dependent. GPU texture limits, memory bandwidth, CPU packing, encoder throughput, storage speed, and player decode performance are separate constraints.

## Current wgpu output-reference validation

### NDI

For the current `wgpu/32` and router-derived references, confirm the SDK/runtime is available and test with an official/known receiver. A missing NDI source can be a build/runtime dependency problem rather than a renderer problem. NDI itself is an external transport, not a wgpu feature.

### Syphon

macOS only. For the current wgpu sender reference, confirm the source appears in a known Syphon receiver and that the native preview continues if the receiver disconnects. The transport is platform-specific; the current repository implementation happens to use a wgpu-to-Metal bridge.

### Spout

Windows only. For the current wgpu sender reference, confirm the sender appears in a compatible receiver and record whether the bridge is using the current CPU-staging path. The transport is platform-specific; the current repository implementation happens to use a wgpu-to-D3D11 bridge.

### Network output

Treat `40-wgpu-network-output` as unresolved/under review. Do not use it as the stable template for router/application development until its publishing path is explicitly revisited and validated.

## Development checklist

1. Launch the untouched example.
2. Confirm telemetry and error panels initialize.
3. Verify documented controls.
4. Test resize/fullscreen where relevant.
5. Test input loss/reconnect where relevant.
6. Confirm invalid config/shader/media does not destroy the last working state when the example promises last-known-good behavior.
7. Exercise output start/stop/finalization separately from rendering.
8. Build the production bundle.
9. Record platform, CPU architecture, GPU/backend, input/output hardware, dependency versions, and result.

## Repository hygiene

Do not commit:

- `node_modules/`
- Rust `target/`
- temporary recordings/exports
- decoder caches
- generated runtime state unless intentionally part of an example fixture
- OS metadata such as `.DS_Store`

Preserve project folder identities because documentation and external references may rely on them.
