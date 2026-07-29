# Documentation update — July 26, 2026

## Purpose

Reconcile the public Junkpile documentation with the completed development baseline.

## Before this update

The reference package documented 22 WebView projects:

- 12 Tauri v1
- 10 Tauri v2
- no native-wgpu collection

It also correctly warned readers not to mistake Tauri v2 for a native GPU renderer—but that warning had become outdated because a separate native-wgpu family was subsequently completed.

## After this update

The package documents 78 standalone projects:

- 26 Tauri v1 WebView examples
- 26 Tauri v2 WebView examples
- 26 native Rust/wgpu examples

## Main changes

- rebuilt `index.html` around the three-track architecture
- rebuilt `docs.html` as a searchable, filterable 78-example guide
- replaced obsolete counts and WebView-only claims
- added complete machine-readable catalog data
- expanded architecture and development documentation
- added modernization/reliability lessons
- added current validation language
- added Junkpile → Scheng → standalone-instrument ecosystem direction
- retained the existing static-site assets and visual language

## Integration note

This is a documentation-only package. When it is merged into the latest complete repository, verify every example-directory link against the final local folder tree before publishing.


## Subsequent identity update

On 2026-07-27, the documentation received a new layered Junkpile identity, a complete product design principle manifest, an asset registry, refreshed favicons, and explicit deprecation of the previous illustrated desk logo. See `BRAND_UPDATE_2026-07-27.md`.
