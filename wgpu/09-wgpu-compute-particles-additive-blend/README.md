# 08 — wgpu Backend Lab

A standalone Tauri 2 + Rust/wgpu example for inspecting which native GPU backends and adapters are available, then running the same WGSL workload through the selected backend.

## What this example demonstrates

- A raw Tauri renderer window with no WebView in the render path.
- Adapter enumeration through `Instance::enumerate_adapters`.
- Backend selection before instance creation through `WGPU_BACKEND`.
- Optional adapter-name filtering through `WGPU_ADAPTER_NAME`.
- Surface compatibility, formats, present modes, and alpha modes.
- Hardware limits for textures, buffers, bind groups, and compute workgroups.
- Feature reporting for timestamp queries, subgroups, f16 shaders, and compressed textures.
- One identical WGSL workload for comparison across Metal, Vulkan, DX12, and the optional GL path.

## Run

```bash
npm install
npm run dev
```

The default run allows wgpu to choose from its primary native backend set.

### Explicit backend scripts

```bash
npm run dev:metal
npm run dev:vulkan
npm run dev:dx12
npm run dev:gl
```

The helper script sets `WGPU_BACKEND` in a cross-platform way before launching Tauri.

### Select an adapter by name

macOS/Linux:

```bash
WGPU_ADAPTER_NAME="Apple M3" npm run dev
```

PowerShell:

```powershell
$env:WGPU_ADAPTER_NAME="NVIDIA"
npm run dev
```

The match is case-insensitive and checks whether the adapter name contains the supplied text.

## Platform expectations

| Platform | Primary native backend | Other useful test paths |
|---|---|---|
| macOS | Metal | Vulkan through MoltenVK when available |
| Windows | DX12 or Vulkan | The other native backend for comparison |
| Linux | Vulkan | GL/GLES as a compatibility comparison |

A single physical GPU may appear as multiple adapters when more than one backend exposes it.

## macOS Vulkan note

This project enables wgpu's `vulkan-portability` Cargo feature on macOS, but that does not install a Vulkan loader or MoltenVK. `npm run dev:vulkan` may report that no Vulkan adapter is available. Metal remains the native Apple path.

The lab reports exactly what wgpu can enumerate rather than claiming a backend exists because its code was compiled.

## Fixed dependency line

This example intentionally matches the versions validated by examples 00–07:

```text
Tauri       2.11.5
tauri-build 2.6.3
wgpu        29.0.4
```

## Architecture

```text
WGPU_BACKEND / WGPU_ADAPTER_NAME
                 ↓
          wgpu Instance
                 ↓
       enumerate GPU adapters
                 ↓
choose a surface-compatible adapter
                 ↓
      Device + Queue + Surface
                 ↓
       identical WGSL workload
                 ↓
 Metal · Vulkan · DX12 · optional GL
```

## Important limitation

Backends cannot be changed after the wgpu instance, adapter, device, and surface have been created. Restart the application with a different launch script to perform a valid backend comparison.
