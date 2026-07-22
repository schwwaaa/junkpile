# Compute Fluid Guide

## What this example simulates

The project approximates a two-dimensional incompressible fluid. It is intended as a creative GPU template, not a scientific computational-fluid-dynamics solver.

The simulation stores velocity as the XY components of an HDR texture. Dye stores color transported through that velocity field. Pressure is solved iteratively so the projected velocity field approaches zero divergence.

## Advection

For every grid cell, the compute shader looks backward through the velocity field and samples the value that would have arrived at the current location. Manual bilinear interpolation is implemented with `textureLoad`, which keeps the compute path independent of texture-filtering support.

## Vorticity confinement

Semi-Lagrangian advection is stable but loses small rotating structures. Curl is measured into a separate texture. A confinement force is then applied along the gradient of curl magnitude to restore visible rotational motion.

## Pressure projection

The divergence pass measures local expansion or compression. Pressure is solved with repeated Jacobi iterations using pressure ping-pong textures. The pressure gradient is then subtracted from velocity.

More pressure iterations improve the projection but add one complete compute dispatch per iteration. The example uses even iteration counts so the final pressure consistently returns to pressure texture A.

## Dye feedback

Dye is transported after pressure projection. A small rotated and contracted sample of prior dye can be mixed back into the current field. This is a creative feedback stage rather than part of the physical solver.

## Memory

Each simulation texture is `Rgba16Float`, or eight bytes per grid cell.

Approximate field memory for eight textures:

| Grid | Cells | Fluid textures |
|---:|---:|---:|
| 128² | 16,384 | 1 MiB |
| 256² | 65,536 | 4 MiB |
| 512² | 262,144 | 16 MiB |
| 1024² | 1,048,576 | 64 MiB |
| 2048² | 4,194,304 | 256 MiB |

The HDR output target is separate. One 8K `Rgba16Float` target is approximately 253 MiB.

## Performance scaling

Per substep, the project records:

```text
6 fixed full-grid passes + pressure iteration count
```

At 24 pressure iterations and one substep, that is 30 full-grid compute dispatches per frame. Two substeps doubles it to 60.

The diagnostics report an estimated cell-update rate:

```text
grid cells × compute passes per frame × measured FPS
```

This is not a direct GPU-time measurement, but it makes workload growth visible.

## Future extensions

This architecture is ready for:

- mouse or tablet force injection
- webcam optical-flow injection
- audio-spectrum emitters
- MIDI and OSC mapping
- obstacles and boundary masks
- signed-distance-field collision boundaries
- three-dimensional volume transport
- timestamp-query profiling
- offline deterministic image-sequence export
