# Junkpile 37 — wgpu Syphon Metal Sender

A focused macOS-native wgpu example that integrates ShadeCore's Syphon output concept into the Junkpile renderer family.

The application renders one authoritative wgpu texture, previews it in a native window, reads frames back through a bounded three-slot GPU pipeline, converts RGBA into BGRA, uploads the frame into a reusable Metal texture, and publishes it through `SyphonMetalServer` from a dedicated worker thread.

```text
Authoritative wgpu texture
├── native preview
└── asynchronous GPU readback
    └── reusable BGRA CPU pool
        └── reusable Metal texture
            └── SyphonMetalServer
                └── Syphon receiver
```

The worker queue is bounded. If GPU readback, CPU-buffer availability, Metal upload, or the receiver path cannot keep up, the corresponding drop counter increases while the native preview continues.

## Why this implementation differs from ShadeCore

ShadeCore renders with OpenGL and can publish its OpenGL texture directly through `SyphonOpenGLServer`.

Junkpile's native renderer uses wgpu. This example preserves ShadeCore's sender lifecycle, naming, resize behavior, client detection, output isolation, and telemetry while using an explicit compatibility path:

```text
wgpu → CPU BGRA staging → Metal texture → Syphon
```

This is a real working Syphon architecture, but it is not yet zero-copy. A later backend-specific experiment can expose wgpu's underlying Metal texture directly without changing the public sink contract established here.

## Technologies

- Rust 2021
- Tauri 2
- wgpu 29.0.3
- WGSL
- Objective-C ARC bridge
- Metal
- `SyphonMetalServer`
- Vendored universal `Syphon.framework`
- Bounded Rust worker queues

## Platform

Syphon is macOS-only. The renderer can compile without the Syphon feature for basic diagnostics, but the sender itself requires macOS.

## Run

```bash
npm install
npm run dev
```

The standard development command enables the `syphon` Cargo feature.

Renderer-only diagnostic build:

```bash
npm run dev:no-syphon
```

## First test

1. Start the application.
2. Leave the default source name at `Junkpile 37`.
3. Click **Start Syphon**.
4. Open a Syphon-compatible receiver.
5. Select `Junkpile 37` from the source list.
6. Confirm the receiver and native preview show the same animation.

The sender source should appear immediately. With **Transfer frames only with connected clients** enabled, GPU readback and Metal upload begin only after a receiver connects.

## Compatible receiver examples

Any application with Syphon input can be used, including a Syphon test client, VDMX, Resolume, OBS with Syphon support, or another compatible visual application.

## Controls

| Control | Purpose |
|---|---|
| Source name | Name advertised to Syphon receivers |
| Resolution | Authoritative render and Syphon texture dimensions |
| Frame rate | Target publication cadence |
| Transfer only with clients | Avoids readback/upload work when no receiver is connected |
| Vertical flip | Corrects receiver orientation if required |
| Start Syphon | Applies settings and starts the server |
| Stop Syphon | Stops the server and worker |
| Reset metrics | Clears counters without restarting |
| Renderer fullscreen | Toggles the native preview window |

Settings are locked while the sender is active. Stop Syphon before changing source dimensions or cadence.

## Telemetry

| Metric | Meaning |
|---|---|
| Client connected | `SyphonMetalServer.hasClients` is true |
| Capture requests | Frames requested by the publication cadence |
| GPU readbacks | Completed wgpu texture readbacks |
| Frames published | Frames successfully published through Syphon |
| Skipped — no client | Cadence events intentionally skipped because no receiver was connected |
| GPU drops | No readback slot was available |
| CPU-pool drops | No reusable BGRA frame buffer was available |
| Worker drops | The bounded two-frame sender queue was full |
| Worker queue | Frames waiting for the Metal/Syphon worker |
| Raw bandwidth | Uncompressed frame traffic before publication |

## Bundled native framework

The project includes:

```text
src-tauri/vendor/Syphon.framework
```

The build script:

- compiles `native/syphon_metal_bridge.m`
- links Metal, Foundation, AppKit, and Syphon
- adds the vendored framework directory as a development rpath
- adds application-relative rpaths for packaged builds

The Tauri bundle configuration also declares the framework for macOS packaging.

## Architecture notes

### Authoritative frame

The same offscreen wgpu texture feeds both preview and Syphon. Window resizing does not change the configured Syphon resolution.

### Client gating

The Objective-C worker polls `SyphonMetalServer.hasClients`. When gating is enabled and no client is attached, the renderer skips readback at the configured publication cadence.

### Threading

- The renderer thread owns wgpu rendering and readback commands.
- Mapped frames are converted into reusable BGRA buffers.
- A bounded worker owns the Metal texture and Syphon server.
- The worker waits for each Syphon copy command to complete before reusing the Metal texture.

### Backpressure

The application never grows an unbounded frame queue. Pressure is reported as explicit GPU, CPU-pool, or worker drops.

## Troubleshooting

### Source does not appear

- Confirm the app was started with `npm run dev`, not `npm run dev:no-syphon`.
- Confirm the controls show **Syphon Metal compiled**.
- Stop and restart the sender after changing the source name.
- Confirm the receiver actually supports Syphon input.

### Source appears but remains black

- Disable **Transfer frames only with connected clients** temporarily.
- Toggle **Vertical flip** only for orientation issues; it should not normally affect visibility.
- Check the sender log for Metal texture upload failures.

### dyld cannot find Syphon.framework

Clean and relink:

```bash
cd src-tauri
cargo clean
cd ..
npm run dev
```

The build warning should report the vendored Syphon framework path.

### High-resolution drops

Start at 1080p60, then test 1440p60, 4K30, and 4K60. This compatibility path performs GPU readback plus a CPU-to-Metal upload, so 4K60 is intentionally a stress test.

## Scope

This is a Syphon **sender**. It does not receive Syphon textures. Receiver-side Syphon belongs in a later Junkpile input example.
