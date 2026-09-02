# Repository documentation audit — 2026-08-28

## Scope

This audit uses the supplied repository tree as the source of truth for the documentation and website. Application/example source code is not changed by this documentation pass.

## Major findings

### 1. Native wgpu documentation was stale

The old site/database described the native collection as ending at the early `00–25` baseline and used the obsolete path `native-wgpu/`.

The actual repository uses `wgpu/` and continues through later I/O, routing, runtime, A/V, and shader-tooling projects.

### 2. Fixed example totals were structurally fragile

The root README, old build script, and older documentation advertised fixed totals. Because Junkpile is intentionally growing, public copy should describe tracks and capabilities rather than require count maintenance after every new project.

### 3. Native numbering needs explanation, not source renumbering

The actual tree contains:

- canonical `19-wgpu-gesture-field`
- a historical `19-wgpu-gesture-field-wgsl-keyword-fix` repair copy
- no `29-*` folder
- later READMEs that explicitly describe the earlier Example 29 network-streaming branch as quarantined
- `40-wgpu-network-output`, which remains unresolved/under review

The documentation catalog therefore keeps existing project identities and explains the gap/status instead of renaming application folders.

### 4. The native I/O architecture is now a major part of Junkpile

The codebase includes a coherent progression from configuration and frame contracts through FFmpeg recording, high-resolution profiles, NDI, presentation modes, runtime state/logging, Syphon/Spout, multi-output routing, appliance operation, and A/V recording.

The old public docs did not explain this as one architectural system.

### 5. WebView and native paths remain complementary

The website should not imply that native wgpu supersedes the WebView examples. The WebView tracks remain the accessible browser-media/creative-coding path; native wgpu adds explicit GPU ownership and currently hosts the deeper high-resolution, recording, and external-output reference implementations. Native/media transports must not be described as wgpu-exclusive merely because their current dedicated example lives in `wgpu/`.

### 6. Product-level framing should remain agnostic

Junkpile is documented as a general stack for focused standalone creative applications. Public docs should not frame the repository as subordinate to another internal engine or product architecture.

## Documentation changes in this pass

- rebuilt `docs/examples.json` from actual repository paths
- updated `README.md`
- updated `wgpu/README.md`
- rewrote `docs/ARCHITECTURE.md`
- regenerated `docs/EXAMPLE_MATRIX.md`
- updated development, roadmap, troubleshooting, and contribution guidance
- updated `index.html` and `docs.html`
- updated the site build script so future builds use the current database rather than the old WebView-only assumptions
- removed visible fixed example counts from the website
- restored an explicit Install navigation entry
- removed obsolete `native-wgpu/` links

## Evidence policy

A project being present in the tree is not the same as runtime validation.

Documentation should distinguish:

- source present
- static validation present
- build/runtime tested on a named platform
- cross-platform tested
- unresolved / under review

Local project READMEs and `VALIDATION.md` files remain the most specific evidence source.
