'use strict';

// Example 02 keeps the complete WebGL pipeline visible in one file:
// parameter state → GLSL source → compilation/linking → quad buffer → uniforms → draw loop.

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
  rendererPanel: document.querySelector('.renderer-panel'),
  runtimeStatus: document.getElementById('runtime-status'),
  runtimeLabel: document.getElementById('runtime-label'),
  vertexStatus: document.getElementById('vertex-status'),
  fragmentStatus: document.getElementById('fragment-status'),
  linkStatus: document.getElementById('link-status'),
  fpsValue: document.getElementById('fps-value'),
  resolutionValue: document.getElementById('resolution-value'),
  hudResolution: document.getElementById('hud-resolution'),
  rendererValue: document.getElementById('renderer-value'),
  errorLog: document.getElementById('error-log'),
  rendererError: document.getElementById('renderer-error'),
  rendererErrorMessage: document.getElementById('renderer-error-message'),
  pauseButton: document.getElementById('pause-button'),
  resetButton: document.getElementById('reset-button'),
  fullscreenButton: document.getElementById('fullscreen-button'),
};

let gl = null;
let program = null;
let quadBuffer = null;
let animationFrameId = 0;
let paused = false;
let shaderTime = 0;
let previousFrameTime = performance.now();
let fpsWindowStart = previousFrameTime;
let fpsFrameCount = 0;
let canvasResizeObserver = null;

const uniformLocations = new Map();

function setRuntimeState(state, label) {
  ui.runtimeStatus.dataset.state = state;
  ui.runtimeLabel.textContent = label;
}

function setDiagnostic(element, text, result = '') {
  element.textContent = text;
  if (result) {
    element.dataset.result = result;
  } else {
    delete element.dataset.result;
  }
}

function reportFatalError(error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(error);
  setRuntimeState('error', 'Error');
  ui.errorLog.hidden = false;
  ui.errorLog.textContent = message;
  ui.rendererError.hidden = false;
  ui.rendererErrorMessage.textContent = message;
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = 0;
  }
}

function compileShader(type, source, statusElement, label) {
  const shader = gl.createShader(type);
  if (!shader) {
    setDiagnostic(statusElement, 'Create failed', 'error');
    throw new Error(`${label} shader could not be created.`);
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) || 'No compiler log was returned.';
    gl.deleteShader(shader);
    setDiagnostic(statusElement, 'Compile failed', 'error');
    throw new Error(`${label} shader compile error:\n${info}`);
  }

  setDiagnostic(statusElement, 'Compiled', 'success');
  return shader;
}

function createProgram(vertexSource, fragmentSource) {
  const vertexShader = compileShader(
    gl.VERTEX_SHADER,
    vertexSource,
    ui.vertexStatus,
    'Vertex'
  );
  const fragmentShader = compileShader(
    gl.FRAGMENT_SHADER,
    fragmentSource,
    ui.fragmentStatus,
    'Fragment'
  );

  const linkedProgram = gl.createProgram();
  if (!linkedProgram) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    setDiagnostic(ui.linkStatus, 'Create failed', 'error');
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
    setDiagnostic(ui.linkStatus, 'Link failed', 'error');
    throw new Error(`Program link error:\n${info}`);
  }

  setDiagnostic(ui.linkStatus, 'Linked', 'success');
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
  if (uniform !== null) {
    gl.uniform1f(uniform, value);
  }
}

function setUniform2f(name, x, y) {
  const uniform = getUniformLocation(name);
  if (uniform !== null) {
    gl.uniform2f(uniform, x, y);
  }
}

function createFullscreenQuad() {
  const buffer = gl.createBuffer();
  if (!buffer) {
    throw new Error('Fullscreen quad buffer could not be created.');
  }

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

  const resolutionText = `${drawingWidth} × ${drawingHeight}`;
  ui.resolutionValue.textContent = resolutionText;
  ui.hudResolution.textContent = resolutionText;
  return true;
}

function updateFps(now) {
  fpsFrameCount += 1;
  const elapsed = now - fpsWindowStart;
  if (elapsed < 500) return;

  const fps = (fpsFrameCount * 1000) / elapsed;
  ui.fpsValue.textContent = fps.toFixed(1);
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

function render(now) {
  const deltaSeconds = Math.min((now - previousFrameTime) / 1000, 0.25);
  previousFrameTime = now;

  if (!paused) {
    shaderTime += deltaSeconds * params.speed;
  }

  resizeCanvasToDisplaySize();

  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  uploadUniforms();
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  updateFps(now);
  animationFrameId = requestAnimationFrame(render);
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
    });
  }

  for (const id of TOGGLE_IDS) {
    const input = document.getElementById(id);
    if (!(input instanceof HTMLInputElement)) {
      throw new Error(`Missing toggle control: ${id}`);
    }

    input.addEventListener('change', () => {
      params[id] = input.checked ? 1 : 0;
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

function setPaused(nextPaused) {
  paused = nextPaused;
  previousFrameTime = performance.now();
  ui.pauseButton.textContent = paused ? 'Resume' : 'Pause';
  ui.pauseButton.setAttribute('aria-pressed', String(paused));
  setRuntimeState(paused ? 'paused' : 'running', paused ? 'Paused' : 'Running');
}

function resetExample() {
  Object.assign(params, DEFAULT_PARAMS);
  shaderTime = 0;
  syncControlsFromParams();
  setPaused(false);
}

async function toggleFullscreen() {
  try {
    const invoke = window.__TAURI__?.core?.invoke;
    if (typeof invoke === 'function') {
      const isFullscreen = await invoke('toggle_fullscreen');
      ui.fullscreenButton.textContent = isFullscreen ? 'Windowed' : 'Fullscreen';
      return;
    }

    if (document.fullscreenElement) {
      await document.exitFullscreen();
      ui.fullscreenButton.textContent = 'Fullscreen';
    } else {
      await document.documentElement.requestFullscreen();
      ui.fullscreenButton.textContent = 'Windowed';
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ui.errorLog.hidden = false;
    ui.errorLog.textContent = `Fullscreen request failed:\n${message}`;
  }
}

function wireActions() {
  ui.pauseButton.addEventListener('click', () => setPaused(!paused));
  ui.resetButton.addEventListener('click', resetExample);
  ui.fullscreenButton.addEventListener('click', toggleFullscreen);

  document.addEventListener('keydown', (event) => {
    const target = event.target;
    const isInteractive = target instanceof HTMLInputElement || target instanceof HTMLButtonElement;
    if (isInteractive) return;

    if (event.code === 'Space') {
      event.preventDefault();
      setPaused(!paused);
    } else if (event.key.toLowerCase() === 'r') {
      event.preventDefault();
      resetExample();
    } else if (event.key.toLowerCase() === 'f') {
      event.preventDefault();
      toggleFullscreen();
    }
  });

  document.addEventListener('visibilitychange', () => {
    previousFrameTime = performance.now();
  });
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

  if (!gl) {
    throw new Error('WebGL 1 is unavailable in this WebView.');
  }

  ui.canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    reportFatalError(new Error('The WebGL context was lost. Restart the example to recreate it.'));
  });

  program = createProgram(VERTEX_SHADER_SOURCE, FRAGMENT_SHADER_SOURCE);
  quadBuffer = createFullscreenQuad();

  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.clearColor(0, 0, 0, 1);

  ui.rendererValue.textContent = readRendererName();
  ui.rendererValue.title = ui.rendererValue.textContent;

  canvasResizeObserver = new ResizeObserver(() => resizeCanvasToDisplaySize());
  canvasResizeObserver.observe(ui.rendererPanel);
  resizeCanvasToDisplaySize();
}

function initialize() {
  try {
    wireControls();
    wireActions();
    syncControlsFromParams();
    initializeWebGl();

    setRuntimeState('running', 'Running');
    previousFrameTime = performance.now();
    fpsWindowStart = previousFrameTime;
    animationFrameId = requestAnimationFrame(render);
  } catch (error) {
    reportFatalError(error);
  }
}

window.addEventListener('beforeunload', () => {
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  canvasResizeObserver?.disconnect();
  if (gl && quadBuffer) gl.deleteBuffer(quadBuffer);
  if (gl && program) gl.deleteProgram(program);
});

initialize();
