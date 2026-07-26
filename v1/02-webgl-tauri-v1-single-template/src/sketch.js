"use strict";

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

const PRESETS = Object.freeze({
  default: DEFAULT_PARAMS,
  soft: { ...DEFAULT_PARAMS, hue: 205, saturation: 0.48, brightness: 0.9, zoom: 1.05, speed: 0.18, distortion: 0.16, complexity: 5, symmetry: 2, glow: 0.72, pulse: 0 },
  prism: { ...DEFAULT_PARAMS, hue: 302, saturation: 1, brightness: 1.28, zoom: 2.2, speed: 0.75, distortion: 0.62, complexity: 6, symmetry: 7, glow: 0.6, rotate: 1 },
  mono: { ...DEFAULT_PARAMS, hue: 0, saturation: 0, brightness: 1.3, zoom: 1.72, speed: 0.42, distortion: 0.38, complexity: 4, symmetry: 5, glow: 0.52, invert: 1, pulse: 1 },
});

const SLIDER_IDS = ["hue", "saturation", "brightness", "zoom", "speed", "distortion", "complexity", "symmetry", "glow"];
const TOGGLE_IDS = ["invert", "pulse", "rotate"];
const VALUE_FORMATTERS = {
  hue: value => `${Math.round(value)}°`,
  speed: value => `${value.toFixed(2)}×`,
  complexity: value => String(Math.round(value)),
  symmetry: value => String(Math.round(value)),
};

const params = { ...DEFAULT_PARAMS };
let gl = null;
let program = null;
let quadBuffer = null;
let animationPaused = false;
let elapsedSeconds = 0;
let lastFrameMs = performance.now();
let fpsWindowStart = performance.now();
let fpsFrames = 0;
let resizeObserver = null;

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
mat2 rotate2D(float a) { return mat2(cos(a), -sin(a), sin(a), cos(a)); }
void main() {
  vec2 uv = vTexCoord - 0.5;
  uv.x *= u_resolution.x / max(u_resolution.y, 1.0);
  uv *= u_zoom;
  uv = rotate2D(u_time * 0.15 * u_rotate) * uv;
  float wt = u_time * 0.3;
  vec2 warpUV = uv + u_distortion * 2.0 * vec2(fbm(uv + vec2(wt, 0.0)) - 0.5, fbm(uv + vec2(0.0, wt)) - 0.5);
  float ang = atan(warpUV.y, warpUV.x);
  float radius = length(warpUV);
  float sector = 6.28318 / max(u_symmetry, 1.0);
  ang = mod(ang + 3.14159, sector) - sector * 0.5;
  vec2 symUV = vec2(cos(ang), sin(ang)) * radius;
  float t = u_time * 0.5;
  float pattern = fbm(symUV * 2.0 + vec2(t, t * 0.7)) * 0.5 + fbm(symUV * 3.0 + vec2(-t * 0.8, t)) * 0.3 + fbm(symUV * 1.5 + vec2(t * 0.3, -t)) * 0.2;
  pattern *= 1.0 + u_glow * (1.0 - smoothstep(0.0, 0.8, radius));
  float pulseVal = 1.0 + 0.15 * sin(u_time * 2.5);
  pattern *= mix(1.0, pulseVal, u_pulse);
  float hue = mod((u_hue / 360.0) + pattern * 0.5 + u_time * 0.05, 1.0);
  vec3 col = hsb2rgb(hue, u_saturation, clamp(pattern * u_brightness, 0.0, 1.5));
  col = mix(col, 1.0 - col, u_invert);
  gl_FragColor = vec4(col, 1.0);
}
`;

const canvas = document.getElementById("glcanvas");
const container = document.getElementById("canvas-container");

function setStatus(text, kind = "ok") {
  document.getElementById("statusText").textContent = text;
  const badge = document.getElementById("canvasBadge");
  badge.classList.toggle("error", kind === "error");
  if (kind === "error") badge.textContent = "ERROR";
  else if (badge.textContent === "ERROR" || badge.textContent === "STARTING") badge.textContent = animationPaused ? "PAUSED" : "RUNNING";
}

function setDiagnostics(title, text, kind = "ok") {
  document.getElementById("compileStatus").textContent = title;
  const diagnostics = document.getElementById("diagnostics");
  diagnostics.textContent = text;
  diagnostics.classList.toggle("error", kind === "error");
  const dot = document.getElementById("compileDot");
  dot.className = `status-dot ${kind}`;
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
  try {
    const nextProgram = buildProgram();
    if (program) gl.deleteProgram(program);
    program = nextProgram;
    gl.useProgram(program);
    configureGeometry();
    setDiagnostics("Shader linked", "Vertex compile: OK\nFragment compile: OK\nProgram link: OK", "ok");
    setStatus(animationPaused ? "Paused · shader ready" : "Rendering · shader ready");
    return true;
  } catch (error) {
    console.error("[junkpile] shader build failed", error);
    setDiagnostics("Shader error", String(error?.message || error), "error");
    setStatus("Shader compilation failed", "error");
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
  const width = Math.max(1, Math.floor(container.clientWidth));
  const height = Math.max(1, Math.floor(container.clientHeight));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    document.getElementById("sizeReadout").textContent = `${width} × ${height}`;
  }
}

function render(nowMs) {
  const deltaSeconds = Math.min(Math.max((nowMs - lastFrameMs) / 1000, 0), 0.1);
  lastFrameMs = nowMs;
  if (!animationPaused) elapsedSeconds += deltaSeconds * params.speed;

  if (gl && program && !gl.isContextLost()) {
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
  if (fpsElapsed >= 500) {
    document.getElementById("fpsReadout").textContent = String(Math.round((fpsFrames * 1000) / fpsElapsed));
    fpsFrames = 0;
    fpsWindowStart = nowMs;
  }
  requestAnimationFrame(render);
}

function formatValue(id, value) {
  return VALUE_FORMATTERS[id]?.(value) ?? value.toFixed(2);
}

function syncControls() {
  for (const id of SLIDER_IDS) {
    const input = document.getElementById(id);
    input.value = String(params[id]);
    document.getElementById(`${id}-val`).textContent = formatValue(id, params[id]);
  }
  for (const id of TOGGLE_IDS) document.getElementById(id).checked = params[id] > 0.5;
}

function applyState(nextState, resetClock = false) {
  Object.assign(params, nextState);
  if (resetClock) elapsedSeconds = 0;
  syncControls();
}

function setPaused(paused) {
  animationPaused = paused;
  const button = document.getElementById("pauseBtn");
  const badge = document.getElementById("canvasBadge");
  button.textContent = paused ? "Resume" : "Pause";
  badge.textContent = paused ? "PAUSED" : "RUNNING";
  badge.classList.toggle("paused", paused);
  setStatus(paused ? "Animation paused" : "Rendering");
}

async function toggleFullscreen() {
  try {
    const fullscreen = await window.__TAURI__.tauri.invoke("toggle_fullscreen");
    document.getElementById("fullscreenBtn").textContent = fullscreen ? "Windowed" : "Fullscreen";
  } catch (error) {
    console.error("[junkpile] fullscreen failed", error);
    setStatus(`Fullscreen error: ${String(error)}`, "error");
  }
}

function wireControls() {
  for (const id of SLIDER_IDS) {
    const input = document.getElementById(id);
    input.addEventListener("input", () => {
      params[id] = Number.parseFloat(input.value);
      document.getElementById(`${id}-val`).textContent = formatValue(id, params[id]);
    });
  }
  for (const id of TOGGLE_IDS) {
    document.getElementById(id).addEventListener("change", event => {
      params[id] = event.currentTarget.checked ? 1 : 0;
    });
  }
  document.querySelectorAll("[data-preset]").forEach(button => {
    button.addEventListener("click", () => applyState(PRESETS[button.dataset.preset], true));
  });
  document.getElementById("compileBtn").addEventListener("click", recompileProgram);
  document.getElementById("resetBtn").addEventListener("click", () => {
    applyState(DEFAULT_PARAMS, true);
    setStatus(animationPaused ? "Paused · reset" : "Rendering · reset");
  });
  document.getElementById("pauseBtn").addEventListener("click", () => setPaused(!animationPaused));
  document.getElementById("fullscreenBtn").addEventListener("click", toggleFullscreen);

  window.addEventListener("keydown", event => {
    const tag = document.activeElement?.tagName;
    if (["INPUT", "SELECT", "TEXTAREA"].includes(tag)) return;
    if (event.code === "Space") { event.preventDefault(); setPaused(!animationPaused); }
    else if (event.key.toLowerCase() === "r") { applyState(DEFAULT_PARAMS, true); }
    else if (event.key.toLowerCase() === "c") { recompileProgram(); }
    else if (event.key.toLowerCase() === "f") { toggleFullscreen(); }
  });
}

function initializeWebGL() {
  gl = canvas.getContext("webgl", { antialias: false, alpha: false, depth: false, stencil: false });
  if (!gl) {
    setDiagnostics("WebGL unavailable", "WKWebView did not provide a WebGL 1 context.", "error");
    setStatus("WebGL is not available", "error");
    return false;
  }
  const renderer = gl.getParameter(gl.RENDERER) || "WebGL 1";
  document.getElementById("rendererReadout").textContent = String(renderer).replace(/^ANGLE \(/, "").slice(0, 26);
  resizeObserver?.disconnect();
  resizeObserver = new ResizeObserver(resizeCanvas);
  resizeObserver.observe(container);
  resizeCanvas();
  return recompileProgram();
}

canvas.addEventListener("webglcontextlost", event => {
  event.preventDefault();
  program = null;
  quadBuffer = null;
  setDiagnostics("Context lost", "The WebGL context was lost. Waiting for WKWebView to restore it…", "error");
  setStatus("WebGL context lost", "error");
});
canvas.addEventListener("webglcontextrestored", () => {
  setStatus("Restoring WebGL…");
  initializeWebGL();
});
window.addEventListener("error", event => {
  setStatus(`Runtime error: ${event.message}`, "error");
});

document.addEventListener("DOMContentLoaded", () => {
  wireControls();
  syncControls();
  if (initializeWebGL()) {
    document.getElementById("canvasBadge").textContent = "RUNNING";
    setStatus("Rendering");
  }
  requestAnimationFrame(render);
});
