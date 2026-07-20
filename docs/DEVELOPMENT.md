# Development setup

## Repository model

There is no root workspace command. Each example is an independent Tauri project with its own `package.json`, Rust crate, lock files, configuration, and frontend assets.

Run commands from the example directory:

```bash
cd v1/p5-tauri-single-template
npm install
npm run dev
```

## Core prerequisites

Install the prerequisites from the official Tauri documentation for your target generation and operating system.

Common requirements:

- Rust installed through `rustup`
- Node.js and npm
- macOS: Xcode command-line tools
- Windows: Microsoft C++ build tools and WebView2
- Linux: WebKitGTK and the distribution-specific Tauri development packages

## CLI isolation

Each project declares a local CLI major in `devDependencies`:

- v1 projects: `@tauri-apps/cli` 1.x
- v2 projects: `@tauri-apps/cli` 2.x

Use `npm run dev` and `npm run build` so npm selects the project-local CLI. Avoid relying on whichever global `cargo tauri` or global npm CLI happens to be installed.

## Development commands

```bash
npm install      # install the local Tauri CLI
npm run dev      # development build and launch
npm run build    # release bundle
```

## Camera examples

Camera behavior crosses several layers:

1. the operating system exposes a camera
2. the WebView requests permission
3. the user grants permission
4. `getUserMedia()` returns a stream
5. the hidden video element receives frames
6. WebGL uploads those frames into a texture

Test all six layers. A black canvas is not always a shader problem.

### macOS

The examples include an entitlement file where camera-specific projects require it. Packaged applications may also require usage-description metadata depending on the bundle/toolchain behavior. Confirm this during a signed build test.

### Windows

Verify the Windows privacy settings allow desktop applications to access the camera and that WebView2 is current.

### Linux

Camera behavior depends on the WebKitGTK stack, device permissions, and the local media backend. Treat Linux support as unverified until tested on a named distribution.

## MIDI example

The MIDI example uses native `midir` rather than the Web MIDI browser API.

- macOS: verify the device in Audio MIDI Setup; use the IAC Driver for virtual routing.
- Windows: verify the device in the system and close applications that may hold it exclusively.
- Linux: install ALSA development support before compiling and verify device permissions.

## OSC example

The OSC example listens on UDP port `9000`.

- Set the sender host to the computer running Junkpile.
- Set the sender port to `9000`.
- Start with the documented address map.
- Check the firewall when messages do not arrive.

## WebSocket examples

All WS templates use TCP port `2727` on loopback. Run only one of these templates at a time unless you change the port in both Rust and JavaScript.

## Offline development

The p5 family, MIDI example, and OSC example currently load p5.js from cdnjs. To make a project self-contained:

1. download a known p5.js version
2. place it in `src/vendor/p5.min.js`
3. change the HTML script path
4. adjust the CSP to permit only local script loading
5. record the vendored version and license

## Platform test record

For every project, record:

```text
OS and version:
CPU architecture:
Rust version:
Node/npm version:
Tauri CLI version:
Development launch: pass/fail
Release build: pass/fail
Core input path: pass/fail
Known warnings:
Screenshot filename:
```
