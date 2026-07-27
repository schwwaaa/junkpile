'use strict';

const WS_URL = 'ws://127.0.0.1:2727';
const RECONNECT_DELAY_MS = 1200;
const CANVAS_STALE_AFTER_MS = 2400;
const DEFAULT_SHADER_URL = 'shader.frag';
const MAX_SHADER_BYTES = 1024 * 1024;

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
  sourceStatus: document.getElementById('source-status'),
  vertexStatus: document.getElementById('vertex-status'),
  fragmentStatus: document.getElementById('fragment-status'),
  linkStatus: document.getElementById('link-status'),
  fpsValue: document.getElementById('fps-value'),
  resolutionValue: document.getElementById('resolution-value'),
  rendererValue: document.getElementById('renderer-value'),
  sentValue: document.getElementById('sent-value'),
  receivedValue: document.getElementById('received-value'),
  compilerLog: document.getElementById('compiler-log'),
  activeShaderName: document.getElementById('active-shader-name'),
  candidateShaderName: document.getElementById('candidate-shader-name'),
  shaderFileInput: document.getElementById('shader-file-input'),
  loadShaderButton: document.getElementById('load-shader-button'),
  defaultShaderButton: document.getElementById('default-shader-button'),
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
let nextShaderRevision = 1;
let defaultShaderSource = '';
let acceptedShader = null;
let pendingShader = null;
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

function setCompilerLog(state, lines) {
  ui.compilerLog.dataset.state = state;
  ui.compilerLog.textContent = Array.isArray(lines) ? lines.join('\n') : String(lines);
  ui.compilerLog.scrollTop = 0;
}

function updateCounters() {
  ui.sentValue.textContent = String(sentCount);
  ui.receivedValue.textContent = String(receivedCount);
}

function updateShaderLabels() {
  const activeName = acceptedShader?.name || 'Waiting for canvas';
  const candidateName = pendingShader?.name || 'None';
  ui.activeShaderName.textContent = activeName;
  ui.activeShaderName.title = activeName;
  ui.candidateShaderName.textContent = candidateName;
  ui.candidateShaderName.title = candidateName;
}

function sendMessage(message) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;

  try {
    socket.send(JSON.stringify(message));
    sentCount += 1;
    updateCounters();
    return true;
  } catch (error) {
    setCompilerLog('error', [
      '[websocket] Send failed.',
      error instanceof Error ? error.message : String(error),
    ]);
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

function sendShader(shader, reason) {
  if (!shader?.source) return false;
  return sendMessage({
    type: 'shader',
    role: 'controls',
    name: shader.name,
    source: shader.source,
    revision: shader.revision,
    reason,
  });
}

function syncCanvas(reason, resetTime = false) {
  pendingParams.clear();
  sendMessage(stateMessage(reason, resetTime));

  // Restore the known-good program first. If a candidate was waiting when the
  // canvas reconnected, send it second so rejection still has a safe fallback.
  if (acceptedShader) sendShader(acceptedShader, `${reason}:accepted`);
  if (pendingShader) sendShader(pendingShader, `${reason}:candidate`);
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
  if (!flushFrame) flushFrame = requestAnimationFrame(flushPendingParams);
}

function scheduleReconnect() {
  window.clearTimeout(reconnectTimer);
  reconnectTimer = window.setTimeout(connectWebSocket, RECONNECT_DELAY_MS);
}

function connectWebSocket() {
  if (socket && (
    socket.readyState === WebSocket.OPEN ||
    socket.readyState === WebSocket.CONNECTING
  )) return;

  setRelayState('starting', 'Relay connecting');
  socket = new WebSocket(WS_URL);

  socket.addEventListener('open', () => {
    setRelayState('connected', 'Relay connected');
    sendMessage({ type: 'hello', role: 'controls' });
    syncCanvas('controls_connected');
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
        syncCanvas('canvas_hello');
      } else if (message.type === 'state_request' && message.role === 'canvas') {
        canvasLastSeen = performance.now();
        setCanvasState('running', 'Renderer syncing');
        syncCanvas('canvas_requested_state');
      } else if (message.type === 'telemetry' && message.role === 'canvas') {
        applyTelemetry(message);
      } else if (message.type === 'shader_result' && message.role === 'canvas') {
        applyShaderResult(message);
      } else if (message.type === 'canvas_state' && message.role === 'canvas') {
        canvasLastSeen = performance.now();
        if (typeof message.paused === 'boolean') {
          paused = message.paused;
          updatePauseButton();
        }
      }
    } catch (error) {
      setCompilerLog('error', [
        '[websocket] Could not parse renderer message.',
        error instanceof Error ? error.message : String(error),
      ]);
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

function diagnosticResult(value, successValue) {
  if (value === successValue) return 'success';
  if (typeof value === 'string' && /failed|missing|rejected|error/i.test(value)) return 'error';
  return '';
}

function applyTelemetry(message) {
  canvasLastSeen = performance.now();
  const runtimeState = message.runtime === 'error'
    ? 'error'
    : message.runtime === 'warning'
      ? 'warning'
      : 'running';
  const runtimeLabel = message.runtime === 'error'
    ? 'Renderer error'
    : message.runtime === 'warning'
      ? 'Shader rejected / running'
      : message.paused
        ? 'Renderer paused'
        : 'Renderer online';
  setCanvasState(runtimeState, runtimeLabel);

  setDiagnostic(ui.sourceStatus, message.sourceStatus || 'Unknown', diagnosticResult(message.sourceStatus, 'Active'));
  setDiagnostic(ui.vertexStatus, message.vertexStatus || 'Unknown', diagnosticResult(message.vertexStatus, 'Compiled'));
  setDiagnostic(ui.fragmentStatus, message.fragmentStatus || 'Unknown', diagnosticResult(message.fragmentStatus, 'Compiled'));
  setDiagnostic(ui.linkStatus, message.linkStatus || 'Unknown', diagnosticResult(message.linkStatus, 'Linked'));

  ui.fpsValue.textContent = Number.isFinite(message.fps) ? message.fps.toFixed(1) : '—';
  ui.resolutionValue.textContent = message.resolution || '—';
  ui.rendererValue.textContent = message.renderer || 'Unknown';
  ui.rendererValue.title = ui.rendererValue.textContent;

  if (message.activeShaderName && !pendingShader) {
    if (!acceptedShader || message.activeShaderRevision >= acceptedShader.revision) {
      acceptedShader = acceptedShader
        ? { ...acceptedShader, name: message.activeShaderName, revision: message.activeShaderRevision }
        : acceptedShader;
      updateShaderLabels();
    }
  }

  if (typeof message.paused === 'boolean') {
    paused = message.paused;
    updatePauseButton();
  }

  if (message.compilerLog) {
    setCompilerLog(message.runtime === 'warning' || message.runtime === 'error' ? 'error' : 'success', message.compilerLog);
  }
}

function applyShaderResult(message) {
  canvasLastSeen = performance.now();
  const revision = Number(message.revision);
  const matchesPending = pendingShader && revision === pendingShader.revision;

  if (message.accepted) {
    if (matchesPending) {
      acceptedShader = pendingShader;
      pendingShader = null;
    }
    setDiagnostic(ui.sourceStatus, 'Active', 'success');
    setCanvasState('running', paused ? 'Renderer paused' : 'Renderer online');
    setCompilerLog('success', message.compilerLog || [
      `[accepted] ${message.name || 'shader'}`,
      '[active] Candidate is now rendering.',
    ]);
  } else {
    if (matchesPending) pendingShader = null;
    setDiagnostic(ui.sourceStatus, 'Rejected', 'error');
    setCanvasState('warning', 'Shader rejected / running');
    setCompilerLog('error', message.compilerLog || [
      `[rejected] ${message.name || 'shader'}`,
      '[preserved] Last valid program remains active.',
      '',
      message.error || 'Unknown compiler error.',
    ]);
  }

  updateShaderLabels();
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
    if (!(input instanceof HTMLInputElement)) throw new Error(`Missing toggle control: ${id}`);
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
  syncCanvas('reset', true);
}

function toggleCanvasFullscreen() {
  sendMessage({ type: 'action', role: 'controls', name: 'fullscreen' });
}

function queueShaderCandidate(source, name) {
  pendingShader = {
    name,
    source,
    revision: nextShaderRevision++,
  };
  updateShaderLabels();
  setDiagnostic(ui.sourceStatus, 'Validating');
  setCompilerLog('idle', [
    `[candidate] ${name}`,
    `[payload] ${new Blob([source]).size.toLocaleString('en-US')} bytes`,
    '[websocket] Sending source to canvas for compilation…',
  ]);

  if (!sendShader(pendingShader, 'user_candidate')) {
    setCompilerLog('idle', [
      `[candidate] ${name}`,
      '[queued] Relay is offline. The candidate will be sent after reconnection.',
    ]);
  }
}

async function loadShaderFile(file) {
  if (!file) return;
  if (file.size > MAX_SHADER_BYTES) {
    setCompilerLog('error', [
      `[rejected locally] ${file.name}`,
      'Shader files are limited to 1 MiB in this focused example.',
    ]);
    return;
  }

  ui.loadShaderButton.disabled = true;
  setDiagnostic(ui.sourceStatus, 'Reading file');
  try {
    const source = await file.text();
    queueShaderCandidate(source, file.name);
  } catch (error) {
    setDiagnostic(ui.sourceStatus, 'Read failed', 'error');
    setCompilerLog('error', [
      `[file] Could not read ${file.name}.`,
      error instanceof Error ? error.message : String(error),
    ]);
  } finally {
    ui.loadShaderButton.disabled = false;
  }
}

async function fetchDefaultShader() {
  const response = await fetch(DEFAULT_SHADER_URL, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Could not load ${DEFAULT_SHADER_URL}: HTTP ${response.status}.`);
  const source = await response.text();
  if (new Blob([source]).size > MAX_SHADER_BYTES) throw new Error('Default shader exceeds the 1 MiB limit.');
  return source;
}

async function prepareDefaultShader() {
  try {
    defaultShaderSource = await fetchDefaultShader();
    if (!acceptedShader) {
      acceptedShader = {
        name: DEFAULT_SHADER_URL,
        source: defaultShaderSource,
        revision: nextShaderRevision++,
      };
      updateShaderLabels();
    }
    setDiagnostic(ui.sourceStatus, 'Prepared', 'success');
    setCompilerLog('idle', [
      `[loader] ${DEFAULT_SHADER_URL} is ready.`,
      '[canvas] Waiting for renderer validation telemetry…',
    ]);

    if (socket?.readyState === WebSocket.OPEN) syncCanvas('default_source_ready');
  } catch (error) {
    setDiagnostic(ui.sourceStatus, 'Load failed', 'error');
    setCompilerLog('error', [
      `[loader] Could not prepare ${DEFAULT_SHADER_URL}.`,
      error instanceof Error ? error.message : String(error),
    ]);
  }
}

async function restoreDefaultShader() {
  ui.defaultShaderButton.disabled = true;
  try {
    if (!defaultShaderSource) defaultShaderSource = await fetchDefaultShader();
    queueShaderCandidate(defaultShaderSource, DEFAULT_SHADER_URL);
  } catch (error) {
    setDiagnostic(ui.sourceStatus, 'Load failed', 'error');
    setCompilerLog('error', [
      `[loader] Could not restore ${DEFAULT_SHADER_URL}.`,
      error instanceof Error ? error.message : String(error),
    ]);
  } finally {
    ui.defaultShaderButton.disabled = false;
  }
}

function openShaderPicker() {
  ui.shaderFileInput.value = '';
  ui.shaderFileInput.click();
}

function wireActions() {
  ui.loadShaderButton.addEventListener('click', openShaderPicker);
  ui.defaultShaderButton.addEventListener('click', restoreDefaultShader);
  ui.shaderFileInput.addEventListener('change', () => {
    const [file] = ui.shaderFileInput.files || [];
    if (file) loadShaderFile(file);
  });
  ui.pauseButton.addEventListener('click', togglePause);
  ui.resetButton.addEventListener('click', resetExample);
  ui.fullscreenButton.addEventListener('click', toggleCanvasFullscreen);

  document.addEventListener('keydown', (event) => {
    const target = event.target;
    const isInteractive =
      target instanceof HTMLInputElement ||
      target instanceof HTMLButtonElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement;
    if (isInteractive || event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.code === 'Space') {
      event.preventDefault();
      togglePause();
    } else if (event.key.toLowerCase() === 'r') {
      event.preventDefault();
      resetExample();
    } else if (event.key.toLowerCase() === 'o') {
      event.preventDefault();
      openShaderPicker();
    } else if (event.key.toLowerCase() === 'd') {
      event.preventDefault();
      restoreDefaultShader();
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
    updateShaderLabels();
    connectWebSocket();
    prepareDefaultShader();

    window.setInterval(() => {
      if (canvasLastSeen && performance.now() - canvasLastSeen > CANVAS_STALE_AFTER_MS) {
        setCanvasState('waiting', 'Renderer waiting');
      }
    }, 500);
  } catch (error) {
    setCompilerLog('error', error instanceof Error ? error.message : String(error));
    setRelayState('error', 'Controls error');
  }
}

window.addEventListener('beforeunload', () => {
  window.clearTimeout(reconnectTimer);
  if (flushFrame) cancelAnimationFrame(flushFrame);
  if (socket) socket.close(1000, 'controls window closing');
});

initialize();
