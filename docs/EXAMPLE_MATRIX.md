# Example matrix

This is the authoritative inventory of the projects currently present in Junkpile. It should be updated whenever a project is added, renamed, removed, or changes architectural status.

| Project | Tauri | Family | Topology | Input | Frontend source |
|---|---|---|---|---|---|
| [p5-tauri-single-template](../v1/p5-tauri-single-template/) | V1 | p5.js shader baseline | Single | DOM controls | `index.html, sketch.js` |
| [p5-tauri-ws-template](../v1/p5-tauri-ws-template/) | V1 | p5.js shader baseline | WS / two-window | WebSocket controls | `canvas.html, canvas.js, controls.html, controls.js` |
| [p5-tauri-midi-template](../v1/p5-tauri-midi-template/) | V1 | Rust MIDI bridge baseline | Single | MIDI + DOM controls | `index.html, sketch.js` |
| [p5-tauri-osc-template](../v1/p5-tauri-osc-template/) | V1 | Rust OSC bridge baseline | Single | OSC + DOM controls | `index.html, sketch.js` |
| [webgl-tauri-v1-single-template](../v1/webgl-tauri-v1-single-template/) | V1 | raw WebGL shader baseline | Single | DOM controls | `index.html, sketch.js` |
| [webgl-tauri-v1-ws-template](../v1/webgl-tauri-v1-ws-template/) | V1 | raw WebGL shader baseline | WS / two-window | WebSocket controls | `canvas.html, canvas.js, controls.html, controls.js` |
| [glsl-tauri-v1-single-template](../v1/glsl-tauri-v1-single-template/) | V1 | external GLSL file baseline | Single | DOM controls + shader file | `index.html, shader.frag, sketch.js` |
| [glsl-tauri-v1-ws-template](../v1/glsl-tauri-v1-ws-template/) | V1 | external GLSL file baseline | WS / two-window | WebSocket controls + shader file | `canvas.html, canvas.js, controls.html, controls.js, shader.frag` |
| [webcam-tauri-v1-single-template](../v1/webcam-tauri-v1-single-template/) | V1 | webcam processing baseline | Single | Webcam + DOM controls | `index.html, sketch.js` |
| [webcam-tauri-v1-ws-template](../v1/webcam-tauri-v1-ws-template/) | V1 | webcam processing baseline | WS / two-window | Webcam + WebSocket controls | `canvas.html, canvas.js, controls.html, controls.js` |
| [feedback-tauri-v1-single-template](../v1/feedback-tauri-v1-single-template/) | V1 | ping-pong feedback baseline | Single | Webcam + DOM controls | `index.html, sketch.js` |
| [feedback-tauri-v1-ws-template](../v1/feedback-tauri-v1-ws-template/) | V1 | ping-pong feedback baseline | WS / two-window | Webcam + WebSocket controls | `canvas.html, canvas.js, controls.html, controls.js` |
| [p5-tauri-v2-single-template](../v2/p5-tauri-v2-single-template/) | V2 | p5.js shader baseline | Single | DOM controls | `index.html, sketch.js` |
| [p5-tauri-v2-ws-template](../v2/p5-tauri-v2-ws-template/) | V2 | p5.js shader baseline | WS / two-window | WebSocket controls | `canvas.html, canvas.js, controls.html, controls.js` |
| [webgl-tauri-v2-single-template](../v2/webgl-tauri-v2-single-template/) | V2 | raw WebGL shader baseline | Single | DOM controls | `index.html, sketch.js` |
| [webgl-tauri-v2-ws-template](../v2/webgl-tauri-v2-ws-template/) | V2 | raw WebGL shader baseline | WS / two-window | WebSocket controls | `canvas.html, canvas.js, controls.html, controls.js` |
| [glsl-tauri-v2-single-template](../v2/glsl-tauri-v2-single-template/) | V2 | external GLSL file baseline | Single | DOM controls + shader file | `index.html, shader.frag, sketch.js` |
| [glsl-tauri-v2-ws-template](../v2/glsl-tauri-v2-ws-template/) | V2 | external GLSL file baseline | WS / two-window | WebSocket controls + shader file | `canvas.html, canvas.js, controls.html, controls.js, shader.frag` |
| [webcam-tauri-v2-single-template](../v2/webcam-tauri-v2-single-template/) | V2 | webcam processing baseline | Single | Webcam + DOM controls | `index.html, sketch.js` |
| [webcam-tauri-v2-ws-template](../v2/webcam-tauri-v2-ws-template/) | V2 | webcam processing baseline | WS / two-window | Webcam + WebSocket controls | `canvas.html, canvas.js, controls.html, controls.js` |
| [feedback-tauri-v2-single-template](../v2/feedback-tauri-v2-single-template/) | V2 | ping-pong feedback baseline | Single | Webcam + DOM controls | `index.html, sketch.js` |
| [feedback-tauri-v2-ws-template](../v2/feedback-tauri-v2-ws-template/) | V2 | ping-pong feedback baseline | WS / two-window | Webcam + WebSocket controls | `canvas.html, canvas.js, controls.html, controls.js` |

## Pairing map

| Concept | Tauri v1 | Tauri v2 |
|---|---|---|
| p5 single | `v1/p5-tauri-single-template` | `v2/p5-tauri-v2-single-template` |
| p5 two-window | `v1/p5-tauri-ws-template` | `v2/p5-tauri-v2-ws-template` |
| raw WebGL single | `v1/webgl-tauri-v1-single-template` | `v2/webgl-tauri-v2-single-template` |
| raw WebGL two-window | `v1/webgl-tauri-v1-ws-template` | `v2/webgl-tauri-v2-ws-template` |
| external GLSL single | `v1/glsl-tauri-v1-single-template` | `v2/glsl-tauri-v2-single-template` |
| external GLSL two-window | `v1/glsl-tauri-v1-ws-template` | `v2/glsl-tauri-v2-ws-template` |
| webcam single | `v1/webcam-tauri-v1-single-template` | `v2/webcam-tauri-v2-single-template` |
| webcam two-window | `v1/webcam-tauri-v1-ws-template` | `v2/webcam-tauri-v2-ws-template` |
| feedback single | `v1/feedback-tauri-v1-single-template` | `v2/feedback-tauri-v2-single-template` |
| feedback two-window | `v1/feedback-tauri-v1-ws-template` | `v2/feedback-tauri-v2-ws-template` |
| MIDI | `v1/p5-tauri-midi-template` | **Not implemented** |
| OSC | `v1/p5-tauri-osc-template` | **Not implemented** |

## Baseline maturity labels

Use these labels only after recording evidence in the project README or a test report:

- **Static reviewed** — source, JSON, and JavaScript syntax checked.
- **Build verified** — `npm run build` completed on a named platform.
- **Runtime verified** — the app launched and its core input/render path worked.
- **Cross-platform verified** — runtime verified on macOS, Windows, and Linux.
- **Experimental** — architecture exists but important behavior remains unverified.

Do not use “stable” as a synonym for “looks complete.” Stable should mean the expected platform matrix has actually been exercised.
