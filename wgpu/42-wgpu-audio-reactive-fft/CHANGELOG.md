## 0.1.2

- Correct wgpu 29.0.4 presentation path to use `SurfaceTexture::present()` rather than the wgpu 30 `Queue::present()` API.

# Changelog

## 0.1.1

- Migrate preview surface acquisition to wgpu 29 `CurrentSurfaceTexture`.
- Replace removed `SurfaceError` handling with explicit Success/Suboptimal/Timeout/Occluded/Outdated/Lost/Validation branches.
- Present frames through `Queue::present`.
- Recreate a lost surface and reconfigure outdated/suboptimal surfaces without disturbing the authoritative offscreen renderer.

## 0.1.0

- Add native microphone capture through CPAL.
- Add 2048-sample Hann-window FFT analysis through RustFFT.
- Add 256-bin smoothed spectrum and 512-sample waveform textures.
- Add RMS, peak, bass, mid, treble, and adaptive beat telemetry.
- Add six WGSL audio-reactive visual modes.
- Add actual angular-velocity Spin control with stop and reverse behavior.
- Add demo analysis signal for permission/device-independent inspection.
- Add independent 720p through 8K authoritative render targets.
- Add Fit, Fill, Stretch, and Pixel preview presentation.
