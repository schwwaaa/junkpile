# Compute-shader guide

## Compute workgroups

The shader declares:

```wgsl
@compute @workgroup_size(256)
```

Rust dispatches enough workgroups to cover the active particle count:

```text
workgroups = ceil(active particles / 256)
```

The shader checks the global invocation index and exits when the index exceeds the active count. This permits arbitrary particle counts without requiring the count to be divisible by 256.

## Substeps

Substeps are performed inside each compute invocation. Every particle loops between one and eight times before writing its final state back to the storage buffer. This is appropriate because particles do not depend on one another in this example.

For simulations where neighboring particles interact, separate dispatches or additional spatial data structures may be required.

## Storage-buffer portability

The example derives maximum capacity from three device limits:

- maximum storage-buffer binding size
- maximum general buffer size
- maximum compute workgroups per dimension

It then applies a one-million-particle teaching limit. Future projects can lift that limit, split state across multiple buffers, or use indirect dispatch and draw commands.

## Performance interpretation

The controls window reports particle updates per second:

```text
active particles × substeps × measured FPS
```

This is a useful workload indicator but not a direct GPU-time measurement. A later profiling example should use timestamp queries when supported.
