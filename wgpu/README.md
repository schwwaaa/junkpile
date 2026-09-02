# Junkpile Native wgpu

The `wgpu/` collection is Junkpile's explicit native GPU path.

```text
HTML controls / native inputs
          ↓ Tauri commands + shared state
Rust application state
          ↓
wgpu render / compute graph
          ↓
Authoritative GPU textures
          ↓
Metal · Vulkan · Direct3D 12
```

The renderer and controls do not have to share one surface. Many projects use a Tauri WebView for editing and diagnostics while Rust owns a separate native GPU window.

## Progression

### Foundations and GPU behavior

| No. | Project | Purpose |
|---:|---|---|
| 00 | `00-wgpu-surface-probe` | Native surface creation, adapter/backend diagnostics |
| 01 | `01-wgpu-resize-fullscreen` | Resize, HiDPI, fullscreen, surface recovery |
| 02 | `02-wgpu-wgsl-shader` | WGSL fullscreen rendering and uniforms |
| 03 | `03-wgpu-tauri-controls` | HTML → Rust → native renderer control path |
| 04 | `04-wgpu-image-texture` | Native image texture upload |
| 05 | `05-wgpu-ping-pong-feedback` | Persistent ping-pong GPU feedback |
| 06 | `06-wgpu-multipass-render-graph` | Explicit multipass graph |
| 07 | `07-wgpu-high-resolution-lab` | Render definition independent from preview size |
| 08 | `08-wgpu-backend-lab` | GPU backend and adapter investigation |

### Compute, 3D, and temporal graphics

| No. | Project | Purpose |
|---:|---|---|
| 09 | `09-wgpu-compute-particles-additive-blend` | Compute particles and additive rendering |
| 10 | `10-wgpu-3d-particle-volume` | XYZ particle simulation and perspective render |
| 11 | `11-wgpu-volumetric-raymarcher` | Procedural volumetric/raymarched scenes |
| 12 | `12-wgpu-compute-fluid-feedback` | GPU fluid-style feedback |
| 13 | `13-wgpu-voxel-feedback-volume` | Persistent 3D volume field |

### Native media and control

| No. | Project | Purpose |
|---:|---|---|
| 14 | `14-wgpu-native-webcam-texture-avfoundation-macos` | Direct AVFoundation camera path on macOS |
| 15 | `15-wgpu-native-video-decoder-effect-ui` | FFmpeg video decode → native texture → effects |
| 16 | `16-wgpu-audio-reactive-spectrum` | Native audio capture and spectrum-driven rendering |
| 17 | `17-wgpu-midi-parameter-registry` | MIDI routed through reusable parameter registry |
| 18 | `18-wgpu-osc-network-control` | OSC/UDP routed into renderer parameters |
| 19 | `19-wgpu-gesture-field` | Gesture-field interaction system |
| 20 | `20-wgpu-multi-input-compositor` | Native multi-input convergence/compositing |

The repository also contains `19-wgpu-gesture-field-wgsl-keyword-fix`, a historical repair copy. The public catalog treats `19-wgpu-gesture-field` as the canonical Example 19 and leaves the repair copy in source history without assigning it a new number.

### Scene, deformation, and export

| No. | Project | Purpose |
|---:|---|---|
| 21 | `21-wgpu-gltf-scene-loader` | glTF scene import |
| 22 | `22-wgpu-skeletal-pose-lab` | Skinning, animation, manual pose inspection |
| 23 | `23-wgpu-morph-target-lab` | GPU morph-target animation |
| 24 | `24-wgpu-mesh-feedback-deformer` | Persistent mesh deformation / feedback |
| 25 | `25-wgpu-ultra-resolution-export` | Tiled high-resolution still export |

### I/O and recording foundation

| No. | Project | Purpose |
|---:|---|---|
| 26 | `26-wgpu-io-config-foundation` | Typed I/O configuration, validation, hot reload |
| 27 | `27-wgpu-frame-output-contract` | Shared authoritative frame and sink lifecycle |
| 28 | `28-wgpu-ffmpeg-record` | Real GPU readback → FFmpeg file recording |
| 29 | — | Not present in the current tree; referenced by later projects as a quarantined network-streaming experiment |
| 30 | `30-wgpu-high-resolution-record` | Native-resolution recording through 8K-class presets where supported |
| 31 | `31-wgpu-io-profile-router` | Validated JSON profiles for render + file-output routes |

### External outputs and runtime infrastructure

| No. | Project | Purpose |
|---:|---|---|
| 32 | `32-wgpu-ndi-sender` | NDI sender with bounded readback/worker pipeline |
| 33 | `33-wgpu-preview-output-modes` | Fit/fill/stretch/pixel/off presentation sink |
| 34 | `34-wgpu-shader-parameter-hotreload` | WGSL stress lab, hot reload, parameter profiles |
| 35 | `35-wgpu-assets-state-logging` | Asset roots, persistent runtime state, structured logs |
| 36 | `36-wgpu-runtime-output-router` | Preview + NDI + recording from one authoritative texture |
| 37 | `37-wgpu-syphon-sender` | macOS Syphon/Metal sender |
| 38 | `38-wgpu-spout-sender` | Windows Spout2 sender |
| 39 | `39-wgpu-cross-platform-output-router` | Preview + NDI + recording + platform texture sharing |
| 40 | `40-wgpu-network-output` | Network publishing experiment; unresolved / under review |
| 41 | `41-wgpu-appliance-runtime` | Windowless/config-driven runtime and health reporting |

### Native counterparts and application-facing tools

| No. | Project | Purpose |
|---:|---|---|
| 42 | `42-wgpu-audio-reactive-fft` | Native counterpart to WebView audio-reactive FFT |
| 43 | `43-wgpu-av-recorder` | Native high-resolution A/V recorder |
| 44 | `44-wgpu-wgsl-shader-playground` | Native counterpart to the WebView shader playground |

The numbering is historical project identity, not a promise that every future project must fit into a perfectly contiguous sequence.

## Core I/O contract

The I/O series establishes a reusable pattern:

```text
renderer / compute
      ↓
authoritative GPU texture
      ↓ VideoFrame / sink contract
      ├── preview
      ├── file recorder
      ├── NDI
      ├── Syphon / Spout
      └── other bounded workers
```

Output-specific logic should not own the renderer. Slow workers use bounded queues and explicit drop/pressure metrics so a failing output can be isolated.

## Native recording stack

The stable file-recording lineage is:

```text
27 frame/output contract
      ↓
28 FFmpeg recording
      ↓
30 high-resolution recording
      ↓
31 profile-driven recording
      ↓
36/39 multi-output routing
      ↓
43 A/V recorder
```

Example 43 adds microphone or audio-file capture and performs a final audio/video mux after the video writer completes.

## Status boundary

Do not infer stability from folder presence alone.

- **Example 29**: earlier network-streaming branch referenced as quarantined by later projects; not present in the current tree.
- **Example 40**: retained for investigation, but network publishing is unresolved and should not be used as the stable routing foundation.
- **Examples 36, 39, and 41** intentionally exclude the unresolved network worker path.
- **Syphon** is macOS-specific.
- **Spout** is Windows-specific.
- **NDI** requires the NDI SDK/runtime for enabled builds.

## Running a project

Every project is standalone:

```bash
cd wgpu/43-wgpu-av-recorder
npm install
npm run dev
```

Use the local README and any `VALIDATION.md` file for project-specific requirements.
