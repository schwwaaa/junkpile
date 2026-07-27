'use strict';

const WS_URL = 'ws://127.0.0.1:2727';
const RECONNECT_DELAY_MS = 1200;
const TELEMETRY_INTERVAL_MS = 500;
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
const VALID_PARAM_NAMES = new Set(Object.keys(DEFAULT_PARAMS));

const VERTEX_SHADER_SOURCE = `
  precision highp float;

  attribute vec2 a_position;
  varying vec2 vTexCoord;

  void main() {
    vTexCoord = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

const ui = {
  canvas: document.getElementById('gl-canvas'),
  rendererPanel: document.getElementById('renderer-panel'),
  runtimeLabel: document.getElementById('runtime-label'),
  shaderLabel: document.getElementById('shader-label'),
  wsLabel: document.getElementById('ws-label'),
  fpsLabel: document.getElementById('fps-label'),
  resolutionLabel: document.getElementById('resolution-label'),
  rendererNotice: document.getElementById('renderer-notice'),
  rendererNoticeMessage: document.getElementById('renderer-notice-message'),
  rendererError: document.getElementById('renderer-error'),
  rendererErrorMessage: document.getElementById('renderer-error-message'),
};

const diagnostics = {
  runtime: 'starting',
  sourceStatus: 'Loading',
  vertexStatus: 'Pending',
  fragmentStatus: 'Pending',
  linkStatus: 'Pending',
  renderer: 'Detecting…',
  resolution: '—',
  fps: 0,
  compilerLog: '[loader] Waiting for shader.frag…',
  warning: '',
  fatalError: '',
};

let socket = null;
let reconnectTimer = 0;
let gl = null;
let program = null;
let quadBuffer = null;
let positionAttributeLocation = -1;
let animationFrameId = 0;
let resizeObserver = null;
let paused = false;
let shaderTime = 0;
let previousFrameTime = performance.now();
let fpsWindowStart = previousFrameTime;
let fpsFrameCount = 0;
let lastTelemetryTime = 0;
let activeShaderName = 'Loading…';
let activeShaderRevision = -1;
const uniformLocations = new Map();

function refreshRuntime() {
  if (diagnostics.fatalError) {
    diagnostics.runtime = 'error';
    ui.runtimeLabel.textContent = 'Error';
  } else if (diagnostics.warning) {
    diagnostics.runtime = 'warning';
    ui.runtimeLabel.textContent = paused ? 'Paused / rejected' : 'Running / rejected';
  } else if (paused) {
    diagnostics.runtime = 'paused';
    ui.runtimeLabel.textContent = 'Paused';
  } else if (program) {
    diagnostics.runtime = 'running';
    ui.runtimeLabel.textContent = 'Running';
  } else {
    diagnostics.runtime = 'starting';
    ui.runtimeLabel.textContent = 'Loading shader';
  }
}

function sendMessage(message) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  try {
    socket.send(JSON.stringify(message));
    return true;
  } catch (error) {
    console.warn('[canvas] send failed', error);
    return false;
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
  )) return;

  ui.wsLabel.textContent = 'WS connecting';
  socket = new WebSocket(WS_URL);

  socket.addEventListener('open', () => {
    ui.wsLabel.textContent = 'WS connected';
    sendMessage({ type: 'hello', role: 'canvas' });
    sendMessage({ type: 'state_request', role: 'canvas' });
    sendTelemetry(performance.now(), true);
  });

  socket.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') return;
    try {
      applyMessage(JSON.parse(event.data));
    } catch (error) {
      console.warn('[canvas] invalid message', error);
    }
  });

  socket.addEventListener('close', (event) => {
    ui.wsLabel.textContent = `WS disconnected ${event.code}`;
    scheduleReconnect();
  });

  socket.addEventListener('error', () => {
    ui.wsLabel.textContent = 'WS error';
  });
}

function applyMessage(message) {
  if (message.type === 'param' && VALID_PARAM_NAMES.has(message.name)) {
    const value = typeof message.value === 'boolean'
      ? (message.value ? 1 : 0)
      : Number(message.value);
    if (Number.isFinite(value)) params[message.name] = value;
    return;
  }

  if (message.type === 'state' && message.params && typeof message.params === 'object') {
    for (const [name, rawValue] of Object.entries(message.params)) {
      if (!VALID_PARAM_NAMES.has(name)) continue;
      const value = Number(rawValue);
      if (Number.isFinite(value)) params[name] = value;
    }

    if (typeof message.paused === 'boolean') {
      paused = message.paused;
      previousFrameTime = performance.now();
    }
    if (message.resetTime === true) shaderTime = 0;

    refreshRuntime();
    sendTelemetry(performance.now(), true);
    return;
  }

  if (message.type === 'shader' && typeof message.source === 'string') {
    handleShaderCandidate(message);
    return;
  }

  if (message.type === 'action') {
    if (message.name === 'pause') {
      paused = Boolean(message.value);
      previousFrameTime = performance.now();
      refreshRuntime();
      sendMessage({ type: 'canvas_state', role: 'canvas', paused });
      sendTelemetry(performance.now(), true);
    } else if (message.name === 'fullscreen') {
      toggleNativeFullscreen();
    }
  }
}

async function toggleNativeFullscreen() {
  try {
    const invoke = window.__TAURI__?.core?.invoke;
    if (typeof invoke === 'function') {
      await invoke('toggle_canvas_fullscreen');
      return;
    }
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch (error) {
    diagnostics.warning = `Fullscreen request failed: ${error instanceof Error ? error.message : String(error)}`;
    diagnostics.compilerLog = `[fullscreen] ${diagnostics.warning}`;
    refreshRuntime();
    sendTelemetry(performance.now(), true);
  }
}

function compileShader(type, source, statusKey, label) {
  const shader = gl.createShader(type);
  if (!shader) {
    diagnostics[statusKey] = 'Create failed';
    throw new Error(`${label} shader could not be created.`);
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) || 'No compiler log was returned.';
    gl.deleteShader(shader);
    diagnostics[statusKey] = 'Compile failed';
    throw new Error(`${label} shader compile error:\n${info}`);
  }

  diagnostics[statusKey] = 'Compiled';
  return shader;
}

function buildCandidateProgram(fragmentSource) {
  diagnostics.vertexStatus = 'Compiling';
  diagnostics.fragmentStatus = 'Waiting';
  diagnostics.linkStatus = 'Waiting';

  let vertexShader = null;
  let fragmentShader = null;
  let candidate = null;

  try {
    vertexShader = compileShader(
      gl.VERTEX_SHADER,
      VERTEX_SHADER_SOURCE,
      'vertexStatus',
      'Vertex'
    );

    diagnostics.fragmentStatus = 'Compiling';
    fragmentShader = compileShader(
      gl.FRAGMENT_SHADER,
      fragmentSource,
      'fragmentStatus',
      'Fragment'
    );

    candidate = gl.createProgram();
    if (!candidate) {
      diagnostics.linkStatus = 'Create failed';
      throw new Error('WebGL program could not be created.');
    }

    gl.attachShader(candidate, vertexShader);
    gl.attachShader(candidate, fragmentShader);
    diagnostics.linkStatus = 'Linking';
    gl.linkProgram(candidate);

    if (!gl.getProgramParameter(candidate, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(candidate) || 'No linker log was returned.';
      diagnostics.linkStatus = 'Link failed';
      throw new Error(`Program link error:\n${info}`);
    }

    const attributeLocation = gl.getAttribLocation(candidate, 'a_position');
    if (attributeLocation < 0) {
      diagnostics.linkStatus = 'Attribute missing';
      throw new Error('The linked program does not expose the required a_position attribute.');
    }

    diagnostics.linkStatus = 'Linked';
    return { program: candidate, attributeLocation };
  } catch (error) {
    if (candidate) gl.deleteProgram(candidate);
    throw error;
  } finally {
    if (vertexShader) gl.deleteShader(vertexShader);
    if (fragmentShader) gl.deleteShader(fragmentShader);
  }
}

function activateShaderSource(fragmentSource, sourceName, revision) {
  const candidate = buildCandidateProgram(fragmentSource);
  const previousProgram = program;
  const previousAttribute = positionAttributeLocation;

  program = candidate.program;
  positionAttributeLocation = candidate.attributeLocation;
  uniformLocations.clear();

  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  if (previousAttribute >= 0 && previousAttribute !== positionAttributeLocation) {
    gl.disableVertexAttribArray(previousAttribute);
  }
  gl.enableVertexAttribArray(positionAttributeLocation);
  gl.vertexAttribPointer(positionAttributeLocation, 2, gl.FLOAT, false, 0, 0);

  if (previousProgram) gl.deleteProgram(previousProgram);

  activeShaderName = sourceName;
  activeShaderRevision = revision;
  ui.shaderLabel.textContent = sourceName;
  diagnostics.sourceStatus = 'Active';
  diagnostics.warning = '';
  diagnostics.fatalError = '';
  diagnostics.compilerLog = [
    `[source] ${sourceName}`,
    '[vertex] compiled',
    '[fragment] compiled',
    '[program] linked',
    '[active] Validated program is now rendering.',
  ].join('\n');
  ui.rendererNotice.hidden = true;
  ui.rendererError.hidden = true;
  refreshRuntime();

  if (!animationFrameId) {
    previousFrameTime = performance.now();
    fpsWindowStart = previousFrameTime;
    animationFrameId = requestAnimationFrame(render);
  }
}

function sendShaderResult({ accepted, name, revision, error = '' }) {
  sendMessage({
    type: 'shader_result',
    role: 'canvas',
    accepted,
    name,
    revision,
    activeShaderName,
    activeShaderRevision,
    sourceStatus: diagnostics.sourceStatus,
    vertexStatus: diagnostics.vertexStatus,
    fragmentStatus: diagnostics.fragmentStatus,
    linkStatus: diagnostics.linkStatus,
    compilerLog: diagnostics.compilerLog,
    error,
  });
}

function showRejectedShader(name, revision, error) {
  const message = error instanceof Error ? error.message : String(error);
  diagnostics.sourceStatus = 'Rejected';
  diagnostics.warning = message;
  diagnostics.compilerLog = [
    `[rejected] ${name}`,
    '[preserved] Previous valid program remains active.',
    '',
    message,
  ].join('\n');
  ui.rendererNotice.hidden = false;
  ui.rendererNoticeMessage.textContent = `${name} failed validation. ${activeShaderName} remains active.`;
  refreshRuntime();
  sendShaderResult({ accepted: false, name, revision, error: message });
  sendTelemetry(performance.now(), true);
}

function handleShaderCandidate(message) {
  const name = typeof message.name === 'string' && message.name.trim()
    ? message.name.trim()
    : 'unnamed.frag';
  const revision = Number.isFinite(Number(message.revision)) ? Number(message.revision) : 0;
  const sourceBytes = new Blob([message.source]).size;

  if (sourceBytes > MAX_SHADER_BYTES) {
    showRejectedShader(name, revision, new Error('Shader source exceeds the 1 MiB limit.'));
    return;
  }

  if (program && revision === activeShaderRevision && name === activeShaderName) {
    diagnostics.sourceStatus = 'Active';
    diagnostics.compilerLog = [
      `[source] ${name}`,
      '[sync] This validated revision is already active.',
    ].join('\n');
    sendShaderResult({ accepted: true, name, revision });
    sendTelemetry(performance.now(), true);
    return;
  }

  diagnostics.sourceStatus = 'Validating';
  diagnostics.warning = '';
  refreshRuntime();
  sendTelemetry(performance.now(), true);

  try {
    activateShaderSource(message.source, name, revision);
    sendShaderResult({ accepted: true, name, revision });
    sendTelemetry(performance.now(), true);
  } catch (error) {
    if (program) showRejectedShader(name, revision, error);
    else {
      showFatalError(error);
      sendShaderResult({
        accepted: false,
        name,
        revision,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function showFatalError(error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(error);
  diagnostics.fatalError = message;
  diagnostics.sourceStatus = program ? diagnostics.sourceStatus : 'Load failed';
  diagnostics.compilerLog = `[fatal] ${message}`;
  ui.rendererError.hidden = false;
  ui.rendererErrorMessage.textContent = message;
  refreshRuntime();
  sendTelemetry(performance.now(), true);

  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = 0;
  }
}

async function loadDefaultShader() {
  diagnostics.sourceStatus = 'Fetching';
  diagnostics.compilerLog = `[loader] Fetching ${DEFAULT_SHADER_URL}…`;
  refreshRuntime();
  sendTelemetry(performance.now(), true);

  try {
    const response = await fetch(DEFAULT_SHADER_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Could not load ${DEFAULT_SHADER_URL}: HTTP ${response.status}.`);
    const source = await response.text();
    if (new Blob([source]).size > MAX_SHADER_BYTES) throw new Error('Default shader exceeds the 1 MiB limit.');

    // A WebSocket-delivered program may have arrived while fetch() was pending.
    // Never overwrite that newer source with the startup default.
    if (!program) activateShaderSource(source, DEFAULT_SHADER_URL, 0);
  } catch (error) {
    if (!program) showFatalError(error);
  }
}

function getUniformLocation(name) {
  if (!uniformLocations.has(name)) {
    uniformLocations.set(name, gl.getUniformLocation(program, name));
  }
  return uniformLocations.get(name);
}

function setUniform1f(name, value) {
  const location = getUniformLocation(name);
  if (location !== null) gl.uniform1f(location, value);
}

function setUniform2f(name, x, y) {
  const location = getUniformLocation(name);
  if (location !== null) gl.uniform2f(location, x, y);
}

function createFullscreenQuad() {
  const buffer = gl.createBuffer();
  if (!buffer) throw new Error('Fullscreen quad buffer could not be created.');

  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
       1,  1,
    ]),
    gl.STATIC_DRAW
  );
  return buffer;
}

function readRendererName() {
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = debugInfo
    ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
    : gl.getParameter(gl.RENDERER);
  return renderer || 'Unknown WebGL renderer';
}

function resizeCanvasToDisplaySize() {
  const width = Math.max(1, ui.rendererPanel.clientWidth);
  const height = Math.max(1, ui.rendererPanel.clientHeight);
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const drawingWidth = Math.max(1, Math.round(width * pixelRatio));
  const drawingHeight = Math.max(1, Math.round(height * pixelRatio));

  if (ui.canvas.width === drawingWidth && ui.canvas.height === drawingHeight) return false;

  ui.canvas.width = drawingWidth;
  ui.canvas.height = drawingHeight;
  gl.viewport(0, 0, drawingWidth, drawingHeight);
  diagnostics.resolution = `${drawingWidth} × ${drawingHeight}`;
  ui.resolutionLabel.textContent = diagnostics.resolution;
  return true;
}

function updateFps(now) {
  fpsFrameCount += 1;
  const elapsed = now - fpsWindowStart;
  if (elapsed < 500) return;

  diagnostics.fps = (fpsFrameCount * 1000) / elapsed;
  ui.fpsLabel.textContent = `${diagnostics.fps.toFixed(1)} FPS`;
  fpsWindowStart = now;
  fpsFrameCount = 0;
}

function uploadUniforms() {
  setUniform1f('u_time', shaderTime);
  setUniform2f('u_resolution', gl.drawingBufferWidth, gl.drawingBufferHeight);
  setUniform1f('u_hue', params.hue);
  setUniform1f('u_saturation', params.saturation);
  setUniform1f('u_brightness', params.brightness);
  setUniform1f('u_zoom', params.zoom);
  setUniform1f('u_distortion', params.distortion);
  setUniform1f('u_rotate', params.rotate);
  setUniform1f('u_complexity', params.complexity);
  setUniform1f('u_symmetry', params.symmetry);
  setUniform1f('u_glow', params.glow);
  setUniform1f('u_invert', params.invert);
  setUniform1f('u_pulse', params.pulse);
}

function sendTelemetry(now, force = false) {
  if (!force && now - lastTelemetryTime < TELEMETRY_INTERVAL_MS) return;
  lastTelemetryTime = now;
  sendMessage({
    type: 'telemetry',
    role: 'canvas',
    runtime: diagnostics.runtime,
    sourceStatus: diagnostics.sourceStatus,
    vertexStatus: diagnostics.vertexStatus,
    fragmentStatus: diagnostics.fragmentStatus,
    linkStatus: diagnostics.linkStatus,
    renderer: diagnostics.renderer,
    resolution: diagnostics.resolution,
    fps: diagnostics.fps,
    paused,
    activeShaderName,
    activeShaderRevision,
    compilerLog: diagnostics.compilerLog,
    warning: diagnostics.warning,
    fatalError: diagnostics.fatalError,
  });
}

function render(now) {
  const deltaSeconds = Math.min((now - previousFrameTime) / 1000, 0.25);
  previousFrameTime = now;
  if (!paused) shaderTime += deltaSeconds * params.speed;

  resizeCanvasToDisplaySize();
  if (program) {
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.enableVertexAttribArray(positionAttributeLocation);
    gl.vertexAttribPointer(positionAttributeLocation, 2, gl.FLOAT, false, 0, 0);
    uploadUniforms();
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  updateFps(now);
  sendTelemetry(now);
  animationFrameId = requestAnimationFrame(render);
}

function initializeWebGl() {
  gl = ui.canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  });

  if (!gl) throw new Error('WebGL 1 is unavailable in this WebView.');

  ui.canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    showFatalError(new Error('The WebGL context was lost. Restart the example to recreate it.'));
  });

  quadBuffer = createFullscreenQuad();
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.clearColor(0, 0, 0, 1);

  diagnostics.renderer = readRendererName();
  resizeObserver = new ResizeObserver(() => resizeCanvasToDisplaySize());
  resizeObserver.observe(ui.rendererPanel);
  resizeCanvasToDisplaySize();
}

async function initialize() {
  connectWebSocket();
  try {
    initializeWebGl();
    await loadDefaultShader();
  } catch (error) {
    showFatalError(error);
  }
}

document.addEventListener('keydown', (event) => {
  if (event.key.toLowerCase() === 'f') {
    event.preventDefault();
    toggleNativeFullscreen();
  }
});

document.addEventListener('visibilitychange', () => {
  previousFrameTime = performance.now();
});

window.addEventListener('beforeunload', () => {
  window.clearTimeout(reconnectTimer);
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  resizeObserver?.disconnect();
  if (socket) socket.close(1000, 'canvas window closing');
  if (gl && quadBuffer) gl.deleteBuffer(quadBuffer);
  if (gl && program) gl.deleteProgram(program);
});

initialize();
