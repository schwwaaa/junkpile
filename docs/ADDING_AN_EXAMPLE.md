# Adding or forking a Junkpile example

Junkpile is a growing laboratory, not a fixed-count collection. New work should begin from the nearest accepted baseline and preserve the old project unless the change is a documented repair.

## 1. Choose the nearest baseline

Select by architecture, not visual appearance alone:

- Tauri generation/framework model
- pixel owner: WebView/WebGL or native Rust/wgpu
- native/media services attached to the application, documented separately from renderer ownership
- input/capture source
- temporal state
- window topology
- output/recording requirements
- platform-specific interop

## 2. Preserve the original

Create a branch, tag, or copied project. A useful example is a reproducible reference; do not turn it into a moving target while developing an unrelated capability.

## 3. Change one architectural layer first

Examples:

- browser camera → native camera
- WebGL feedback → wgpu feedback
- manual controls → MIDI/OSC parameter registry
- one output → independent routed outputs
- browser decoder → FFmpeg decoder
- video-only recorder → A/V recorder

## 4. Numbering

Numbering is project identity, not a requirement for future examples to fill every gap.

- Preserve existing folder numbers.
- Do not renumber later projects simply to make the tree contiguous.
- A repair copy should not silently become a new numbered example.
- If an experiment is quarantined or unresolved, document the gap/status rather than shifting the rest of the collection.

The native wgpu tree currently demonstrates both cases: Example 29 is absent and referenced by later projects as quarantined; the public catalog treats `19-wgpu-gesture-field` as canonical even though a historical WGSL-fix copy remains in the source tree.

## 5. Required project structure

Typical standalone project:

```text
README.md
package.json
src/
src-tauri/
```

Rust projects should retain an independent workspace boundary when appropriate:

```toml
[workspace]
resolver = "2"
```

## 6. Required behavior

Aim for:

- clear purpose and project identity
- visible runtime status and actionable errors
- reliable initial layout/scrolling
- lifecycle-safe input start/stop/reconnect
- explicit GPU/resource clear and resize behavior
- bounded queues for external workers
- telemetry for dropped frames or backpressure
- development and production build commands
- platform requirements called out explicitly

## 7. Shared media I/O principle

Focused applications should be able to opt into common media/input/output patterns without carrying every dependency.

Treat these as separable capabilities:

- camera/video/image/audio input
- MIDI/OSC control
- preview
- file recording
- NDI
- Syphon/Spout
- future network or device-specific outputs

The renderer should remain authoritative while outputs consume frames through explicit contracts. New I/O examples are most valuable when they introduce a genuinely new capability rather than duplicating an existing transport.

## 8. Documentation required for a new example

Document:

1. purpose
2. architecture
3. prerequisites
4. run/build commands
5. controls and expected behavior
6. file/module map
7. failure modes
8. validation evidence
9. platform boundaries
10. relationship to the baseline it extends
