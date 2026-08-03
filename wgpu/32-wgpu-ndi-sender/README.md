# Junkpile 32 — wgpu NDI Sender

A focused native-wgpu example that ports ShadeCore's NDI output concept into the Junkpile renderer family.

The application renders one authoritative wgpu texture, previews it in a native window, reads frames back through a bounded three-slot GPU pipeline, converts RGBA into BGRA, and publishes a progressive NDI source from a dedicated worker thread.

## What this example proves

```text
Authoritative wgpu texture
├── native window preview
└── three-slot GPU readback
    └── reusable CPU BGRA buffers
        └── bounded two-frame worker queue
            └── NDI source
                └── NDI Video Monitor / Studio Monitor
```

The render thread never waits for an unbounded NDI queue. If GPU readback, CPU buffer packing, or the sender worker cannot keep up, the corresponding drop counter increases while the native preview continues.

## ShadeCore concepts preserved

- Optional Cargo feature named `ndi`
- `grafton-ndi 0.9.0`
- Configurable source name
- Optional NDI groups
- Configurable video clocking
- Rational frame-rate numerator and denominator
- Progressive BGRA video frames
- Optional vertical flip
- Bounded two-frame sender queue
- Drop instead of blocking the renderer
- Dedicated NDI worker lifecycle

### Backend adaptation

ShadeCore's OpenGL readback normally starts at the bottom-left, so ShadeCore defaults to vertical flipping. wgpu texture readback is already represented as top-left in this example, so vertical flip defaults to **off**. The option remains available for testing or unusual downstream workflows.

## Requirements

### Rust and Tauri

- Rust toolchain
- Tauri 2 prerequisites for your operating system
- Node/npm for the local Tauri CLI

### NDI

This project deliberately uses the same Rust NDI integration as the supplied ShadeCore codebase.

You need:

1. **NDI Tools / Runtime** — provides NDI Video Monitor on macOS or NDI Studio Monitor on Windows and the runtime libraries.
2. **NDI SDK 6.x** — may be required to compile `grafton-ndi`, because the Rust crate builds against the installed SDK.
3. **Xcode Command Line Tools** on macOS, or the corresponding C/LLVM build tools on Windows/Linux.

Common macOS SDK locations include:

```text
/Library/NDI SDK for macOS
/Library/NDI SDK for Apple
/Library/NDI 6 SDK
```

If your SDK is elsewhere:

```bash
export NDI_SDK_DIR="/path/to/your/NDI SDK"
```

Having the official monitor installed confirms the receiver/runtime side, but the SDK headers can still be a separate installation requirement.

### macOS runtime linking

The NDI library is installed as `libndi.dylib` and uses the install name `@rpath/libndi.dylib`. Revision 0.1.1 detects the active SDK, adds its `lib/macOS` directory to the executable runtime search paths, and also includes application-relative rpaths for future bundling. This prevents the project from compiling successfully and then failing at launch with:

```text
Library not loaded: @rpath/libndi.dylib
```

After changing `NDI_SDK_DIR` or installing a different SDK, clean the application crate before rebuilding:

```bash
cd src-tauri
cargo clean
cd ..
npm run dev
```

For a one-session diagnostic workaround, the equivalent shell setting is:

```bash
export DYLD_LIBRARY_PATH="$NDI_SDK_DIR/lib/macOS${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}"
npm run dev
```

## Run

```bash
cd 32-wgpu-ndi-sender
npm install
npm run dev
```

The normal `dev` and `build` commands enable the `ndi` feature.

A renderer-only diagnostic build is also available:

```bash
npm run dev:no-ndi
```

That build intentionally refuses to start an NDI sender, but it lets the rest of the application compile without the optional NDI dependency.

## First monitor test

1. Run the example.
2. Leave the defaults at `1920 × 1080`, `60 fps`, and source name `Junkpile 32`.
3. Click **Start NDI**.
4. Open **NDI Video Monitor** on macOS or **NDI Studio Monitor** on Windows.
5. Open its source menu.
6. Select the source containing `Junkpile 32`.

The receiver can display a machine-qualified name such as:

```text
Computer Name (Junkpile 32)
```

The native renderer and the NDI monitor should show the same animation.

## Controls

| Control | Purpose |
|---|---|
| Source name | Name advertised to NDI receivers |
| Groups | Optional comma-separated NDI groups |
| Resolution | 720p, 1080p, 1440p, or 4K |
| Frame rate | 24, 30, or 60 FPS |
| NDI clocks video | Lets the NDI sender clock outgoing video |
| Vertical flip | Reverses row order before BGRA publication |
| Start NDI | Applies the settings and creates the source |
| Stop NDI | Destroys the source and closes the worker |
| Reset metrics | Clears the pipeline counters |

Settings are locked while the sender is active. Stop NDI before changing the source format.

## Diagnostics

The controls window separates pressure at each stage:

| Metric | Meaning |
|---|---|
| Capture requests | Frames requested by the NDI cadence clock |
| GPU readbacks | Frames successfully copied back from wgpu |
| NDI frames sent | Frames handed to the NDI SDK |
| GPU drops | All readback slots were busy |
| CPU pool drops | No reusable BGRA buffer was available |
| Worker drops | The bounded two-frame NDI queue was full |
| Worker pending | Frames waiting for the NDI worker |
| CPU buffers free | Reusable full-frame buffers currently available |
| Readback slots busy | GPU buffers currently mapping |
| Raw frame bandwidth | Uncompressed RGBA/BGRA traffic before NDI compression |

A smooth monitor image with zero drops means the local pipeline is healthy. Receiver-side network or monitor issues can still occur independently.

## Resolution guidance

Start with 1080p60. Then test:

```text
720p60
1080p60
1440p60
4K30
4K60
```

4K60 is intentionally available rather than artificially blocked, but it has a much larger readback and network cost. Use the real-time counters to decide whether the hardware and network can sustain it.

Official NDI documentation notes that frame widths should be divisible by two; this example validates that requirement before reconfiguring the wgpu target.

## Troubleshooting

### The application does not compile

Confirm the NDI SDK is installed and set `NDI_SDK_DIR` if necessary. The official monitor alone may provide the runtime without the SDK headers used at build time.

### The source does not appear

- Confirm the UI says **sending** rather than **error**.
- Confirm the monitor is on the same machine or local network.
- Check NDI Access Manager groups if a custom group is configured.
- Temporarily clear the Groups field.
- Confirm local firewall/network permissions allow NDI discovery.
- Restart the official monitor after starting the source.

### The image is upside down

Enable **Vertical flip**. It is off by default because the wgpu path is already top-left.

### Drops increase

Lower resolution or frame rate and identify the stage:

- GPU drops: readback pressure
- CPU pool drops: RGBA-to-BGRA packing pressure
- Worker drops: NDI sender/receiver/network pressure

## Source layout

```text
32-wgpu-ndi-sender/
├── config/ndi.json
├── src/
│   ├── index.html
│   ├── app.js
│   └── styles.css
└── src-tauri/
    └── src/
        ├── main.rs
        ├── renderer.rs
        ├── ndi.rs
        ├── preview.rs
        ├── frame.rs
        ├── source.wgsl
        └── preview.wgsl
```

## Scope

This is an **NDI sender** example. It does not receive NDI streams, send audio, or provide NDI HX encoding. Receiver-side NDI belongs in a later Junkpile input example.
