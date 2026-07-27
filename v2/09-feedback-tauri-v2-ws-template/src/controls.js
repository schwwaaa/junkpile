"use strict";

// Junkpile Example 09 — Feedback Lab WebSocket Controls
//
// This window owns user intent and parameter state. The canvas window owns
// getUserMedia, WebGL, brush input, and persistent ping-pong framebuffer state.

const WS_URL = "ws://127.0.0.1:2727";
const DEFAULTS = Object.freeze({
  mode: 0,
  decay: 0.97,
  camMix: 0.3,
  speed: 1,
  scale: 1,
  intensity: 1,
  hue: 0,
  palette: 0,
  brush: 0.03,
});

const MODE_NAMES = Object.freeze([
  "Echo Trail",
  "Fluid Smear",
  "Reaction-Diffusion",
  "Thermal",
  "Mirror Echo",
  "Glitch Memory",
]);

const MODE_DESCRIPTIONS = Object.freeze([
  "The previous frame decays while the current webcam frame is injected, producing persistent motion trails.",
  "Webcam edges stir a curl-noise flow field, advecting stored pixels like a fluid.",
  "Webcam luminance continuously injects the V activator into a Gray-Scott reaction-diffusion state.",
  "Camera brightness acts as heat while a nine-tap neighborhood diffuses energy through the stored frame.",
  "A six-sector camera fold and a slightly contracting previous-frame lookup build a rotating live mandala.",
  "Block-shifted feedback and chromatic camera offsets accumulate a persistent VHS-like memory.",
]);

const PALETTE_NAMES = Object.freeze(["Fire", "Ice", "Acid", "Void", "Rainbow"]);
const RANGE_IDS = Object.freeze(["decay", "camMix", "speed", "scale", "intensity", "hue", "palette", "brush"]);
const DIAGNOSTIC_IDS = new Set([
  "camera-state", "camera-name", "camera-resolution", "upload-fps",
  "vertex-status", "simulation-status", "display-status", "link-status",
  "fbo-status", "target-format", "render-fps", "drawing-resolution", "renderer-name",
]);

const params = { ...DEFAULTS };
const ui = {
  relayStatus: document.getElementById("relay-status"),
  relayLabel: document.getElementById("relay-label"),
  canvasStatus: document.getElementById("canvas-status"),
  canvasLabel: document.getElementById("canvas-label"),
  deviceSelect: document.getElementById("camera-device"),
  cameraButton: document.getElementById("camera-button"),
  refreshButton: document.getElementById("refresh-button"),
  cameraHelp: document.getElementById("camera-help"),
  modeDescription: document.getElementById("mode-description"),
  clearButton: document.getElementById("clear-button"),
  pauseButton: document.getElementById("pause-button"),
  resetButton: document.getElementById("reset-button"),
  fullscreenButton: document.getElementById("fullscreen-button"),
  errorLog: document.getElementById("error-log"),
};

let ws = null;
let reconnectTimer = 0;
let canvasOnline = false;
let paused = false;
let desiredCameraOn = false;
let selectedDeviceId = "";
let cameraBusyRemote = false;
let pendingParams = new Map();
let flushScheduled = false;
let activeRangeId = "";
let restoreScheduled = false;

function setPill(element, label, state, text) {
  element.dataset.state = state;
  label.textContent = text;
}

function send(message) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  try {
    ws.send(JSON.stringify(message));
    return true;
  } catch {
    return false;
  }
}

function sendFullState() {
  pendingParams.clear();
  send({ type: "state-sync", params: { ...params }, paused });
}

function queueParameter(name, value) {
  pendingParams.set(name, value);
  if (flushScheduled) return;
  flushScheduled = true;
  requestAnimationFrame(() => {
    flushScheduled = false;
    if (!canvasOnline || !ws || ws.readyState !== WebSocket.OPEN) return;
    const entries = Array.from(pendingParams.entries());
    pendingParams.clear();
    for (const [paramName, paramValue] of entries) {
      send({ type: "param", name: paramName, value: paramValue });
    }
  });
}

function formatValue(id, value) {
  if (id === "palette") return PALETTE_NAMES[Math.round(value)] || String(value);
  if (["decay", "hue", "brush"].includes(id)) return Number(value).toFixed(3);
  return Number(value).toFixed(2);
}

function updateOutput(id, value) {
  const output = document.getElementById(`${id}-value`);
  if (output) output.textContent = formatValue(id, value);
}

function updateModeUi() {
  document.querySelectorAll(".mode-button").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.mode) === params.mode);
  });
  ui.modeDescription.textContent = MODE_DESCRIPTIONS[params.mode] || MODE_DESCRIPTIONS[0];
}

function syncUiFromState({ preserveActive = false } = {}) {
  for (const id of RANGE_IDS) {
    const input = document.getElementById(id);
    if (!(preserveActive && activeRangeId === id)) input.value = String(params[id]);
    updateOutput(id, preserveActive && activeRangeId === id ? Number(input.value) : params[id]);
  }
  updateModeUi();
  ui.pauseButton.textContent = paused ? "Resume" : "Pause";
  ui.cameraButton.textContent = desiredCameraOn ? "Stop Camera" : "Start Camera";
}

function setDiagnostic(id, text, result = "") {
  if (!DIAGNOSTIC_IDS.has(id)) return;
  const element = document.getElementById(id);
  if (!element) return;
  element.textContent = text;
  if (result) element.dataset.result = result;
  else delete element.dataset.result;
}

function setError(scope, message) {
  if (!message) {
    ui.errorLog.hidden = true;
    ui.errorLog.textContent = "";
    delete ui.errorLog.dataset.scope;
    return;
  }
  ui.errorLog.hidden = false;
  ui.errorLog.dataset.scope = scope || "renderer";
  ui.errorLog.textContent = `[${scope || "renderer"}] ${message}`;
}

function updateCameraButtons() {
  const enabled = canvasOnline && ws?.readyState === WebSocket.OPEN;
  ui.cameraButton.disabled = !enabled || cameraBusyRemote;
  ui.refreshButton.disabled = !enabled || cameraBusyRemote;
  ui.deviceSelect.disabled = !enabled || cameraBusyRemote;
  ui.cameraButton.textContent = cameraBusyRemote ? "Requesting…" : desiredCameraOn ? "Stop Camera" : "Start Camera";
}

function populateDevices(devices = [], activeDeviceId = "") {
  const previous = selectedDeviceId || activeDeviceId || ui.deviceSelect.value;
  ui.deviceSelect.innerHTML = "";
  if (!devices.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No video inputs reported";
    ui.deviceSelect.appendChild(option);
  } else {
    devices.forEach((device, index) => {
      const option = document.createElement("option");
      option.value = device.deviceId || "";
      option.textContent = device.label || `Camera ${index + 1} — permission required`;
      ui.deviceSelect.appendChild(option);
    });
    const ids = new Set(devices.map((device) => device.deviceId));
    if (previous && ids.has(previous)) ui.deviceSelect.value = previous;
    else if (activeDeviceId && ids.has(activeDeviceId)) ui.deviceSelect.value = activeDeviceId;
  }
  selectedDeviceId = ui.deviceSelect.value;
}

function restoreCanvasState() {
  if (!canvasOnline) return;
  sendFullState();
  send({ type: "camera-command", action: "enumerate" });
  if (desiredCameraOn) {
    send({ type: "camera-command", action: "start", deviceId: selectedDeviceId });
  }
}

function scheduleCanvasRestore() {
  if (restoreScheduled) return;
  restoreScheduled = true;
  requestAnimationFrame(() => {
    restoreScheduled = false;
    restoreCanvasState();
  });
}

function handleMessage(message) {
  if (!message || typeof message !== "object") return;

  if (message.type === "hello" && message.role === "canvas") {
    canvasOnline = true;
    setPill(ui.canvasStatus, ui.canvasLabel, "connected", "Renderer connected");
    updateCameraButtons();
    return;
  }

  if (message.type === "canvas-ready" || message.type === "request-state") {
    canvasOnline = true;
    setPill(ui.canvasStatus, ui.canvasLabel, "connected", "Renderer ready");
    updateCameraButtons();
    scheduleCanvasRestore();
    return;
  }

  if (message.type === "runtime") {
    const state = message.state === "error" ? "error" : message.state === "paused" ? "paused" : "connected";
    setPill(ui.canvasStatus, ui.canvasLabel, state, message.text || "Renderer online");
    return;
  }

  if (message.type === "diagnostic") {
    setDiagnostic(message.id, message.text ?? "—", message.result || "");
    return;
  }

  if (message.type === "error-log") {
    setError(message.scope, message.message);
    return;
  }

  if (message.type === "camera-devices") {
    populateDevices(message.devices, message.activeDeviceId);
    return;
  }

  if (message.type === "camera-status") {
    const state = message.state || "idle";
    cameraBusyRemote = state === "requesting";
    if (["error", "ended", "stopped"].includes(state)) desiredCameraOn = false;
    if (["requesting", "running"].includes(state)) desiredCameraOn = true;
    if (message.activeDeviceId) selectedDeviceId = message.activeDeviceId;
    if (message.help) ui.cameraHelp.textContent = message.help;
    updateCameraButtons();
    return;
  }

  if (message.type === "paused-state") {
    paused = Boolean(message.paused);
    ui.pauseButton.textContent = paused ? "Resume" : "Pause";
    return;
  }

  if (message.type === "renderer-state" && message.params) {
    Object.assign(params, message.params);
    paused = Boolean(message.paused);
    syncUiFromState({ preserveActive: true });
  }
}

function connect() {
  window.clearTimeout(reconnectTimer);
  setPill(ui.relayStatus, ui.relayLabel, "starting", "Relay connecting");
  ws = new WebSocket(WS_URL);

  ws.addEventListener("open", () => {
    setPill(ui.relayStatus, ui.relayLabel, "connected", "Relay connected");
    send({ type: "hello", role: "controls" });
    send({ type: "request-state", role: "controls" });
  });

  ws.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    try {
      handleMessage(JSON.parse(event.data));
    } catch {
      // Ignore malformed relay traffic; this local relay broadcasts raw text.
    }
  });

  ws.addEventListener("close", (event) => {
    canvasOnline = false;
    updateCameraButtons();
    setPill(ui.relayStatus, ui.relayLabel, "offline", `Relay offline (${event.code})`);
    setPill(ui.canvasStatus, ui.canvasLabel, "waiting", "Renderer waiting");
    reconnectTimer = window.setTimeout(connect, 1500);
  });

  ws.addEventListener("error", () => {
    setPill(ui.relayStatus, ui.relayLabel, "error", "Relay error");
  });
}

function selectMode(mode) {
  params.mode = Math.max(0, Math.min(MODE_NAMES.length - 1, Number(mode)));
  updateModeUi();
  send({ type: "action", name: "set-mode", value: params.mode });
}

function toggleCamera() {
  if (!canvasOnline) return;
  if (desiredCameraOn) {
    desiredCameraOn = false;
    send({ type: "camera-command", action: "stop" });
  } else {
    desiredCameraOn = true;
    selectedDeviceId = ui.deviceSelect.value;
    send({ type: "camera-command", action: "start", deviceId: selectedDeviceId });
  }
  updateCameraButtons();
}

function togglePause() {
  paused = !paused;
  ui.pauseButton.textContent = paused ? "Resume" : "Pause";
  send({ type: "action", name: "set-paused", value: paused });
}

function clearFeedback() {
  send({ type: "action", name: "clear-feedback" });
}

function reset() {
  Object.assign(params, DEFAULTS);
  paused = false;
  syncUiFromState();
  send({ type: "state-sync", params: { ...params }, paused });
  send({ type: "action", name: "reset-feedback" });
}

function wireControls() {
  for (const id of RANGE_IDS) {
    const input = document.getElementById(id);
    input.addEventListener("pointerdown", () => { activeRangeId = id; });
    input.addEventListener("pointerup", () => { activeRangeId = ""; });
    input.addEventListener("pointercancel", () => { activeRangeId = ""; });
    input.addEventListener("blur", () => { if (activeRangeId === id) activeRangeId = ""; });
    input.addEventListener("input", () => {
      const value = Number.parseFloat(input.value);
      params[id] = id === "palette" ? Math.round(value) : value;
      updateOutput(id, params[id]);
      queueParameter(id, params[id]);
    });
  }

  document.querySelectorAll(".mode-button").forEach((button) => {
    button.addEventListener("click", () => selectMode(Number(button.dataset.mode)));
  });

  ui.cameraButton.addEventListener("click", toggleCamera);
  ui.refreshButton.addEventListener("click", () => send({ type: "camera-command", action: "enumerate" }));
  ui.deviceSelect.addEventListener("change", () => {
    selectedDeviceId = ui.deviceSelect.value;
    if (desiredCameraOn) {
      send({ type: "camera-command", action: "start", deviceId: selectedDeviceId });
    }
  });
  ui.clearButton.addEventListener("click", clearFeedback);
  ui.pauseButton.addEventListener("click", togglePause);
  ui.resetButton.addEventListener("click", reset);
  ui.fullscreenButton.addEventListener("click", () => send({ type: "action", name: "fullscreen" }));
}

function shortcutIgnored(event) {
  const target = event.target;
  return target instanceof HTMLElement
    && (["INPUT", "SELECT", "BUTTON", "TEXTAREA"].includes(target.tagName) || target.isContentEditable);
}

function wireShortcuts() {
  window.addEventListener("keydown", (event) => {
    if (shortcutIgnored(event) || event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === " ") {
      event.preventDefault();
      togglePause();
    } else if (key === "r") reset();
    else if (key === "x") clearFeedback();
    else if (key === "c") toggleCamera();
    else if (key === "f") send({ type: "action", name: "fullscreen" });
    else if (/^[1-6]$/.test(key)) selectMode(Number(key) - 1);
  });
}

syncUiFromState();
wireControls();
wireShortcuts();
updateCameraButtons();
connect();
