# 18 — wgpu OSC Network Control

A standalone **Tauri 2 + Rust + wgpu 29** example that receives Open Sound Control messages over UDP and routes them through a reusable parameter registry before rendering on a native Metal, Vulkan, or DX12 surface.

```text
Max/MSP / TouchOSC / Pure Data / SuperCollider / sensors
                         ↓ UDP
                   rosc OSC decoder
                         ↓
      address + argument-index parameter registry
                         ↓
        normalized values + smoothing + activity lanes
                         ↓
                     wgpu renderer
```

## Run

```bash
npm install
npm run dev:metal
```

Automatic backend selection:

```bash
npm run dev
```

## Default listener

```text
Bind host: 0.0.0.0
UDP port: 9000
```

`0.0.0.0` accepts local and network traffic. Use `127.0.0.1` when you want local-only control.

## Starter OSC map

The application loads this map at startup:

| OSC address | Renderer parameter | Expected input |
|---|---|---|
| `/hue` | Hue | 0–1 |
| `/zoom` | Zoom | 0–1 |
| `/rotation` | Rotation | 0–1 |
| `/field` | Field strength | 0–1 |
| `/turbulence` | Turbulence | 0–1 |
| `/trail` | Trail persistence | 0–1 |
| `/exposure` | Exposure | 0–1 |
| `/pulse_decay` | Pulse decay | 0–1 |

The mapping editor can also normalize nonstandard inputs such as `0–127`, `-1–1`, or sensor-unit ranges.

## OSC Learn

1. Click **Learn** beside a parameter.
2. Send a message containing at least one numeric argument.
3. The address and first numeric argument index are assigned to that parameter.
4. Edit input/output ranges, inversion, or smoothing in the mapping table.

Supported learnable values include OSC int, float, long, double, bool, and char arguments.

## Message and bundle handling

- UDP datagrams are decoded on a dedicated Rust thread.
- Nested bundles are expanded recursively.
- The monitor records address, argument types, values, sender, and bundle depth.
- Bundle timetags are displayed structurally but messages are applied immediately in this example.
- The render thread never performs socket I/O.

## Address activity buffer

Every incoming address hashes into one of 32 GPU activity lanes. The lanes decay over time and remain independent from the eight scalar parameter mappings. This means unmapped OSC traffic still produces visible structured activity.

## Companion examples

- `examples/max/junkpile-osc-test.maxpat`
- `examples/supercollider/send-test.scd`

## Security note

OSC over UDP has no authentication or encryption in this example. Bind to `127.0.0.1` when remote network access is unnecessary, and do not expose the port directly to the public internet.

## Project structure

```text
src-tauri/src/
├── main.rs       Tauri commands and window lifecycle
├── osc.rs        UDP listener, OSC decoder, mappings, monitor, snapshots
├── renderer.rs   native wgpu surface and render loop
└── osc.wgsl      network-activity visualization

src/
├── index.html
├── app.js
└── style.css
```
