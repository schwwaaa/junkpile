# 11 · Tauri v1 OSC Input

A modernized Junkpile essential demonstrating how a **Tauri v1 Rust backend** can receive Open Sound Control messages over UDP and route them into a **p5.js WebGL shader instrument**.

This is the final legacy V1 project modernization. It intentionally remains smaller than the later OSC-driven applications: the goal is to make the native UDP → Tauri event → JavaScript parameter → GLSL path visible and easy to modify.

## What it demonstrates

- Native UDP input through Rust
- OSC packet and nested-bundle decoding with `rosc`
- Tauri v1 commands and frontend events
- Local-only or LAN-accessible listeners
- Editable OSC address routes
- Exact and wildcard-prefix matching
- Four input scaling modes
- OSC learn
- Persistent route configuration
- A built-in local OSC test burst
- p5.js WebGL shader control
- Live packet, sender, value, and rate telemetry
- A scroll-safe current Junkpile interface

## Signal flow

```text
TouchOSC / Max / Pure Data / SuperCollider / another sender
                              │
                              │ OSC over UDP
                              ▼
                  Rust UdpSocket listener
                              │
                              ▼
                    rosc packet decoder
                              │
                              ▼
                  Tauri "osc-event" event
                              │
                              ▼
                 address route + value scale
                              │
                              ▼
                    p5.js parameter state
                              │
                              ▼
                        GLSL uniforms
                              │
                              ▼
                       WebGL output
```

The browser cannot open a raw UDP socket. Rust owns that system-level input and forwards structured messages to the WebView.

## Run

```bash
npm install
npm run dev
```

`npm install` installs both the local Tauri CLI and p5.js. The `predev` script copies `p5.min.js` into `src/vendor`, so the app does not require a CDN at runtime.

## Production build

```bash
npm run build
```

On macOS, packaged output is normally created under:

```text
src-tauri/target/release/bundle/
```

Unsigned applications may still trigger Gatekeeper warnings when distributed outside your own computer.

## First test

1. Run the app.
2. Leave **LAN devices** and port **9000** selected.
3. Press **Send test burst**.
4. Confirm that the terminal receives eight packets and the visual changes.
5. Configure another OSC application to send UDP to one of the listed endpoints.

## Listener controls

### Bind mode

- `127.0.0.1` accepts packets only from applications on the same computer.
- `0.0.0.0` accepts packets sent to the computer from the local network.

### Port

The default is UDP `9000`. Change it when another application already owns that port.

### Endpoint hints

The app displays loopback and likely LAN endpoints. Network interfaces and firewalls vary, so these are practical hints rather than a replacement for operating-system network inspection.

## Default routes

| OSC address | Parameter | Expected input |
|---|---|---|
| `/hue` | Hue | 0–1 |
| `/zoom` | Zoom | 0–1 |
| `/speed` | Speed | 0–1 |
| `/brightness` | Brightness | 0–1 |
| `/distortion` | Distortion | 0–1 |
| `/complexity` | Complexity | 0–1 |
| `/saturation` | Saturation | 0–1 |
| `/glow` | Glow | 0–1 |

Routes can be edited directly. End an address with `*` to match a prefix, such as:

```text
/visual/*
```

That route accepts `/visual/a`, `/visual/fader/1`, and any other address sharing the prefix.

## Scaling modes

- **0–1** maps normalized controller values into the parameter range.
- **0–127** supports MIDI-style integer controllers transported through OSC.
- **−1–1** maps bipolar values into the parameter range.
- **Direct** treats the OSC number as the actual parameter value and clamps it to the slider range.

## OSC learn

1. Choose a visual parameter.
2. Press **Arm learn**.
3. Send one OSC message.
4. The incoming address becomes that parameter's route.

Routes are stored in WebView local storage and survive relaunches.

## Supported packet data

The Rust listener reports common OSC argument types including:

- Float
- Integer
- Double
- Long integer
- Boolean
- String
- Blob
- Nil

The first numeric argument drives visual routing. All arguments remain visible in the packet terminal.

Nested OSC bundles are decoded recursively and report their bundle depth.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `Space` | Pause/resume rendering |
| `R` | Reset visual values |
| `F` | Toggle fullscreen |

## Project structure

```text
p5-tauri-osc-template/
├── README.md
├── MODERNIZATION-NOTES.md
├── package.json
├── scripts/
│   └── sync-p5.mjs
├── src/
│   ├── index.html
│   ├── styles.css
│   ├── sketch.js
│   └── vendor/
│       └── p5.min.js        generated after npm install
└── src-tauri/
    ├── Cargo.toml
    ├── build.rs
    ├── tauri.conf.json
    ├── icons/
    └── src/
        └── main.rs
```

## Rust architecture

`main.rs` owns a restartable listener runtime:

```text
OscState
└── Mutex<Option<OscRuntime>>
    ├── stop flag
    ├── listener thread
    └── active endpoint metadata
```

Starting a new listener safely stops and joins the previous listener thread before binding the replacement socket.

## Troubleshooting

### No packets arrive

- Confirm the sender uses UDP, not TCP.
- Confirm sender and receiver ports match.
- Use `127.0.0.1` only when both applications run on the same computer.
- Use LAN mode for phones or other computers.
- Check macOS or Windows firewall rules.
- Press **Send test burst** to separate app problems from network problems.

### Port already in use

Another process has bound the selected UDP port. Stop that process or choose a different port.

### Values move incorrectly

Check the selected scaling mode. A sender producing `0–127` values will immediately saturate a route configured for normalized `0–1` values.

### A sender uses different paths

Edit the route fields or use OSC learn. The app does not require the default address names.

## Suggested extensions

- Multiple arguments mapped to multiple parameters
- OSC output and bidirectional controller feedback
- Timetag scheduling for bundles
- Saved named routing profiles
- Multiple simultaneous UDP ports
- Authentication or network allowlists for public installations
- Separate controls and canvas windows
- Routing into native wgpu rather than p5.js

## Version note

This project intentionally uses **Tauri v1**. It is a WebView graphics example, not a native wgpu surface. The renderer is p5.js/WebGL and Rust supplies native UDP access.
