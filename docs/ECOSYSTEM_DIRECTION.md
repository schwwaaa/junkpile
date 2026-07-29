# Junkpile, Scheng, and the standalone instrument ecosystem

## Roles

```text
Junkpile
verified examples, experiments, and educational baselines
        ↓
Scheng
reusable native runtime, contracts, and optional components
        ↓
Standalone instruments
focused processors, keyers, feedback units, routers, recorders, mixers
        ↕
Master suite / rack / router
shared sources, synchronization, program output, recording, automation
```

Junkpile should remain the transparent research and teaching layer. Scheng should absorb patterns only after they are proven. Applications such as Shadecore or future instruments should consume those components without carrying the entire laboratory.

## Common optional media I/O

Every application should be able to opt into consistent sources and destinations:

- cameras
- files
- generated textures
- Syphon
- Spout
- NDI
- FFmpeg/network streams
- recording
- window output
- future transports

These contracts must remain optional at build and runtime so a small utility does not inherit unrelated dependencies.

## Why this supports focused products

A firm, optimized routing and I/O foundation makes it practical to sell small standalone tools rather than only one flagship monolith. Independent branding and narrow creative identity can coexist with shared technical infrastructure.

## Design principle

Engine capability may be broad; instrument identity should remain narrow, legible, and deliberate.
