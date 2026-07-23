# 13 · Tauri v1 Audio-Reactive FFT

A focused Tauri v1 essential showing how live microphone audio can drive raw WebGL graphics without a native Rust audio dependency.

The example captures one microphone through the Web Audio API, calculates a live FFT and waveform, uploads both arrays to the GPU as textures, and supplies reduced frequency bands to a GLSL ES fragment shader.

## What this example teaches

- Requesting microphone permission from a Tauri v1 WebView
- Enumerating and switching audio-input devices
- Building a Web Audio graph with `MediaStreamAudioSourceNode`, `GainNode`, and `AnalyserNode`
- Keeping analysis silent by not connecting the graph to the speakers
- Reading frequency-domain and time-domain byte arrays every animation frame
- Converting FFT bins into sub, bass, mid, high, and air bands
- Applying separate attack and release smoothing
- Implementing a lightweight adaptive beat detector
- Uploading the complete FFT and waveform to WebGL luminance textures
- Driving GLSL with both texture data and scalar audio uniforms
- Preserving visual motion with ping-pong framebuffer feedback

## Signal path

```text
Microphone
    │
    ▼
MediaStreamAudioSourceNode
    │
    ▼
GainNode ── input gain
    │
    ▼
AnalyserNode
    ├── getByteFrequencyData() ──► FFT texture ───────┐
    ├── getByteTimeDomainData() ─► waveform texture ─┤
    └── band reduction ──────────► GLSL uniforms ────┤
                                                     ▼
                                         WebGL fragment shader
                                                     │
                                                     ▼
                                      ping-pong feedback buffers
                                                     │
                                                     ▼
                                                  display
```

The analyser is **not** connected to `AudioContext.destination`. The microphone is measured but not monitored through the speakers, which avoids immediate acoustic feedback.

## Analysis values

| Value | Frequency range | Primary use |
|---|---:|---|
| Sub | 20–60 Hz | Deep kick and low-frequency movement |
| Bass | 60–250 Hz | Beat detection and large-scale deformation |
| Mid | 250–2,000 Hz | Structural movement and visual density |
| High | 2,000–8,000 Hz | Fine detail and brightness |
| Air | 8,000 Hz–Nyquist | Texture, noise, and upper-frequency shimmer |
| RMS | Time-domain energy | Overall loudness response |
| Beat | Adaptive low-band transient | Short visual impulse |

Band values are normalized, multiplied by **Sensitivity**, then independently smoothed with **Band attack** and **Band release**.

## Visual modes

1. **Spectrum rings** — FFT bins wrap around radial rings.
2. **Waveform tunnel** — the waveform shapes a receding circular tunnel.
3. **Frequency terrain** — the FFT becomes a continuous animated horizon.
4. **Aurora field** — multiple spectrum-driven luminous strands.
5. **Beat grid** — a frequency-colored grid deformed by low bands and beat impulses.

All five modes receive the same full spectrum texture, waveform texture, scalar band values, RMS energy, and beat pulse.

## Project structure

```text
13-tauri-v1-audio-reactive-fft/
├── README.md
├── package.json
├── src/
│   ├── index.html       controls, meters, monitors, and WebGL stage
│   ├── styles.css       fixed-width controls and responsive layout
│   └── app.js           Web Audio analysis, beat detection, WebGL renderer
└── src-tauri/
    ├── Cargo.toml
    ├── build.rs
    ├── tauri.conf.json
    ├── Info.plist       macOS microphone usage explanation
    ├── entitlements.plist
    ├── icons/
    └── src/main.rs
```

## Run

```bash
npm install
npm run dev
```

Press **Start microphone**. The operating system may ask for microphone permission the first time.

## Useful starting settings

For music playing through speakers in the room:

```text
FFT size          2048
Analyser smooth   0.72
Input gain        1.00×
Sensitivity       1.35×
Band attack       0.62
Band release      0.055
Beat threshold    1.32×
Beat cooldown     180 ms
```

For a direct, clean source close to the microphone, reduce **Sensitivity**. For quiet ambient sound, increase **Input gain** gradually before increasing sensitivity.

## FFT-size tradeoff

| FFT size | Frequency detail | Time response | Frequency bins |
|---:|---|---|---:|
| 512 | Low | Fastest | 256 |
| 1,024 | Moderate | Fast | 512 |
| 2,048 | Balanced | Balanced | 1,024 |
| 4,096 | High | Slower | 2,048 |
| 8,192 | Highest | Slowest | 4,096 |

A larger FFT does not simply make the visual “better.” It improves frequency resolution while increasing analysis latency and softening fast transients.

## macOS microphone permission

Tauri v1 merges `src-tauri/Info.plist` into the generated macOS application metadata. This example defines `NSMicrophoneUsageDescription` there and includes the `com.apple.security.device.audio-input` entitlement for packaged builds.

When permission was denied previously:

1. Open **System Settings → Privacy & Security → Microphone**.
2. Enable the Junkpile application or terminal/build host being used.
3. Fully quit and relaunch the app.

During development, macOS may associate permission with the generated debug application or the terminal that launched it. A clean rebuild can occasionally cause the operating system to ask again.

## Windows and Linux notes

- Windows uses WebView2 and the normal Windows microphone privacy controls.
- Linux behavior depends on WebKitGTK and the active PipeWire or PulseAudio configuration.
- Device labels can remain generic until microphone permission has been granted. This is expected browser privacy behavior.

## Troubleshooting

### The status says permission denied

Grant microphone access in the operating-system privacy settings, quit the application completely, and rerun it.

### The meters move but no sound is audible

That is intentional. This example analyses the microphone without routing it to the output device.

### Beat detection triggers too often

Increase **Threshold**, increase **Cooldown**, or lower **Sensitivity**.

### Beat detection misses kicks

Lower **Threshold** slightly, raise **Sensitivity**, or reduce **Analyser smooth** so transients remain sharper.

### The visual reacts slowly

Use a smaller FFT size and raise **Band attack**. A very large FFT and high analyser smoothing both increase perceived latency.

### Changing microphone does nothing

Press the refresh button, select the desired device again, or stop and restart microphone input. Some operating systems expose a changed device only after the old stream is released.

## Security and privacy

- Audio samples are processed locally in the WebView.
- The example contains no network requests or upload code.
- It does not record or save microphone audio.
- The stream is stopped when the input is disabled or the application closes.

## Next extension ideas

- Audio-file input through `MediaElementAudioSourceNode`
- Native CoreAudio, WASAPI, or PipeWire capture in Rust
- User-defined frequency-band ranges
- Tempo estimation and phase-locked beat events
- MIDI plus audio hybrid control
- Recording the visual canvas alongside the source audio

## License

MIT.
