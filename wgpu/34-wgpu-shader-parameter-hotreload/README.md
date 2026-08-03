# Junkpile 34 — wgpu Shader Stress Lab + Hot Reload

A native Tauri 2 + wgpu example that expands ShadeCore's live shader and parameter configuration concepts into a demanding WGSL laboratory.

The runtime workspace contains twelve shaders:

```text
shaders/
  01-kaleido-reactor.wgsl
  02-plasma-warp.wgsl
  03-infinite-tunnel.wgsl
  04-voronoi-storm.wgsl
  05-fractal-nebula.wgsl
  06-mandelbrot-reactor.wgsl
  07-raymarch-lattice.wgsl
  08-caustic-engine.wgsl
  09-hyperbolic-grid.wgsl
  10-interference-array.wgsl
  11-volumetric-storm.wgsl
  12-recursive-glyph-field.wgsl
```

The collection ranges from folded procedural fields and fractals to raymarching and volumetric sampling. Every shader shares the same live parameter contract and includes a practical `default`, stationary `still`, and intentionally demanding `peak` profile.

## Revision 0.2.0

This revision adds:

- Twelve substantially different WGSL shaders instead of four
- `u_complexity` for iteration, sample, and workload pressure
- Correct spin semantics across every shader
- Runtime shader/profile/parameter preservation across file saves
- A fresh v2 runtime-asset workspace so existing four-shader configs cannot hide the new collection

## Spin is angular velocity

`u_spin` is no longer a static orientation offset.

Every shader computes rotation from:

```wgsl
rotation = time * spin_speed
```

Therefore:

- `0.0` stops rotation
- Positive values rotate in one direction
- Negative values reverse direction
- Larger magnitudes rotate faster
- Smoothing changes how quickly the requested speed is reached

Other animation inside a shader may continue at zero spin, but the rotational component stops completely.

The control is measured in radians per second and ranges from `-4.0` to `4.0`.

## File saves do not change the selected shader

After launch, runtime selection is authoritative.

Saving an active or inactive WGSL file now preserves:

- Active shader
- Active profile
- Current parameter values
- Parameter targets

The candidate assets are validated and the currently selected shader is rebuilt in place. The application falls back to `render.json.active_frag` only when the current shader was actually removed from the catalog.

`active_frag` is therefore the **startup selection**, not a command that reasserts itself after every save.

## What the example demonstrates

- Twelve hot-swappable WGSL variants
- Practical and peak GPU workloads
- `render.json` shader catalog and startup selection
- `params.json` metadata, ranges, defaults, smoothing, and profiles
- Runtime shader selection preserved across file edits
- Per-shader profile selection
- Current and target parameter values
- Recursive directory watching
- Atomic-save editor compatibility
- Naga WGSL parsing and semantic validation
- wgpu pipeline validation through an error scope
- Last-known-good pipeline retention after invalid edits
- Native rendering independent from the HTML controls

## Run

```bash
cd 34-wgpu-shader-parameter-hotreload
npm install
npm run dev
```

Two windows should open:

1. HTML/CSS controls and diagnostics
2. Native wgpu renderer

This revision uses a new runtime workspace:

```text
shader-parameter-hotreload-v2
```

The exact OS-specific path appears in the controls window. The earlier four-shader runtime workspace is left untouched.

## Required test sequence

### 1. Cycle all shaders

Use **Previous shader** and **Next shader**. Verify that all twelve shaders activate without restarting.

Default keyboard codes while the controls window has focus:

```text
Shader next:       Quote / Period / Backquote
Shader previous:   Semicolon / Comma / IntlBackslash
Profile next:      BracketRight
Profile previous:  BracketLeft
```

### 2. Verify spin speed

For several shaders:

1. Set **Spin speed** to `0.0`; rotation must stop.
2. Raise it gradually; rotation must accelerate.
3. Move it below zero; rotation must reverse.
4. Select the `still` profile; spin returns to zero.

### 3. Push the GPU

Select a shader and cycle to its `peak` profile. The peak profile raises complexity and may also increase zoom, gain, or spin speed.

The most demanding shaders are expected to be:

```text
07-raymarch-lattice.wgsl
10-interference-array.wgsl
11-volumetric-storm.wgsl
```

The point is to expose the hardware limit rather than silently reduce quality. Watch the renderer FPS and frame time while comparing default and peak profiles.

### 4. Verify save-in-place behavior

1. Select any shader other than the startup shader.
2. Open the runtime asset directory.
3. Edit and save the selected WGSL file.
4. Confirm that the same shader stays selected.
5. Confirm that its active profile and slider targets remain unchanged.
6. Confirm that pipeline generation increases after a valid edit.

Saving an inactive shader should also leave the active shader unchanged.

### 5. Last-known-good protection

Click **Write invalid active shader**.

Expected result:

- Previous valid pipeline keeps rendering
- Failed reload count increases
- Pipeline generation does not increase
- Full WGSL diagnostic appears
- Active shader selection does not change

Then click **Restore active shader**.

## Parameter contract

The fixed uniform contract supports:

```text
params.x = u_gain
params.y = u_zoom
params.z = u_spin        // angular velocity, radians / second
params.w = u_complexity  // iterations / samples / workload
```

Parameter behavior:

```text
alpha = 1 - smoothing
current += (target - current) * alpha
```

- `0.0` smoothing is immediate
- Larger values move more slowly
- Smoothing is limited to `0.0–0.999`

`u_complexity` ranges from `1.0` to `12.0`. Each shader interprets it according to its algorithm, typically by increasing loop iterations, raymarch steps, octaves, emitters, or volume samples.

## Shader contract

Every shader must provide:

```wgsl
@vertex fn vs_main(...)
@fragment fn fs_main(...)
@group(0) @binding(0) var<uniform> u: Uniforms
```

Uniform layout:

```wgsl
struct Uniforms {
    timing: vec4<f32>,
    resolution: vec4<f32>,
    params: vec4<f32>,
};
```

Every built-in shader also contains:

```wgsl
const LIVE_EDIT_TINT: f32 = 0.0;
```

The valid-edit test toggles that constant without changing shader selection.

## Last-known-good behavior

Candidate assets are validated before live state is replaced.

A reload can fail because of malformed JSON, unknown fields, invalid paths, missing files, bad profile references, WGSL parse errors, WGSL semantic errors, or wgpu pipeline validation errors.

On failure:

- Previous pipeline remains active
- Previous runtime configuration remains active
- Renderer continues
- Full error is displayed

## Architecture

```text
Runtime asset directory
├── render.json
├── params.json
└── shaders/*.wgsl
        │
        ▼
Recursive file watcher
        │
        ▼
JSON validation
+ Naga WGSL validation
+ wgpu pipeline validation
        │
        ├── failure ──► preserve pipeline + runtime selection
        │
        └── success ──► replace selected shader pipeline in place
                              │
                              ▼
                  Authoritative offscreen texture
                              │
                              ▼
                       Native preview sink
```

## Build

```bash
npm run build
```
