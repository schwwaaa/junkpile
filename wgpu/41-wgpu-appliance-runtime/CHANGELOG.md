# Changelog

## 0.1.0

- Add configuration-driven appliance startup.
- Add UI-visible, hidden-controls, and fully hidden launch modes.
- Add profile and visibility CLI overrides.
- Add optional output autostart.
- Add continuous JSON health/status snapshots.
- Add timed clean shutdown.
- Make controls-window close perform a clean multi-output shutdown; provide a separate explicit hide-controls action.
- Change preview-window close behavior from renderer shutdown to presentation hide.
- Add clean multi-output shutdown with recording-finalization wait.
- Add a headless NDI + H.264 capture profile.
- Preserve preview, NDI, recording, Syphon, and Spout routing from the stable cross-platform router.
- Exclude unresolved network-output code.
