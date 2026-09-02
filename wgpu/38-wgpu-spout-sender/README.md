# Junkpile 38 — wgpu Spout Sender

Windows-only Spout2 output for the native Junkpile wgpu track.

The example renders one authoritative offscreen wgpu texture, presents it in a native preview window, reads selected frames back asynchronously, converts RGBA to BGRA, and sends them through a dedicated Direct3D 11 SpoutDX worker.

```text
Authoritative wgpu texture
├── native preview
└── 3-slot GPU readback
    └── reusable BGRA buffers
        └── bounded 2-frame worker queue
            └── SpoutDX / Direct3D 11 sender
```

## What this ports from ShadeCore

ShadeCore establishes the Spout sender lifecycle, platform-specific native bridge, sender naming, dimension updates, vertical orientation option, and clean release behavior. This example preserves those concepts while adapting the source frame from OpenGL to wgpu.

ShadeCore publishes an OpenGL texture directly. Example 38 instead uses:

```text
wgpu → CPU BGRA staging → Direct3D 11 shared texture → Spout
```

This is a real Spout sender, but it is not zero-copy. A future backend-specific optimization can share a native wgpu Direct3D texture directly.

## Requirements

- Windows 10 or Windows 11
- Rust toolchain
- Node.js and npm
- Tauri CLI 2
- Visual Studio 2022 Build Tools
- **Desktop development with C++** workload
- CMake
- A Spout-compatible receiver

The required Spout2 source files are vendored in `src-tauri/vendor/spout2`.

## Run

```powershell
cd 38-wgpu-spout-sender
npm install
npm run dev
```

The first build compiles the C++ SpoutDX bridge and can take longer than later builds.

Renderer-only inspection on another operating system:

```bash
npm run dev:no-spout
```

Spout output remains unavailable outside Windows.

## First test

1. Leave the sender at `Junkpile 38`, 1920 × 1080, 60 FPS, automatic adapter.
2. Click **Start Spout**.
3. Open the official Spout receiver or another compatible application.
4. Select `Junkpile 38`.
5. Verify that the receiver follows the native preview.
6. Stop and restart the sender.
7. Test 1440p60 and 4K30 after 1080p60 is stable.

## Multi-GPU systems

Automatic adapter selection should be tested first. When the source is not visible in the receiver, select the Direct3D adapter that matches the receiver application.

Spout sender and receiver applications generally need to use compatible adapters. Windows graphics preferences can also force both applications onto the same GPU.

## Orientation

wgpu readback is treated as top-left, so vertical flip is disabled by default. Enable it only when the receiving application displays the frame upside down.

## Backpressure

The live renderer never waits indefinitely for Spout:

- 3 GPU readback slots
- 3 reusable CPU buffers
- 2-frame bounded sender queue
- GPU, CPU-pool, and worker drop counters

If the Spout worker cannot keep up, frames are dropped rather than allowing latency to grow without limit.

## Performance expectations

The current implementation performs GPU readback and a CPU-to-Direct3D upload. Start at 1080p60. Higher resolutions increase memory bandwidth sharply and may need a lower frame rate.

## Project structure

```text
src-tauri/
├── native/spout_bridge/       C ABI and CMake project
├── vendor/spout2/             vendored Spout2 source subset
└── src/
    ├── renderer.rs            authoritative wgpu texture and render loop
    ├── spout.rs               readback, BGRA packing, queue, sender worker
    ├── preview.rs             independent native preview sink
    └── frame.rs               shared frame descriptor
```

## Known limitations

- Windows testing is still required.
- The sender uses CPU staging rather than direct wgpu/D3D texture interoperability.
- Adapter names are not enumerated in the UI yet; adapter selection uses indices.
- The project does not include a Spout receiver.
