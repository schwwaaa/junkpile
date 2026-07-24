# 13 · Tauri v2 Audio-Reactive FFT

A microphone-driven Web Audio and raw WebGL example for the Junkpile Tauri v2 essentials collection.

The application captures a selected audio-input device, analyzes it locally with an `AnalyserNode`, uploads the complete FFT and waveform arrays to one-dimensional WebGL textures, and also derives smoothed musical bands for direct shader uniforms.

## Signal path

```text
Microphone MediaStream
        ↓
MediaStreamAudioSourceNode
        ↓
GainNode
        ↓
AnalyserNode
        ├── frequency bins → WebGL FFT texture
        ├── waveform bytes → WebGL waveform texture
        └── reduced bands → sub / bass / mid / high / air / RMS
                                      ↓
                             adaptive beat pulse
                                      ↓
                      GLSL visual + feedback buffers
```

The analyser is deliberately **not connected to the speakers**. Microphone audio is measured but not monitored, avoiding feedback and echo.

## Features

- Microphone permission and selectable input devices
- Refresh and hot-switching between microphones
- Pre-permission device enumeration that remains refreshable
- FFT sizes from 512 to 8192
- Full FFT uploaded to a GPU texture every frame
- Full waveform uploaded to a second GPU texture
- Sub, bass, mid, high, air, RMS, peak-dB, and beat values
- Independent attack and release smoothing
- Adjustable analyser smoothing, gain, and sensitivity
- Adaptive low-frequency beat detection
- Manual beat trigger
- Five GLSL visual modes
- Ping-pong framebuffer feedback
- Clear-feedback command
- Native Tauri v2 PNG save dialog
- Browser-download fallback outside Tauri
- Native fullscreen command
- Scroll-safe controls panel
- Live spectrum, waveform, resolution, and FPS telemetry

## Visual modes

1. Spectrum rings
2. Waveform tunnel
3. Frequency terrain
4. Aurora field
5. Beat grid

## Run

```bash
npm install
npm run dev
```

Press **Start microphone**, approve the operating-system permission prompt, and then choose an input device if more than one is available.

## macOS microphone permission

The project includes:

- `src-tauri/Info.plist` with `NSMicrophoneUsageDescription`
- `src-tauri/entitlements.plist` with `com.apple.security.device.audio-input`
- the entitlement path in `tauri.conf.json`

If permission was previously denied, enable the application under **System Settings → Privacy & Security → Microphone**.

## Tauri v2 structure

```text
13-tauri-v2-audio-reactive-fft/
├── package.json
├── src/
│   ├── index.html
│   ├── styles.css
│   └── app.js
└── src-tauri/
    ├── Cargo.toml
    ├── Info.plist
    ├── entitlements.plist
    ├── tauri.conf.json
    ├── capabilities/default.json
    └── src/main.rs
```

The WebView owns microphone capture and WebGL. Rust is intentionally limited to native desktop duties: PNG writing and fullscreen control.
