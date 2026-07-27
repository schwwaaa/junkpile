'use strict';

const WS_URL = 'ws://127.0.0.1:2727';
const RECONNECT_DELAY_MS = 1200;
const CANVAS_STALE_AFTER_MS = 2200;

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
const PARAMETER_IDS = [
  'hue',
  'saturation',
  'brightness',
  'zoom',
  'speed',
  'distortion',
  'complexity',
  'symmetry',
  'glow',
];
const TOGGLE_IDS = ['invert', 'pulse', 'rotate'];
const INTEGER_PARAMETERS = new Set(['hue', 'complexity', 'symmetry']);

const ui = {
  relayStatus: document.getElementById('relay-status'),
  relayLabel: document.getElementById('relay-label'),
  canvasStatus: document.getElementById('canvas-status'),
  canvasLabel: document.getElementById('canvas-label'),
  vertexStatus: document.getElementById('vertex-status'),
  fragmentStatus: document.getElementById('fragment-status'),
  linkStatus: document.getElementById('link-status'),
  fpsValue: document.getElementById('fps-value'),
  resolutionValue: document.getElementById('resolution-value'),
  rendererValue: document.getElementById('renderer-value'),
  sentValue: document.getElementById('sent-value'),
  receivedValue: document.getElementById('received-value'),
  errorLog: document.getElementById('error-log'),
  pauseButton: document.getElementById('pause-button'),
  resetButton: document.getElementById('reset-button'),
  fullscreenButton: document.getElementById('fullscreen-button'),
};

let socket = null;
let reconnectTimer = 0;
let flushFrame = 0;
let paused = false;
let canvasLastSeen = 0;
let sentCount = 0;
let receivedCount = 0;
const pendingParams = new Map();

function setPill(element, labelElement, state, label) {
  element.dataset.state = state;
  labelElement.textContent = label;
}

function setRelayState(state, label) {
  setPill(ui.relayStatus, ui.relayLabel, state, label);
}

function setCanvasState(state, label) {
  setPill(ui.canvasStatus, ui.canvasLabel, state, label);
}

function setDiagnostic(element, text, result = '') {
  element.textContent = text;
  if (result) element.dataset.result = result;
  else delete element.dataset.result;
}

function showError(message) {
  ui.errorLog.hidden = false;
  ui.errorLog.textContent = message;
}

function clearError() {
  ui.errorLog.hidden = true;
  ui.errorLog.textContent = '';
}

function updateCounters() {
  ui.sentValue.textContent = String(sentCount);
  ui.receivedValue.textContent = String(receivedCount);
}

function sendMessage(message) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;

  try {
    socket.send(JSON.stringify(message));
    sentCount += 1;
    updateCounters();
    return true;
  } catch (error) {
    showError(`WebSocket send failed:\n${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

function stateMessage(reason, resetTime = false) {
  return {
    type: 'state',
    role: 'controls',
    params: { ...params },
    paused,
    resetTime,
    reason,
  };
}

function broadcastState(reason, resetTime = false) {
  pendingParams.clear();
  sendMessage(stateMessage(reason, resetTime));
}

function flushPendingParams() {
  flushFrame = 0;
  for (const [name, value] of pendingParams) {
    sendMessage({ type: 'param', role: 'controls', name, value });
  }
  pendingParams.clear();
}

function queueParam(name, value) {
  pendingParams.set(name, value);
  if (!flushFrame) {
    flushFrame = requestAnimationFrame(flushPendingParams);
  }
}

function scheduleReconnect() {
  window.clearTimeout(reconnectTimer);
  reconnectTimer = window.setTimeout(connectWebSocket, RECONNECT_DELAY_MS);
}

function connectWebSocket() {
  if (socket && (
    socket.readyState === WebSocket.OPEN ||
    socket.readyState === WebSocket.CONNECTING
  )) {
    return;
  }

  setRelayState('starting', 'Relay connecting');
  socket = new WebSocket(WS_URL);

  socket.addEventListener('open', () => {
    clearError();
    setRelayState('connected', 'Relay connected');
    sendMessage({ type: 'hello', role: 'controls' });
    broadcastState('controls_connected');
  });

  socket.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') return;

    try {
      const message = JSON.parse(event.data);
      receivedCount += 1;
      updateCounters();

      if (message.type === 'hello' && message.role === 'canvas') {
        canvasLastSeen = performance.now();
        setCanvasState('running', 'Renderer online');
        broadcastState('canvas_hello');
        return;
      }

      if (message.type === 'state_request' && message.role === 'canvas') {
        canvasLastSeen = performance.now();
        setCanvasState('running', 'Renderer syncing');
        broadcastState('canvas_requested_state');
        return;
      }

      if (message.type === 'telemetry' && message.role === 'canvas') {
        applyTelemetry(message);
        return;
      }

      if (message.type === 'canvas_state' && message.role === 'canvas') {
        canvasLastSeen = performance.now();
        if (typeof message.paused === 'boolean') {
          paused = message.paused;
          updatePauseButton();
        }
      }
    } catch (error) {
      showError(`Could not parse renderer message:\n${error instanceof Error ? error.message : String(error)}`);
    }
  });

  socket.addEventListener('close', (event) => {
    setRelayState('offline', `Relay disconnected (${event.code})`);
    setCanvasState('waiting', 'Renderer unavailable');
    scheduleReconnect();
  });

  socket.addEventListener('error', () => {
    setRelayState('error', 'Relay error');
  });
}

function applyTelemetry(message) {
  canvasLastSeen = performance.now();
  setCanvasState(message.runtime === 'error' ? 'error' : 'running',
    message.runtime === 'error' ? 'Renderer error' : 'Renderer online');

  setDiagnostic(
    ui.vertexStatus,
    message.vertexStatus || 'Unknown',
    message.vertexStatus === 'Compiled' ? 'success' : message.runtime === 'error' ? 'error' : ''
  );
  setDiagnostic(
    ui.fragmentStatus,
    message.fragmentStatus || 'Unknown',
    message.fragmentStatus === 'Compiled' ? 'success' : message.runtime === 'error' ? 'error' : ''
  );
  setDiagnostic(
    ui.linkStatus,
    message.linkStatus || 'Unknown',
    message.linkStatus === 'Linked' ? 'success' : message.runtime === 'error' ? 'error' : ''
  );

  ui.fpsValue.textContent = Number.isFinite(message.fps) ? message.fps.toFixed(1) : '—';
  ui.resolutionValue.textContent = message.resolution || '—';
  ui.rendererValue.textContent = message.renderer || 'Unknown';
  ui.rendererValue.title = ui.rendererValue.textContent;

  if (typeof message.paused === 'boolean') {
    paused = message.paused;
    updatePauseButton();
  }

  if (message.error) showError(message.error);
  else clearError();
}

function formatParameterValue(id, value) {
  return INTEGER_PARAMETERS.has(id) ? String(Math.round(value)) : value.toFixed(2);
}

function wireControls() {
  for (const id of PARAMETER_IDS) {
    const input = document.getElementById(id);
    const output = document.getElementById(`${id}-value`);

    if (!(input instanceof HTMLInputElement) || !(output instanceof HTMLOutputElement)) {
      throw new Error(`Missing parameter control: ${id}`);
    }

    input.addEventListener('input', () => {
      const value = Number.parseFloat(input.value);
      if (!Number.isFinite(value)) return;
      params[id] = value;
      output.value = formatParameterValue(id, value);
      output.textContent = output.value;
      queueParam(id, value);
    });
  }

  for (const id of TOGGLE_IDS) {
    const input = document.getElementById(id);
    if (!(input instanceof HTMLInputElement)) {
      throw new Error(`Missing toggle control: ${id}`);
    }

    input.addEventListener('change', () => {
      params[id] = input.checked ? 1 : 0;
      queueParam(id, input.checked);
    });
  }
}

function syncControlsFromParams() {
  for (const id of PARAMETER_IDS) {
    const input = document.getElementById(id);
    const output = document.getElementById(`${id}-value`);
    input.value = String(params[id]);
    output.value = formatParameterValue(id, params[id]);
    output.textContent = output.value;
  }

  for (const id of TOGGLE_IDS) {
    document.getElementById(id).checked = params[id] === 1;
  }
}

function updatePauseButton() {
  ui.pauseButton.textContent = paused ? 'Resume' : 'Pause';
  ui.pauseButton.setAttribute('aria-pressed', String(paused));
}

function togglePause() {
  paused = !paused;
  updatePauseButton();
  sendMessage({ type: 'action', role: 'controls', name: 'pause', value: paused });
}

function resetExample() {
  Object.assign(params, DEFAULT_PARAMS);
  paused = false;
  syncControlsFromParams();
  updatePauseButton();
  broadcastState('reset', true);
}

function toggleCanvasFullscreen() {
  sendMessage({ type: 'action', role: 'controls', name: 'fullscreen' });
}

function wireActions() {
  ui.pauseButton.addEventListener('click', togglePause);
  ui.resetButton.addEventListener('click', resetExample);
  ui.fullscreenButton.addEventListener('click', toggleCanvasFullscreen);

  document.addEventListener('keydown', (event) => {
    const target = event.target;
    const isInteractive = target instanceof HTMLInputElement || target instanceof HTMLButtonElement;
    if (isInteractive) return;

    if (event.code === 'Space') {
      event.preventDefault();
      togglePause();
    } else if (event.key.toLowerCase() === 'r') {
      event.preventDefault();
      resetExample();
    } else if (event.key.toLowerCase() === 'f') {
      event.preventDefault();
      toggleCanvasFullscreen();
    }
  });
}

function initialize() {
  try {
    wireControls();
    wireActions();
    syncControlsFromParams();
    updatePauseButton();
    connectWebSocket();

    window.setInterval(() => {
      if (canvasLastSeen && performance.now() - canvasLastSeen > CANVAS_STALE_AFTER_MS) {
        setCanvasState('waiting', 'Renderer waiting');
      }
    }, 500);
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
    setRelayState('error', 'Controls error');
  }
}

window.addEventListener('beforeunload', () => {
  window.clearTimeout(reconnectTimer);
  if (flushFrame) cancelAnimationFrame(flushFrame);
  if (socket) socket.close(1000, 'controls window closing');
});

initialize();
