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

function connect() {
  clearTimeout(reconnectTimer);
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;

  setStatus("relayStatus", "Connecting…", "pending");
  socket = new WebSocket(WS_URL);

  socket.addEventListener("open", () => {
    reconnectDelayMs = 600;
    setStatus("relayStatus", "Connected", "ok");
    socket.send(JSON.stringify({ type: "hello", role: "controls" }));
    setTimeout(() => sendSnapshot(), 60);
  });

  socket.addEventListener("message", event => {
    if (typeof event.data !== "string") return;
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }

    if (message.type === "presence") {
      const controls = Number(message.controls || 0);
      const canvas = Number(message.canvas || 0);
      setText("presenceReadout", `${controls} controls · ${canvas} outputs`);
      setStatus("canvasStatus", canvas > 0 ? "Connected" : "Waiting…", canvas > 0 ? "ok" : "pending");
    } else if (message.type === "request_state") {
      sendSnapshot();
    } else if (message.type === "telemetry" && message.role === "canvas") {
      setText("fpsReadout", String(Math.round(Number(message.fps || 0))));
      setText("sizeReadout", `${Math.round(Number(message.width || 0))} × ${Math.round(Number(message.height || 0))}`);
      state.paused = Boolean(message.paused);
      updatePauseUi();
      setStatus("canvasStatus", message.paused ? "Paused" : "Rendering", message.paused ? "pending" : "ok");
    }
  });

  socket.addEventListener("close", () => {
    setStatus("relayStatus", "Disconnected", "error");
    setStatus("canvasStatus", "Waiting…", "pending");
    reconnectTimer = window.setTimeout(connect, reconnectDelayMs);
    reconnectDelayMs = Math.min(4000, Math.round(reconnectDelayMs * 1.5));
  });

  socket.addEventListener("error", () => {
    // The close handler owns reconnection and user-facing status.
  });
}

function syncControlsFromState() {
  for (const id of SLIDER_IDS) {
    const input = document.getElementById(id);
    const output = document.getElementById(`${id}-val`);
    input.value = String(state.params[id]);
    output.textContent = formatValue(id, state.params[id]);
  }
  for (const id of TOGGLE_IDS) {
    document.getElementById(id).checked = state.params[id] > 0.5;
  }
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
    setStatus("canvasStatus", `Window error`, "error");
    console.error("[junkpile 01] fullscreen failed", error);
  }
}

async function showOutput() {
  try {
    await invoke("show_canvas");
  } catch (error) {
    console.error("[junkpile 01] show output failed", error);
  }
}

async function focusOutput() {
  try {
    await invoke("focus_canvas");
  } catch (error) {
    console.error("[junkpile 01] focus output failed", error);
  }
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

  document.querySelectorAll("[data-preset]").forEach(button => {
    button.addEventListener("click", () => applyPreset(button.dataset.preset));
  });

  document.getElementById("syncBtn").addEventListener("click", () => sendSnapshot());
  document.getElementById("pauseBtn").addEventListener("click", () => setPaused(!state.paused));
  document.getElementById("resetBtn").addEventListener("click", resetExample);
  document.getElementById("showOutputBtn").addEventListener("click", showOutput);
  document.getElementById("focusOutputBtn").addEventListener("click", focusOutput);
  document.getElementById("fullscreenOutputBtn").addEventListener("click", toggleOutputFullscreen);

  window.addEventListener("keydown", event => {
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

    if (event.code === "Space") {
      event.preventDefault();
      setPaused(!state.paused);
    } else if (event.key.toLowerCase() === "r") {
      resetExample();
    } else if (event.key.toLowerCase() === "s") {
      sendSnapshot();
    } else if (event.key.toLowerCase() === "f") {
      toggleOutputFullscreen();
    }
  });

  syncControlsFromState();
}

document.addEventListener("DOMContentLoaded", () => {
  wireControls();
  connect();
});
