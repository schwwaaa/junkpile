# Gesture Pipeline Guide

## Why the input pad is in the controls window

The renderer window is a raw Tauri window used directly as a wgpu surface. Tauri's public high-level window event enum provides resize, focus, scale, drag/drop and lifecycle events, but not cursor movement, mouse buttons, wheel, touch, or pen events. The controls WebView supports the browser Pointer Events model, which unifies mouse, touch, and pen input.

This example therefore keeps the architecture explicit:

```text
WebView = input only
Rust = normalization boundary and bounded state
wgpu = visual output only
```

The video/render path never goes through a browser canvas.

## Point representation

Each point occupies 32 bytes in the GPU storage buffer:

```text
position_velocity:          x, y, velocity_x, velocity_y
pressure_age_tool_active:   pressure, age, tool, active
```

At 64 retained points, the total point buffer is only 2 KiB.

## Backpressure

Pointer events can arrive faster than the renderer needs them. JavaScript retains the latest event and publishes at most once per `requestAnimationFrame`. Rust stores at most 64 points. This prevents input bursts from creating unbounded queues.

## Future native hooks

A platform-specific advanced example could capture events directly from NSWindow/NSEvent, Win32 messages, or the Linux windowing backend. That would be a native-input study rather than a portable Tauri template.
