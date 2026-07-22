# Raymarching guide

## Signed-distance fields

A signed-distance function estimates the distance from a point in space to the nearest surface. Positive values are outside the shape, values near zero are on the surface, and negative values are inside.

Primitive functions in `shader.wgsl` include:

- sphere
- box and rounded box
- torus
- capsule

The examples combine primitives through minimum operations, smooth unions, subtraction, rotation, deformation, and spatial repetition.

## Primary ray

For each output pixel:

1. Construct a camera ray.
2. Evaluate the scene at the current point.
3. Advance by a fraction of the returned distance.
4. Stop when the distance is below the surface epsilon, the maximum travel distance is exceeded, or the ray-step limit is reached.

A higher step limit can reveal more difficult geometry, but it multiplies potential scene evaluations across every pixel.

## Surface normal

The shader estimates the normal by sampling the distance field in four nearby directions. This allows lighting without storing mesh normals because no mesh exists.

## Soft shadows

A shadow ray marches from the surface toward the light. It estimates partial visibility from how closely the ray approaches geometry, producing soft penumbra rather than only binary shadowing.

## Ambient occlusion

Several short samples are taken along the surface normal. Nearby geometry reduces the ambient term, making cavities and intersections easier to read.

## Volumetric glow

The primary ray accumulates a small amount of energy whenever it passes close to a surface. This is not a physically complete participating-media renderer, but it demonstrates how distance fields can contribute effects throughout the ray instead of only at the final hit.

## High-resolution cost

Approximate primary-ray upper bound:

```text
internal pixels × maximum ray steps × frames per second
```

The controls report this as `Gsteps/s`. It is an upper-bound diagnostic, not a measured shader invocation count, because many rays terminate early and lighting adds separate distance-field samples.

At 8K and 128 maximum steps, the primary ray alone has a theoretical budget of more than 4.2 billion distance evaluations per frame before early exits.
