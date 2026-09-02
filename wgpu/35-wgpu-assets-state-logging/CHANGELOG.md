# Changelog

## 0.1.0 — ShadeCore runtime infrastructure parity

- add ordered asset-root discovery through CLI, environment, persisted state, and platform defaults
- support `JUNKPILE_ASSETS`, `JUNKPILE_LOG_FILE`, and ShadeCore-compatible aliases
- add strict base plus operating-system runtime configuration
- add atomic shader/profile/parameter state persistence and startup restoration
- add autosave suspension after explicit state removal
- add JSON Lines file logging with a bounded in-memory event ring
- add subsystem, event, severity, message, timestamp, and structured field metadata
- add custom asset-root cloning and next-launch selection
- preserve live shader selection when watched files change
- retain last-known-good WGSL and parameter configuration on validation failures
