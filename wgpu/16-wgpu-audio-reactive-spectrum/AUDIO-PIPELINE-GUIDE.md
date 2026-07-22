# Audio Pipeline Guide

## Thread boundaries

The native audio callback is time-sensitive. It should not run FFTs, acquire long-lived locks, invoke Tauri commands, or wait for the renderer.

This project keeps that callback intentionally small:

```text
CPAL callback
  1. mix input channels to mono
  2. copy one callback chunk
  3. try_send into a bounded channel
  4. return immediately
```

If the analysis thread falls behind, the bounded channel drops a chunk and increments `Dropped chunks` rather than increasing latency without limit.

## FFT analysis

The analyzer uses a Hann window before a forward FFT. Raw linear FFT bins are condensed into 256 logarithmic bins, which gives more visual space to bass and midrange frequencies than a linear mapping.

Four broad bands are also derived:

| Band | Approximate range |
|---|---:|
| Bass | 20–200 Hz |
| Low-mid | 200–800 Hz |
| High-mid | 800 Hz–4 kHz |
| Treble | 4–16 kHz, limited by Nyquist |

## GPU boundary

Each render frame uploads one storage-buffer structure:

```rust
struct AudioGpuData {
    spectrum: [f32; 256],
    waveform: [f32; 512],
}
```

The amount transferred per rendered frame is only 3 KiB. The shader can index this data directly without creating hundreds of uniforms.

## FFT size tradeoff

- `1024`: faster transient response, wider frequency bins
- `2048`: balanced default
- `4096`: greater frequency definition, more latency
- `8192`: highest definition in this example, noticeably slower response

At 48 kHz, an 8192-sample window spans about 171 ms before overlap is considered. High FFT definition and instantaneous response cannot both be maximized.
