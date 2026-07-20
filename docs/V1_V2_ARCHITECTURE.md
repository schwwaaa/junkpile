# Tauri v1 and v2 architecture in Junkpile

## What actually changed

The paired examples intentionally preserve the JavaScript graphics architecture. This makes the Tauri migration visible without changing the rendering technology at the same time.

### Configuration shape

Tauri v1:

```json
{
  "$schema": "https://schema.tauri.app/config/1",
  "build": {
    "devPath": "../src",
    "distDir": "../src"
  },
  "package": {
    "productName": "example",
    "version": "0.1.0"
  },
  "tauri": {
    "windows": [],
    "security": {},
    "bundle": {
      "identifier": "com.example.app"
    }
  }
}
```

Tauri v2:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "example",
  "version": "0.1.0",
  "identifier": "com.example.app",
  "build": {
    "frontendDist": "../src"
  },
  "app": {
    "windows": [],
    "security": {}
  },
  "bundle": {}
}
```

### Cargo shape

Tauri v1 projects use v1 `tauri` and `tauri-build` dependencies. Several include an explicit `custom-protocol` feature for bundled asset serving.

Tauri v2 projects use v2 dependencies. Product identity and frontend configuration move into the v2 schema, and the project no longer declares the v1 custom-protocol feature pattern.

### Runtime code

For the current single-window examples, `main.rs` is intentionally minimal in both generations.

For the current two-window examples, the Rust WebSocket relay is conceptually the same. `tauri::async_runtime::spawn()` is used from `setup()` so tasks are dispatched through the runtime owned by Tauri.

## What did not change

- The graphics remain JavaScript/WebGL inside a WebView.
- p5 examples remain p5.js examples.
- raw WebGL examples remain browser WebGL examples.
- camera capture remains `navigator.mediaDevices.getUserMedia()`.
- the two-window transport remains a loopback WebSocket server.

## What Tauri v2 does not imply

A Tauri v2 project is not automatically a native GPU project. Native `wgpu` requires a different renderer, window/surface integration, resize handling, synchronization, and an explicit strategy for any HTML overlay. None of those components are present in the current v2 folders.

## API and security implications for future ports

The current v2 projects avoid most frontend-to-Rust commands, so they do not exercise the full v2 capability system. When porting the MIDI or OSC examples, document:

1. command registration
2. event API imports or global API configuration
3. capability/permission files
4. plugin permissions when plugins are introduced
5. platform-specific network or device access requirements

## Migration checklist for a new pair

- [ ] Pin the correct project-local `@tauri-apps/cli` major version.
- [ ] Pin matching `tauri` and `tauri-build` major versions.
- [ ] Convert `tauri.conf.json` to the target schema.
- [ ] Verify product name, identifier, windows, CSP, and bundle icons.
- [ ] Verify every window URL exists in the frontend asset folder.
- [ ] Verify commands/events against the target generation.
- [ ] Run both `npm run dev` and `npm run build`.
- [ ] Test permissions and lifecycle behavior on each target OS.
- [ ] Update the local README with the differences that are actually present.
