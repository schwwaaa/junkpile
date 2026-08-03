# Changelog

## 0.2.0

- Expanded the built-in collection from four to twelve WGSL shaders.
- Added GPU-pressure profiles and the `u_complexity` parameter.
- Changed `u_spin` from a static angle to angular velocity in every shader.
- Preserved active shader, profile, current values, and targets across file-system reloads.
- Treated `render.json.active_frag` as startup selection after launch.
- Moved built-ins to a v2 runtime workspace so the new catalog is installed cleanly.
