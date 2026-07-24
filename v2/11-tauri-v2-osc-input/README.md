# 11 · Tauri v2 OSC Input

A Tauri v2 essential demonstrating native OSC-over-UDP input in Rust and live control of a raw WebGL visual in the WebView.

## Why Rust owns OSC

Browser WebViews do not expose arbitrary UDP sockets. Rust binds the UDP port, receives packets from local or network OSC senders, decodes messages and bundles with `rosc`, and emits structured Tauri events to JavaScript.

```text
TouchOSC / Max / Pure Data / SuperCollider / TouchDesigner
                         │
                         │ OSC over UDP
                         ▼
                 Rust UdpSocket
                         │
                         ▼
             rosc packet + bundle decoder
                         │
                         ▼
               Tauri `osc-event`
                         │
                         ▼
          address routing → WebGL uniforms
```

## Run

```bash
npm install
npm run dev
```

The app automatically starts a listener on:

```text
0.0.0.0:9000
```

`0.0.0.0` accepts both local and LAN traffic. Select `127.0.0.1` when only applications on the same computer should be allowed to send.

## Test without another OSC application

Press **Send test burst**. Rust encodes six OSC messages and sends them to the local listener. This verifies:

- UDP binding
- OSC encoding and decoding
- Tauri event delivery
- Address routing
- Visual parameter updates

## Default address map

| OSC address | Visual parameter | Expected input |
|---|---|---|
| `/hue` | Hue | `0.0–1.0` |
| `/zoom` | Zoom | `0.0–1.0` |
| `/speed` | Speed | `0.0–1.0` |
| `/brightness` | Brightness | `0.0–1.0` |
| `/distortion` | Distortion | `0.0–1.0` |
| `/complexity` | Complexity | `0.0–1.0` |

Every route is editable. A route ending in `*` matches an address prefix. For example:

```text
/visual/hue*
```

matches `/visual/hue`, `/visual/hue/1`, and `/visual/hue/main`.

## Input scaling modes

- **0–1 normalized** — maps `0.0–1.0` across the full parameter range.
- **0–127** — converts MIDI-like OSC values into `0.0–1.0` first.
- **−1–1 bipolar** — maps a centered bipolar control across the parameter range.
- **Direct value** — uses the received numeric value directly and clamps it to the parameter limits.

## OSC learn

1. Select a visual parameter.
2. Press **Arm learn**.
3. Send one OSC message.
4. The received address becomes that parameter's route.

Routes and scaling modes persist in WebView local storage.

## Sender setup

### TouchOSC

Set the OSC connection to:

```text
Host: one of the LAN endpoints displayed in the app
Port: 9000
Protocol: UDP
```

Assign a control address such as `/hue` and use a `0–1` value range.

### Max

Send messages such as:

```text
/hue 0.5
/zoom 0.75
/distortion 0.2
```

through `udpsend` to port `9000`.

### Pure Data

Use `netsend -u -b` with an OSC formatting object and connect to the displayed endpoint.

### SuperCollider

```supercollider
n = NetAddr("127.0.0.1", 9000);
n.sendMsg("/hue", 0.5);
```

## Mini OSC terminal

The terminal displays:

- Address
- Argument type and value
- Sender IP and source port
- Bundle depth
- Numeric activity
- Approximate messages per second
- Decode or socket errors

The decoder accepts messages inside nested OSC bundles and emits each message separately.

## Files

```text
11-tauri-v2-osc-input/
├── src/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── src-tauri/
│   ├── capabilities/default.json
│   ├── src/main.rs
│   ├── Cargo.toml
│   └── tauri.conf.json
├── package.json
├── README.md
└── V2-FOLDER-MAP.md
```

## Troubleshooting

### Port already in use

Choose another UDP port and press **Start / restart**. Update the sender to use the same port.

### Local messages work, network messages do not

- Bind to `0.0.0.0`, not `127.0.0.1`.
- Use the LAN endpoint shown in the app.
- Confirm both devices are on the same network.
- Allow incoming UDP traffic through the operating-system firewall.

### Messages appear but controls do not move

- Confirm the address exactly matches the route.
- Check the selected scaling mode.
- Confirm the message contains at least one numeric argument.
- Use OSC learn to capture the sender's actual address.

### High-rate OSC stream feels delayed

The terminal retains only the newest 100 messages, but extremely high UDP rates can still overwhelm UI event delivery. Reduce the sender rate or send only meaningful parameter changes.
