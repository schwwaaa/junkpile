---
title: Junkpile Product Design Principle Manifest
version: 1.0.0
status: active-for-documentation
owner: Junkpile project owner
created: 2026-07-27
last_updated: 2026-07-27
canonical_location: docs/DESIGN_PRINCIPLES_MANIFEST.md
related_assets: assets/brand/
parent_ecosystem:
  - Schwwaaa
  - shared component layer
supported_contexts:
  - documentation website
  - developer documentation
  - repository README
  - application identity reference
  - social and presentation graphics
---

# Junkpile Product Design Principle Manifest

## 1. Evidence summary

This manifest applies the supplied **Design Principles Criteria and Product Manifest Protocol** to the current Junkpile documentation, source inventory, website CSS, project positioning, and the newly approved generated logo.

### Source status

| Source | Evidence status | What it establishes |
| --- | --- | --- |
| Completed Junkpile documentation package | **Verified** | Product scope, three 00–25 collections, audience, architecture, existing information hierarchy, site structure, and documentation voice. |
| `assets/site/site.css` | **Verified** | Current digital color tokens, typography stacks, border rules, grid texture, shadow system, layout widths, and interaction timing. |
| Approved generated Junkpile logo | **Verified for current documentation use** | Primary horizontal lockup, layered symbol, lowercase wordmark, and four-color identity concept. |
| Previous illustrated desk logo | **Verified historical asset** | Earlier identity equity and the original “pile of work” metaphor; retained only for archive/history. |
| Design Principles Criteria and Product Manifest Protocol | **Verified governance source** | Evidence rules, rationale requirements, production cautions, and asset-governance method. |
| Exact vector construction and wordmark font | **Unknown** | No approved vector master or separately identified wordmark typeface exists yet. |

The available evidence is sufficient for a current web/documentation identity specification. It is not yet sufficient for a final print-production standards manual because vector construction, spot-color targets, physical production tests, trademark review, and exact wordmark outlines remain unresolved.

---

## 2. Executive design thesis

**Junkpile is presented as a disciplined stack of reusable experiments: accumulated parts organized into an inspectable system.**

The identity combines the disorder implied by the name with the rigor of the completed library. The layered symbol represents examples, render paths, media sources, and reusable modules placed into a visible stack. Acid color signals experimentation; black structure signals technical seriousness; the lowercase wordmark keeps the system direct and unpretentious.

The most important rule is:

> **Keep the accumulation visible, but make the system legible.**

Junkpile must never become generic corporate technology minimalism, uncontrolled visual clutter, or nostalgic illustration detached from the actual developer tool.

---

## 3. Product and audience definition

### Product

Junkpile is a completed developer laboratory of 78 standalone creative graphics and media applications. It contains three parallel 00–25 collections:

- Tauri v1 WebView;
- Tauri v2 WebView;
- native Rust/wgpu.

Each example isolates a rendering, media, input, routing, control, automation, or output architecture so developers can run it, inspect it, modify it, package it, and reuse it.

### Primary audiences

- creative coders;
- graphics and media developers;
- artists building standalone visual instruments;
- developers learning the boundary between WebView and native GPU systems;
- future shared-component authors.

### Usage contexts

- repository landing pages;
- long-form technical documentation;
- standalone example applications;
- diagrams and architecture comparisons;
- release archives and developer handoffs;
- presentations and ecosystem explanations.

### Desired relationship

The product should feel:

- technically credible but approachable;
- experimental but not unstable;
- dense with possibility but easy to navigate;
- visually assertive without obscuring the code;
- handmade in attitude but systematic in execution.

---

## 4. Design problem

### Previous condition

The earlier illustrated desk logo communicated “pile,” labor, and informal experimentation, but it behaved more like a detailed editorial illustration than a flexible identity mark. It was difficult to reduce, difficult to use as an icon, visually disconnected from the modern documentation shell, and dependent on fine line detail.

The documentation site had already developed a stronger system through:

- hard black borders;
- warm paper fields;
- acid signal colors;
- large editorial typography;
- visible grids;
- square tags and status blocks;
- explicit architecture diagrams.

The identity mark did not yet express that system.

### Current design objective

Create an identity that:

1. preserves the semantic equity of accumulation and experimentation;
2. aligns with the current documentation website;
3. remains recognizable as a small icon;
4. works in color and monochrome;
5. feels appropriate beside code, diagrams, technical controls, and developer writing;
6. can extend into future application assets without forcing every product to look identical.

### Success criteria

- recognizable layered silhouette;
- readable horizontal wordmark at documentation-header sizes;
- symbol remains legible at favicon and app-icon sizes;
- identity uses existing site tokens rather than adding an unrelated palette;
- black-and-white versions survive;
- full lockup and symbol-only use are clearly separated;
- old identity remains traceable without remaining active.

---

## 5. Central concept and reasoning

### Central idea

> Junkpile is a stack of working modules: each layer is independently useful, while the pile becomes a larger system through visible accumulation.

### Why the idea fits

The logo does not illustrate a literal trash heap. It abstracts the project’s real behavior:

- examples accumulate;
- layers remain distinguishable;
- render paths can be compared;
- modules are reused;
- the library becomes infrastructure without hiding its parts.

### Product-specific contrast

The character comes from controlled tension:

| Tension | Design translation |
| --- | --- |
| Pile / system | Offset layers arranged on a strict visual axis. |
| Experiment / proof | Acid signals contained by black structure. |
| Browser / native | Multiple colored planes sharing one stack. |
| Play / engineering | Bright palette beside technical typography and diagnostics. |
| Fragment / ecosystem | Small independent shapes forming one memorable symbol. |

The red square operates as an active module, cursor, sample, or signal point. It prevents the stack from becoming a generic layer icon and gives the mark a small asymmetric event.

---

## 6. Influences and boundaries

| Reference | Relevant quality | Translation for Junkpile | Boundary | Status |
| --- | --- | --- | --- | --- |
| Paul Rand’s rationale-led identity practice | Clear central idea, memorable form, proof through reproduction | The identity is explained through product behavior and tested as symbol, lockup, monochrome, and small-size assets | Do not copy historical marks, the NeXT cube, angles, typography, or presentation surface | Method verified; visual translation original |
| Swiss and modernist editorial systems | hierarchy, strong alignment, limited palette, typography as structure | Bold headings, mono metadata, grid, hard rules, visible information architecture | Avoid sterile neutrality or false mathematical mythology | Observed / adopted |
| Brutalist web language | directness, visible borders, unapologetic controls | square borders, hard shadows, exposed architecture diagrams, zero-radius surfaces | Avoid intentionally broken usability, illegibility, or random ugliness | Observed / refined |
| Developer tools and patchable media systems | modules, signals, explicit state | stacked symbol, signal colors, status tags, architecture-first copy | Avoid generic cloud/SaaS symbolism | Inferred / adopted |
| Previous illustrated desk logo | accumulation, workbench, informal creative labor | retain the “pile of work” idea in a reducible layered symbol | Do not retain detailed line illustration as the primary mark | Historical / deprecated |

---

## 7. Core design principles

### 7.1 Accumulation Becomes System

**Rule:** Show that many small parts form the whole, but preserve hierarchy and boundaries.

**Reason:** Junkpile’s value comes from a large collection of focused standalone examples rather than one opaque framework.

**In practice:** Use stacks, sequences, numbered collections, grouped cards, and explicit tracks.

**Avoid:** Decorative clutter, random overlaps, or combining unrelated information without labels.

**Evaluation question:** Can a user see both the individual unit and the system it belongs to?

### 7.2 Architecture Stays Visible

**Rule:** The design should expose ownership, signal flow, runtime status, and system differences.

**Reason:** The project teaches by making architectural boundaries inspectable.

**In practice:** Prefer diagrams, labels, telemetry, code paths, and clear WebView/native distinctions.

**Avoid:** Marketing language that collapses materially different render paths into one vague promise.

**Evaluation question:** Does the presentation make the important boundary easier to understand?

### 7.3 Signal Color Has a Job

**Rule:** Bright colors identify tracks, actions, status, or emphasis; they are not ambient decoration.

**Reason:** The palette is expressive because each color creates structure and recognition.

**In practice:** Acid yellow-green marks primary action and recognition; blue marks modern/current system layers; orange marks active exceptions or hot events; yellow supports warnings and secondary emphasis.

**Avoid:** Random per-page recoloring, gradients that weaken token identity, or using every signal color at equal strength.

**Evaluation question:** Can the reason for this color be stated in one sentence?

### 7.4 Editorial, Not Generic SaaS

**Rule:** Pages should feel authored, paced, and explanatory rather than assembled from anonymous rounded cards.

**Reason:** Junkpile is a learning archive and technical publication as much as a software repository.

**In practice:** Use strong headings, hard rules, asymmetry, captions, diagrams, and deliberate white space.

**Avoid:** excessive pill shapes, soft glass effects, generic hero gradients, and empty “premium technology” language.

**Evaluation question:** Does the page help construct an argument, or merely decorate information?

### 7.5 Instrument-Ready Clarity

**Rule:** Interfaces and examples should remain legible during active adjustment and testing.

**Reason:** Many examples become live visual instruments, not static demos.

**In practice:** Maintain stable readouts, visible state, direct controls, keyboard access, clear errors, and responsive feedback.

**Avoid:** shifting values, hidden state, unnecessary modals, and animation that interrupts operation.

**Evaluation question:** Can the user act, perceive the result, and recover without losing concentration?

### 7.6 Reproduction Before Effects

**Rule:** Identity and interface elements must work as flat forms before shadows, texture, motion, or special presentation are added.

**Reason:** The project spans favicons, READMEs, application windows, print, screenshots, and constrained displays.

**In practice:** Maintain monochrome assets, strong silhouettes, high contrast, and crisp edges.

**Avoid:** glows, soft blur, fine detail, or lighting effects as required identity features.

**Evaluation question:** Does the element remain recognizable when reduced to one color and viewed small?

---

## 8. Identity mark and logo system

### 8.1 Mark concept

**Name:** Layered Modules mark  
**Type:** abstract/suggestive symbol plus lowercase wordmark  
**Mnemonic role:** a pile of examples, screens, cards, frames, or reusable system layers  
**Relationship to name:** translates “junkpile” from literal debris into useful accumulated parts

### 8.2 Canonical form

The current primary lockup contains:

1. black base layer;
2. blue middle layer;
3. acid yellow-green top layer;
4. small hot-orange square accent;
5. lowercase black `junkpile` wordmark.

The layers use offset isometric-like planes with hard edges. The mark should remain flat. The current production derivatives intentionally remove glow and normalize colors to site tokens.

### 8.3 Approved current variants

| Variant | Asset | Use | Status |
| --- | --- | --- | --- |
| Primary horizontal | `assets/brand/junkpile-logo-primary.png` | website, documentation, general digital use | Current |
| Primary on paper | `assets/brand/junkpile-logo-primary-on-paper.png` | README, presentations, dark viewer environments | Current |
| Symbol only | `assets/brand/junkpile-symbol.png` | favicon, avatar, app tile, compact navigation | Current |
| Symbol on paper | `assets/brand/junkpile-symbol-on-paper.png` | social/profile presentation and light app tile | Current |
| Monochrome | `assets/brand/junkpile-logo-monochrome.png` | one-color light backgrounds | Current |
| Reversed | `assets/brand/junkpile-logo-reversed.png` | one-color dark backgrounds | Current |
| Original generation | `assets/brand/source/junkpile-logo-generation.png` | source reference only | Retained source |
| Illustrated desk logo | `assets/brand/archive/schwwaaa-junkpile-logo-legacy.jpg` | history only | Deprecated |

### 8.4 Current usage rules

**Full name required:** first appearance, README header, documentation hero, release cover, presentation cover, and unfamiliar external contexts.

**Symbol-only permitted:** favicon, small app tile, compact header where the written name appears immediately beside it, social avatar, or repeated navigation context.

**Backgrounds:** use the primary logo on Paper, Paper 2, white, or other quiet light backgrounds. Use the reversed one-color asset on Ink or other dark backgrounds. Do not place the black wordmark directly on a dark field.

**Clear space — proposed:** reserve at least one orange-accent-square width around the complete lockup. This is a relative rule and remains provisional until a vector construction standard is approved.

**Minimum size — provisional:**

- primary lockup: 180 CSS pixels wide for general web use;
- symbol: 24 CSS pixels for interface use;
- favicon exception: 16 pixels using the symbol-only derivative;
- print minimum: TBD after physical proofing.

### 8.5 Prohibited use

- do not restore generation glow, haze, lighting, or environmental mockup effects to the canonical logo;
- do not rotate the complete lockup;
- do not rearrange layer order;
- do not recolor with arbitrary hues;
- do not place the black wordmark on low-contrast or dark backgrounds;
- do not stretch, condense, outline, or add shadows to the logo artwork;
- do not place the logo inside an arbitrary badge shape;
- do not use the old illustrated desk logo as the current primary identity;
- do not claim an exact vector construction or font name until approved masters exist.

---

## 9. Typography system

### 9.1 Documentation typography

The current website defines the following stacks:

```css
--sans: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
--mono: "SFMono-Regular", "Cascadia Code", "Roboto Mono", Consolas, "Liberation Mono", monospace;
```

**Status:** Verified implementation. The site does not currently bundle Inter, so actual rendering may use a platform fallback.

### 9.2 Roles

| Role | Family | Behavior |
| --- | --- | --- |
| Display and section headings | Sans stack | very heavy weight, compressed line height, negative tracking, editorial scale |
| Body copy | Sans stack | moderate weight, generous line height, readable long-form width |
| Metadata, code, labels, buttons, telemetry | Mono stack | uppercase or compact technical rhythm |
| Logo wordmark | Raster artwork | embedded in approved logo files; no runtime font dependency |

### 9.3 Typographic rules

- use lowercase `junkpile` in the logo and ordinary product references unless sentence grammar requires capitalization;
- reserve all-caps mono type for small labels, categories, statuses, and controls;
- use very heavy display type sparingly for page-level arguments;
- do not make long documentation body copy display-sized;
- preserve code and file names exactly;
- allow long example names and paths to wrap rather than clip.

### 9.4 Unknowns

- exact outlined wordmark construction;
- licensed canonical display font independent of the system stack;
- print typography specification.

These remain TBD rather than inferred from the raster logo.

---

## 10. Color system

### 10.1 Canonical digital tokens

| Name | HEX | Role | Status |
| --- | --- | --- | --- |
| Ink | `#11110F` | primary text, borders, structural fields, dark backgrounds | Verified |
| Paper | `#F3F0E5` | primary warm background | Verified |
| Paper 2 | `#FFFDF6` | cards and raised reading surfaces | Verified |
| Muted | `#6C6A62` | secondary copy and subdued metadata | Verified |
| Acid Signal | `#D7FF2F` | primary recognition, action, active state, top logo layer | Verified |
| Hot Orange | `#FF6B47` | event, exception, alert emphasis, logo accent | Verified |
| System Blue | `#8EB8FF` | modern/current system layer, information, middle logo layer | Verified |
| Utility Yellow | `#FFCF4B` | warning and secondary emphasis | Verified |
| Success | `#BDF4B1` | completed/healthy status | Verified |
| Warning | `#FFE195` | caution surface | Verified |
| Danger | `#FFB5AA` | failure/destructive surface | Verified |

### 10.2 Color behavior

- Ink and Paper carry the system even without signal color.
- Acid Signal is the primary recognition color and should remain scarce enough to retain force.
- System Blue distinguishes a second layer or modern/current path.
- Hot Orange is a small event color; its limited area in the logo is intentional.
- Utility Yellow supports warning and editorial punctuation but is not part of the four-color primary logo.
- Status colors must be paired with text or symbols; color alone must not carry critical meaning.

### 10.3 Print status

CMYK, spot-color, substrate, finish, and proofing specifications are **unknown**. Digital HEX values must not be presented as final print formulas without controlled conversion and proofing.

---

## 11. Spatial, grid, and formal language

### Verified digital structure

- content maximum: `1240px` on the main site;
- page background grid: `24px × 24px`;
- borders: generally `2px–3px` Ink;
- corner radius: `0`;
- large shadow: `6px 6px 0 Ink`;
- small shadow: `3px 3px 0 Ink`;
- major section spacing: approximately `86px` desktop and `62px` compact screens;
- cards and diagrams use hard rectangular containment;
- interface layers use clear stacking and offset rather than soft elevation.

### Formal vocabulary

- square and rectangular modules;
- hard rules and frames;
- offset planes and stacks;
- deliberate asymmetry;
- visible grids;
- outlined or reversed display text;
- signal-color tags;
- no decorative rounding;
- no required gradients.

### White-space rule

White space is used to separate reasoning layers and preserve reading pace. It must not be filled merely because the project name implies a pile.

---

## 12. Iconography, diagrams, and imagery

### Iconography

- use simple filled or outlined symbols with strong silhouette;
- prefer platform-recognizable controls for critical functions;
- pair ambiguous icons with labels;
- use the layered symbol for product identity, not as a universal interface glyph;
- maintain optical clarity at 16, 24, 32, and 48 pixels.

### Diagrams

Junkpile diagrams should:

- show direction with explicit arrows;
- name ownership and transport;
- separate WebView and native GPU paths;
- use color to classify, not decorate;
- include small technical captions;
- remain readable when printed in monochrome.

### Screenshots

- show real application state;
- include enough interface context to identify the example;
- avoid fake device mockups when a direct screenshot is clearer;
- frame screenshots with Ink rules and concise captions;
- do not obscure errors or limitations for promotional cleanliness.

### Generative imagery policy

Generative imagery may be used for concept exploration and identity prototyping when its status is recorded. Production assets must be normalized, tested, and archived with the source generation. Generated imagery must not fabricate product capabilities or be presented as a screenshot of functioning software.

---

## 13. Interface and interaction language

The interface language follows the product’s “inspectable instrument” behavior:

- direct manipulation;
- visible numeric values;
- explicit runtime state;
- stable control geometry;
- immediate feedback;
- recoverable errors;
- scroll-safe panels;
- keyboard shortcuts where useful;
- ownership and connection telemetry;
- no silent failure or blank-canvas ambiguity.

High-rate controls should be coalesced. Reconnectable systems should restore authoritative state. Active sliders should not be overwritten by stale telemetry.

---

## 14. Motion and temporal behavior

### Current implementation

The website uses short, functional interaction transitions around `120ms` for button movement and shadow response.

### Rules

- motion should reveal state change, hierarchy, or signal flow;
- logo motion is not yet specified;
- avoid ambient animation that competes with code or diagrams;
- provide reduced-motion behavior for future animated systems;
- never make the identity dependent on glow, blur, or continuous movement.

---

## 15. Content and verbal language

### Voice

- direct;
- technically specific;
- transparent about limitations;
- enthusiastic without hype;
- educational in layers;
- respectful of architectural differences.

### Core phrasing

Preferred positioning:

- “creative graphics systems laboratory”;
- “standalone creative graphics systems examples”;
- “see it, run it, understand it, modify it, build it”;
- “three tracks, seventy-eight examples, one visible learning path.”

Avoid:

- describing every project as revolutionary, effortless, or production-ready without evidence;
- collapsing all Tauri v2 work into native GPU rendering;
- calling Junkpile only a shader library;
- language that hides platform limitations or untested paths.

---

## 16. Accessibility requirements

- maintain text/background contrast appropriate to the actual type size;
- never use signal color alone for status;
- preserve visible keyboard focus;
- allow text scaling and long names without clipping;
- maintain minimum pointer and touch target sizes in application interfaces;
- provide reduced-motion alternatives when motion is added;
- ensure logo alt text identifies the project rather than describing every shape;
- use the on-paper logo in contexts where transparent black artwork may be displayed against dark UI;
- preserve monochrome recognition.

---

## 17. Usage scenarios

### Website header

Use the symbol at compact size beside the written product name and subtitle. The full horizontal logo is unnecessary when the name is already present in text.

### Landing-page hero

Use the primary transparent horizontal logo on the warm Paper/Paper 2 field inside the existing hard-bordered logo card.

### Repository README

Use `junkpile-logo-primary-on-paper.png` because GitHub and other viewers may switch between light and dark UI.

### Favicon and compact app identity

Use the symbol-only icon derivatives from `assets/icons/`. At 16 pixels, simplified recognition takes priority over the orange accent’s exact detail.

### Dark presentation slide

Use the reversed one-color logo or place the full-color primary logo on a contained Paper field. Do not place the black wordmark directly on Ink.

### Monochrome print

Use the monochrome horizontal asset. Physical minimum size remains TBD until proofed.

---

## 18. Anti-patterns and non-goals

The identity must not become:

- a literal garbage/trash brand;
- an imitation of the NeXT cube or another historical technology identity;
- generic cloud, AI, code-bracket, or circuit-board symbolism;
- a soft rounded SaaS design system;
- arbitrary rainbow variation;
- a cluttered collage with no hierarchy;
- a glow-dependent cyber aesthetic;
- an excuse to obscure limitations or architecture;
- an identical skin forced onto every future shared-component-based product.

Junkpile may inform sibling tools, but each standalone product should be permitted its own identity within a shared ecosystem logic.

---

## 19. Asset and token registry

| ID | Asset or token | Canonical location | Format | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| JP-LOGO-PRIMARY | Horizontal color logo | `assets/brand/junkpile-logo-primary.png` | PNG/RGBA | Current | Normalized site-token colors |
| JP-LOGO-PAPER | Horizontal logo on Paper | `assets/brand/junkpile-logo-primary-on-paper.png` | PNG | Current | Preferred for README/viewer-safe use |
| JP-SYMBOL | Layered Modules symbol | `assets/brand/junkpile-symbol.png` | PNG/RGBA | Current | Source for icon derivatives |
| JP-SYMBOL-PAPER | Symbol on Paper | `assets/brand/junkpile-symbol-on-paper.png` | PNG | Current | Avatar/presentation use |
| JP-LOGO-MONO | One-color dark logo | `assets/brand/junkpile-logo-monochrome.png` | PNG/RGBA | Current | Light backgrounds |
| JP-LOGO-REVERSE | One-color white logo | `assets/brand/junkpile-logo-reversed.png` | PNG/RGBA | Current | Dark backgrounds |
| JP-GEN-SOURCE | Original generative concept | `assets/brand/source/junkpile-logo-generation.png` | PNG/RGBA | Source reference | Do not use directly in layout |
| JP-LOGO-LEGACY | Illustrated workbench mark | `assets/brand/archive/schwwaaa-junkpile-logo-legacy.jpg` | JPEG | Deprecated | Historical reference only |
| JP-COLOR-INK | Ink | CSS `--ink` | `#11110F` | Current | Structure and text |
| JP-COLOR-PAPER | Paper | CSS `--paper` | `#F3F0E5` | Current | Primary background |
| JP-COLOR-SIGNAL | Acid Signal | CSS `--signal` | `#D7FF2F` | Current | Recognition/action |
| JP-COLOR-ORANGE | Hot Orange | CSS `--signal-2` | `#FF6B47` | Current | Event/accent |
| JP-COLOR-BLUE | System Blue | CSS `--signal-3` | `#8EB8FF` | Current | Layer/information |
| JP-TYPE-SANS | Sans stack | CSS `--sans` | CSS stack | Current | Body and display |
| JP-TYPE-MONO | Mono stack | CSS `--mono` | CSS stack | Current | Code and metadata |

---

## 20. Governance and change control

- The current logo is approved for documentation integration.
- `assets/brand/` is the canonical digital asset folder.
- The legacy illustrated logo remains archived and must not be silently deleted from project history.
- New logo variants must derive from the approved form and color system or receive explicit owner approval.
- Vector reconstruction must preserve the visible approved artwork rather than substituting a “similar” font without review.
- Color-token changes must be made in the CSS source and reflected in this manifest and derived assets.
- Major identity changes require a documented rationale, before/after reproduction tests, and a migration note.
- Deprecated assets should remain labeled during a reasonable transition period.

---

## 21. Open questions and decision log

| ID | Question or decision | Status | Evidence needed / trigger |
| --- | --- | --- | --- |
| JP-BRAND-001 | Approve a manually reconstructed vector master | Open | Vector drawing, outline comparison, small-size proof, owner approval |
| JP-BRAND-002 | Identify or custom-draw the canonical wordmark geometry | Open | Typeface/outline study; do not infer from raster alone |
| JP-BRAND-003 | Establish print CMYK and spot-color targets | Open | Printer, substrate, proofing method, physical samples |
| JP-BRAND-004 | Establish trademark and legal usage requirements | Open | Legal review if public commercial use expands |
| JP-BRAND-005 | Define logo motion behavior | Deferred | A real product/application need and reduced-motion plan |
| JP-BRAND-006 | Define sibling-product endorsement system | Open | future standalone product architecture decisions |
| JP-BRAND-007 | Confirm physical minimum sizes | Open | Actual print, engraving, embroidery, and label tests |

---

## 22. Quality-control checklist

### Completed for current documentation use

- [x] Central concept relates to product behavior.
- [x] New mark preserves the accumulation metaphor.
- [x] Primary, symbol, monochrome, and reversed raster variants exist.
- [x] Digital colors match existing site tokens.
- [x] Header, hero, README, and favicon use cases are defined.
- [x] Legacy asset is retained and deprecated explicitly.
- [x] Web typography and spacing rules are traceable to CSS.
- [x] Accessibility and misuse guidance are documented.
- [x] Generative source is archived.

### Required before a final cross-media identity release

- [ ] Approved vector master.
- [ ] Approved wordmark outlines.
- [ ] Print color proofing.
- [ ] Physical minimum-size testing.
- [ ] Trademark/legal review where applicable.
- [ ] Formal co-branding and sibling-product rules.

---

## Closing rule

Junkpile’s identity succeeds when it can look accumulated without looking accidental, technical without looking generic, and playful without weakening the truth of the system.
