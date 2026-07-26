"use strict";

const WS_URL = "ws://127.0.0.1:2727";
const PROJECT_SHADER_URL = "shader.frag";
const SHADER_EXTENSIONS = [".frag", ".glsl", ".fs", ".txt"];

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

const PRESETS = {
  default: { ...DEFAULT_PARAMS },
  soft: { ...DEFAULT_PARAMS, hue: 202, saturation: 0.48, brightness: 0.9, speed: 0.2, distortion: 0.12, complexity: 3, symmetry: 2, glow: 0.68, rotate: 1 },
  prism: { ...DEFAULT_PARAMS, hue: 312, saturation: 1, brightness: 1.35, zoom: 2.1, speed: 0.9, distortion: 0.7, complexity: 6, symmetry: 7, glow: 0.75, pulse: 1, rotate: 1 },
  mono: { ...DEFAULT_PARAMS, hue: 0, saturation: 0, brightness: 1.25, zoom: 1.1, speed: 0.35, distortion: 0.38, complexity: 5, symmetry: 4, glow: 0.5, pulse: 1 },
};

const SLIDER_IDS = ["hue", "saturation", "brightness", "zoom", "speed", "distortion", "complexity", "symmetry", "glow"];
const TOGGLE_IDS = ["invert", "pulse", "rotate"];
const VALUE_FORMATTERS = {
  hue: value => `${Math.round(value)}°`,
  speed: value => `${value.toFixed(2)}×`,
  complexity: value => String(Math.round(value)),
  symmetry: value => String(Math.round(value)),
};

const state = { params: { ...DEFAULT_PARAMS }, paused: false };
const shaderState = {
  source: "",
  name: "shader.frag",
  origin: "PROJECT",
  revision: 0,
};
const pendingParams = new Map();

let socket = null;
let reconnectTimer = 0;
let reconnectDelayMs = 600;
let flushScheduled = false;
let outputFullscreen = false;

function formatValue(id, value) {
  return VALUE_FORMATTERS[id]?.(value) ?? value.toFixed(2);
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function setStatus(id, text, kind = "pending") {
  const element = document.getElementById(id);
  if (!element) return;
  element.textContent = text;
  element.classList.remove("ok", "pending", "error");
  element.classList.add(kind);
}

function setDiagnostics(text, kind = "pending") {
  const terminal = document.getElementById("diagnostics");
  terminal.textContent = text;
  terminal.classList.remove("ok", "error");
  if (kind === "ok" || kind === "error") terminal.classList.add(kind);
}

function sendJson(message) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(message));
  return true;
}

function sendSnapshot({ resetClock = false } = {}) {
  sendJson({
    type: "state_snapshot",
    params: { ...state.params },
    paused: state.paused,
    resetClock,
  });
}

function sendShader(reason = "manual sync") {
  if (!shaderState.source) {
    setDiagnostics("No shader source is loaded yet.", "error");
    return false;
  }
  shaderState.revision += 1;
  const sent = sendJson({
    type: "shader_source",
    source: shaderState.source,
    name: shaderState.name,
    origin: shaderState.origin,
    revision: shaderState.revision,
    reason,
  });
  if (sent) {
    setStatus("shaderStatus", "Compiling…", "pending");
    setDiagnostics(`→ Sent ${shaderState.name} to the output\nReason: ${reason}\nRevision: ${shaderState.revision}`);
  } else {
    setDiagnostics("The shader is loaded, but the WebSocket relay is not connected yet.");
  }
  return sent;
}

function queueParameter(name, value) {
  pendingParams.set(name, value);
  if (flushScheduled) return;
  flushScheduled = true;
  requestAnimationFrame(() => {
    flushScheduled = false;
    if (pendingParams.size === 0) return;
    const values = Object.fromEntries(pendingParams.entries());
    pendingParams.clear();
    sendJson({ type: "param_batch", values });
  });
}

function updateShaderMetadata() {
  const lines = shaderState.source ? shaderState.source.split(/\r?\n/).length : 0;
  const bytes = new TextEncoder().encode(shaderState.source).byteLength;
  setText("shaderName", shaderState.name);
  setText("shaderOrigin", shaderState.origin);
  setText("shaderLines", String(lines));
  setText("shaderBytes", String(bytes));
  setText("sourceReadout", shaderState.origin.toLowerCase());
}

function isSupportedShaderFile(file) {
  const name = file?.name?.toLowerCase() || "";
  return SHADER_EXTENSIONS.some(extension => name.endsWith(extension)) || file?.type === "text/plain";
}

function compatibilityHints(source) {
  const hints = [];
  if (/^\s*#version\s+300\s+es/m.test(source)) hints.push("WebGL 2 source detected: remove '#version 300 es' and convert the shader to GLSL ES 1.00.");
  if (/\bout\s+vec4\s+\w+\s*;/m.test(source)) hints.push("WebGL 1 writes the fragment color through gl_FragColor, not a custom 'out vec4'.");
  if (/\btexture\s*\(/m.test(source)) hints.push("WebGL 1 uses texture2D(...) rather than texture(...).");
  if (/\bmainImage\s*\(/m.test(source)) hints.push("ShaderToy mainImage(...) must be wrapped or converted to void main().");
  if (/\bi(Time|Resolution|Mouse)\b/.test(source)) hints.push("ShaderToy uniforms must be renamed or mapped to u_time, u_resolution, and your own mouse uniform.");
  if (/\blayout\s*\(/m.test(source)) hints.push("layout(...) qualifiers require newer GLSL and are unsupported by WebGL 1.");
  if (/^\s*#include\b/m.test(source)) hints.push("WebGL does not expand #include directives automatically.");
  if (!/\bvoid\s+main\s*\(/m.test(source)) hints.push("The fragment shader needs void main().");
  if (!/precision\s+(lowp|mediump|highp)\s+float\s*;/m.test(source)) hints.push("Add a float precision declaration, usually 'precision highp float;'.");
  return hints;
}

async function loadProjectShader({ send = true } = {}) {
  setStatus("shaderStatus", "Loading…", "pending");
  setDiagnostics("Fetching src/shader.frag…");
  try {
    const response = await fetch(PROJECT_SHADER_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    shaderState.source = await response.text();
    shaderState.name = "shader.frag";
    shaderState.origin = "PROJECT";
    updateShaderMetadata();
    setStatus("shaderStatus", "Ready", "pending");
    setDiagnostics("Project shader loaded. Waiting for the output compiler…");
    if (send) sendShader("project shader loaded");
  } catch (error) {
    setStatus("shaderStatus", "Load failed", "error");
    setDiagnostics(`Could not load shader.frag:\n${error?.message || error}`, "error");
  }
}

function loadLocalShader(file) {
  if (!file || !isSupportedShaderFile(file)) {
    setDiagnostics("Unsupported shader file. Use .frag, .glsl, .fs, or .txt.", "error");
    return;
  }
  const reader = new FileReader();
  reader.onerror = () => setDiagnostics(`Could not read ${file.name}.`, "error");
  reader.onload = () => {
    shaderState.source = String(reader.result || "");
    shaderState.name = file.name;
    shaderState.origin = "LOCAL";
    updateShaderMetadata();
    const hints = compatibilityHints(shaderState.source);
    setDiagnostics([
      `Loaded ${file.name}`,
      hints.length ? "\nPreflight notes:\n- " + hints.join("\n- ") : "\nPreflight: no obvious WebGL 1 compatibility issues found.",
    ].join(""));
    sendShader("local shader loaded");
  };
  reader.readAsText(file);
}

function connect() {
  clearTimeout(reconnectTimer);
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  setStatus("relayStatus", "Connecting…", "pending");
  socket = new WebSocket(WS_URL);

  socket.addEventListener("open", () => {
    reconnectDelayMs = 600;
    setStatus("relayStatus", "Connected", "ok");
    socket.send(JSON.stringify({ type: "hello", role: "controls" }));
    setTimeout(() => {
      sendSnapshot();
      sendShader("controls connected");
    }, 70);
  });

  socket.addEventListener("message", event => {
    if (typeof event.data !== "string") return;
    let message;
    try { message = JSON.parse(event.data); } catch { return; }

    if (message.type === "presence") {
      const controls = Number(message.controls || 0);
      const canvas = Number(message.canvas || 0);
      setText("presenceReadout", `${controls} controls · ${canvas} outputs`);
      setStatus("canvasStatus", canvas > 0 ? "Connected" : "Waiting…", canvas > 0 ? "ok" : "pending");
    } else if (message.type === "request_state") {
      sendSnapshot();
      sendShader("output requested state");
    } else if (message.type === "telemetry" && message.role === "canvas") {
      state.paused = Boolean(message.paused);
      updatePauseUi();
      if (message.shaderReady === false) {
        setStatus("canvasStatus", "No valid shader", "error");
      } else {
        setStatus("canvasStatus", message.paused ? "Paused" : "Rendering", message.paused ? "pending" : "ok");
      }
    } else if (message.type === "shader_result") {
      const isCurrent = Number(message.revision || 0) === shaderState.revision || !message.revision;
      if (!isCurrent) return;
      setText("shaderCompileMs", Number.isFinite(Number(message.compileMs)) ? `${Number(message.compileMs).toFixed(1)} ms` : "—");
      setText("compileReadout", Number.isFinite(Number(message.compileMs)) ? `${Number(message.compileMs).toFixed(1)} ms` : "—");
      if (message.ok) {
        setStatus("shaderStatus", "Linked", "ok");
        setDiagnostics([
          `✓ ${message.name || shaderState.name} compiled and linked`,
          `Revision: ${message.revision || shaderState.revision}`,
          `Compile + link: ${Number(message.compileMs || 0).toFixed(2)} ms`,
          `Active program retained in output window.`,
        ].join("\n"), "ok");
      } else {
        setStatus("shaderStatus", "Rejected", "error");
        const hints = compatibilityHints(shaderState.source);
        setDiagnostics([
          `✗ ${message.name || shaderState.name} was rejected`,
          message.error || "Unknown compiler/linker error.",
          hints.length ? `\nCompatibility hints:\n- ${hints.join("\n- ")}` : "",
          "\nThe last valid shader is still rendering.",
        ].filter(Boolean).join("\n"), "error");
      }
    }
  });

  socket.addEventListener("close", () => {
    setStatus("relayStatus", "Disconnected", "error");
    setStatus("canvasStatus", "Waiting…", "pending");
    reconnectTimer = window.setTimeout(connect, reconnectDelayMs);
    reconnectDelayMs = Math.min(4000, Math.round(reconnectDelayMs * 1.5));
  });
}

function syncControlsFromState() {
  for (const id of SLIDER_IDS) {
    const input = document.getElementById(id);
    input.value = String(state.params[id]);
    document.getElementById(`${id}-val`).textContent = formatValue(id, state.params[id]);
  }
  for (const id of TOGGLE_IDS) document.getElementById(id).checked = state.params[id] > 0.5;
  updatePauseUi();
}

function updatePauseUi() {
  const button = document.getElementById("pauseBtn");
  button.textContent = state.paused ? "Resume" : "Pause";
  button.classList.toggle("primary", !state.paused);
}

function setPaused(paused) {
  state.paused = paused;
  updatePauseUi();
  sendJson({ type: "action", name: "set_paused", value: paused });
}

function applyPreset(name) {
  const preset = PRESETS[name];
  if (!preset) return;
  Object.assign(state.params, preset);
  state.paused = false;
  syncControlsFromState();
  sendSnapshot({ resetClock: true });
}

function resetExample() {
  Object.assign(state.params, DEFAULT_PARAMS);
  state.paused = false;
  syncControlsFromState();
  sendSnapshot({ resetClock: true });
}

async function invoke(command) {
  if (!window.__TAURI__?.tauri?.invoke) throw new Error("Tauri API is unavailable");
  return window.__TAURI__.tauri.invoke(command);
}

async function toggleOutputFullscreen() {
  try {
    outputFullscreen = await invoke("toggle_canvas_fullscreen");
    document.getElementById("fullscreenOutputBtn").textContent = outputFullscreen ? "Output windowed" : "Output fullscreen";
  } catch (error) {
    setStatus("canvasStatus", "Window error", "error");
    console.error("[junkpile 05] fullscreen failed", error);
  }
}

async function showOutput() {
  try { await invoke("show_canvas"); } catch (error) { console.error("[junkpile 05] show output failed", error); }
}

async function focusOutput() {
  try { await invoke("focus_canvas"); } catch (error) { console.error("[junkpile 05] focus output failed", error); }
}

function wireDropZone() {
  const zone = document.getElementById("shaderDropZone");
  for (const eventName of ["dragenter", "dragover"]) {
    zone.addEventListener(eventName, event => {
      event.preventDefault();
      zone.classList.add("dragging");
    });
  }
  for (const eventName of ["dragleave", "drop"]) {
    zone.addEventListener(eventName, event => {
      event.preventDefault();
      zone.classList.remove("dragging");
    });
  }
  zone.addEventListener("drop", event => loadLocalShader(event.dataTransfer?.files?.[0]));
  zone.addEventListener("click", () => document.getElementById("shaderFileInput").click());
  zone.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      document.getElementById("shaderFileInput").click();
    }
  });
}

function wireControls() {
  for (const id of SLIDER_IDS) {
    const input = document.getElementById(id);
    const output = document.getElementById(`${id}-val`);
    input.addEventListener("input", () => {
      const value = Number.parseFloat(input.value);
      state.params[id] = value;
      output.textContent = formatValue(id, value);
      queueParameter(id, value);
    });
  }
  for (const id of TOGGLE_IDS) {
    document.getElementById(id).addEventListener("change", event => {
      const value = event.currentTarget.checked ? 1 : 0;
      state.params[id] = value;
      queueParameter(id, value);
    });
  }
  document.querySelectorAll("[data-preset]").forEach(button => button.addEventListener("click", () => applyPreset(button.dataset.preset)));
  document.getElementById("syncBtn").addEventListener("click", () => { sendSnapshot(); sendShader("manual sync"); });
  document.getElementById("pauseBtn").addEventListener("click", () => setPaused(!state.paused));
  document.getElementById("resetBtn").addEventListener("click", resetExample);
  document.getElementById("showOutputBtn").addEventListener("click", showOutput);
  document.getElementById("focusOutputBtn").addEventListener("click", focusOutput);
  document.getElementById("fullscreenOutputBtn").addEventListener("click", toggleOutputFullscreen);
  document.getElementById("openShaderBtn").addEventListener("click", () => document.getElementById("shaderFileInput").click());
  document.getElementById("shaderFileInput").addEventListener("change", event => {
    loadLocalShader(event.currentTarget.files?.[0]);
    event.currentTarget.value = "";
  });
  document.getElementById("recompileBtn").addEventListener("click", () => sendShader("manual recompile"));
  document.getElementById("projectShaderBtn").addEventListener("click", () => loadProjectShader({ send: true }));
  wireDropZone();

  window.addEventListener("keydown", event => {
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (event.code === "Space") { event.preventDefault(); setPaused(!state.paused); }
    else if (event.key.toLowerCase() === "r") resetExample();
    else if (event.key.toLowerCase() === "s") { sendSnapshot(); sendShader("keyboard sync"); }
    else if (event.key.toLowerCase() === "o") document.getElementById("shaderFileInput").click();
    else if (event.key.toLowerCase() === "c") sendShader("keyboard recompile");
    else if (event.key.toLowerCase() === "f") toggleOutputFullscreen();
  });
  syncControlsFromState();
}

document.addEventListener("DOMContentLoaded", async () => {
  wireControls();
  connect();
  await loadProjectShader({ send: true });
});
