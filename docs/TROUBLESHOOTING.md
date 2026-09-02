# Troubleshooting

Diagnose the boundary that owns the failure: WebView, transport, media source, Rust integration, GPU resource, readback queue, encoder/output worker, or operating-system packaging.

## Blank p5.js or WebGL output

- inspect the JavaScript console
- confirm p5 or other frontend dependencies loaded
- confirm `getContext('webgl')`
- inspect vertex/fragment compile logs
- inspect program link status
- verify drawing-buffer size and viewport
- verify geometry buffers and attribute locations
- verify textures/framebuffer completeness
- check context loss

A useful example should surface a readable runtime error rather than leaving a permanently blank canvas.

## Output appears in one quadrant

p5 custom vertex positions can arrive in 0–1 space. Convert to clip space:

```glsl
vec4 position = vec4(aPosition, 1.0);
position.xy = position.xy * 2.0 - 1.0;
gl_Position = position;
```

## Frontend never initializes in WebKit

Avoid global helpers that collide with browser globals such as `window.location`.

## Controls do not scroll until resize

Add `min-height: 0` to nested grid/flex children and avoid global `overflow: hidden` when content can exceed the viewport.

## Sliders jump or snap backward

- coalesce high-rate messages
- serialize sends where ordering matters
- do not write stale telemetry back into active controls
- separate current/target values when smoothing is involved

## WebSocket state is stale after reconnect

Keep canonical control state in one place and resend the full snapshot after the renderer announces readiness. Renderer-owned camera streams, GPU history, and feedback textures may need independent restart/reinitialization.

## Camera or microphone is unavailable

- check OS privacy settings
- request permission before assuming enumeration is complete
- enumerate again after permission
- close competing applications
- show exact capture API errors
- confirm the selected device still exists
- separate source/capture cadence from render cadence

## Native file drag/drop does not work in Tauri 2

Use the Tauri WebView/native drag-drop path for OS filesystem paths when browser `DataTransfer.files` is insufficient.

## Image displays but WebGL texture upload throws `SecurityError`

Read the file through the trusted application path, create an appropriate local/Blob representation, decode it, then upload that image to WebGL. Direct asset-protocol images can be tainted for browser GPU use.

## Image sequence freezes

Buffer frames before playback, hold the previous frame when decoding lags, preserve playhead state across rate changes, and bound the cache.

## Native wgpu validation error

Read the complete validation chain. Common causes include:

- bind-group layout mismatch
- CPU/WGSL struct alignment mismatch
- invalid shader types
- incompatible render-target formats
- missing resource usage flags
- depth state incompatible with primitive topology
- invalid texture/sample combinations

One established example-specific lesson: depth bias is not compatible with line-list topology.

## Native surface errors

Handle:

- zero/minimized size
- resize/reconfigure
- timeout/occluded states
- outdated/lost surfaces
- suboptimal surfaces
- device limits

Do not continue presenting through stale configuration.

## Recording/export stalls or uses excessive memory

Check the pipeline in order:

```text
render texture
→ capture cadence
→ texture-to-buffer copy
→ mapped readback slot
→ row depadding / CPU pack
→ bounded worker queue
→ FFmpeg / file writer
```

Then inspect:

- GPU readback drops
- CPU-pool drops
- worker-queue drops
- raw bandwidth estimate
- output storage speed
- encoder stderr

Avoid unbounded frame accumulation. Dropping a capture frame is preferable to freezing the renderer when the example's contract is real-time output.

## FFmpeg AV mux fails

Read the first encoder/layout error, not only the final “nothing was written” message.

Check:

- selected audio stream exists
- sample rate
- channel count/layout
- output codec/container pairing
- temporary audio file finalized before mux
- `ffmpeg` and `ffprobe` resolve to compatible installations

Example 43 finalizes video first, then performs the A/V mux. When muxing fails, intermediate files should be preserved for diagnosis rather than deleted.

## A high-resolution file stutters in one player

Separate encode correctness from playback capability. Verify the file with `ffprobe` and test another player before changing the recorder. 5K/8K ProRes or high-bitrate files can exceed the smooth-decoding path of one playback application even when the encoded cadence is correct.

## Current wgpu external-output references

The NDI, Syphon, and Spout troubleshooting notes below refer to the dedicated sender implementations currently present under `wgpu/`. They should not be read as a claim that those transports are wgpu-only.

## NDI source does not appear

- verify the build includes the NDI feature where required
- verify SDK/runtime discovery
- open a known NDI receiver
- inspect worker/drop telemetry
- test preview-only mode to confirm the renderer itself remains healthy

## Syphon sender does not appear

macOS only. Verify the Syphon framework path/build bridge, source name, and a known compatible receiver. Confirm whether transfer is configured to occur only when a client is connected.

## Spout sender does not appear

Windows only. Verify the native C++/D3D build prerequisites, sender initialization, compatible receiver, and the current bridge path.

## OSC or MIDI does not move parameters

Inspect exact port/device names, incoming bytes/arguments, channel/address mapping, scaling, listener bind address, and firewall state. Prefer the on-screen event/parameter diagnostics over guessing from the final image.

## WebSocket port conflict

Two relay examples cannot both bind the same loopback port. Change both the Rust relay and frontend endpoint together.

## Network output

Do not use Example 40 as a general troubleshooting baseline for stable routing. It remains unresolved/under review. Validate UDP/RTSP/RTMP server requirements separately before attributing failures to the renderer.
