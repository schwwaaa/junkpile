# Modernization notes · V1 Example 07

Legacy folder retained:

```text
webcam-tauri-v1-ws-template
```

## Preserved

- Tauri v1
- Separate controls and canvas windows
- Rust WebSocket relay on port 2727
- Camera capture in the output WebView
- Raw WebGL 1 camera texture
- Original six effects, grading controls, and feedback concept

## Modernized

- Current Junkpile Example 07 identity and interface
- Scroll-safe controls from initial launch
- Coalesced parameter batches instead of one WebSocket message per input event
- Presence reporting and reconnect-safe complete-state synchronization
- Requested camera state restored after output reconnects
- Camera enumeration available before permission
- Restartable device and resolution selection
- Calibration source when no camera is active
- Separate effect and blit shaders to avoid processing the final image twice
- Shader compiler diagnostics and WebGL context recovery
- Camera FPS, render FPS, input/output resolution, and GPU telemetry
- Output show, focus, and fullscreen controls
- macOS permission metadata
- Standalone Cargo workspace boundary
- Complete development and production documentation
