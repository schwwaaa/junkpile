# Junkpile example matrix

This matrix is generated from the project directories in the current repository. It deliberately avoids advertising a fixed total because the library is expected to grow.

## Reading the matrix

- **Project** is the actual folder name.
- **Tauri** is derived from the project Cargo dependency, not assumed from the parent directory.
- **Family** describes the capability the project isolates.
- **Topology** describes whether pixels live in a WebView or a native GPU surface and whether controls are separated.
- **Status** is descriptive, not a universal stability guarantee; local `README.md` and `VALIDATION.md` files remain authoritative.

### Native numbering notes

- `wgpu/29-*` is not present in the current tree. Later I/O projects explicitly refer to the earlier network-streaming implementation as quarantined.
- `wgpu/19-wgpu-gesture-field-wgsl-keyword-fix` remains in the repository as a historical repair copy. The public catalog treats `19-wgpu-gesture-field` as canonical Example 19.
- `wgpu/40-wgpu-network-output` is retained as an unresolved network-output experiment and should not be treated as the stable routing foundation.

## Tauri v1 directory

| No. | Project | Tauri | Family | Topology | Status |
|---:|---|---:|---|---|---|
| 00 | [`00-p5-tauri-single-template`](../v1/00-p5-tauri-single-template/README.md) | 1 | p5 | single-window | documented-current |
| 01 | [`01-p5-tauri-ws-template`](../v1/01-p5-tauri-ws-template/README.md) | 1 | p5 | two-window | documented-current |
| 02 | [`02-webgl-tauri-v1-single-template`](../v1/02-webgl-tauri-v1-single-template/README.md) | 1 | webgl | single-window | documented-current |
| 03 | [`03-webgl-tauri-v1-ws-template`](../v1/03-webgl-tauri-v1-ws-template/README.md) | 1 | webgl | two-window | documented-current |
| 04 | [`04-glsl-tauri-v1-single-template`](../v1/04-glsl-tauri-v1-single-template/README.md) | 1 | glsl | single-window | documented-current |
| 05 | [`05-glsl-tauri-v1-ws-template`](../v1/05-glsl-tauri-v1-ws-template/README.md) | 1 | glsl | two-window | documented-current |
| 06 | [`06-webcam-tauri-v1-single-template`](../v1/06-webcam-tauri-v1-single-template/README.md) | 1 | camera | single-window | documented-current |
| 07 | [`07-webcam-tauri-v1-ws-template`](../v1/07-webcam-tauri-v1-ws-template/README.md) | 1 | camera | two-window | documented-current |
| 08 | [`08-feedback-tauri-v1-single-template`](../v1/08-feedback-tauri-v1-single-template/README.md) | 1 | feedback | single-window | documented-current |
| 09 | [`09-feedback-tauri-v1-ws-template`](../v1/09-feedback-tauri-v1-ws-template/README.md) | 1 | feedback | two-window | documented-current |
| 10 | [`10-p5-tauri-midi-template`](../v1/10-p5-tauri-midi-template/README.md) | 1 | midi | single-window | documented-current |
| 11 | [`11-p5-tauri-osc-template`](../v1/11-p5-tauri-osc-template/README.md) | 1 | osc | single-window | documented-current |
| 12 | [`12-tauri-v1-video-texture-player`](../v1/12-tauri-v1-video-texture-player/README.md) | 1 | video | single-window | documented-current |
| 13 | [`13-tauri-v1-audio-reactive-fft`](../v1/13-tauri-v1-audio-reactive-fft/README.md) | 1 | audio | single-window | documented-current |
| 14 | [`14-tauri-v1-canvas-recorder`](../v1/14-tauri-v1-canvas-recorder/README.md) | 1 | recording | single-window | documented-current |
| 15 | [`15-tauri-v1-multipass-compositor`](../v1/15-tauri-v1-multipass-compositor/README.md) | 1 | compositing | single-window | documented-current |
| 16 | [`16-tauri-v1-image-texture-processor`](../v1/16-tauri-v1-image-texture-processor/README.md) | 1 | image | single-window | documented-current |
| 17 | [`17-tauri-v1-glsl-shader-playground`](../v1/17-tauri-v1-glsl-shader-playground/README.md) | 1 | glsl | single-window | documented-current |
| 18 | [`18-tauri-v1-texture-mixer`](../v1/18-tauri-v1-texture-mixer/README.md) | 1 | compositing | single-window | documented-current |
| 19 | [`19-tauri-v1-webcam-compositor`](../v1/19-tauri-v1-webcam-compositor/README.md) | 1 | camera | single-window | documented-current |
| 20 | [`20-tauri-v1-live-video-switcher-speed`](../v1/20-tauri-v1-live-video-switcher-speed/README.md) | 1 | video | single-window | documented-current |
| 21 | [`21-tauri-v1-projection-mapper`](../v1/21-tauri-v1-projection-mapper/README.md) | 1 | projection | two-window | documented-current |
| 22 | [`22-tauri-v1-image-sequence-player`](../v1/22-tauri-v1-image-sequence-player/README.md) | 1 | image | two-window | documented-current |
| 23 | [`23-tauri-v1-audio-file-fft-visualizer`](../v1/23-tauri-v1-audio-file-fft-visualizer/README.md) | 1 | audio | single-window | documented-current |
| 24 | [`24-tauri-v1-keyframe-automation`](../v1/24-tauri-v1-keyframe-automation/README.md) | 1 | automation | single-window | documented-current |
| 25 | [`25-wgpu-ultra-resolution-export`](../v1/25-wgpu-ultra-resolution-export/README.md) | 2 | export | native-window | documented-current |

## Tauri v2 WebView

| No. | Project | Tauri | Family | Topology | Status |
|---:|---|---:|---|---|---|
| 00 | [`00-p5-tauri-v2-single-template`](../v2/00-p5-tauri-v2-single-template/README.md) | 2 | p5 | single-window | documented-current |
| 01 | [`01-p5-tauri-v2-ws-template`](../v2/01-p5-tauri-v2-ws-template/README.md) | 2 | p5 | two-window | documented-current |
| 02 | [`02-webgl-tauri-v2-single-template`](../v2/02-webgl-tauri-v2-single-template/README.md) | 2 | webgl | single-window | documented-current |
| 03 | [`03-webgl-tauri-v2-ws-template`](../v2/03-webgl-tauri-v2-ws-template/README.md) | 2 | webgl | two-window | documented-current |
| 04 | [`04-glsl-tauri-v2-single-template`](../v2/04-glsl-tauri-v2-single-template/README.md) | 2 | glsl | single-window | documented-current |
| 05 | [`05-glsl-tauri-v2-ws-template`](../v2/05-glsl-tauri-v2-ws-template/README.md) | 2 | glsl | two-window | documented-current |
| 06 | [`06-webcam-tauri-v2-single-template`](../v2/06-webcam-tauri-v2-single-template/README.md) | 2 | camera | single-window | documented-current |
| 07 | [`07-webcam-tauri-v2-ws-template`](../v2/07-webcam-tauri-v2-ws-template/README.md) | 2 | camera | two-window | documented-current |
| 08 | [`08-feedback-tauri-v2-single-template`](../v2/08-feedback-tauri-v2-single-template/README.md) | 2 | feedback | single-window | documented-current |
| 09 | [`09-feedback-tauri-v2-ws-template`](../v2/09-feedback-tauri-v2-ws-template/README.md) | 2 | feedback | two-window | documented-current |
| 10 | [`10-tauri-v2-midi-input`](../v2/10-tauri-v2-midi-input/README.md) | 2 | midi | single-window | documented-current |
| 11 | [`11-tauri-v2-osc-input`](../v2/11-tauri-v2-osc-input/README.md) | 2 | osc | single-window | documented-current |
| 12 | [`12-tauri-v2-video-texture-player`](../v2/12-tauri-v2-video-texture-player/README.md) | 2 | video | single-window | documented-current |
| 13 | [`13-tauri-v2-audio-reactive-fft`](../v2/13-tauri-v2-audio-reactive-fft/README.md) | 2 | audio | single-window | documented-current |
| 14 | [`14-tauri-v2-canvas-recorder`](../v2/14-tauri-v2-canvas-recorder/README.md) | 2 | recording | single-window | documented-current |
| 15 | [`15-tauri-v2-multipass-compositor`](../v2/15-tauri-v2-multipass-compositor/README.md) | 2 | compositing | single-window | documented-current |
| 16 | [`16-tauri-v2-image-texture-processor`](../v2/16-tauri-v2-image-texture-processor/README.md) | 2 | image | single-window | documented-current |
| 17 | [`17-tauri-v2-glsl-shader-playground`](../v2/17-tauri-v2-glsl-shader-playground/README.md) | 2 | glsl | single-window | documented-current |
| 18 | [`18-tauri-v2-texture-mixer`](../v2/18-tauri-v2-texture-mixer/README.md) | 2 | compositing | single-window | documented-current |
| 19 | [`19-tauri-v2-webcam-compositor`](../v2/19-tauri-v2-webcam-compositor/README.md) | 2 | camera | single-window | documented-current |
| 20 | [`20-tauri-v2-live-video-switcher`](../v2/20-tauri-v2-live-video-switcher/README.md) | 2 | video | single-window | documented-current |
| 21 | [`21-tauri-v2-projection-mapper`](../v2/21-tauri-v2-projection-mapper/README.md) | 2 | projection | two-window | documented-current |
| 22 | [`22-tauri-v2-image-sequence-player`](../v2/22-tauri-v2-image-sequence-player/README.md) | 2 | image | two-window | documented-current |
| 23 | [`23-tauri-v2-audio-file-fft-visualizer`](../v2/23-tauri-v2-audio-file-fft-visualizer/README.md) | 2 | audio | single-window | documented-current |
| 24 | [`24-tauri-v2-keyframe-automation`](../v2/24-tauri-v2-keyframe-automation/README.md) | 2 | automation | single-window | documented-current |
| 25 | [`25-tauri-v2-multi-display-output-manager`](../v2/25-tauri-v2-multi-display-output-manager/README.md) | 2 | display | single-window | documented-current |

## Native Rust/wgpu

| No. | Project | Tauri | Family | Topology | Status |
|---:|---|---:|---|---|---|
| 00 | [`00-wgpu-surface-probe`](../wgpu/00-wgpu-surface-probe/README.md) | 2 | foundation | native-window | documented-current |
| 01 | [`01-wgpu-resize-fullscreen`](../wgpu/01-wgpu-resize-fullscreen/README.md) | 2 | foundation | native-window | documented-current |
| 02 | [`02-wgpu-wgsl-shader`](../wgpu/02-wgpu-wgsl-shader/README.md) | 2 | foundation | native-window | documented-current |
| 03 | [`03-wgpu-tauri-controls`](../wgpu/03-wgpu-tauri-controls/README.md) | 2 | foundation | hybrid-controls-native-renderer | documented-current |
| 04 | [`04-wgpu-image-texture`](../wgpu/04-wgpu-image-texture/README.md) | 2 | image | native-window | documented-current |
| 05 | [`05-wgpu-ping-pong-feedback`](../wgpu/05-wgpu-ping-pong-feedback/README.md) | 2 | feedback-compute | native-window | documented-current |
| 06 | [`06-wgpu-multipass-render-graph`](../wgpu/06-wgpu-multipass-render-graph/README.md) | 2 | foundation | native-window | documented-current |
| 07 | [`07-wgpu-high-resolution-lab`](../wgpu/07-wgpu-high-resolution-lab/README.md) | 2 | foundation | native-window | documented-current |
| 08 | [`08-wgpu-backend-lab`](../wgpu/08-wgpu-backend-lab/README.md) | 2 | foundation | native-window | documented-current |
| 09 | [`09-wgpu-compute-particles-additive-blend`](../wgpu/09-wgpu-compute-particles-additive-blend/README.md) | 2 | compute | native-window | documented-current |
| 10 | [`10-wgpu-3d-particle-volume`](../wgpu/10-wgpu-3d-particle-volume/README.md) | 2 | compute | native-window | documented-current |
| 11 | [`11-wgpu-volumetric-raymarcher`](../wgpu/11-wgpu-volumetric-raymarcher/README.md) | 2 | 3d | native-window | documented-current |
| 12 | [`12-wgpu-compute-fluid-feedback`](../wgpu/12-wgpu-compute-fluid-feedback/README.md) | 2 | feedback-compute | native-window | documented-current |
| 13 | [`13-wgpu-voxel-feedback-volume`](../wgpu/13-wgpu-voxel-feedback-volume/README.md) | 2 | feedback-compute | native-window | documented-current |
| 14 | [`14-wgpu-native-webcam-texture-avfoundation-macos`](../wgpu/14-wgpu-native-webcam-texture-avfoundation-macos/README.md) | 2 | camera | hybrid-controls-native-renderer | documented-current |
| 15 | [`15-wgpu-native-video-decoder-effect-ui`](../wgpu/15-wgpu-native-video-decoder-effect-ui/README.md) | 2 | video | hybrid-controls-native-renderer | documented-current |
| 16 | [`16-wgpu-audio-reactive-spectrum`](../wgpu/16-wgpu-audio-reactive-spectrum/README.md) | 2 | audio | hybrid-controls-native-renderer | documented-current |
| 17 | [`17-wgpu-midi-parameter-registry`](../wgpu/17-wgpu-midi-parameter-registry/README.md) | 2 | midi | hybrid-controls-native-renderer | documented-current |
| 18 | [`18-wgpu-osc-network-control`](../wgpu/18-wgpu-osc-network-control/README.md) | 2 | osc | hybrid-controls-native-renderer | documented-current |
| 19 | [`19-wgpu-gesture-field`](../wgpu/19-wgpu-gesture-field/README.md) | 2 | interaction | hybrid-controls-native-renderer | documented-current |
| 20 | [`20-wgpu-multi-input-compositor`](../wgpu/20-wgpu-multi-input-compositor/README.md) | 2 | compositing | hybrid-controls-native-renderer | documented-current |
| 21 | [`21-wgpu-gltf-scene-loader`](../wgpu/21-wgpu-gltf-scene-loader/README.md) | 2 | 3d | hybrid-controls-native-renderer | documented-current |
| 22 | [`22-wgpu-skeletal-pose-lab`](../wgpu/22-wgpu-skeletal-pose-lab/README.md) | 2 | 3d | hybrid-controls-native-renderer | documented-current |
| 23 | [`23-wgpu-morph-target-lab`](../wgpu/23-wgpu-morph-target-lab/README.md) | 2 | 3d | hybrid-controls-native-renderer | documented-current |
| 24 | [`24-wgpu-mesh-feedback-deformer`](../wgpu/24-wgpu-mesh-feedback-deformer/README.md) | 2 | feedback-compute | hybrid-controls-native-renderer | documented-current |
| 25 | [`25-wgpu-ultra-resolution-export`](../wgpu/25-wgpu-ultra-resolution-export/README.md) | 2 | export | native-window | documented-current |
| 26 | [`26-wgpu-io-config-foundation`](../wgpu/26-wgpu-io-config-foundation/README.md) | 2 | io-foundation | hybrid-controls-native-renderer | documented-current |
| 27 | [`27-wgpu-frame-output-contract`](../wgpu/27-wgpu-frame-output-contract/README.md) | 2 | io-foundation | hybrid-controls-native-renderer | documented-current |
| 28 | [`28-wgpu-ffmpeg-record`](../wgpu/28-wgpu-ffmpeg-record/README.md) | 2 | recording | hybrid-controls-native-renderer | documented-current |
| 30 | [`30-wgpu-high-resolution-record`](../wgpu/30-wgpu-high-resolution-record/README.md) | 2 | recording | hybrid-controls-native-renderer | documented-current |
| 31 | [`31-wgpu-io-profile-router`](../wgpu/31-wgpu-io-profile-router/README.md) | 2 | io-foundation | hybrid-controls-native-renderer | documented-current |
| 32 | [`32-wgpu-ndi-sender`](../wgpu/32-wgpu-ndi-sender/README.md) | 2 | ndi | hybrid-controls-native-renderer | ndi-sdk-required |
| 33 | [`33-wgpu-preview-output-modes`](../wgpu/33-wgpu-preview-output-modes/README.md) | 2 | preview | hybrid-controls-native-renderer | documented-current |
| 34 | [`34-wgpu-shader-parameter-hotreload`](../wgpu/34-wgpu-shader-parameter-hotreload/README.md) | 2 | shader-tooling | hybrid-controls-native-renderer | documented-current |
| 35 | [`35-wgpu-assets-state-logging`](../wgpu/35-wgpu-assets-state-logging/README.md) | 2 | runtime | hybrid-controls-native-renderer | documented-current |
| 36 | [`36-wgpu-runtime-output-router`](../wgpu/36-wgpu-runtime-output-router/README.md) | 2 | routing | hybrid-controls-native-renderer | documented-current |
| 37 | [`37-wgpu-syphon-sender`](../wgpu/37-wgpu-syphon-sender/README.md) | 2 | syphon | hybrid-controls-native-renderer | macos-specific |
| 38 | [`38-wgpu-spout-sender`](../wgpu/38-wgpu-spout-sender/README.md) | 2 | spout | hybrid-controls-native-renderer | windows-specific |
| 39 | [`39-wgpu-cross-platform-output-router`](../wgpu/39-wgpu-cross-platform-output-router/README.md) | 2 | routing | hybrid-controls-native-renderer | documented-current |
| 40 | [`40-wgpu-network-output`](../wgpu/40-wgpu-network-output/README.md) | 2 | network | hybrid-controls-native-renderer | unresolved-under-review |
| 41 | [`41-wgpu-appliance-runtime`](../wgpu/41-wgpu-appliance-runtime/README.md) | 2 | runtime | hybrid-controls-native-renderer | documented-current |
| 42 | [`42-wgpu-audio-reactive-fft`](../wgpu/42-wgpu-audio-reactive-fft/README.md) | 2 | audio | hybrid-controls-native-renderer | documented-current |
| 43 | [`43-wgpu-av-recorder`](../wgpu/43-wgpu-av-recorder/README.md) | 2 | recording | hybrid-controls-native-renderer | working-baseline |
| 44 | [`44-wgpu-wgsl-shader-playground`](../wgpu/44-wgpu-wgsl-shader-playground/README.md) | 2 | shader-tooling | native-window | documented-current |

> **29:** intentionally absent from the current tree; later project documentation identifies the earlier network-streaming branch as quarantined.

## Track relationship

The WebView and native collections are complementary rather than replacements. WebView projects provide approachable creative-coding and browser-media patterns; native wgpu projects expose explicit GPU ownership and currently contain the repository's deeper high-resolution, FFmpeg-recording, and external-output-router references. That placement is not a claim that native transports such as NDI, Syphon, or Spout are exclusive to wgpu.

Native counterparts do not need to share the same number as older WebView examples. The current native parity/application pass includes, among others, audio-reactive FFT, A/V recording, and WGSL shader editing.

## Source of truth

- Machine-readable catalog: [`examples.json`](examples.json)
- Native progression: [`../wgpu/README.md`](../wgpu/README.md)
- Architecture: [`ARCHITECTURE.md`](ARCHITECTURE.md)
