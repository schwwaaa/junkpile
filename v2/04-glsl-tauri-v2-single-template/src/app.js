'use strict';

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
const DEFAULT_SHADER_URL = 'shader.frag';
const MAX_SHADER_BYTES = 1024 * 1024;

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
  rendererPanel: document.querySelector('.renderer-panel'),
  runtimeStatus: document.getElementById('runtime-status'),
  runtimeLabel: document.getElementById('runtime-label'),
  sourceStatus: document.getElementById('source-status'),
  vertexStatus: document.getElementById('vertex-status'),
  fragmentStatus: document.getElementById('fragment-status'),
  linkStatus: document.getElementById('link-status'),
  fpsValue: document.getElementById('fps-value'),
  resolutionValue: document.getElementById('resolution-value'),
  rendererValue: document.getElementById('renderer-value'),
  compilerLog: document.getElementById('compiler-log'),
  activeShaderName: document.getElementById('active-shader-name'),
  hudShader: document.getElementById('hud-shader'),
  hudResolution: document.getElementById('hud-resolution'),
  rendererNotice: document.getElementById('renderer-notice'),
  rendererError: document.getElementById('renderer-error'),
  rendererErrorMessage: document.getElementById('renderer-error-message'),
  shaderFileInput: document.getElementById('shader-file-input'),
  loadShaderButton: document.getElementById('load-shader-button'),
  defaultShaderButton: document.getElementById('default-shader-button'),
  pauseButton: document.getElementById('pause-button'),
  resetButton: document.getElementById('reset-button'),
  fullscreenButton: document.getElementById('fullscreen-button'),
};

let gl = null;
let program = null;
let quadBuffer = null;
let positionAttributeLocation = -1;
let animationFrameId = 0;
let canvasResizeObserver = null;
let paused = false;
let shaderTime = 0;
let previousFrameTime = performance.now();
let fpsWindowStart = previousFrameTime;
let fpsFrameCount = 0;
let shaderLoadSequence = 0;

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

function setCompilerLog(state, lines) {
  ui.compilerLog.dataset.state = state;
  ui.compilerLog.textContent = Array.isArray(lines) ? lines.join('\n') : String(lines);
  ui.compilerLog.scrollTop = 0;
}

function setShaderButtonsBusy(isBusy) {
  ui.loadShaderButton.disabled = isBusy;
  ui.defaultShaderButton.disabled = isBusy;
}

function showFatalError(error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(error);
  setRuntimeState('error', 'Renderer error');
  ui.rendererNotice.hidden = true;
  ui.rendererError.hidden = false;
  ui.rendererErrorMessage.textContent = message;
  setCompilerLog('error', [`[fatal] ${message}`]);

  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = 0;
  }
}

function showRejectedShader(sourceName, error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[shader] rejected ${sourceName}:`, error);
  setDiagnostic(ui.sourceStatus, 'Rejected', 'error');
  setRuntimeState('warning', paused ? 'Paused / shader rejected' : 'Running / shader rejected');
  ui.rendererNotice.hidden = false;
  setCompilerLog('error', [
    `[rejected] ${sourceName}`,
    '[preserved] Previous valid program remains active.',
    '',
    message,
  ]);
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

function buildCandidateProgram(fragmentSource) {
  setDiagnostic(ui.vertexStatus, 'Compiling');
  setDiagnostic(ui.fragmentStatus, 'Waiting');
  setDiagnostic(ui.linkStatus, 'Waiting');

  let vertexShader = null;
  let fragmentShader = null;
  let candidate = null;

  try {
    vertexShader = compileShader(
      gl.VERTEX_SHADER,
      VERTEX_SHADER_SOURCE,
      ui.vertexStatus,
      'Vertex'
    );

    setDiagnostic(ui.fragmentStatus, 'Compiling');
    fragmentShader = compileShader(
      gl.FRAGMENT_SHADER,
      fragmentSource,
      ui.fragmentStatus,
      'Fragment'
    );

    candidate = gl.createProgram();
    if (!candidate) {
      setDiagnostic(ui.linkStatus, 'Create failed', 'error');
      throw new Error('WebGL program could not be created.');
    }

    gl.attachShader(candidate, vertexShader);
    gl.attachShader(candidate, fragmentShader);
    setDiagnostic(ui.linkStatus, 'Linking');
    gl.linkProgram(candidate);

    if (!gl.getProgramParameter(candidate, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(candidate) || 'No linker log was returned.';
      setDiagnostic(ui.linkStatus, 'Link failed', 'error');
      throw new Error(`Program link error:\n${info}`);
    }

    const attributeLocation = gl.getAttribLocation(candidate, 'a_position');
    if (attributeLocation < 0) {
      setDiagnostic(ui.linkStatus, 'Attribute missing', 'error');
      throw new Error('The linked program does not expose the required a_position attribute.');
    }

    setDiagnostic(ui.linkStatus, 'Linked', 'success');
    return { program: candidate, attributeLocation };
  } catch (error) {
    if (candidate) {
      gl.deleteProgram(candidate);
    }
    throw error;
  } finally {
    if (vertexShader) gl.deleteShader(vertexShader);
    if (fragmentShader) gl.deleteShader(fragmentShader);
  }
}

function activateShaderSource(fragmentSource, sourceName) {
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

  if (previousProgram) {
    gl.deleteProgram(previousProgram);
  }

  ui.activeShaderName.textContent = sourceName;
  ui.activeShaderName.title = sourceName;
  ui.hudShader.textContent = sourceName;
  setDiagnostic(ui.sourceStatus, 'Active', 'success');
  setRuntimeState(paused ? 'paused' : 'running', paused ? 'Paused' : 'Running');
  ui.rendererNotice.hidden = true;
  ui.rendererError.hidden = true;
  setCompilerLog('success', [
    `[source] ${sourceName}`,
    '[vertex] compiled',
    '[fragment] compiled',
    '[program] linked',
    '[active] validated program is now rendering',
  ]);

  if (!animationFrameId) {
    previousFrameTime = performance.now();
    fpsWindowStart = previousFrameTime;
    animationFrameId = requestAnimationFrame(render);
  }
}

async function loadShaderFromUrl(url, sourceName, isInitial = false) {
  const sequence = ++shaderLoadSequence;
  setShaderButtonsBusy(true);
  setDiagnostic(ui.sourceStatus, 'Fetching');
  setRuntimeState('starting', isInitial ? 'Loading shader' : 'Loading replacement');
  setCompilerLog('idle', [`[loader] Fetching ${sourceName}…`]);

  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Could not load ${url}: HTTP ${response.status}.`);
    }

    const source = await response.text();
    if (sequence !== shaderLoadSequence) return;
    setDiagnostic(ui.sourceStatus, 'Loaded', 'success');
    activateShaderSource(source, sourceName);
  } catch (error) {
    setDiagnostic(ui.sourceStatus, 'Load failed', 'error');
    if (isInitial || !program) {
      showFatalError(error);
    } else {
      showRejectedShader(sourceName, error);
    }
  } finally {
    if (sequence === shaderLoadSequence) {
      setShaderButtonsBusy(false);
    }
  }
}

async function loadShaderFile(file) {
  if (!file) return;

  if (file.size > MAX_SHADER_BYTES) {
    showRejectedShader(file.name, new Error('Shader files are limited to 1 MiB in this focused example.'));
    return;
  }

  const sequence = ++shaderLoadSequence;
  setShaderButtonsBusy(true);
  setDiagnostic(ui.sourceStatus, 'Reading file');
  setRuntimeState('starting', 'Loading replacement');
  setCompilerLog('idle', [`[loader] Reading ${file.name}…`]);

  try {
    const source = await file.text();
    if (sequence !== shaderLoadSequence) return;
    setDiagnostic(ui.sourceStatus, 'Loaded', 'success');
    activateShaderSource(source, file.name);
  } catch (error) {
    setDiagnostic(ui.sourceStatus, 'Read failed', 'error');
    if (!program) {
      showFatalError(error);
    } else {
      showRejectedShader(file.name, error);
    }
  } finally {
    if (sequence === shaderLoadSequence) {
      setShaderButtonsBusy(false);
    }
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
  if (location !== null) {
    gl.uniform1f(location, value);
  }
}

function setUniform2f(name, x, y) {
  const location = getUniformLocation(name);
  if (location !== null) {
    gl.uniform2f(location, x, y);
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

  if (program) {
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.enableVertexAttribArray(positionAttributeLocation);
    gl.vertexAttribPointer(positionAttributeLocation, 2, gl.FLOAT, false, 0, 0);
    uploadUniforms();
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

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

  if (program) {
    setRuntimeState(paused ? 'paused' : 'running', paused ? 'Paused' : 'Running');
  }
}

function resetExample() {
  Object.assign(params, DEFAULT_PARAMS);
  shaderTime = 0;
  syncControlsFromParams();
  setPaused(false);
}

async function restoreDefaultShader() {
  if (ui.defaultShaderButton.disabled) return;
  await loadShaderFromUrl(DEFAULT_SHADER_URL, DEFAULT_SHADER_URL, false);
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
    setCompilerLog('error', [`[fullscreen] ${message}`]);
  }
}

function openShaderPicker() {
  if (ui.loadShaderButton.disabled) return;
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

  ui.pauseButton.addEventListener('click', () => setPaused(!paused));
  ui.resetButton.addEventListener('click', resetExample);
  ui.fullscreenButton.addEventListener('click', toggleFullscreen);

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
      setPaused(!paused);
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
    showFatalError(new Error('The WebGL context was lost. Restart the example to recreate it.'));
  });

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

async function initialize() {
  try {
    wireControls();
    wireActions();
    syncControlsFromParams();
    initializeWebGl();
    await loadShaderFromUrl(DEFAULT_SHADER_URL, DEFAULT_SHADER_URL, true);
  } catch (error) {
    showFatalError(error);
  }
}

window.addEventListener('beforeunload', () => {
  shaderLoadSequence += 1;
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  canvasResizeObserver?.disconnect();
  if (gl && quadBuffer) gl.deleteBuffer(quadBuffer);
  if (gl && program) gl.deleteProgram(program);
});

initialize();
