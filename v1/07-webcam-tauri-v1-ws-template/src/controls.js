"use strict";

const WS_URL = "ws://127.0.0.1:2727";
const DEFAULT_PARAMS = Object.freeze({
  effect: 0, distortion: 0, feedback: 0, zoom: 1, speed: 0.3,
  hue: 0, saturation: 1, brightness: 1, contrast: 1,
  mirror: 0, invert: 0, greyscale: 0, fitMode: 1,
});
const PRESETS = Object.freeze({
  clean: { ...DEFAULT_PARAMS },
  echo: { ...DEFAULT_PARAMS, effect: 1, distortion: 0.18, feedback: 0.82, zoom: 1.02, speed: 0.42, hue: 12, saturation: 1.15, brightness: 1.02, contrast: 1.08, mirror: 1 },
  prism: { ...DEFAULT_PARAMS, effect: 3, distortion: 0.58, feedback: 0.36, zoom: 1.16, speed: 0.65, hue: 48, saturation: 1.55, brightness: 1.05, contrast: 1.18 },
  edge: { ...DEFAULT_PARAMS, effect: 4, distortion: 0.12, feedback: 0.22, speed: 0.24, hue: -18, saturation: 0.2, brightness: 1.25, contrast: 1.8, greyscale: 1 },
});
const SLIDERS = ["distortion", "feedback", "zoom", "speed", "hue", "saturation", "brightness", "contrast"];
const TOGGLES = ["mirror", "invert", "greyscale"];

const state = {
  params: { ...DEFAULT_PARAMS },
  paused: false,
  camera: { on: false, deviceId: "", preset: "720" },
};
const pendingParams = new Map();
let socket = null;
let reconnectTimer = 0;
let reconnectDelayMs = 600;
let flushScheduled = false;
let outputFullscreen = false;
let lastCameraDevices = [];

function invoke(name, args = {}) {
  const fn = window.__TAURI__?.invoke || window.__TAURI__?.tauri?.invoke;
  return fn ? fn(name, args) : Promise.reject(new Error("Tauri API unavailable"));
}
function setStatus(id, text, kind = "pending") {
  const element = document.getElementById(id);
  if (!element) return;
  element.textContent = text;
  element.classList.remove("ok", "pending", "error");
  element.classList.add(kind);
}
function setDot(id, tone) {
  const element = document.getElementById(id);
  if (element) element.className = `status-dot ${tone}`;
}
function send(message) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(message));
  return true;
}
function formatValue(id, value) {
  if (id === "hue") return `${Math.round(value)}°`;
  if (id === "speed") return `${value.toFixed(2)}×`;
  return value.toFixed(2);
}
function updateControls() {
  for (const id of SLIDERS) {
    const input = document.getElementById(id);
    input.value = String(state.params[id]);
    document.getElementById(`${id}-val`).textContent = formatValue(id, Number(state.params[id]));
  }
  document.getElementById("effect").value = String(state.params.effect);
  document.getElementById("fitMode").value = String(state.params.fitMode);
  for (const id of TOGGLES) document.getElementById(id).checked = state.params[id] > 0.5;
  document.getElementById("capturePreset").value = state.camera.preset;
  document.getElementById("cam-btn").textContent = state.camera.on ? "Stop camera" : "Start camera";
  document.getElementById("pauseBtn").textContent = state.paused ? "Resume render" : "Pause render";
}
function scheduleFlush(name, value) {
  pendingParams.set(name, value);
  if (flushScheduled) return;
  flushScheduled = true;
  requestAnimationFrame(() => {
    flushScheduled = false;
    if (!pendingParams.size) return;
    const values = Object.fromEntries(pendingParams);
    pendingParams.clear();
    send({ type: "param_batch", values });
  });
}
function sendSnapshot(options = {}) {
  send({
    type: "state_snapshot",
    params: { ...state.params },
    paused: state.paused,
    camera: { ...state.camera },
    resetClock: Boolean(options.resetClock),
    clearHistory: Boolean(options.clearHistory),
  });
}
function updateCameraUi(message) {
  const tone = message.state === "ok" ? "ok" : message.state === "error" ? "error" : "warning";
  document.getElementById("cameraStatus").textContent = message.title || (message.state === "ok" ? "Camera live" : message.state === "error" ? "Camera error" : "Not started");
  document.getElementById("cameraMessage").textContent = message.message || "Camera state updated by the output window.";
  setDot("cameraDot", tone);
  if (message.state === "ok") {
    state.camera.on = true;
    if (message.deviceId) state.camera.deviceId = message.deviceId;
    document.getElementById("cam-btn").textContent = "Stop camera";
    document.getElementById("cameraStateReadout").textContent = message.label || "Camera live";
    if (message.width && message.height) document.getElementById("inputReadout").textContent = `${message.width} × ${message.height}`;
  } else if (message.state === "stopped" || message.state === "error") {
    state.camera.on = false;
    document.getElementById("cam-btn").textContent = "Start camera";
    document.getElementById("cameraStateReadout").textContent = message.state === "error" ? "Camera error" : "No camera";
  }
}
function populateDevices(message) {
  const select = document.getElementById("cam-select");
  const devices = Array.isArray(message.devices) ? message.devices : [];
  lastCameraDevices = devices;
  select.innerHTML = "";
  if (!devices.length) {
    select.innerHTML = '<option value="">Default camera / permission required</option>';
  } else {
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = "Default camera";
    select.appendChild(defaultOption);
    devices.forEach((device, index) => {
      const option = document.createElement("option");
      option.value = device.deviceId || "";
      option.textContent = device.label || `Camera ${index + 1}`;
      select.appendChild(option);
    });
  }
  const preferred = state.camera.deviceId || message.activeDeviceId || "";
  if (Array.from(select.options).some(option => option.value === preferred)) select.value = preferred;
  if (!state.camera.on && devices.length) {
    document.getElementById("cameraStatus").textContent = "Ready to request";
    document.getElementById("cameraMessage").textContent = `${devices.length} camera input${devices.length === 1 ? "" : "s"} reported by the output WebView.`;
    setDot("cameraDot", "warning");
  }
}
function handleTelemetry(message) {
  document.getElementById("fpsReadout").textContent = String(message.fps || 0);
  document.getElementById("cameraFpsReadout").textContent = String(message.cameraFps || 0);
  document.getElementById("sizeReadout").textContent = `${message.width || 0} × ${message.height || 0}`;
  document.getElementById("rendererReadout").textContent = message.renderer || "WebGL 1";
  setStatus("shaderStatus", message.shaderReady ? "Shaders linked" : "Shader error", message.shaderReady ? "ok" : "error");
  setDot("shaderDot", message.shaderReady ? "ok" : "error");
  document.getElementById("diagnostics").textContent = message.diagnostics || (message.shaderReady ? "Effect shader: OK\nBlit shader: OK\nFeedback framebuffers: OK" : "Output reported a shader or framebuffer error.");
  if (message.camera?.on) {
    document.getElementById("cameraStateReadout").textContent = message.camera.label || "Camera live";
    document.getElementById("inputReadout").textContent = `${message.camera.width || 0} × ${message.camera.height || 0}`;
  }
}
function handleMessage(message) {
  if (message.type === "presence") {
    const controls = Number(message.controls || 0);
    const outputs = Number(message.canvas || 0);
    document.getElementById("presenceReadout").textContent = `${controls} control${controls === 1 ? "" : "s"} · ${outputs} output${outputs === 1 ? "" : "s"}`;
    setStatus("canvasStatus", outputs > 0 ? "Connected" : "Waiting…", outputs > 0 ? "ok" : "pending");
  } else if (message.type === "request_state") {
    sendSnapshot();
    send({ type: "cam", action: "enumerate" });
  } else if (message.type === "telemetry") {
    handleTelemetry(message);
  } else if (message.type === "cam-devices") {
    populateDevices(message);
  } else if (message.type === "cam-status") {
    updateCameraUi(message);
  }
}
function connect() {
  clearTimeout(reconnectTimer);
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  setStatus("relayStatus", "Connecting…", "pending");
  socket = new WebSocket(WS_URL);
  socket.addEventListener("open", () => {
    reconnectDelayMs = 600;
    setStatus("relayStatus", "Connected", "ok");
    send({ type: "hello", role: "controls" });
    sendSnapshot();
    send({ type: "cam", action: "enumerate" });
  });
  socket.addEventListener("message", event => {
    if (typeof event.data !== "string") return;
    try { handleMessage(JSON.parse(event.data)); }
    catch (error) { console.warn("[junkpile 07] ignored malformed relay message", error); }
  });
  socket.addEventListener("close", () => {
    setStatus("relayStatus", "Disconnected", "error");
    setStatus("canvasStatus", "Waiting…", "pending");
    reconnectTimer = window.setTimeout(connect, reconnectDelayMs);
    reconnectDelayMs = Math.min(4000, Math.round(reconnectDelayMs * 1.5));
  });
  socket.addEventListener("error", () => setStatus("relayStatus", "Relay error", "error"));
}
function applyPreset(name) {
  state.params = { ...DEFAULT_PARAMS, ...(PRESETS[name] || PRESETS.clean), fitMode: state.params.fitMode };
  updateControls();
  sendSnapshot({ clearHistory: true });
}
function resetExample() {
  state.params = { ...DEFAULT_PARAMS };
  state.paused = false;
  updateControls();
  sendSnapshot({ resetClock: true, clearHistory: true });
}
function toggleCamera() {
  if (state.camera.on) {
    state.camera.on = false;
    send({ type: "cam", action: "stop" });
    updateCameraUi({ state: "stopped", title: "Not started", message: "Camera stopped from the controls window." });
  } else {
    state.camera.on = true;
    state.camera.deviceId = document.getElementById("cam-select").value || "";
    state.camera.preset = document.getElementById("capturePreset").value;
    document.getElementById("cam-btn").textContent = "Requesting…";
    send({ type: "cam", action: "start", deviceId: state.camera.deviceId, preset: state.camera.preset });
  }
}
function wireControls() {
  SLIDERS.forEach(id => {
    const input = document.getElementById(id);
    input.addEventListener("input", () => {
      state.params[id] = Number(input.value);
      document.getElementById(`${id}-val`).textContent = formatValue(id, state.params[id]);
      scheduleFlush(id, state.params[id]);
    });
  });
  document.getElementById("effect").addEventListener("change", event => { state.params.effect = Number(event.target.value); scheduleFlush("effect", state.params.effect); });
  document.getElementById("fitMode").addEventListener("change", event => { state.params.fitMode = Number(event.target.value); scheduleFlush("fitMode", state.params.fitMode); });
  TOGGLES.forEach(id => document.getElementById(id).addEventListener("change", event => { state.params[id] = event.target.checked ? 1 : 0; scheduleFlush(id, state.params[id]); }));
  document.querySelectorAll("[data-preset]").forEach(button => button.addEventListener("click", () => applyPreset(button.dataset.preset)));
  document.getElementById("cam-btn").addEventListener("click", toggleCamera);
  document.getElementById("cam-refresh").addEventListener("click", () => send({ type: "cam", action: "enumerate" }));
  document.getElementById("cam-select").addEventListener("change", event => {
    state.camera.deviceId = event.target.value || "";
    if (state.camera.on) send({ type: "cam", action: "start", deviceId: state.camera.deviceId, preset: state.camera.preset });
  });
  document.getElementById("capturePreset").addEventListener("change", event => {
    state.camera.preset = event.target.value;
    if (state.camera.on) send({ type: "cam", action: "start", deviceId: state.camera.deviceId, preset: state.camera.preset });
  });
  document.getElementById("pauseBtn").addEventListener("click", () => {
    state.paused = !state.paused;
    updateControls();
    send({ type: "action", name: "set_paused", value: state.paused });
  });
  document.getElementById("clearBtn").addEventListener("click", () => send({ type: "action", name: "clear_history" }));
  document.getElementById("resetBtn").addEventListener("click", resetExample);
  document.getElementById("syncBtn").addEventListener("click", () => { sendSnapshot(); send({ type: "cam", action: "enumerate" }); });
  document.getElementById("showOutputBtn").addEventListener("click", () => invoke("show_canvas").catch(console.error));
  document.getElementById("focusOutputBtn").addEventListener("click", () => invoke("focus_canvas").catch(console.error));
  document.getElementById("fullscreenOutputBtn").addEventListener("click", async () => {
    try {
      outputFullscreen = await invoke("toggle_canvas_fullscreen");
      document.getElementById("fullscreenOutputBtn").textContent = outputFullscreen ? "Exit fullscreen" : "Output fullscreen";
    } catch (error) { console.error("[junkpile 07] fullscreen failed", error); }
  });
  window.addEventListener("keydown", event => {
    if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
    if (event.code === "Space") { event.preventDefault(); document.getElementById("pauseBtn").click(); }
    if (event.key.toLowerCase() === "r") resetExample();
    if (event.key.toLowerCase() === "x") document.getElementById("clearBtn").click();
    if (event.key.toLowerCase() === "s") document.getElementById("syncBtn").click();
    if (event.key.toLowerCase() === "f") document.getElementById("fullscreenOutputBtn").click();
  });
}
function start() {
  wireControls();
  updateControls();
  setDot("cameraDot", "warning");
  setDot("shaderDot", "warning");
  connect();
}
document.addEventListener("DOMContentLoaded", start, { once: true });
