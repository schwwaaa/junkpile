# Understanding the Z Plane

Adding a `z` value does not automatically produce a convincing 3D image. A useful 3D renderer needs several coordinated spaces and systems.

## Coordinate spaces

```text
Particle local data
      ↓
World space (x, y, z)
      ↓ camera position and orientation
View/camera space
      ↓ perspective projection
Clip space
      ↓ divide by w
Normalized device coordinates
      ↓ viewport
Screen pixels
```

## Perspective

The vertex shader outputs a clip-space `vec4`. The GPU divides its XYZ components by W. In this example, camera-space depth becomes clip-space W, so distant positions contract toward the center after the divide.

## Depth buffer

The color texture stores visible color. A separate `Depth32Float` texture stores the nearest accepted depth at each pixel. With depth writes enabled, later fragments are compared against that stored value.

## Why two render modes exist

Particles are soft transparent discs rather than sealed opaque triangles. Traditional depth writing can cause a soft disc to block particles behind it. Additive rendering avoids that problem but does not provide occlusion. The toggle lets developers inspect both behaviors directly.

## Future extensions

This example is the foundation for:

- 3D feedback volumes
- Point-cloud camera input
- Mesh and voxel particles
- Signed-distance-field raymarching
- 3D audio-reactive fields
- Stereoscopic rendering
- Volumetric fog and lighting
- Camera matrices supplied by MIDI, OSC, or motion tracking
