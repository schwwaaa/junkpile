"use strict";

const WS_URL = "ws://127.0.0.1:2727";
const PROJECT_SHADER_URL = "shader.frag";

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
let currentSource = "";
let currentShaderName = "shader.frag";
let currentShaderOrigin = "PROJECT";
let currentRevision = 0;

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

function setBadge(id, text, kind = "pending") {
  const element = document.getElementById(id);
  if (!element) return;
  element.textContent = text;
  element.classList.remove("ok", "pending", "error");
  element.classList.add(kind);
}

function setError(message = "") {
  const panel = document.getElementById("errorPanel");
  panel.textContent = message;
  panel.classList.toggle("hidden", !message);
}

function updatePauseUi() {
  document.getElementById("pauseBadge").classList.toggle("hidden", !animationPaused);
}

function updateSourceUi() {
  const lines = currentSource ? currentSource.split(/\r?\n/).length : 0;
  document.getElementById("sourceReadout").textContent = `${currentShaderName} · ${currentShaderOrigin.toLowerCase()} · ${lines} lines`;
}

function sendJson(message) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(message));
  return true;
}

function applyNumericState(values) {
  if (!values || typeof values !== "object") return;
  for (const [name, value] of Object.entries(values)) {
    if (Object.prototype.hasOwnProperty.call(params, name) && Number.isFinite(Number(value))) params[name] = Number(value);
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
  } else if (message.type === "shader_source" && typeof message.source === "string") {
    compileAndSwap(message.source, {
      name: message.name || "remote shader",
      origin: message.origin || "REMOTE",
      revision: Number(message.revision || 0),
    });
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
    try { handleMessage(JSON.parse(event.data)); }
    catch (error) { console.warn("[junkpile 05] ignored malformed relay message", error); }
  });

  socket.addEventListener("close", () => {
    setBadge("connectionBadge", "DISCONNECTED", "error");
    reconnectTimer = window.setTimeout(connectWebSocket, reconnectDelayMs);
    reconnectDelayMs = Math.min(4000, Math.round(reconnectDelayMs * 1.5));
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

function buildProgram(fragmentSource) {
  const vertex = compileShader(gl.VERTEX_SHADER, VERT_SHADER, "Vertex");
  const fragment = compileShader(gl.FRAGMENT_SHADER, fragmentSource, "Fragment");
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

function configureGeometry(targetProgram) {
  if (!quadBuffer) {
    quadBuffer = gl.createBuffer();
    if (!quadBuffer) throw new Error("Could not allocate the fullscreen-quad buffer.");
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  } else {
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  }
  const location = gl.getAttribLocation(targetProgram, "a_position");
  if (location < 0) throw new Error("Shader attribute a_position was not found. Keep the supplied vertex varying contract.");
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
}

function compileAndSwap(source, metadata = {}) {
  if (!gl || gl.isContextLost()) return false;
  const start = performance.now();
  setBadge("shaderBadge", "COMPILING", "pending");
  setError("");
  try {
    const nextProgram = buildProgram(source);
    gl.useProgram(nextProgram);
    configureGeometry(nextProgram);
    const oldProgram = program;
    program = nextProgram;
    if (oldProgram) gl.deleteProgram(oldProgram);
    currentSource = source;
    currentShaderName = metadata.name || currentShaderName;
    currentShaderOrigin = metadata.origin || currentShaderOrigin;
    currentRevision = Number(metadata.revision || currentRevision || 0);
    shaderReady = true;
    updateSourceUi();
    setBadge("shaderBadge", "LINKED", "ok");
    const compileMs = performance.now() - start;
    sendJson({
      type: "shader_result",
      role: "canvas",
      ok: true,
      name: currentShaderName,
      origin: currentShaderOrigin,
      revision: currentRevision,
      compileMs,
    });
    return true;
  } catch (error) {
    const compileMs = performance.now() - start;
    const message = String(error?.message || error);
    shaderReady = Boolean(program);
    setBadge("shaderBadge", program ? "REJECTED" : "SHADER ERROR", "error");
    setError(`${message}\n\n${program ? "The last valid shader is still rendering." : "No valid shader is currently available."}`);
    sendJson({
      type: "shader_result",
      role: "canvas",
      ok: false,
      name: metadata.name || currentShaderName,
      origin: metadata.origin || currentShaderOrigin,
      revision: Number(metadata.revision || 0),
      compileMs,
      error: message,
      retainedPrevious: Boolean(program),
    });
    console.error("[junkpile 05] shader build failed", error);
    return false;
  }
}

async function loadProjectShader() {
  setBadge("shaderBadge", "LOADING", "pending");
  try {
    const response = await fetch(PROJECT_SHADER_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const source = await response.text();
    compileAndSwap(source, { name: "shader.frag", origin: "PROJECT", revision: 0 });
  } catch (error) {
    setBadge("shaderBadge", "LOAD ERROR", "error");
    setError(`Could not load shader.frag:\n${error?.message || error}`);
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

function initializeWebGL(loadDefaultShader = true) {
  gl = canvas.getContext("webgl", { antialias: false, alpha: false, depth: false, stencil: false, preserveDrawingBuffer: false });
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
  if (loadDefaultShader) loadProjectShader();
  return true;
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
      shaderName: currentShaderName,
      shaderOrigin: currentShaderOrigin,
      revision: currentRevision,
      renderer: document.getElementById("rendererReadout").textContent,
    });
  }
  requestAnimationFrame(render);
}

async function toggleOwnFullscreen() {
  try { await window.__TAURI__?.tauri?.invoke("toggle_current_fullscreen"); }
  catch (error) { console.error("[junkpile 05] output fullscreen failed", error); }
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
  const sourceToRestore = currentSource;
  initializeWebGL(false);
  if (sourceToRestore) {
    setTimeout(() => compileAndSwap(sourceToRestore, { name: currentShaderName, origin: currentShaderOrigin, revision: currentRevision }), 0);
  } else {
    loadProjectShader();
  }
});

window.addEventListener("keydown", event => {
  if (event.key.toLowerCase() === "f") toggleOwnFullscreen();
});

window.addEventListener("error", event => setError(`Runtime error: ${event.message}`));

document.addEventListener("DOMContentLoaded", () => {
  initializeWebGL();
  connectWebSocket();
  requestAnimationFrame(render);
});
