# Adding or forking a Junkpile example

The three 00–25 collections are a frozen baseline. New work should normally begin as a fork, a new numbered family, or a product repository—not by silently changing an accepted lesson.

## 1. Choose the nearest baseline

Select by render ownership, input, temporal state, topology, and output—not by visual appearance alone.

## 2. Preserve the original

Create a branch, tag, or copied project. Keep the accepted example runnable.

## 3. Change one architectural layer first

Examples:

- browser camera → native camera
- WebGL feedback → wgpu feedback
- manual controls → MIDI/OSC registry
- one output → routed outputs
- browser decoder → FFmpeg decoder

## 4. Required project structure

```text
README.md
package.json
src/
src-tauri/
```

Add a Cargo workspace boundary:

```toml
[workspace]
resolver = "2"
```

## 5. Required behavior

- clear purpose and example identity
- visible runtime status and actionable errors
- stable numeric readouts
- reliable initial scrolling
- pause/reset/fullscreen where relevant
- lifecycle-safe input start/stop/reconnect
- explicit resource clear/resize behavior
- development and production build commands

## 6. Native shared I/O

Future Scheng-based applications should opt into shared media ports rather than reimplementing every transport. Inputs and outputs remain optional so focused applications do not carry unused dependencies.
