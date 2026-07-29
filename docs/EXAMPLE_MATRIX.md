# Junkpile example matrix

**Baseline:** July 26, 2026  
**Total:** 78 independent examples · three collections of 26

Use the collection and number together. Numbers intentionally repeat across tracks because each track teaches a different render ownership model.

| Collection | No. | Folder | Lesson | Topology | Primary input | Renderer |
| --- | --- | --- | --- | --- | --- | --- |
| v1 | 00 | `p5-tauri-single-template` | p5.js Shader · Single Window | single-window | DOM controls | p5.js WebGL |
| v1 | 01 | `p5-tauri-ws-template` | p5.js Shader · Two Window | two-window | WebSocket controls | p5.js WebGL |
| v1 | 02 | `webgl-tauri-v1-single-template` | Raw WebGL · Single Window | single-window | DOM controls | Raw WebGL 1 / GLSL |
| v1 | 03 | `webgl-tauri-v1-ws-template` | Raw WebGL · Two Window | two-window | WebSocket controls | Raw WebGL 1 / GLSL |
| v1 | 04 | `glsl-tauri-v1-single-template` | External GLSL · Single Window | single-window | Shader file + DOM controls | Raw WebGL 1 / GLSL |
| v1 | 05 | `glsl-tauri-v1-ws-template` | External GLSL · Two Window | two-window | Shader file + WebSocket controls | Raw WebGL 1 / GLSL |
| v1 | 06 | `webcam-tauri-v1-single-template` | Webcam Texture · Single Window | single-window | Webcam + DOM controls | Raw WebGL 1 / GLSL |
| v1 | 07 | `webcam-tauri-v1-ws-template` | Webcam Texture · Two Window | two-window | Webcam + WebSocket controls | Raw WebGL 1 / GLSL |
| v1 | 08 | `feedback-tauri-v1-single-template` | Feedback Simulation · Single Window | single-window | Webcam + pointer + DOM controls | Raw WebGL 1 / GLSL |
| v1 | 09 | `feedback-tauri-v1-ws-template` | Feedback Simulation · Two Window | two-window | Webcam + pointer + WebSocket controls | Raw WebGL 1 / GLSL |
| v1 | 10 | `p5-tauri-midi-template` | MIDI Input | single-window | MIDI + DOM controls | WebView WebGL / browser media + Rust integrations |
| v1 | 11 | `p5-tauri-osc-template` | OSC Input | single-window | OSC + DOM controls | WebView WebGL / browser media + Rust integrations |
| v1 | 12 | `12-tauri-v1-video-texture-player` | Video Texture Player | single-window | Video file + transport | WebView WebGL / browser media + Rust integrations |
| v1 | 13 | `13-tauri-v1-audio-reactive-fft` | Audio-Reactive FFT | single-window | Microphone + DOM controls | WebView WebGL / browser media + Rust integrations |
| v1 | 14 | `14-tauri-v1-canvas-recorder` | Canvas Recorder | single-window | Canvas + optional microphone | WebView WebGL / browser media + Rust integrations |
| v1 | 15 | `15-tauri-v1-multipass-compositor` | Multipass Compositor | single-window | Images/video + DOM controls | WebView WebGL / browser media + Rust integrations |
| v1 | 16 | `16-tauri-v1-image-texture-processor` | Image Texture Processor | single-window | Image files + drag/drop | WebView WebGL / browser media + Rust integrations |
| v1 | 17 | `17-tauri-v1-glsl-shader-playground-terminal` | GLSL Shader Playground | single-window | Shader source + DOM controls | WebView WebGL / browser media + Rust integrations |
| v1 | 18 | `18-tauri-v1-texture-mixer` | Texture Mixer | single-window | Two image/video sources | WebView WebGL / browser media + Rust integrations |
| v1 | 19 | `19-tauri-v1-webcam-compositor` | Webcam Compositor | single-window | Webcam + image/video | WebView WebGL / browser media + Rust integrations |
| v1 | 20 | `20-tauri-v1-live-video-switcher` | Live Video Switcher | multi-source | Video/camera/generators | WebView WebGL / browser media + Rust integrations |
| v1 | 21 | `21-tauri-v1-projection-mapper` | Projection Mapper | two-window | Media + pointer calibration | WebView WebGL / browser media + Rust integrations |
| v1 | 22 | `22-tauri-v1-image-sequence-player` | Image Sequence Player | two-window | Image sequence | WebView WebGL / browser media + Rust integrations |
| v1 | 23 | `23-tauri-v1-audio-file-fft-visualizer` | Audio File FFT Visualizer | single-window | Audio file | WebView WebGL / browser media + Rust integrations |
| v1 | 24 | `24-tauri-v1-keyframe-automation` | Keyframe Automation | single-window | Timeline + manual controls | WebView WebGL / browser media + Rust integrations |
| v1 | 25 | `25-tauri-v1-multi-display-output-manager` | Multi-Display Output Manager | multi-window | Generated/media sources | WebView WebGL / browser media + Rust integrations |
| v2 | 00 | `p5-tauri-v2-single-template` | p5.js Shader · Single Window | single-window | DOM controls | p5.js WebGL |
| v2 | 01 | `p5-tauri-v2-ws-template` | p5.js Shader · Two Window | two-window | WebSocket controls | p5.js WebGL |
| v2 | 02 | `webgl-tauri-v2-single-template` | Raw WebGL · Single Window | single-window | DOM controls | Raw WebGL 1 / GLSL |
| v2 | 03 | `webgl-tauri-v2-ws-template` | Raw WebGL · Two Window | two-window | WebSocket controls | Raw WebGL 1 / GLSL |
| v2 | 04 | `glsl-tauri-v2-single-template` | External GLSL · Single Window | single-window | Shader file + DOM controls | Raw WebGL 1 / GLSL |
| v2 | 05 | `glsl-tauri-v2-ws-template` | External GLSL · Two Window | two-window | Shader file + WebSocket controls | Raw WebGL 1 / GLSL |
| v2 | 06 | `webcam-tauri-v2-single-template` | Webcam Texture · Single Window | single-window | Webcam + DOM controls | Raw WebGL 1 / GLSL |
| v2 | 07 | `webcam-tauri-v2-ws-template` | Webcam Texture · Two Window | two-window | Webcam + WebSocket controls | Raw WebGL 1 / GLSL |
| v2 | 08 | `feedback-tauri-v2-single-template` | Feedback Simulation · Single Window | single-window | Webcam + pointer + DOM controls | Raw WebGL 1 / GLSL |
| v2 | 09 | `feedback-tauri-v2-ws-template` | Feedback Simulation · Two Window | two-window | Webcam + pointer + WebSocket controls | Raw WebGL 1 / GLSL |
| v2 | 10 | `10-tauri-v2-midi-input` | MIDI Input | single-window | MIDI + DOM controls | WebView WebGL / browser media + Rust integrations |
| v2 | 11 | `11-tauri-v2-osc-input` | OSC Input | single-window | OSC + DOM controls | WebView WebGL / browser media + Rust integrations |
| v2 | 12 | `12-tauri-v2-video-texture-player` | Video Texture Player | single-window | Video file + transport | WebView WebGL / browser media + Rust integrations |
| v2 | 13 | `13-tauri-v2-audio-reactive-fft` | Audio-Reactive FFT | single-window | Microphone + DOM controls | WebView WebGL / browser media + Rust integrations |
| v2 | 14 | `14-tauri-v2-canvas-recorder` | Canvas Recorder | single-window | Canvas + optional microphone | WebView WebGL / browser media + Rust integrations |
| v2 | 15 | `15-tauri-v2-multipass-compositor` | Multipass Compositor | single-window | Images/video + DOM controls | WebView WebGL / browser media + Rust integrations |
| v2 | 16 | `16-tauri-v2-image-texture-processor` | Image Texture Processor | single-window | Image files + drag/drop | WebView WebGL / browser media + Rust integrations |
| v2 | 17 | `17-tauri-v2-glsl-shader-playground` | GLSL Shader Playground | single-window | Shader source + DOM controls | WebView WebGL / browser media + Rust integrations |
| v2 | 18 | `18-tauri-v2-texture-mixer` | Texture Mixer | single-window | Two image/video sources | WebView WebGL / browser media + Rust integrations |
| v2 | 19 | `19-tauri-v2-webcam-compositor` | Webcam Compositor | single-window | Webcam + image/video | WebView WebGL / browser media + Rust integrations |
| v2 | 20 | `20-tauri-v2-live-video-switcher` | Live Video Switcher | multi-source | Video/camera/generators | WebView WebGL / browser media + Rust integrations |
| v2 | 21 | `21-tauri-v2-projection-mapper` | Projection Mapper | two-window | Media + pointer calibration | WebView WebGL / browser media + Rust integrations |
| v2 | 22 | `22-tauri-v2-image-sequence-player` | Image Sequence Player | two-window | Image sequence | WebView WebGL / browser media + Rust integrations |
| v2 | 23 | `23-tauri-v2-audio-file-fft-visualizer` | Audio File FFT Visualizer | single-window | Audio file | WebView WebGL / browser media + Rust integrations |
| v2 | 24 | `24-tauri-v2-keyframe-automation` | Keyframe Automation | single-window | Timeline + manual controls | WebView WebGL / browser media + Rust integrations |
| v2 | 25 | `25-tauri-v2-multi-display-output-manager` | Multi-Display Output Manager | multi-window | Generated/media sources | WebView WebGL / browser media + Rust integrations |
| native-wgpu | 00 | `00-wgpu-surface-probe` | Surface Probe | native-window | GPU adapter | Native Rust wgpu |
| native-wgpu | 01 | `01-wgpu-resize-fullscreen` | Resize & Fullscreen | native-window | Window events | Native Rust wgpu |
| native-wgpu | 02 | `02-wgpu-wgsl-shader` | WGSL Shader | native-window | DOM/Tauri controls | Native Rust wgpu |
| native-wgpu | 03 | `03-wgpu-tauri-controls` | Tauri Controls | hybrid-window | DOM → IPC | Native Rust wgpu |
| native-wgpu | 04 | `04-wgpu-image-texture` | Image Texture | native-window | Image file | Native Rust wgpu |
| native-wgpu | 05 | `05-wgpu-ping-pong-feedback` | Ping-Pong Feedback | native-window | GPU history + controls | Native Rust wgpu |
| native-wgpu | 06 | `06-wgpu-multipass-render-graph` | Multipass Render Graph | native-window | Generated textures | Native Rust wgpu |
| native-wgpu | 07 | `07-wgpu-high-resolution-lab` | High-Resolution Lab | native-window | Resolution controls | Native Rust wgpu |
| native-wgpu | 08 | `08-wgpu-backend-lab` | Backend Lab | native-window | Backend environment | Native Rust wgpu |
| native-wgpu | 09 | `09-wgpu-compute-particles` | Compute Particles | native-window | Compute simulation | Native Rust wgpu |
| native-wgpu | 10 | `10-wgpu-3d-particle-volume` | 3D Particle Volume | native-window | Compute simulation | Native Rust wgpu |
| native-wgpu | 11 | `11-wgpu-volumetric-raymarcher` | Volumetric Raymarcher | native-window | Procedural scene controls | Native Rust wgpu |
| native-wgpu | 12 | `12-wgpu-compute-fluid-feedback` | Compute Fluid Feedback | native-window | Pointer/force injection | Native Rust wgpu |
| native-wgpu | 13 | `13-wgpu-camera-input` | Camera Input | native-window | Camera | Native Rust wgpu |
| native-wgpu | 14 | `14-wgpu-native-webcam-texture` | Native Webcam Texture | native-window | Native camera capture | Native Rust wgpu |
| native-wgpu | 15 | `15-wgpu-native-video-decoder-effect-ui` | Native Video Decoder + Effect UI | hybrid-window | Video file | Native Rust wgpu |
| native-wgpu | 16 | `16-wgpu-recording` | Native Recording Pipeline | native-window | Rendered frames | Native Rust wgpu |
| native-wgpu | 17 | `17-wgpu-midi-parameter-registry` | MIDI Parameter Registry | hybrid-window | MIDI / Max / hardware | Native Rust wgpu |
| native-wgpu | 18 | `18-wgpu-osc-network-control` | OSC Network Control | hybrid-window | OSC / UDP | Native Rust wgpu |
| native-wgpu | 19 | `19-wgpu-gesture-field` | Gesture Field | native-window | Pointer/touch/pen | Native Rust wgpu |
| native-wgpu | 20 | `20-wgpu-multi-input-compositor` | Multi-Input Compositor | hybrid-window | Video/camera/audio/generators | Native Rust wgpu |
| native-wgpu | 21 | `21-wgpu-gltf-scene-loader` | glTF Scene Loader | native-window | glTF/GLB file | Native Rust wgpu |
| native-wgpu | 22 | `22-wgpu-skeletal-pose-lab` | Skeletal Pose Lab | native-window | Skinned mesh / animation | Native Rust wgpu |
| native-wgpu | 23 | `23-wgpu-morph-target-lab` | Morph Target Lab | two-window | Morph targets + controls | Native Rust wgpu |
| native-wgpu | 24 | `24-wgpu-mesh-feedback-deformer` | Mesh Feedback Deformer | native-window | Compute mesh state | Native Rust wgpu |
| native-wgpu | 25 | `25-wgpu-ultra-resolution-export` | Ultra-Resolution Export | native-window | Export configuration | Native Rust wgpu |
