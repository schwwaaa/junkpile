# 16 · wgpu Audio Reactive Spectrum

A Tauri 2 + Rust + wgpu example that treats live audio as a structured native input source rather than a single volume value.

```text
microphone / line input
        ↓ CPAL native host
interleaved device samples
        ↓ mono conversion
Hann window + RustFFT
        ↓
256 logarithmic spectrum bins
512 waveform samples
RMS / peak / four bands / centroid / transient
        ↓ queue.write_buffer
WGSL visualization
        ↓
Metal / Vulkan / DX12 surface
```

## Run

```bash
npm install
npm run dev:metal   # macOS
```

Or allow wgpu to choose the backend:

```bash
npm run dev
```

Starting audio may trigger the operating system microphone permission prompt.

## Visualization modes

1. **Spectrum bars** — logarithmic FFT bins with waveform overlay.
2. **Radial spectrum** — angular frequency mapping and audio-reactive radius.
3. **Oscilloscope** — time-domain waveform plus low spectrum floor.
4. **Spectral field** — procedural WGSL field driven by bands, centroid, and transients.

## Analysis data

The Rust audio layer publishes:

- 256 logarithmically spaced spectrum bins from 20 Hz to Nyquist
- 512 time-domain waveform samples
- RMS and peak amplitude
- bass, low-mid, high-mid, and treble bands
- spectral centroid
- spectral-flux transient trigger

The CPAL callback performs only channel mixing and a bounded `try_send`. FFT work runs away from the real-time callback so GPU and analysis work cannot block the native audio thread.

## Platform notes

- **macOS:** CoreAudio through CPAL. `NSMicrophoneUsageDescription` is included.
- **Windows:** WASAPI through CPAL.
- **Linux:** ALSA by default; install the ALSA development package before compiling.

Ubuntu/Debian:

```bash
sudo apt install libasound2-dev
```

## Why CPU FFT first?

This example deliberately performs FFT analysis in Rust and sends compact results to the GPU. That keeps the audio callback simple, provides readable signal-analysis code, and allows the same spectrum buffer to control any later wgpu system. A future example can compare this baseline with a compute-shader FFT.
