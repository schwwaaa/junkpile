# Validation Checklist

- [x] Twelve shader files are listed in `render.json`.
- [x] Every listed shader exists and contains the required WGSL contract text.
- [x] Every shader maps spin as `time * spin_speed`.
- [x] Every shader defines `LIVE_EDIT_TINT`.
- [x] Every shader has `default`, `still`, and `peak` profiles.
- [x] JSON files parse and relationship checks pass statically.
- [x] Frontend JavaScript passes `node --check`.
- [x] Runtime reload code preserves active selection and parameter targets.
- [ ] First local Cargo compile.
- [ ] Local activation test for all twelve shaders.
- [ ] Peak-profile performance test on target GPUs.
