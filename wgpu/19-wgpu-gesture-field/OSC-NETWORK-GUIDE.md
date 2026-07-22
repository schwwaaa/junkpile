# OSC Network Guide

## Why OSC is a different input vector

MIDI primarily identifies controls by message class, channel, and controller/note number. OSC identifies controls using human-readable address strings and typed argument lists:

```text
/hue 0.25
/camera/orbit 0.6 0.2
/scene/reset true
```

That makes OSC well suited to software patches, mobile control surfaces, sensor systems, robotics, and networked installations.

## Registry mapping

Each mapping stores:

```text
target renderer parameter
OSC address
argument index
input minimum / maximum
output minimum / maximum
invert flag
smoothing amount
```

For example, a Max slider outputting `0–127` can be mapped to normalized hue:

```text
Address:    /hue
Argument:   0
Input:      0 → 127
Output:     0 → 1
```

## Max/MSP

Open `examples/max/junkpile-osc-test.maxpat`. The core patch chain is:

```text
slider → scale 0 127 0. 1. → oscformat hue → udpsend 127.0.0.1 9000
```

To change the destination address, replace `oscformat hue` with another address such as `oscformat turbulence`.

## TouchOSC

Set the OSC connection host to the computer running the Tauri example and the outgoing UDP port to `9000`. Use address strings from the starter map or create mappings with OSC Learn.

## SuperCollider

Run `examples/supercollider/send-test.scd`, then evaluate individual send lines or the automatic routine.

## Pure Data

A typical Pd chain is:

```text
[number box]
     ↓
[oscformat hue]
     ↓
[netsend -u -b]
```

Connect `netsend` to `localhost 9000`.

## Bundles

`rosc` represents a packet as either a message or a bundle. Bundles may contain nested messages or more bundles. This example recursively expands them and records bundle depth in the monitor.

The bundle timetag is not scheduled in this first version. Messages are applied as soon as their UDP datagram is decoded. A future clocked OSC example can place timetagged messages into a scheduler.

## Threading

```text
UDP socket thread
    ↓ synchronized snapshot
wgpu renderer thread
    ↓ GPU buffers
native surface
```

The socket is nonblocking and processes a bounded number of datagrams per worker iteration. The renderer reads only the latest normalized state.
