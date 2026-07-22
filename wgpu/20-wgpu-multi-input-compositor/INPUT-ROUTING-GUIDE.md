# Input Routing Guide

## Thread and queue policy

The compositor does not funnel raw high-rate input through one central queue.

- Camera and video publish only their latest complete frame.
- Microphone callbacks publish bounded sample chunks; FFT runs on a worker thread.
- Video audio is decoded into a bounded ring and clocked by the audio output callback.
- MIDI and OSC callbacks update small normalized snapshots.
- Gesture IPC is limited to one publication per browser animation frame.
- The renderer reads snapshots once per GPU frame.

This prevents one slow input source from blocking the other systems or the native render loop.

## Audio router

```text
microphone analyzer snapshot ─┐
                              ├── source router → renderer audio snapshot
video-audio analyzer snapshot ┘
```

The router supports microphone, video, and mixed sources. Mixed mode combines already analyzed data, avoiding an implicit sample-rate conversion step.

## GPU resources

```text
Group 0
  uniform buffer
  64-point gesture storage buffer
  160-float MIDI/OSC signal buffer

Group 1
  camera texture
  video texture
  source sampler

Group 2
  current composite texture
  previous feedback texture
  feedback sampler

Group 3
  completed feedback texture
  presentation sampler
```

The pipeline layouts retain explicit bind-group numbers so media, control data, feedback history, and presentation resources remain visibly separated.

## Why the controls window still exists

The controls WebView handles device selection, file picking, transport, routing controls, and pointer events. It does not render the final output. The renderer window remains a native wgpu surface with no WebGL canvas in the output path.
