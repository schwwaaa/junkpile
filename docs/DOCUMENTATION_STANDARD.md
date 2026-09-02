# Documentation and commenting standard

Every example README should answer:

1. What does this application demonstrate?
2. Why does this example exist?
3. Who owns the renderer, media source, transport, and state?
4. What is the signal flow?
5. Which files matter?
6. How is it installed, run, and built?
7. What should be visible when it works?
8. What controls and shortcuts exist?
9. What errors and platform limitations are known?
10. What is safe to change next?

## Required architecture diagram

Show the actual path from input to output. Do not label a Tauri v2 WebGL example as native wgpu. Do not imply that a WebView owns native GPU resources when Rust does. **Do not convert “the current reference example lives in this track” into “this capability only works in this track.”** Tauri generation, render ownership, and native/media transport must be documented as separate concerns.

## Commenting

Comment lifecycle, ownership, synchronization, alignment, platform constraints, and non-obvious tradeoffs. Avoid comments that merely repeat syntax.

## Validation vocabulary

- **Static reviewed:** files/config/syntax inspected.
- **Build verified:** production build completed on a named platform.
- **Runtime tested:** central path launched and worked on a named platform.
- **Cross-platform verified:** tested on all claimed targets.

Never substitute one term for another.
