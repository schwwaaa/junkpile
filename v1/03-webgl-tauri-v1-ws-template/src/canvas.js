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
let gl = null;
let program = null;
let quadBuffer = null;
let resizeObserver = null;
let animationPaused = false;
let elapsedSeconds = 0;
let lastFrameMs = performance.now();
let fpsWindowStart = performance.now();
let fpsFrames = 0;
let telemetryLastMs = 0;
let shaderReady = false;

const canvas = document.getElementById("glcanvas");
const container = document.getElementById("canvas-container");

const VERT_SHADER = `
precision highp float;
attribute vec2 a_position;
varying vec2 vTexCoord;
void main() {
  vTexCoord = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAG_SHADER = `
precision highp float;
uniform float u_time;
uniform vec2 u_resolution;
uniform float u_hue;
uniform float u_saturation;
uniform float u_brightness;
uniform float u_zoom;
uniform float u_distortion;
uniform float u_rotate;
uniform float u_complexity;
uniform float u_symmetry;
uniform float u_glow;
uniform float u_invert;
uniform float u_pulse;
varying vec2 vTexCoord;

vec3 hsb2rgb(float h, float s, float b) {
  vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return b * mix(vec3(1.0), rgb, s);
}
float hash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 19.19);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  float freq = 1.0;
  float fi = 0.0;
  for (int i = 0; i < 8; i++) {
    if (fi >= u_complexity) break;
    value += amplitude * vnoise(p * freq);
    freq *= 2.0;
    amplitude *= 0.5;
    fi += 1.0;
  }
  return value;
}
mat2 rotate2D(float a) {
  return mat2(cos(a), -sin(a), sin(a), cos(a));
}
void main() {
  vec2 uv = vTexCoord - 0.5;
  uv.x *= u_resolution.x / max(u_resolution.y, 1.0);
  uv *= u_zoom;
  uv = rotate2D(u_time * 0.15 * u_rotate) * uv;

  float wt = u_time * 0.3;
  vec2 warpUV = uv + u_distortion * 2.0 * vec2(
    fbm(uv + vec2(wt, 0.0)) - 0.5,
    fbm(uv + vec2(0.0, wt)) - 0.5
  );

  float ang = atan(warpUV.y, warpUV.x);
  float radius = length(warpUV);
  float sector = 6.28318 / max(u_symmetry, 1.0);
  ang = mod(ang + 3.14159, sector) - sector * 0.5;
  vec2 symUV = vec2(cos(ang), sin(ang)) * radius;

  float t = u_time * 0.5;
  float pattern =
    fbm(symUV * 2.0 + vec2(t, t * 0.7)) * 0.5 +
    fbm(symUV * 3.0 + vec2(-t * 0.8, t)) * 0.3 +
    fbm(symUV * 1.5 + vec2(t * 0.3, -t)) * 0.2;

  pattern *= 1.0 + u_glow * (1.0 - smoothstep(0.0, 0.8, radius));
  float pulseVal = 1.0 + 0.15 * sin(u_time * 2.5);
  pattern *= mix(1.0, pulseVal, u_pulse);

  float hue = mod((u_hue / 360.0) + pattern * 0.5 + u_time * 0.05, 1.0);
  vec3 col = hsb2rgb(hue, u_saturation, clamp(pattern * u_brightness, 0.0, 1.5));
  col = mix(col, 1.0 - col, u_invert);
  gl_FragColor = vec4(col, 1.0);
}
`;

function setBadge(id, text, kind = "pending") {
  const element = document.getElementById(id);
  if (!element) return;
  element.textContent = text;
  element.classList.remove("ok", "pending", "error");
  element.classList.add(kind);
}

function setError(message = "") {
  const panel = document.getElementById("errorPanel");
  if (!panel) return;
  panel.textContent = message;
  panel.classList.toggle("hidden", !message);
}

function updatePauseUi() {
  document.getElementById("pauseBadge")?.classList.toggle("hidden", !animationPaused);
}

function sendJson(message) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(message));
  return true;
}

function applyNumericState(values) {
  if (!values || typeof values !== "object") return;
  for (const [name, value] of Object.entries(values)) {
    if (Object.prototype.hasOwnProperty.call(params, name) && Number.isFinite(Number(value))) {
      params[name] = Number(value);
    }
  }
}

function handleMessage(message) {
  if (message.type === "state_snapshot") {
    applyNumericState(message.params);
    animationPaused = Boolean(message.paused);
    if (message.resetClock) elapsedSeconds = 0;
    updatePauseUi();
  } else if (message.type === "param_batch") {
    applyNumericState(message.values);
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
    setBadge("connectionBadge", controls > 0 ? "SYNCED" : "NO CONTROLS", controls > 0 ? "ok" : "pending");
  }
}

function connectWebSocket() {
  clearTimeout(reconnectTimer);
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;

  setBadge("connectionBadge", "CONNECTING", "pending");
  socket = new WebSocket(WS_URL);

  socket.addEventListener("open", () => {
    reconnectDelayMs = 600;
    setBadge("connectionBadge", "CONNECTED", "ok");
    sendJson({ type: "hello", role: "canvas" });
    sendJson({ type: "request_state", role: "canvas" });
  });

  socket.addEventListener("message", event => {
    if (typeof event.data !== "string") return;
    try {
      handleMessage(JSON.parse(event.data));
    } catch (error) {
      console.warn("[junkpile 03] ignored malformed relay message", error);
    }
  });

  socket.addEventListener("close", () => {
    setBadge("connectionBadge", "DISCONNECTED", "error");
    reconnectTimer = window.setTimeout(connectWebSocket, reconnectDelayMs);
    reconnectDelayMs = Math.min(4000, Math.round(reconnectDelayMs * 1.5));
  });

  socket.addEventListener("error", () => {
    // The close handler owns reconnection and status.
  });
}

function compileShader(type, source, stageName) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error(`Could not allocate ${stageName} shader.`);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) || "Unknown compiler error.";
    gl.deleteShader(shader);
    throw new Error(`${stageName} shader failed:\n${log}`);
  }
  return shader;
}

function buildProgram() {
  const vertex = compileShader(gl.VERTEX_SHADER, VERT_SHADER, "Vertex");
  const fragment = compileShader(gl.FRAGMENT_SHADER, FRAG_SHADER, "Fragment");
  const nextProgram = gl.createProgram();
  if (!nextProgram) throw new Error("Could not allocate WebGL program.");
  gl.attachShader(nextProgram, vertex);
  gl.attachShader(nextProgram, fragment);
  gl.linkProgram(nextProgram);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(nextProgram, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(nextProgram) || "Unknown linker error.";
    gl.deleteProgram(nextProgram);
    throw new Error(`Program link failed:\n${log}`);
  }
  return nextProgram;
}

function configureGeometry() {
  if (!quadBuffer) {
    quadBuffer = gl.createBuffer();
    if (!quadBuffer) throw new Error("Could not allocate the fullscreen-quad buffer.");
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  } else {
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  }
  const location = gl.getAttribLocation(program, "a_position");
  if (location < 0) throw new Error("Shader attribute a_position was not found.");
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
}

function recompileProgram() {
  setBadge("shaderBadge", "COMPILING", "pending");
  setError("");
  try {
    const nextProgram = buildProgram();
    if (program) gl.deleteProgram(program);
    program = nextProgram;
    gl.useProgram(program);
    configureGeometry();
    shaderReady = true;
    setBadge("shaderBadge", "LINKED", "ok");
    return true;
  } catch (error) {
    shaderReady = false;
    setBadge("shaderBadge", "SHADER ERROR", "error");
    setError(String(error?.message || error));
    console.error("[junkpile 03] shader build failed", error);
    return false;
  }
}

function uniform1f(name, value) {
  const location = gl.getUniformLocation(program, name);
  if (location !== null) gl.uniform1f(location, value);
}

function uniform2f(name, x, y) {
  const location = gl.getUniformLocation(program, name);
  if (location !== null) gl.uniform2f(location, x, y);
}

function resizeCanvas() {
  const scale = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
  const width = Math.max(1, Math.floor(container.clientWidth * scale));
  const height = Math.max(1, Math.floor(container.clientHeight * scale));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    document.getElementById("sizeReadout").textContent = `${width} × ${height}`;
  }
}

function initializeWebGL() {
  gl = canvas.getContext("webgl", {
    antialias: false,
    alpha: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
  });
  if (!gl) {
    setBadge("shaderBadge", "NO WEBGL", "error");
    setError("WKWebView did not provide a WebGL 1 context.");
    return false;
  }

  const vendor = gl.getParameter(gl.VENDOR) || "Unknown vendor";
  const renderer = gl.getParameter(gl.RENDERER) || "WebGL 1";
  document.getElementById("rendererReadout").textContent = `${vendor} · ${renderer}`;

  resizeObserver?.disconnect();
  resizeObserver = new ResizeObserver(resizeCanvas);
  resizeObserver.observe(container);
  resizeCanvas();
  return recompileProgram();
}

function render(nowMs) {
  const deltaSeconds = Math.min(Math.max((nowMs - lastFrameMs) / 1000, 0), 0.1);
  lastFrameMs = nowMs;
  if (!animationPaused) elapsedSeconds += deltaSeconds * params.speed;

  if (gl && program && shaderReady && !gl.isContextLost()) {
    resizeCanvas();
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    uniform1f("u_time", elapsedSeconds);
    uniform2f("u_resolution", canvas.width, canvas.height);
    uniform1f("u_hue", params.hue);
    uniform1f("u_saturation", params.saturation);
    uniform1f("u_brightness", params.brightness);
    uniform1f("u_zoom", params.zoom);
    uniform1f("u_distortion", params.distortion);
    uniform1f("u_rotate", params.rotate);
    uniform1f("u_complexity", params.complexity);
    uniform1f("u_symmetry", params.symmetry);
    uniform1f("u_glow", params.glow);
    uniform1f("u_invert", params.invert);
    uniform1f("u_pulse", params.pulse);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  fpsFrames += 1;
  const fpsElapsed = nowMs - fpsWindowStart;
  let measuredFps = 0;
  if (fpsElapsed >= 500) {
    measuredFps = Math.round((fpsFrames * 1000) / fpsElapsed);
    document.getElementById("fpsReadout").textContent = String(measuredFps);
    fpsFrames = 0;
    fpsWindowStart = nowMs;
  }

  if (nowMs - telemetryLastMs >= 250) {
    telemetryLastMs = nowMs;
    sendJson({
      type: "telemetry",
      role: "canvas",
      fps: measuredFps || Number(document.getElementById("fpsReadout").textContent || 0),
      width: canvas.width,
      height: canvas.height,
      paused: animationPaused,
      time: elapsedSeconds,
      shaderReady,
      renderer: document.getElementById("rendererReadout").textContent,
    });
  }

  requestAnimationFrame(render);
}

async function toggleOwnFullscreen() {
  try {
    await window.__TAURI__?.tauri?.invoke("toggle_current_fullscreen");
  } catch (error) {
    console.error("[junkpile 03] output fullscreen failed", error);
  }
}

canvas.addEventListener("webglcontextlost", event => {
  event.preventDefault();
  shaderReady = false;
  program = null;
  quadBuffer = null;
  setBadge("shaderBadge", "CONTEXT LOST", "error");
  setError("The WebGL context was lost. Waiting for WKWebView to restore it…");
});

canvas.addEventListener("webglcontextrestored", () => {
  setBadge("shaderBadge", "RESTORING", "pending");
  initializeWebGL();
});

window.addEventListener("keydown", event => {
  if (event.key.toLowerCase() === "f") toggleOwnFullscreen();
});

window.addEventListener("error", event => {
  setError(`Runtime error: ${event.message}`);
});

document.addEventListener("DOMContentLoaded", () => {
  initializeWebGL();
  connectWebSocket();
  requestAnimationFrame(render);
});
