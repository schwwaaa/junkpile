# Video Audio and FFT Routing Guide

## Why video audio is a separate input

A video file contains two independently decoded streams:

```text
video stream → BGRA frames → wgpu texture
 audio stream → PCM samples → preview + FFT
```

Treating the audio track as a first-class input prevents a visually functioning player from appearing broken or silent to users.

## Preview safety

Only video-file audio is sent to the output device.

```text
Microphone → FFT only ───────────────┐
                                      ├── combined GPU analysis snapshot
Video audio → FFT + optional preview ┘
```

The application intentionally does not provide microphone monitoring. That avoids an immediate speaker-to-microphone feedback path.

## Playback clock

FFmpeg may decode faster than real time. Decoded samples therefore enter a bounded ring buffer. The CPAL output callback consumes that ring at the hardware output rate and publishes mono analysis chunks at the same time.

This keeps:

- Audible preview
- Video-audio FFT
- Playback-rate changes

on one audio clock.

## Mixed FFT source

Microphone and video audio can use different sample rates, so they are analyzed independently. Mixed mode combines the two completed analysis snapshots rather than attempting a naive sample-by-sample mix without resampling.

## Transport behavior

The following actions are mirrored to both the video-frame decoder and video-audio decoder:

- Open
- Play
- Pause
- Stop
- Seek
- Frame step
- Loop selection
- Playback-rate changes

Frame stepping pauses audio at the stepped video position. Audio resumes from that position when playback restarts.
