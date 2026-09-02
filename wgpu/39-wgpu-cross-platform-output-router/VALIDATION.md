# Validation Record

## Static validation completed

- `package.json`, `tauri.conf.json`, and `io-profiles.json` parse as valid JSON.
- Frontend JavaScript passes `node --check`.
- Every `byId()` reference has a matching HTML element.
- Every frontend `invoke()`/action command is present in the Tauri handler list.
- All profiles contain preview, recording, NDI, and platform-share routes.
- Profile schema version is 3 and built-in profile IDs/hotkeys are unique.
- Syphon Objective-C bridge, framework, headers, and Metal resources are included.
- Spout CMake bridge and required Spout2 source files are included.
- NDI runtime-rpath logic from the confirmed working NDI sender is retained.
- No target, node_modules, recording, or generated build directory is included.
- The quarantined Example 29 stream worker is absent.

## Runtime validation pending

### macOS

- Cargo/Tauri compilation with `ndi,platform-share`
- Simultaneous NDI + Syphon + H.264 recording
- Independent sink stop/restart
- Hidden-preview output route
- 4K pressure behavior
- Packaged-app Syphon framework loading

### Windows

- CMake/Spout bridge compilation
- Spout sender discovery
- Automatic and explicit adapter selection
- Simultaneous NDI + Spout + H.264 recording
- Packaged application behavior

## Known performance boundary

The platform sender uses CPU staging. 1080p is the primary stable target. Higher resolutions may become choppy, especially when NDI and recording are active simultaneously.
