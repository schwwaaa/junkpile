# Junkpile 40 — wgpu Network Output

A native Tauri 2 + wgpu example that publishes one authoritative GPU frame through UDP/MPEG-TS, RTSP/TCP, or RTMP/FLV without blocking the renderer.

## Run

```bash
npm install
npm run dev
```

## Protocols

### UDP / MPEG-TS

No server is required.

Publisher:

```text
udp://127.0.0.1:23000?pkt_size=1316&buffer_size=1048576
```

VLC receiver:

```text
udp://@:23000
```

Run **destination preflight** before starting. The preflight binds a local UDP receiver, sends a short synthetic MPEG-TS stream through FFmpeg, and confirms that packets arrive.

### RTSP / TCP

Start MediaMTX first:

```bash
mediamtx ./tools/mediamtx.yml
```

Default publisher and reader URL:

```text
rtsp://127.0.0.1:8554/junkpile40
```

### RTMP / FLV

With the same MediaMTX process running:

```text
rtmp://127.0.0.1:1935/junkpile40
```

RTSP and RTMP preflight first test TCP reachability, then publish a short synthetic FFmpeg stream. A `400 Bad Request` is therefore shown before live GPU capture begins. Common causes are authentication, a restricted path, or another publisher already occupying the same path.

## Architecture

```text
wgpu texture
  → 3 asynchronous readback buffers
  → 3 reusable CPU RGBA buffers
  → bounded 2-frame queue
  → one supervised FFmpeg process
```

The app sends one black bootstrap frame during startup so FFmpeg must create the network header before the UI reports the output as active.

## Diagnostics

- full FFmpeg command with credentials redacted
- retained FFmpeg stderr lines
- FFmpeg PID and exit code
- capture requests and completed GPU readbacks
- GPU, CPU-pool, and worker drops
- queue pressure
- raw frame bandwidth and total bytes written

## Important

VLC is a reader. It is not the RTSP or RTMP ingest server. UDP is the only direct sender-to-reader path in this example.
