# Appliance Runtime Architecture

```text
appliance.json + CLI overrides
              |
              v
      startup authority
              |
      arm I/O profile
              |
              v
 authoritative wgpu texture
    |         |          |
 preview     NDI      Syphon/Spout
    |
 optional
    +--------------------> FFmpeg recording

runtime snapshots
      |
      v
appliance-status.json
```

## Ownership rules

- `appliance.json` owns startup profile, autostart, initial window policy, heartbeat, status path, and optional timed exit.
- CLI arguments temporarily override appliance configuration for one launch.
- `io-profiles.json` owns render dimensions and per-sink route settings.
- Runtime profile selection remains authoritative until the appliance configuration is explicitly applied again.
- Closing either window changes visibility only; it does not destroy the renderer.
- The status writer observes runtime state and never controls sinks.
- External sink failures remain isolated from the authoritative renderer and other outputs.

## Hidden versus truly headless

This example creates a native GPU surface because the current renderer is surface-backed. Appliance mode hides the windows and continues offscreen rendering. A future display-server-free implementation would require backend-specific headless surface/context work and is intentionally treated as a separate optimization.
