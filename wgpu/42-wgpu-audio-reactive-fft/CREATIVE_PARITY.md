# Creative workflow mapping

The WebView audio-reactive example establishes this creative workflow:

```text
microphone → FFT/waveform analysis → beat analysis → GPU-reactive visuals
```

This native project preserves that workflow while changing implementation ownership:

| WebView workflow | Native wgpu workflow |
|---|---|
| Browser microphone APIs | CPAL native microphone capture |
| Web Audio FFT | RustFFT worker |
| JavaScript spectrum/waveform arrays | Shared Rust analysis frame |
| WebGL analysis textures | wgpu `RGBA8Unorm` analysis textures |
| GLSL visuals | WGSL visuals |
| Browser-owned canvas resolution | Explicit native authoritative render target |
| WebView renderer | Metal / Vulkan / Direct3D 12 through wgpu |

The intent is creative equivalence, not source-code equivalence.
