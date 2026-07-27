# 11 — Tauri v2 OSC Input

A standalone Tauri v2 example showing how Rust can own an OSC-over-UDP listener, decode messages and bundles with `rosc`, emit structured events into JavaScript, and route OSC addresses into raw WebGL parameters.

## Signal flow

```text
TouchOSC / Max / Pure Data / SuperCollider
                    ↓ OSC over UDP
              Rust `UdpSocket`
                    ↓
                `rosc`
                    ↓
           Tauri `osc-event`
                    ↓
 address routing + scaling + OSC learn
                    ↓
             WebGL uniforms
```

## Features

- Configurable bind address and UDP port
- Local and LAN endpoint hints
- Nested OSC bundle decoding
- Editable address routes and scaling modes
- OSC learn and persistent routes
- Built-in local test burst
- Message terminal and activity meters
- Native fullscreen command

## Run

```bash
npm install
npm run dev
```

The default listener is `0.0.0.0:9000`. Use `127.0.0.1` when only local applications should send messages.

## Default routes

```text
/hue  /zoom  /speed  /brightness  /distortion  /complexity
```

## Production build

```bash
npm run build
```
