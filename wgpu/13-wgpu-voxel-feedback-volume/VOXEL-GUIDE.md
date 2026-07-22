# Voxel feedback guide

The simulation stores `rgb = emitted color` and `a = density` in two alternating 3D textures. Each compute dispatch reads one field and writes the other. The active field is then sampled by the renderer.

## Views

- **Raymarch:** front-to-back volume integration.
- **XY / XZ slice:** direct inspection of internal layers.
- **Maximum intensity:** brightest voxel along each ray.
- **Surface:** first density crossing with a gradient-derived normal.

## Scaling

Volume cost is cubic. Output cost is two-dimensional. A 256³ simulation can be expensive even in a small window, while an 8K output can be expensive even with a 64³ volume. These controls are deliberately independent.
