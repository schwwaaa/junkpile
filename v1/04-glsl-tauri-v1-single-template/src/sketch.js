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

const VERT_SHADER = `
precision highp float;
attribute vec2 a_position;
varying vec2 vTexCoord;
void main() {
  vTexCoord = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const params = { ...DEFAULT_PARAMS };
const canvas = document.getElementById("glcanvas");
const container = document.getElementById("canvas-container");
const dropOverlay = document.getElementById("dropOverlay");

let gl = null;
let program = null;
let quadBuffer = null;
let currentSource = "";
let currentSourceName = "shader.frag";
let currentSourceOrigin = "PROJECT";
let activeSourceName = "";
let animationPaused = false;
let elapsedSeconds = 0;
let lastFrameMs = performance.now();
let fpsWindowStart = performance.now();
let fpsFrames = 0;
let resizeObserver = null;
let dragDepth = 0;

function setStatus(text, kind = "ok") {
  document.getElementById("statusText").textContent = text;
  const badge = document.getElementById("canvasBadge");
  badge.classList.toggle("error", kind === "error");
  badge.classList.toggle("warning", kind === "warning");
  if (kind === "error") badge.textContent = "ERROR";
  else if (kind === "warning") badge.textContent = "LAST GOOD";
  else badge.textContent = animationPaused ? "PAUSED" : "RUNNING";
}

function setDiagnostics(title, text, kind = "ok") {
  document.getElementById("compileStatus").textContent = title;
  const diagnostics = document.getElementById("diagnostics");
  diagnostics.textContent = text;
  diagnostics.className = kind === "ok" ? "" : kind;
  document.getElementById("compileDot").className = `status-dot ${kind}`;
}

function setSourceMetadata(name, origin, source) {
  currentSourceName = name;
  currentSourceOrigin = origin;
  document.getElementById("shaderName").textContent = name;
  const originElement = document.getElementById("shaderOrigin");
  originElement.textContent = origin;
  originElement.classList.toggle("local", origin === "LOCAL");
  document.getElementById("lineReadout").textContent = String(source ? source.split(/\r?\n/).length : 0);
  const bytes = typeof TextEncoder === "function" ? new TextEncoder().encode(source).length : source.length;
  document.getElementById("byteReadout").textContent = bytes.toLocaleString();
}

function compatibilityHints(source) {
  const hints = [];
  if (/^\s*#version\s+300\s+es/m.test(source)) hints.push("This is a WebGL 2 shader. Remove '#version 300 es' and convert the output syntax for WebGL 1.");
  if (/\bout\s+vec4\s+\w+\s*;/m.test(source)) hints.push("WebGL 1 writes the final color to gl_FragColor instead of a custom 'out vec4'.");
  if (/\btexture\s*\(/.test(source)) hints.push("WebGL 1 normally uses texture2D() rather than texture().");
  if (/\bmainImage\s*\(/.test(source)) hints.push("ShaderToy mainImage() shaders need a void main() wrapper and uniform-name conversion.");
  if (/\bi(Time|Resolution|Mouse|Channel\d)\b/.test(source)) hints.push("ShaderToy uniforms are not supplied. Use the u_* contract listed above the controls.");
  if (/\blayout\s*\(/.test(source)) hints.push("layout(...) qualifiers require a newer GLSL version than WebGL 1 provides.");
  if (/^\s*#include\b/m.test(source)) hints.push("WebGL does not expand #include directives automatically.");
  if (!/\bvoid\s+main\s*\(/.test(source)) hints.push("No void main() entry point was found.");
  if (!/precision\s+(lowp|mediump|highp)\s+float\s*;/.test(source)) hints.push("Add a default float precision declaration, usually: precision highp float;");
  return hints;
}

function compileShader(type, source, stageName) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error(`Could not allocate the ${stageName.toLowerCase()} shader.`);
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
  let fragment = null;
  let nextProgram = null;
  try {
    fragment = compileShader(gl.FRAGMENT_SHADER, fragmentSource, "Fragment");
    nextProgram = gl.createProgram();
    if (!nextProgram) throw new Error("Could not allocate a WebGL program.");
    gl.attachShader(nextProgram, vertex);
    gl.attachShader(nextProgram, fragment);
    gl.linkProgram(nextProgram);
    if (!gl.getProgramParameter(nextProgram, gl.LINK_STATUS)) {
      throw new Error(`Program link failed:\n${gl.getProgramInfoLog(nextProgram) || "Unknown linker error."}`);
    }
    return nextProgram;
  } catch (error) {
    if (nextProgram) gl.deleteProgram(nextProgram);
    throw error;
  } finally {
    gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
  }
}

function configureGeometry(nextProgram = program) {
  if (!quadBuffer) {
    quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  } else {
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  }
  const attributeLocation = gl.getAttribLocation(nextProgram, "a_position");
  if (attributeLocation < 0) throw new Error("Required vertex attribute a_position was not found.");
  gl.enableVertexAttribArray(attributeLocation);
  gl.vertexAttribPointer(attributeLocation, 2, gl.FLOAT, false, 0, 0);
}

function compileCurrentSource(reason = "manual compile") {
  if (!gl || gl.isContextLost()) return false;
  if (!currentSource.trim()) {
    setDiagnostics("No shader source", "Open a fragment shader or reload the project shader first.", "error");
    return false;
  }

  const started = performance.now();
  try {
    const nextProgram = buildProgram(currentSource);
    gl.useProgram(nextProgram);
    configureGeometry(nextProgram);
    const previousProgram = program;
    program = nextProgram;
    activeSourceName = currentSourceName;
    if (previousProgram) gl.deleteProgram(previousProgram);
    const compileMs = performance.now() - started;
    document.getElementById("compileTimeReadout").textContent = compileMs.toFixed(1);
    setDiagnostics(
      "Shader linked",
      `Source: ${currentSourceName}\nOrigin: ${currentSourceOrigin}\nReason: ${reason}\nVertex compile: OK\nFragment compile: OK\nProgram link: OK`,
      "ok",
    );
    setStatus(animationPaused ? `Paused · ${activeSourceName}` : `Rendering · ${activeSourceName}`);
    return true;
  } catch (error) {
    const hints = compatibilityHints(currentSource);
    const message = String(error?.message || error);
    const suffix = hints.length ? `\n\nCompatibility hints:\n- ${hints.join("\n- ")}` : "";
    setDiagnostics("Shader rejected", `${currentSourceName}\n\n${message}${suffix}`, "error");
    if (program) {
      setStatus(`Rejected ${currentSourceName} · still rendering ${activeSourceName || "last valid shader"}`, "warning");
    } else {
      setStatus(`Could not compile ${currentSourceName}`, "error");
    }
    console.error("[junkpile] external shader build failed", error);
    return false;
  }
}

async function loadProjectShader() {
  setStatus("Loading shader.frag…");
  try {
    const response = await fetch("shader.frag", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const source = await response.text();
    currentSource = source;
    setSourceMetadata("shader.frag", "PROJECT", source);
    compileCurrentSource("project asset loaded");
  } catch (error) {
    setDiagnostics("Load failed", `Could not fetch src/shader.frag:\n${String(error?.message || error)}`, "error");
    setStatus("Could not load shader.frag", "error");
  }
}

function readShaderFile(file) {
  if (!file) return;
  const validExtension = /\.(frag|glsl|fs|txt)$/i.test(file.name);
  if (!validExtension) {
    setDiagnostics("Unsupported file", `${file.name}\n\nChoose a .frag, .glsl, .fs, or text shader file.`, "error");
    return;
  }
  const reader = new FileReader();
  reader.onerror = () => {
    setDiagnostics("Read failed", `The WebView could not read ${file.name}.`, "error");
    setStatus(`Could not read ${file.name}`, "error");
  };
  reader.onload = () => {
    currentSource = String(reader.result || "");
    setSourceMetadata(file.name, "LOCAL", currentSource);
    compileCurrentSource("local file loaded");
  };
  reader.readAsText(file);
}

function uniform1f(name, value) {
  const uniformLocation = gl.getUniformLocation(program, name);
  if (uniformLocation !== null) gl.uniform1f(uniformLocation, value);
}

function uniform2f(name, x, y) {
  const uniformLocation = gl.getUniformLocation(program, name);
  if (uniformLocation !== null) gl.uniform2f(uniformLocation, x, y);
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
  document.getElementById("pauseBtn").textContent = paused ? "Resume" : "Pause";
  const badge = document.getElementById("canvasBadge");
  if (!badge.classList.contains("error") && !badge.classList.contains("warning")) {
    badge.textContent = paused ? "PAUSED" : "RUNNING";
    badge.classList.toggle("paused", paused);
  }
  setStatus(paused ? `Paused · ${activeSourceName || currentSourceName}` : `Rendering · ${activeSourceName || currentSourceName}`);
}

async function toggleFullscreen() {
  try {
    const fullscreen = await window.__TAURI__.tauri.invoke("toggle_fullscreen");
    document.getElementById("fullscreenBtn").textContent = fullscreen ? "Windowed" : "Fullscreen";
  } catch (error) {
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

  const fileInput = document.getElementById("shaderFile");
  document.getElementById("openShaderBtn").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    readShaderFile(fileInput.files?.[0]);
    fileInput.value = "";
  });
  document.getElementById("restoreShaderBtn").addEventListener("click", loadProjectShader);
  document.getElementById("defaultBtn").addEventListener("click", loadProjectShader);
  document.getElementById("compileBtn").addEventListener("click", () => compileCurrentSource("manual recompile"));
  document.getElementById("resetBtn").addEventListener("click", () => {
    applyState(DEFAULT_PARAMS, true);
    setStatus(animationPaused ? `Paused · reset · ${activeSourceName}` : `Rendering · reset · ${activeSourceName}`);
  });
  document.getElementById("pauseBtn").addEventListener("click", () => setPaused(!animationPaused));
  document.getElementById("fullscreenBtn").addEventListener("click", toggleFullscreen);

  window.addEventListener("keydown", event => {
    const tag = document.activeElement?.tagName;
    if (["INPUT", "SELECT", "TEXTAREA"].includes(tag)) return;
    if (event.code === "Space") { event.preventDefault(); setPaused(!animationPaused); }
    else if (event.key.toLowerCase() === "r") { applyState(DEFAULT_PARAMS, true); }
    else if (event.key.toLowerCase() === "c") { compileCurrentSource("keyboard recompile"); }
    else if (event.key.toLowerCase() === "o") { fileInput.click(); }
    else if (event.key.toLowerCase() === "f") { toggleFullscreen(); }
  });

  window.addEventListener("dragenter", event => {
    event.preventDefault();
    dragDepth += 1;
    dropOverlay.classList.add("visible");
  });
  window.addEventListener("dragover", event => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  });
  window.addEventListener("dragleave", event => {
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropOverlay.classList.remove("visible");
  });
  window.addEventListener("drop", event => {
    event.preventDefault();
    dragDepth = 0;
    dropOverlay.classList.remove("visible");
    readShaderFile(event.dataTransfer?.files?.[0]);
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
  return true;
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
  if (initializeWebGL()) compileCurrentSource("context restored");
});
window.addEventListener("error", event => {
  setStatus(`Runtime error: ${event.message}`, "error");
});

document.addEventListener("DOMContentLoaded", async () => {
  wireControls();
  syncControls();
  if (initializeWebGL()) await loadProjectShader();
  requestAnimationFrame(render);
});
