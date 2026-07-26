"use strict";

const WS_URL = "ws://127.0.0.1:2727";

const DEFAULT_PARAMS = Object.freeze({
  hue: 180,
  saturation: 0.8,
  brightness: 1,
  zoom: 1.5,
  speed: 0.5,
  distortion: 0.3,
  complexity: 4,
  symmetry: 3,
  glow: 0.4,
  invert: 0,
  pulse: 1,
  rotate: 0,
});

const params = { ...DEFAULT_PARAMS };
let socket = null;
let reconnectTimer = 0;
let reconnectDelayMs = 600;
let shaderProgram;
let elapsedSeconds = 0;
let animationPaused = false;
let telemetryLastMs = 0;

const VERT_SHADER = `
    precision highp float;

    attribute vec3 aPosition;
    attribute vec2 aTexCoord;

    varying vec2 vTexCoord;

    void main() {
        vTexCoord = aTexCoord;
        vec4 pos  = vec4(aPosition, 1.0);
        pos.xy    = pos.xy * 2.0 - 1.0;
        gl_Position = pos;
    }
`;

const FRAG_SHADER = `
    precision highp float;

    // ── Uniforms ──────────────────────────────────────────────────────────
    // All declared as float — GLSL ES 1.0 has no int/bool uniform types.

    uniform float u_time;        // accumulated animation seconds, from draw()
    uniform vec2  u_resolution;  // canvas size in pixels

    uniform float u_hue;         // hue shift 0.0–360.0
    uniform float u_saturation;  // saturation 0.0–1.0
    uniform float u_brightness;  // brightness multiplier 0.0–2.0

    uniform float u_zoom;        // coordinate scale
    uniform float u_distortion;  // warp amount 0.0–1.0
    uniform float u_rotate;      // rotation: 0.0 = off, 1.0 = on

    uniform float u_complexity;  // octave count 1.0–8.0 (float threshold, see fbm)
    uniform float u_symmetry;    // fold count 1.0–8.0
    uniform float u_glow;        // radial glow 0.0–1.0

    uniform float u_invert;      // 0.0 = normal, 1.0 = invert
    uniform float u_pulse;       // 0.0 = off, 1.0 = pulse

    varying vec2 vTexCoord;

    // ── HSB → RGB ─────────────────────────────────────────────────────────
    vec3 hsb2rgb(float h, float s, float b) {
        vec3 rgb = clamp(
            abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0,
            0.0, 1.0
        );
        return b * mix(vec3(1.0), rgb, s);
    }

    // ── Pseudo-random hash ────────────────────────────────────────────────
    float hash(vec2 p) {
        p  = fract(p * vec2(127.1, 311.7));
        p += dot(p, p + 19.19);
        return fract(p.x * p.y);
    }

    // ── Smooth value noise ────────────────────────────────────────────────
    float vnoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(
            mix(hash(i),                hash(i + vec2(1.0, 0.0)), u.x),
            mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0, 1.0)), u.x),
            u.y
        );
    }

    // ── Fractal Brownian Motion ───────────────────────────────────────────
    // GLSL ES 1.0 LOOP PATTERN:
    //   Loop bound must be a compile-time constant (8 here = MAX_OCTAVES).
    //   We use a float counter compared against u_complexity to break early.
    //   This is the standard workaround for dynamic octave counts in WebGL1.
    float fbm(vec2 p) {
        float value     = 0.0;
        float amplitude = 0.5;
        float freq      = 1.0;
        float fi        = 0.0;          // float iteration counter
        for (int i = 0; i < 8; i++) {  // 8 = compile-time constant MAX
            if (fi >= u_complexity) break;
            value     += amplitude * vnoise(p * freq);
            freq      *= 2.0;
            amplitude *= 0.5;
            fi        += 1.0;
        }
        return value;
    }

    // ── 2D rotation matrix ────────────────────────────────────────────────
    mat2 rotate2D(float a) {
        return mat2(cos(a), -sin(a), sin(a), cos(a));
    }

    void main() {
        // 1. Centre UV, correct aspect ratio, apply zoom
        vec2 uv = vTexCoord - 0.5;
        uv.x   *= u_resolution.x / u_resolution.y;
        uv     *= u_zoom;

        // 2. Optional slow rotation (u_rotate = 0.0 → no effect)
        uv = rotate2D(u_time * 0.15 * u_rotate) * uv;

        // 3. Domain warp — perturb UV with noise for a liquid look
        float wt = u_time * 0.3;
        vec2 warpUV = uv + u_distortion * 2.0 * vec2(
            fbm(uv + vec2(wt,  0.0)) - 0.5,
            fbm(uv + vec2(0.0, wt )) - 0.5
        );

        // 4. Rotational symmetry — fold the angle into one sector
        float ang    = atan(warpUV.y, warpUV.x);
        float radius = length(warpUV);
        float sector = 6.28318 / u_symmetry;
        ang          = mod(ang + 3.14159, sector) - sector * 0.5;
        vec2 symUV   = vec2(cos(ang), sin(ang)) * radius;

        // 5. Layered fBm pattern
        float t = u_time * 0.5;
        float pattern =
            fbm(symUV * 2.0 + vec2( t,        t * 0.7)) * 0.5 +
            fbm(symUV * 3.0 + vec2(-t * 0.8,  t      )) * 0.3 +
            fbm(symUV * 1.5 + vec2( t * 0.3, -t      )) * 0.2;

        // 6. Radial glow — brighten the centre
        pattern *= 1.0 + u_glow * (1.0 - smoothstep(0.0, 0.8, radius));

        // 7. Rhythmic brightness pulse (mix applies it only when u_pulse = 1.0)
        float pulseVal = 1.0 + 0.15 * sin(u_time * 2.5);
        pattern       *= mix(1.0, pulseVal, u_pulse);

        // 8. HSB colour mapping
        float hue = mod(
            (u_hue / 360.0) + pattern * 0.5 + u_time * 0.05,
            1.0
        );
        vec3 col = hsb2rgb(hue, u_saturation, clamp(pattern * u_brightness, 0.0, 1.5));

        // 9. Optional colour inversion
        col = mix(col, 1.0 - col, u_invert);

        gl_FragColor = vec4(col, 1.0);
    }
`;

function setConnectionBadge(text, kind) {
  const badge = document.getElementById("connectionBadge");
  if (!badge) return;
  badge.textContent = text;
  badge.classList.remove("ok", "pending", "error");
  badge.classList.add(kind);
}

function updatePauseUi() {
  document.getElementById("pauseBadge")?.classList.toggle("hidden", !animationPaused);
}

function sendJson(message) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(message));
  return true;
}

function applySnapshot(message) {
  if (message.params && typeof message.params === "object") {
    for (const [name, value] of Object.entries(message.params)) {
      if (Object.prototype.hasOwnProperty.call(params, name) && Number.isFinite(Number(value))) {
        params[name] = Number(value);
      }
    }
  }
  animationPaused = Boolean(message.paused);
  if (message.resetClock) elapsedSeconds = 0;
  updatePauseUi();
}

function handleMessage(message) {
  if (message.type === "state_snapshot") {
    applySnapshot(message);
  } else if (message.type === "param_batch" && message.values && typeof message.values === "object") {
    for (const [name, value] of Object.entries(message.values)) {
      if (Object.prototype.hasOwnProperty.call(params, name) && Number.isFinite(Number(value))) {
        params[name] = Number(value);
      }
    }
  } else if (message.type === "param" && Object.prototype.hasOwnProperty.call(params, message.name)) {
    params[message.name] = typeof message.value === "boolean" ? (message.value ? 1 : 0) : Number(message.value);
  } else if (message.type === "action") {
    if (message.name === "set_paused") {
      animationPaused = Boolean(message.value);
      updatePauseUi();
    } else if (message.name === "reset_clock") {
      elapsedSeconds = 0;
    }
  } else if (message.type === "presence") {
    const controls = Number(message.controls || 0);
    setConnectionBadge(controls > 0 ? "SYNCED" : "NO CONTROLS", controls > 0 ? "ok" : "pending");
  }
}

function connectWebSocket() {
  clearTimeout(reconnectTimer);
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;

  setConnectionBadge("CONNECTING", "pending");
  socket = new WebSocket(WS_URL);

  socket.addEventListener("open", () => {
    reconnectDelayMs = 600;
    setConnectionBadge("CONNECTED", "ok");
    socket.send(JSON.stringify({ type: "hello", role: "canvas" }));
    socket.send(JSON.stringify({ type: "request_state", role: "canvas" }));
  });

  socket.addEventListener("message", event => {
    if (typeof event.data !== "string") return;
    try {
      handleMessage(JSON.parse(event.data));
    } catch {
      // Ignore malformed relay messages and keep the last valid render state.
    }
  });

  socket.addEventListener("close", () => {
    setConnectionBadge("DISCONNECTED", "error");
    reconnectTimer = window.setTimeout(connectWebSocket, reconnectDelayMs);
    reconnectDelayMs = Math.min(4000, Math.round(reconnectDelayMs * 1.5));
  });

  socket.addEventListener("error", () => {
    // The close event owns reconnect behavior.
  });
}

function setup() {
  const container = document.getElementById("canvas-container");
  const canvas = createCanvas(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight), WEBGL);
  canvas.parent("canvas-container");
  pixelDensity(1);
  noStroke();
  shaderProgram = createShader(VERT_SHADER, FRAG_SHADER);
  updateSizeReadout();
}

function draw() {
  const safeDelta = Math.min(deltaTime / 1000, 0.1);
  if (!animationPaused) elapsedSeconds += safeDelta * params.speed;

  shader(shaderProgram);
  shaderProgram.setUniform("u_time", elapsedSeconds);
  shaderProgram.setUniform("u_resolution", [width, height]);
  shaderProgram.setUniform("u_hue", params.hue);
  shaderProgram.setUniform("u_saturation", params.saturation);
  shaderProgram.setUniform("u_brightness", params.brightness);
  shaderProgram.setUniform("u_zoom", params.zoom);
  shaderProgram.setUniform("u_distortion", params.distortion);
  shaderProgram.setUniform("u_rotate", params.rotate);
  shaderProgram.setUniform("u_complexity", params.complexity);
  shaderProgram.setUniform("u_symmetry", params.symmetry);
  shaderProgram.setUniform("u_glow", params.glow);
  shaderProgram.setUniform("u_invert", params.invert);
  shaderProgram.setUniform("u_pulse", params.pulse);
  rect(-width / 2, -height / 2, width, height);

  const now = millis();
  if (now - telemetryLastMs >= 250) {
    telemetryLastMs = now;
    const fps = Math.round(frameRate());
    document.getElementById("fpsReadout").textContent = String(fps);
    sendJson({
      type: "telemetry",
      role: "canvas",
      fps,
      width,
      height,
      paused: animationPaused,
      time: elapsedSeconds,
    });
  }
}

function updateSizeReadout() {
  const readout = document.getElementById("sizeReadout");
  if (readout && typeof width === "number") readout.textContent = `${width} × ${height}`;
}

function windowResized() {
  const container = document.getElementById("canvas-container");
  resizeCanvas(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight));
  updateSizeReadout();
}

async function toggleOwnFullscreen() {
  try {
    await window.__TAURI__?.tauri?.invoke("toggle_current_fullscreen");
  } catch (error) {
    console.error("[junkpile 01] output fullscreen failed", error);
  }
}

window.addEventListener("keydown", event => {
  if (event.key.toLowerCase() === "f") toggleOwnFullscreen();
});

document.addEventListener("DOMContentLoaded", () => {
  if (typeof window.p5 === "undefined") {
    setConnectionBadge("P5 MISSING", "error");
    return;
  }
  connectWebSocket();
});
