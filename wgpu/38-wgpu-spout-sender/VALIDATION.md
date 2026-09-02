# Validation

## Completed statically

- JSON configuration parses.
- JavaScript syntax passes `node --check`.
- Every frontend ID referenced by JavaScript exists in the HTML.
- Rust source delimiters are balanced.
- C and C++ source delimiters are balanced.
- CMake references only vendored source files that exist.
- No NDI or Syphon dependencies remain in the project.
- No build artifacts are included.
- ZIP integrity test passes.

## Requires Windows

- MSVC and CMake compilation
- Direct3D 11 device creation
- Sender discovery in an official Spout receiver
- Adapter selection on multi-GPU systems
- 1080p60, 1440p60, and 4K30 performance testing
- Packaged application build
