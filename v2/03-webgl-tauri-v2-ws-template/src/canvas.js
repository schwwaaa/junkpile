'use strict';

const WS_URL = 'ws://127.0.0.1:2727';
const RECONNECT_DELAY_MS = 1200;
const TELEMETRY_INTERVAL_MS = 500;

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

const FRAGMENT_SHADER_SOURCE = `
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
    vec3 rgb = clamp(
      abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0,
      0.0,
      1.0
    );
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
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;
    float octave = 0.0;

    for (int i = 0; i < 8; i++) {
      if (octave >= u_complexity) break;
      value += amplitude * vnoise(p * frequency);
      frequency *= 2.0;
      amplitude *= 0.5;
      octave += 1.0;
    }

    return value;
  }

  mat2 rotate2D(float angle) {
    return mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
  }

  void main() {
    vec2 uv = vTexCoord - 0.5;
    uv.x *= u_resolution.x / u_resolution.y;
    uv *= u_zoom;

    uv = rotate2D(u_time * 0.15 * u_rotate) * uv;

    float warpTime = u_time * 0.3;
    vec2 warpedUv = uv + u_distortion * 2.0 * vec2(
      fbm(uv + vec2(warpTime, 0.0)) - 0.5,
      fbm(uv + vec2(0.0, warpTime)) - 0.5
    );

    float angle = atan(warpedUv.y, warpedUv.x);
    float radius = length(warpedUv);
    float sector = 6.28318 / u_symmetry;
    angle = mod(angle + 3.14159, sector) - sector * 0.5;
    vec2 symmetricUv = vec2(cos(angle), sin(angle)) * radius;

    float time = u_time * 0.5;
    float pattern =
      fbm(symmetricUv * 2.0 + vec2(time, time * 0.7)) * 0.5 +
      fbm(symmetricUv * 3.0 + vec2(-time * 0.8, time)) * 0.3 +
      fbm(symmetricUv * 1.5 + vec2(time * 0.3, -time)) * 0.2;

    pattern *= 1.0 + u_glow * (1.0 - smoothstep(0.0, 0.8, radius));

    float pulseValue = 1.0 + 0.15 * sin(u_time * 2.5);
    pattern *= mix(1.0, pulseValue, u_pulse);

    float hue = mod(
      (u_hue / 360.0) + pattern * 0.5 + u_time * 0.05,
      1.0
    );

    vec3 color = hsb2rgb(
      hue,
      u_saturation,
      clamp(pattern * u_brightness, 0.0, 1.5)
    );

    color = mix(color, 1.0 - color, u_invert);
    gl_FragColor = vec4(color, 1.0);
  }
`;

const ui = {
  canvas: document.getElementById('gl-canvas'),
  rendererPanel: document.getElementById('renderer-panel'),
  runtimeLabel: document.getElementById('runtime-label'),
  wsLabel: document.getElementById('ws-label'),
  fpsLabel: document.getElementById('fps-label'),
  resolutionLabel: document.getElementById('resolution-label'),
  rendererError: document.getElementById('renderer-error'),
  rendererErrorMessage: document.getElementById('renderer-error-message'),
};

const diagnostics = {
  runtime: 'starting',
  vertexStatus: 'Pending',
  fragmentStatus: 'Pending',
  linkStatus: 'Pending',
  renderer: 'Detecting…',
  resolution: '—',
  fps: 0,
  error: '',
};

let socket = null;
let reconnectTimer = 0;
let gl = null;
let program = null;
let quadBuffer = null;
let animationFrameId = 0;
let resizeObserver = null;
let paused = false;
let shaderTime = 0;
let previousFrameTime = performance.now();
let fpsWindowStart = previousFrameTime;
let fpsFrameCount = 0;
let lastTelemetryTime = 0;
const uniformLocations = new Map();

function setRuntime(runtime, label) {
  diagnostics.runtime = runtime;
  ui.runtimeLabel.textContent = label;
}

function showFatalError(error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(error);
  diagnostics.error = message;
  setRuntime('error', 'Error');
  ui.rendererError.hidden = false;
  ui.rendererErrorMessage.textContent = message;
  sendTelemetry(performance.now(), true);
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = 0;
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
  )) {
    return;
  }

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
      const message = JSON.parse(event.data);
      applyMessage(message);
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
      setRuntime(paused ? 'paused' : 'running', paused ? 'Paused' : 'Running');
    }

    if (message.resetTime === true) {
      shaderTime = 0;
    }

    sendTelemetry(performance.now(), true);
    return;
  }

  if (message.type === 'action') {
    if (message.name === 'pause') {
      paused = Boolean(message.value);
      previousFrameTime = performance.now();
      setRuntime(paused ? 'paused' : 'running', paused ? 'Paused' : 'Running');
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
    diagnostics.error = `Fullscreen request failed: ${error instanceof Error ? error.message : String(error)}`;
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

function createProgram(vertexSource, fragmentSource) {
  const vertexShader = compileShader(
    gl.VERTEX_SHADER,
    vertexSource,
    'vertexStatus',
    'Vertex'
  );
  const fragmentShader = compileShader(
    gl.FRAGMENT_SHADER,
    fragmentSource,
    'fragmentStatus',
    'Fragment'
  );

  const linkedProgram = gl.createProgram();
  if (!linkedProgram) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    diagnostics.linkStatus = 'Create failed';
    throw new Error('WebGL program could not be created.');
  }

  gl.attachShader(linkedProgram, vertexShader);
  gl.attachShader(linkedProgram, fragmentShader);
  gl.linkProgram(linkedProgram);

  gl.detachShader(linkedProgram, vertexShader);
  gl.detachShader(linkedProgram, fragmentShader);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(linkedProgram, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(linkedProgram) || 'No linker log was returned.';
    gl.deleteProgram(linkedProgram);
    diagnostics.linkStatus = 'Link failed';
    throw new Error(`Program link error:\n${info}`);
  }

  diagnostics.linkStatus = 'Linked';
  return linkedProgram;
}

function getUniformLocation(name) {
  if (!uniformLocations.has(name)) {
    uniformLocations.set(name, gl.getUniformLocation(program, name));
  }
  return uniformLocations.get(name);
}

function setUniform1f(name, value) {
  const uniform = getUniformLocation(name);
  if (uniform !== null) gl.uniform1f(uniform, value);
}

function setUniform2f(name, x, y) {
  const uniform = getUniformLocation(name);
  if (uniform !== null) gl.uniform2f(uniform, x, y);
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

  const positionAttribute = gl.getAttribLocation(program, 'a_position');
  if (positionAttribute < 0) {
    throw new Error('The a_position attribute was not found after linking.');
  }

  gl.enableVertexAttribArray(positionAttribute);
  gl.vertexAttribPointer(positionAttribute, 2, gl.FLOAT, false, 0, 0);
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

  if (ui.canvas.width === drawingWidth && ui.canvas.height === drawingHeight) {
    return false;
  }

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
    vertexStatus: diagnostics.vertexStatus,
    fragmentStatus: diagnostics.fragmentStatus,
    linkStatus: diagnostics.linkStatus,
    renderer: diagnostics.renderer,
    resolution: diagnostics.resolution,
    fps: diagnostics.fps,
    paused,
    error: diagnostics.error,
  });
}

function render(now) {
  const deltaSeconds = Math.min((now - previousFrameTime) / 1000, 0.25);
  previousFrameTime = now;

  if (!paused) shaderTime += deltaSeconds * params.speed;

  resizeCanvasToDisplaySize();
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  uploadUniforms();
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

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

  program = createProgram(VERTEX_SHADER_SOURCE, FRAGMENT_SHADER_SOURCE);
  quadBuffer = createFullscreenQuad();

  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.clearColor(0, 0, 0, 1);

  diagnostics.renderer = readRendererName();
  diagnostics.error = '';
  setRuntime('running', 'Running');

  resizeObserver = new ResizeObserver(() => resizeCanvasToDisplaySize());
  resizeObserver.observe(ui.rendererPanel);
  resizeCanvasToDisplaySize();
}

function initialize() {
  try {
    connectWebSocket();
    initializeWebGl();

    previousFrameTime = performance.now();
    fpsWindowStart = previousFrameTime;
    animationFrameId = requestAnimationFrame(render);
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
