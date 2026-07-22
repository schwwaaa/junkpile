# Validation status

Completed in the packaging environment:

- JSON parsing
- TOML parsing
- JavaScript syntax checking
- frontend element/reference checking
- macOS Objective-C bridge structure checking
- Rust module/reference checking
- wgpu 29 compatibility-pattern checking
- WGSL reserved-word and swizzle-assignment checking
- ZIP integrity checking

Not available in the packaging environment:

- macOS framework compilation
- Cargo compilation
- AVFoundation camera hardware
- Metal runtime testing

The authoritative validation is a local macOS run with camera permission granted.

## macOS SDK compatibility correction

- Replaced deprecated `devicesWithMediaType:` enumeration with `AVCaptureDeviceDiscoverySession`.
- Removed `AVCaptureSessionPresetInputPriority`, which is unavailable on macOS.
- The selected `AVCaptureDevice.activeFormat` and frame durations remain the source of capture configuration.
