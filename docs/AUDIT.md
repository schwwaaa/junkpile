# Documentation reconciliation audit — July 26, 2026

## Scope

The supplied documentation snapshot described 22 WebView examples and stated that native wgpu was not present. The completed project now contains 78 examples across three 00–25 collections. This documentation pass reconciles that mismatch.

## Primary corrections

1. Updated count from 22 to 78.
2. Added Tauri v1 Examples 12–25.
3. Added Tauri v2 Examples 10–25 and reflected modernization of 00–09.
4. Added the complete native-wgpu 00–25 collection.
5. Replaced the false “all renderers are WebView-based” claim with a three-track architecture model.
6. Updated validation language from static-only to sequential macOS runtime testing while preserving cross-platform uncertainty.
7. Added modernization lessons covering scroll, control coalescing, shader safety, device permission, native drag/drop, secure texture loading, image-sequence pacing, and bounded output.
8. Added ecosystem direction from verified examples toward Scheng components and focused standalone instruments.

## Files updated

- `README.md`
- `index.html`
- `docs.html`
- `docs/examples.json`
- all existing Markdown guides
- new advancements and ecosystem direction documents

## Validation performed on this documentation package

- machine-readable catalog contains exactly 78 unique entries
- each collection contains exactly 26 numbers from 00 through 25
- HTML parsed successfully
- internal HTML anchor targets checked
- JSON parsed successfully
- JavaScript syntax checked
- ZIP extracted and tested for integrity

## Remaining repository-level validation

This package documents the finalized development history, but it does not contain the complete source repository. Therefore it cannot verify that every catalog path exists in the user's latest local checkout. Folder names were preserved from the completed project sequence and should be compared during the final merge into the repository.


## Identity and brand audit

- The new layered Junkpile logo is integrated into `index.html`, `docs.html`, and `README.md`.
- Digital colors are normalized to existing CSS tokens rather than introducing a competing palette.
- Primary, symbol, monochrome, reversed, favicon, and README-safe raster derivatives are present.
- The original generative source is archived.
- The previous illustrated desk logo is preserved and explicitly deprecated.
- `docs/DESIGN_PRINCIPLES_MANIFEST.md` records rationale, usage, accessibility, governance, and open production questions.
- Vector master, exact wordmark outlines, print colors, and physical reproduction tests remain open and are not represented as complete.
