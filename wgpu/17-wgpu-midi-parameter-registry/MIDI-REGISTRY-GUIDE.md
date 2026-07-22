# MIDI Registry Guide

## Raw message parsing

Most channel messages arrive as one to three bytes:

```text
status byte   data byte 1   data byte 2
```

The upper status nibble selects the message family and the lower nibble identifies the channel.

```text
0x8n  Note Off
0x9n  Note On
0xAn  Polyphonic aftertouch
0xBn  Control Change
0xCn  Program Change
0xDn  Channel pressure
0xEn  Pitch bend
```

The Rust callback converts these messages into a common `MidiEvent` carrying:

- Message kind
- Channel 1–16
- Number/note/CC
- Raw value
- Normalized 0–1 value
- Signed -1–1 value
- Original bytes
- MIDI timestamp

## The mapping contract

Each mapping stores:

```text
source kind + channel + number
                 ↓
       normalized source value
                 ↓
       optional inversion
                 ↓
       output min / max range
                 ↓
       target parameter
```

Renderer-facing parameters remain normalized from 0 to 1. The renderer or shader decides what that interval means physically.

Examples:

```text
zoom 0–1       → 0.55× to 2.8×
rotation 0–1   → -π to +π
exposure 0–1   → 0.45 to 3.5
```

## Smoothing

The mapping smoothing value is a per-frame retention factor adjusted for elapsed time. A value near zero responds immediately. A value near 0.98 responds gradually.

Time-adjusted smoothing prevents the control response from changing drastically when renderer FPS changes.

## Note storage buffer

Notes are not reduced to a single trigger. The renderer uploads 128 floating-point note levels:

```text
notes[0] ... notes[127]
```

Note On raises a note's value. Note Off releases it, and the renderer decays it according to `trail persistence`. WGSL can therefore sample note identity and velocity directly.

## Thread boundary

The MIDI callback never calls wgpu. It updates synchronized Rust state. The renderer reads a snapshot once per frame and performs all GPU writes on the renderer thread.

This prevents controller message bursts from performing graphics work inside the operating system's MIDI callback.
