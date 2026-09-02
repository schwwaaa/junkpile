# Web Shader Playground → Native wgpu Mapping

This project matches the creative purpose of the existing WebView shader playground rather than attempting literal source-code equivalence.

| Web workflow | Native wgpu implementation |
|---|---|
| GLSL fragment shader | WGSL vertex + fragment module |
| WebGL compilation | Naga validation + wgpu pipeline creation |
| Browser canvas | Native wgpu surface |
| File input | Native Open dialog |
| Browser save/download | Native Save and Save As dialogs |
| Live shader replacement | Transactional native pipeline replacement |
| Browser compiler log | In-app WGSL diagnostic console |
| JavaScript uniforms | Rust uniform buffer updated through Tauri commands |
| Canvas capture | Offscreen native-resolution PNG export |
| Browser animation clock | Pausable/resettable native shader time |

The accessible WebView example remains valuable for browser-oriented workflows. This native version exists for maximum GPU performance, native WGSL development, and export resolutions limited primarily by the machine's GPU capabilities.
