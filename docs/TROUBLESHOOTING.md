# Troubleshooting

Diagnose the boundary that owns the failure: WebView, transport, media source, Rust integration, GPU resource, encoder/export, or OS packaging.

## Blank p5.js or WebGL output

- inspect the JavaScript console
- confirm p5 is local and loaded
- confirm `getContext('webgl')`
- inspect vertex and fragment compile logs
- inspect program link status
- verify drawing-buffer size and viewport
- verify quad/mesh buffers and attribute locations
- verify textures and framebuffer completeness
- check context loss

A modernized example should show a readable runtime error instead of a permanently blank canvas.

## Output appears in one quadrant

p5 custom vertex positions can arrive in 0–1 space. Convert to clip space:

```glsl
vec4 position = vec4(aPosition, 1.0);
position.xy = position.xy * 2.0 - 1.0;
gl_Position = position;
```

## Frontend never initializes in WebKit

Do not define a global helper named `location`; it collides with `window.location`. Use a name such as `getUniformLocation`.

## Controls do not scroll until resize

Add `min-height: 0` to nested grid/flex children and avoid a global `overflow: hidden` when content can exceed the viewport.

## Sliders jump or snap backward

- coalesce messages with `requestAnimationFrame`
- serialize high-rate sends
- do not write old telemetry into the active slider
- use fixed-width numeric readouts

## WebSocket state is stale after reconnect

The controls window should retain the canonical parameter snapshot and resend it after the canvas announces readiness. Renderer-owned camera streams and feedback history must be restarted/reinitialized separately.

## Camera or microphone is unavailable

- keep refresh enabled before permission
- request permission
- enumerate again after access
- check OS privacy settings
- close competing apps
- show exact `getUserMedia` errors
- separate source/upload FPS from render FPS

## Native file drag/drop does not work in Tauri 2

Use the Tauri WebView drag/drop API for native paths. Browser `DataTransfer.files` alone is not a reliable OS-drop contract inside Tauri.

## Image displays but WebGL texture upload throws `SecurityError`

Read the file in Rust, return bytes, create a Blob URL, decode, and upload that image. Direct asset-protocol images may be tainted for WebGL.

## Image sequence freezes

Buffer frames before play, hold every frame, pause timing when decoding lags, preserve the playhead across rate changes, and bound the cache.

## Native wgpu validation error

Read the full validation chain. Common causes include bind-group layout mismatch, uniform alignment, invalid shader types, render-target format mismatch, depth state incompatible with topology, resource usage flags, and surface configuration.

A specific lesson from the skeletal overlay work: depth bias is not valid with line-list topology.

## Native surface errors

Handle minimized size, resize/reconfigure, timeout/occluded, outdated, lost, suboptimal, and validation states. Recreate the surface when required rather than continuing with stale configuration.

## Recording/export stalls or uses excessive memory

Bound frame queues, discard stale capture frames, avoid huge JSON IPC values, use encoder pipes or native files, respect wgpu row alignment, and expose progress/error stages.

## OSC or MIDI does not move parameters

Inspect exact port/device names, incoming message bytes/arguments, channel/address mapping, scaling mode, listener bind address, firewall, and the on-screen event terminal.

## WebSocket port conflict

Two relay examples cannot both own port 2727. Change both the Rust relay port and frontend URL together.
