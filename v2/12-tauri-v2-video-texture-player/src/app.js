'use strict';

// =============================================================================
// Junkpile 12 — Tauri v2 Video Texture Player
// Local video frames are uploaded to a WebGL texture, processed by GLSL, and
// rendered through a ping-pong framebuffer so feedback can persist over time.
// =============================================================================

const canvas = document.getElementById('gl-canvas');
const stage = document.getElementById('stage');
const video = document.getElementById('video-source');
const fileInput = document.getElementById('file-input');
const nativeOpenButton = document.getElementById('native-open-button');
const browserOpenButton = document.getElementById('browser-open-button');
const dropZone = document.getElementById('drop-zone');
const dropOverlay = document.getElementById('drop-overlay');
const emptyState = document.getElementById('empty-state');
const sourceState = document.getElementById('source-state');
const fileName = document.getElementById('file-name');
const sourceSize = document.getElementById('source-size');
const durationLabel = document.getElementById('duration-label');
const playButton = document.getElementById('play-button');
const restartButton = document.getElementById('restart-button');
const stepButton = document.getElementById('step-button');
const timeline = document.getElementById('timeline');
const currentTimeLabel = document.getElementById('current-time');
const remainingTimeLabel = document.getElementById('remaining-time');
const fpsLabel = document.getElementById('fps-label');
const renderSizeLabel = document.getElementById('render-size');
const frameLabel = document.getElementById('frame-label');
const decoderLabel = document.getElementById('decoder-label');
const hudState = document.getElementById('hud-state');
const hudSourceFps = document.getElementById('hud-source-fps');
const saveStatus = document.getElementById('save-status');
const snapshotButton = document.getElementById('snapshot-button');
const fullscreenButton = document.getElementById('fullscreen-button');
const clearFeedbackButton = document.getElementById('clear-feedback-button');

const tauriCore = window.__TAURI__?.core ?? null;
const invoke = tauriCore?.invoke?.bind(tauriCore) ?? null;
const convertFileSrc = tauriCore?.convertFileSrc?.bind(tauriCore) ?? null;
const tauriDialog = window.__TAURI__?.dialog ?? null;
const tauriWebview = window.__TAURI__?.webview ?? null;

const gl = canvas.getContext('webgl', {
  alpha: false,
  antialias: false,
  depth: false,
  stencil: false,
  preserveDrawingBuffer: true,
  powerPreference: 'high-performance'
});

if (!gl) {
  sourceState.textContent = 'WebGL unavailable';
  sourceState.className = 'status-pill error';
  throw new Error('WebGL is unavailable in this WebView');
}

const VERTEX_SHADER = `
precision highp float;
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const EFFECT_SHADER = `
precision highp float;

uniform sampler2D u_video;
uniform sampler2D u_previous;
uniform vec2 u_resolution;
uniform float u_videoAspect;
uniform float u_hasVideo;
uniform float u_time;
uniform float u_fitMode;
uniform float u_zoom;
uniform float u_rotation;
uniform float u_mirrorX;
uniform float u_mirrorY;
uniform float u_effect;
uniform float u_amount;
uniform float u_speed;
uniform float u_feedback;
uniform float u_feedbackZoom;
uniform float u_hue;
uniform float u_saturation;
uniform float u_brightness;
uniform float u_contrast;

varying vec2 v_uv;

float luma(vec3 color) {
  return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

vec2 rotate2D(vec2 point, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return mat2(c, -s, s, c) * point;
}

vec3 rotateHue(vec3 color, float degrees) {
  float angle = radians(degrees);
  float c = cos(angle);
  float s = sin(angle);
  float oneThird = 1.0 / 3.0;
  float rootThird = sqrt(oneThird);
  mat3 matrix = mat3(
    c + (1.0 - c) * oneThird,
    (1.0 - c) * oneThird - rootThird * s,
    (1.0 - c) * oneThird + rootThird * s,
    (1.0 - c) * oneThird + rootThird * s,
    c + (1.0 - c) * oneThird,
    (1.0 - c) * oneThird - rootThird * s,
    (1.0 - c) * oneThird - rootThird * s,
    (1.0 - c) * oneThird + rootThird * s,
    c + (1.0 - c) * oneThird
  );
  return clamp(matrix * color, 0.0, 1.0);
}

vec2 mapVideoUV(vec2 uv) {
  vec2 mapped = uv;
  if (u_mirrorX > 0.5) mapped.x = 1.0 - mapped.x;
  if (u_mirrorY > 0.5) mapped.y = 1.0 - mapped.y;

  vec2 centered = mapped - 0.5;
  centered = rotate2D(centered, radians(u_rotation));
  centered /= max(u_zoom, 0.001);

  if (u_fitMode < 0.5) {
    float canvasAspect = u_resolution.x / max(u_resolution.y, 1.0);
    if (canvasAspect > u_videoAspect) {
      centered.x *= canvasAspect / max(u_videoAspect, 0.001);
    } else {
      centered.y *= u_videoAspect / max(canvasAspect, 0.001);
    }
  } else if (u_fitMode < 1.5) {
    float canvasAspect = u_resolution.x / max(u_resolution.y, 1.0);
    if (canvasAspect > u_videoAspect) {
      centered.y *= u_videoAspect / max(canvasAspect, 0.001);
    } else {
      centered.x *= canvasAspect / max(u_videoAspect, 0.001);
    }
  }

  return centered + 0.5;
}

vec3 sampleVideo(vec2 uv) {
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    return vec3(0.0);
  }
  return texture2D(u_video, uv).rgb;
}

float sobel(vec2 uv) {
  vec2 pixel = 1.0 / max(u_resolution, vec2(1.0));
  float tl = luma(sampleVideo(uv + pixel * vec2(-1.0, 1.0)));
  float tc = luma(sampleVideo(uv + pixel * vec2(0.0, 1.0)));
  float tr = luma(sampleVideo(uv + pixel * vec2(1.0, 1.0)));
  float ml = luma(sampleVideo(uv + pixel * vec2(-1.0, 0.0)));
  float mr = luma(sampleVideo(uv + pixel * vec2(1.0, 0.0)));
  float bl = luma(sampleVideo(uv + pixel * vec2(-1.0, -1.0)));
  float bc = luma(sampleVideo(uv + pixel * vec2(0.0, -1.0)));
  float br = luma(sampleVideo(uv + pixel * vec2(1.0, -1.0)));
  float gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
  float gy = tl + 2.0 * tc + tr - bl - 2.0 * bc - br;
  return clamp(length(vec2(gx, gy)) * 2.4, 0.0, 1.0);
}

vec3 placeholder(vec2 uv) {
  vec2 p = uv - 0.5;
  float radius = length(p);
  float ring = 0.5 + 0.5 * cos(radius * 44.0 - u_time * 1.2);
  float grid = step(0.965, max(abs(sin(uv.x * 42.0)), abs(sin(uv.y * 42.0))));
  vec3 base = mix(vec3(0.015, 0.018, 0.025), vec3(0.08, 0.11, 0.2), ring * 0.22);
  return base + vec3(0.08, 0.11, 0.23) * grid * 0.18;
}

vec3 applyEffect(vec2 uv) {
  float t = u_time * u_speed;

  if (u_effect < 0.5) {
    return sampleVideo(uv);
  }

  if (u_effect < 1.5) {
    vec2 warped = uv + vec2(
      sin(uv.y * 13.0 + t * 2.0),
      cos(uv.x * 11.0 - t * 1.7)
    ) * u_amount * 0.055;
    return sampleVideo(warped);
  }

  if (u_effect < 2.5) {
    vec2 p = uv - 0.5;
    float radius = length(p);
    float angle = atan(p.y, p.x);
    radius += sin(radius * 18.0 - t * 2.0) * u_amount * 0.08;
    angle += u_amount * sin(radius * 8.0 + t) * 0.35;
    return sampleVideo(vec2(cos(angle), sin(angle)) * radius + 0.5);
  }

  if (u_effect < 3.5) {
    vec2 p = uv - 0.5;
    float radius = length(p);
    float angle = atan(p.y, p.x);
    float sectors = mix(3.0, 12.0, u_amount);
    float sector = 6.28318530718 / sectors;
    angle = mod(angle, sector);
    angle = abs(angle - sector * 0.5);
    angle += t * 0.15;
    return sampleVideo(vec2(cos(angle), sin(angle)) * radius + 0.5);
  }

  if (u_effect < 4.5) {
    float edge = sobel(uv);
    vec3 original = sampleVideo(uv);
    return mix(original * 0.12, vec3(edge), 0.45 + u_amount * 0.55);
  }

  if (u_effect < 5.5) {
    float band = floor(uv.y * mix(18.0, 90.0, u_amount));
    float frame = floor(t * 12.0);
    float random = hash11(band + frame * 31.0);
    float active = step(0.72, random);
    float shift = (random - 0.5) * active * u_amount * 0.34;
    float red = sampleVideo(uv + vec2(shift + u_amount * 0.008, 0.0)).r;
    float green = sampleVideo(uv + vec2(shift, 0.0)).g;
    float blue = sampleVideo(uv + vec2(shift - u_amount * 0.008, 0.0)).b;
    return vec3(red, green, blue);
  }

  if (u_effect < 6.5) {
    float blocks = mix(240.0, 12.0, u_amount);
    vec2 quantized = (floor(uv * blocks) + 0.5) / blocks;
    return sampleVideo(quantized);
  }

  float split = u_amount * 0.035;
  float red = sampleVideo(uv + vec2(split, 0.0)).r;
  float green = sampleVideo(uv).g;
  float blue = sampleVideo(uv - vec2(split, 0.0)).b;
  return vec3(red, green, blue);
}

void main() {
  vec2 uv = mapVideoUV(v_uv);
  vec3 color = u_hasVideo > 0.5 ? applyEffect(uv) : placeholder(v_uv);

  if (u_feedback > 0.001) {
    vec2 feedbackUV = (v_uv - 0.5) / max(u_feedbackZoom, 0.001) + 0.5;
    vec3 previous = texture2D(u_previous, feedbackUV).rgb;
    color = mix(color, previous, u_feedback);
  }

  color = rotateHue(color, u_hue);
  color = mix(vec3(luma(color)), color, u_saturation);
  color *= u_brightness;
  color = (color - 0.5) * u_contrast + 0.5;
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

const DISPLAY_SHADER = `
precision highp float;
uniform sampler2D u_texture;
varying vec2 v_uv;
void main() {
  gl_FragColor = texture2D(u_texture, v_uv);
}
`;

function compileShader(type, source, label) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'unknown shader error';
    gl.deleteShader(shader);
    throw new Error(`${label}: ${message}`);
  }
  return shader;
}

function createProgram(fragmentSource, label) {
  const program = gl.createProgram();
  const vertex = compileShader(gl.VERTEX_SHADER, VERTEX_SHADER, `${label} vertex shader`);
  const fragment = compileShader(gl.FRAGMENT_SHADER, fragmentSource, `${label} fragment shader`);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || 'unknown program link error';
    gl.deleteProgram(program);
    throw new Error(`${label}: ${message}`);
  }
  return program;
}

const effectProgram = createProgram(EFFECT_SHADER, 'effect program');
const displayProgram = createProgram(DISPLAY_SHADER, 'display program');

const quadBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
  -1, -1,
   1, -1,
  -1,  1,
   1,  1
]), gl.STATIC_DRAW);

function bindQuad(program) {
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  const location = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
}

function uniform1f(program, name, value) {
  const location = gl.getUniformLocation(program, name);
  if (location !== null) gl.uniform1f(location, value);
}

function uniform2f(program, name, x, y) {
  const location = gl.getUniformLocation(program, name);
  if (location !== null) gl.uniform2f(location, x, y);
}

function uniform1i(program, name, value) {
  const location = gl.getUniformLocation(program, name);
  if (location !== null) gl.uniform1i(location, value);
}

function createTexture() {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

const videoTexture = createTexture();
gl.texImage2D(
  gl.TEXTURE_2D,
  0,
  gl.RGBA,
  1,
  1,
  0,
  gl.RGBA,
  gl.UNSIGNED_BYTE,
  new Uint8Array([0, 0, 0, 255])
);

let feedbackTextures = [];
let feedbackFramebuffers = [];
let feedbackIndex = 0;
let framebufferWidth = 0;
let framebufferHeight = 0;

function destroyFeedbackTargets() {
  for (const framebuffer of feedbackFramebuffers) gl.deleteFramebuffer(framebuffer);
  for (const texture of feedbackTextures) gl.deleteTexture(texture);
  feedbackFramebuffers = [];
  feedbackTextures = [];
}

function createFeedbackTargets(width, height) {
  destroyFeedbackTargets();
  framebufferWidth = width;
  framebufferHeight = height;

  for (let index = 0; index < 2; index += 1) {
    const texture = createTexture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('Could not create a complete feedback framebuffer');
    }

    feedbackTextures.push(texture);
    feedbackFramebuffers.push(framebuffer);
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  feedbackIndex = 0;
  clearFeedback();
}

function clearFeedback() {
  for (const framebuffer of feedbackFramebuffers) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(0, 0, framebufferWidth, framebufferHeight);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

const params = {
  fitMode: 1,
  zoom: 1,
  rotation: 0,
  mirrorX: 0,
  mirrorY: 0,
  effect: 0,
  amount: 0.35,
  speed: 0.55,
  feedback: 0,
  feedbackZoom: 1.002,
  hue: 0,
  saturation: 1,
  brightness: 1,
  contrast: 1
};

let objectUrl = null;
let hasVideo = false;
let timelineDragging = false;
let lastVideoTime = -1;
let latestUploadedTime = -1;
let videoFrameDirty = false;
let dragDepth = 0;
let nativeDropInstalled = false;
let presentedFrames = 0;
let estimatedSourceFps = 0;
let previousFrameMediaTime = null;
let frameCallbackGeneration = 0;
let currentSourceName = 'video-frame';

function setSaveStatus(message, kind = '') {
  saveStatus.textContent = message;
  saveStatus.className = `save-status ${kind}`.trim();
}

function setSourceStatus(text, className) {
  sourceState.textContent = text;
  sourceState.className = `status-pill ${className}`;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00.000';
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(3).padStart(6, '0')}`;
}

function updateTransportLabels() {
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const current = Number.isFinite(video.currentTime) ? video.currentTime : 0;
  if (!timelineDragging) timeline.value = duration > 0 ? String(current / duration) : '0';
  currentTimeLabel.textContent = formatTime(current);
  remainingTimeLabel.textContent = `−${formatTime(Math.max(0, duration - current))}`;
}

function setTransportEnabled(enabled) {
  playButton.disabled = !enabled;
  restartButton.disabled = !enabled;
  stepButton.disabled = !enabled;
  timeline.disabled = !enabled;
}

function isVideoFile(file) {
  if (!file) return false;
  if (file.type?.startsWith('video/')) return true;
  return /\.(mp4|mov|m4v|webm|mkv|avi|ogv)$/i.test(file.name || '');
}

function isVideoPath(path) {
  return /\.(mp4|mov|m4v|webm|mkv|avi|ogv)$/i.test(String(path || ''));
}

function setDropVisualState(active) {
  dropZone.classList.toggle('dragging', active);
  dropOverlay.classList.toggle('visible', active);
}

function resetFrameTelemetry() {
  presentedFrames = 0;
  estimatedSourceFps = 0;
  previousFrameMediaTime = null;
  frameLabel.textContent = '0 frames';
  hudSourceFps.textContent = 'source — fps';
}

function beginVideoFrameTracking() {
  frameCallbackGeneration += 1;
  const generation = frameCallbackGeneration;
  resetFrameTelemetry();

  if (typeof video.requestVideoFrameCallback !== 'function') {
    decoderLabel.textContent = 'timeupdate fallback';
    return;
  }

  const onFrame = (_now, metadata) => {
    if (generation !== frameCallbackGeneration || !hasVideo) return;
    videoFrameDirty = true;
    presentedFrames = Number(metadata.presentedFrames || presentedFrames + 1);
    const mediaTime = Number(metadata.mediaTime);
    if (Number.isFinite(mediaTime) && previousFrameMediaTime !== null) {
      const delta = mediaTime - previousFrameMediaTime;
      if (delta > 0.0001 && delta < 1) {
        const instantaneous = 1 / delta;
        estimatedSourceFps = estimatedSourceFps > 0
          ? estimatedSourceFps * 0.88 + instantaneous * 0.12
          : instantaneous;
      }
    }
    if (Number.isFinite(mediaTime)) previousFrameMediaTime = mediaTime;
    frameLabel.textContent = `${presentedFrames} frames`;
    hudSourceFps.textContent = estimatedSourceFps > 0
      ? `source ${estimatedSourceFps.toFixed(1)} fps`
      : 'source decoding';
    decoderLabel.textContent = 'requestVideoFrameCallback';
    video.requestVideoFrameCallback(onFrame);
  };

  video.requestVideoFrameCallback(onFrame);
}

async function loadVideoSource({ url, name, sizeBytes = 0, revokeOnReplace = false, origin = 'browser' }) {
  video.pause();
  hasVideo = false;
  frameCallbackGeneration += 1;
  setTransportEnabled(false);
  setSourceStatus('Loading', 'loading');
  playButton.textContent = 'Play';
  hudState.textContent = 'LOADING';

  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = revokeOnReplace ? url : null;
  currentSourceName = (name || 'video-frame').replace(/\.[^.]+$/, '') || 'video-frame';
  latestUploadedTime = -1;
  videoFrameDirty = true;
  resetFrameTelemetry();

  video.removeAttribute('src');
  video.load();
  video.src = url;
  video.load();

  fileName.textContent = name || 'Local video';
  sourceSize.textContent = sizeBytes > 0 ? `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB` : 'Inspecting…';
  decoderLabel.textContent = origin === 'native' ? 'Tauri asset protocol' : 'Blob URL';
  emptyState.classList.remove('hidden');

  try {
    await new Promise((resolve, reject) => {
      const onLoaded = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error(video.error?.message || 'The WebView could not decode this video'));
      };
      const cleanup = () => {
        video.removeEventListener('loadedmetadata', onLoaded);
        video.removeEventListener('error', onError);
      };
      video.addEventListener('loadedmetadata', onLoaded, { once: true });
      video.addEventListener('error', onError, { once: true });
    });

    hasVideo = true;
    latestUploadedTime = -1;
    videoFrameDirty = true;
    durationLabel.textContent = formatTime(video.duration);
    const sizePart = sizeBytes > 0 ? ` · ${(sizeBytes / (1024 * 1024)).toFixed(1)} MB` : '';
    sourceSize.textContent = `${video.videoWidth} × ${video.videoHeight}${sizePart}`;
    timeline.value = '0';
    setTransportEnabled(true);
    setSourceStatus('Ready', 'ready');
    hudState.textContent = 'READY';
    emptyState.classList.add('hidden');
    clearFeedback();
    updateTransportLabels();
    beginVideoFrameTracking();
    setSaveStatus(`${origin === 'native' ? 'Native' : 'Browser'} source loaded`, 'success');
  } catch (error) {
    console.error(error);
    hasVideo = false;
    setSourceStatus('Decode error', 'error');
    durationLabel.textContent = 'Unsupported';
    decoderLabel.textContent = error.message;
    hudState.textContent = 'DECODE ERROR';
    emptyState.classList.remove('hidden');
    setSaveStatus(error.message, 'error');
  }
}

async function loadBrowserFile(file) {
  if (!isVideoFile(file)) {
    setSourceStatus('Not a video', 'error');
    setSaveStatus('The dropped file does not look like a supported video.', 'error');
    return;
  }
  const url = URL.createObjectURL(file);
  await loadVideoSource({
    url,
    name: file.name,
    sizeBytes: file.size,
    revokeOnReplace: true,
    origin: 'browser'
  });
}

async function loadNativePath(path, originLabel = 'native') {
  if (!invoke || !convertFileSrc) {
    throw new Error('Native file loading requires the Tauri runtime');
  }
  if (!isVideoPath(path)) {
    throw new Error('The dropped path does not look like a supported video file');
  }
  const selected = await invoke('inspect_video_file', { path });
  await loadVideoSource({
    url: convertFileSrc(selected.path),
    name: selected.name,
    sizeBytes: Number(selected.sizeBytes || 0),
    revokeOnReplace: false,
    origin: originLabel
  });
}

nativeOpenButton.addEventListener('click', async () => {
  if (!invoke || !convertFileSrc || !tauriDialog?.open) {
    fileInput.click();
    return;
  }
  nativeOpenButton.disabled = true;
  setSaveStatus('Opening native file dialog…');
  try {
    const path = await tauriDialog.open({
      multiple: false,
      directory: false,
      title: 'Open a video texture',
      filters: [{
        name: 'Video',
        extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'ogv']
      }]
    });
    if (!path || Array.isArray(path)) {
      setSaveStatus('Open cancelled');
      return;
    }
    await loadNativePath(path, 'native');
  } catch (error) {
    console.error(error);
    setSourceStatus('Open failed', 'error');
    setSaveStatus(String(error), 'error');
  } finally {
    nativeOpenButton.disabled = false;
  }
});

browserOpenButton.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const [file] = fileInput.files || [];
  if (file) loadBrowserFile(file);
  fileInput.value = '';
});

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    fileInput.click();
  }
});

// Browser drag/drop remains useful when the frontend runs outside Tauri.
// In the desktop app, Tauri intercepts operating-system file drops and exposes
// their native paths through Webview.onDragDropEvent instead.
document.addEventListener('dragenter', (event) => {
  event.preventDefault();
  dragDepth += 1;
  setDropVisualState(true);
});
document.addEventListener('dragover', (event) => {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
});
document.addEventListener('dragleave', (event) => {
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) setDropVisualState(false);
});
document.addEventListener('drop', (event) => {
  event.preventDefault();
  dragDepth = 0;
  setDropVisualState(false);
  if (nativeDropInstalled) return;
  const files = Array.from(event.dataTransfer?.files || []);
  const file = files.find(isVideoFile);
  if (file) void loadBrowserFile(file);
  else if (!tauriWebview?.getCurrentWebview) {
    setSaveStatus('No supported video file was found in the drop.', 'error');
  }
});

async function installNativeDropHandler() {
  if (!tauriWebview?.getCurrentWebview) return;
  try {
    const currentWebview = tauriWebview.getCurrentWebview();
    await currentWebview.onDragDropEvent((event) => {
      const payload = event.payload || {};
      if (payload.type === 'over' || payload.type === 'enter') {
        setDropVisualState(true);
        return;
      }
      if (payload.type === 'drop') {
        setDropVisualState(false);
        const path = Array.from(payload.paths || []).find(isVideoPath);
        if (!path) {
          setSaveStatus('No supported video file was found in the drop.', 'error');
          return;
        }
        setSaveStatus('Opening dropped video…');
        void loadNativePath(path, 'native')
          .then(() => setSaveStatus('Dropped video loaded', 'success'))
          .catch((error) => {
            console.error(error);
            setSourceStatus('Drop failed', 'error');
            setSaveStatus(String(error), 'error');
          });
        return;
      }
      setDropVisualState(false);
    });
    nativeDropInstalled = true;
  } catch (error) {
    console.error('Could not install native drag/drop handler', error);
    setSaveStatus(`Native drop unavailable: ${error}`, 'error');
  }
}

void installNativeDropHandler();

playButton.addEventListener('click', async () => {
  if (!hasVideo) return;
  if (video.paused) {
    try {
      await video.play();
    } catch (error) {
      console.error(error);
      setSourceStatus('Playback blocked', 'error');
    }
  } else {
    video.pause();
  }
});

restartButton.addEventListener('click', () => {
  if (!hasVideo) return;
  video.currentTime = 0;
  clearFeedback();
});

stepButton.addEventListener('click', () => {
  if (!hasVideo) return;
  video.pause();
  video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 1 / Math.max(1, estimatedSourceFps || 30));
  videoFrameDirty = true;
});

video.addEventListener('play', () => {
  playButton.textContent = 'Pause';
  setSourceStatus('Playing', 'playing');
  hudState.textContent = 'PLAYING';
});
video.addEventListener('pause', () => {
  playButton.textContent = 'Play';
  if (hasVideo) {
    setSourceStatus('Ready', 'ready');
    hudState.textContent = 'PAUSED';
  }
});
video.addEventListener('ended', () => {
  playButton.textContent = 'Play';
  if (hasVideo) setSourceStatus('Ready', 'ready');
  hudState.textContent = 'ENDED';
});
video.addEventListener('timeupdate', updateTransportLabels);
video.addEventListener('durationchange', updateTransportLabels);

timeline.addEventListener('pointerdown', () => { timelineDragging = true; });
timeline.addEventListener('input', () => {
  if (!hasVideo || !Number.isFinite(video.duration)) return;
  const preview = Number(timeline.value) * video.duration;
  currentTimeLabel.textContent = formatTime(preview);
  remainingTimeLabel.textContent = `−${formatTime(Math.max(0, video.duration - preview))}`;
});
function commitTimeline() {
  if (hasVideo && Number.isFinite(video.duration)) {
    video.currentTime = Number(timeline.value) * video.duration;
  }
  timelineDragging = false;
}
timeline.addEventListener('change', commitTimeline);
timeline.addEventListener('pointerup', commitTimeline);
timeline.addEventListener('pointercancel', () => { timelineDragging = false; });

function bindRange(id, param, format) {
  const input = document.getElementById(id);
  const output = document.getElementById(`${id}-output`);
  const apply = () => {
    const value = Number(input.value);
    if (param) params[param] = value;
    if (output) output.value = format(value);
  };
  input.addEventListener('input', apply);
  apply();
  return input;
}

const rateInput = bindRange('rate', null, (value) => `${value.toFixed(2)}×`);
rateInput.addEventListener('input', () => { video.playbackRate = Number(rateInput.value); });
video.playbackRate = Number(rateInput.value);

const volumeInput = bindRange('volume', null, (value) => `${Math.round(value * 100)}%`);
volumeInput.addEventListener('input', () => { video.volume = Number(volumeInput.value); });
video.volume = Number(volumeInput.value);

bindRange('zoom', 'zoom', (value) => value.toFixed(2));
bindRange('rotation', 'rotation', (value) => `${Math.round(value)}°`);
bindRange('amount', 'amount', (value) => value.toFixed(2));
bindRange('speed', 'speed', (value) => value.toFixed(2));
bindRange('feedback', 'feedback', (value) => value.toFixed(2));
bindRange('feedback-zoom', 'feedbackZoom', (value) => value.toFixed(3));
bindRange('hue', 'hue', (value) => `${Math.round(value)}°`);
bindRange('saturation', 'saturation', (value) => value.toFixed(2));
bindRange('brightness', 'brightness', (value) => value.toFixed(2));
bindRange('contrast', 'contrast', (value) => value.toFixed(2));

document.getElementById('fit-mode').addEventListener('change', (event) => {
  params.fitMode = Number(event.target.value);
});
document.getElementById('effect').addEventListener('change', (event) => {
  params.effect = Number(event.target.value);
});
document.getElementById('mirror-x').addEventListener('change', (event) => {
  params.mirrorX = event.target.checked ? 1 : 0;
});
document.getElementById('mirror-y').addEventListener('change', (event) => {
  params.mirrorY = event.target.checked ? 1 : 0;
});
document.getElementById('loop').addEventListener('change', (event) => {
  video.loop = event.target.checked;
});
document.getElementById('muted').addEventListener('change', (event) => {
  video.muted = event.target.checked;
});
video.loop = document.getElementById('loop').checked;
video.muted = document.getElementById('muted').checked;

clearFeedbackButton.addEventListener('click', () => {
  clearFeedback();
  setSaveStatus('Feedback history cleared', 'success');
});

function canvasToPngBlob() {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('The WebView could not encode the current frame as PNG'));
    }, 'image/png');
  });
}

snapshotButton.addEventListener('click', async () => {
  snapshotButton.disabled = true;
  setSaveStatus('Encoding PNG…');
  try {
    const blob = await canvasToPngBlob();
    const suggestedName = `${currentSourceName || 'video-frame'}-${Date.now()}.png`;
    if (invoke && tauriDialog?.save) {
      const path = await tauriDialog.save({
        title: 'Save processed video frame',
        defaultPath: suggestedName,
        filters: [{ name: 'PNG image', extensions: ['png'] }]
      });
      if (!path) {
        setSaveStatus('Save cancelled');
        return;
      }
      const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
      const savedPath = await invoke('write_png', { path, bytes });
      setSaveStatus(`Saved: ${savedPath}`, 'success');
    } else {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = suggestedName;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setSaveStatus('PNG downloaded through the browser fallback', 'success');
    }
  } catch (error) {
    console.error(error);
    setSaveStatus(String(error), 'error');
  } finally {
    snapshotButton.disabled = false;
  }
});

fullscreenButton.addEventListener('click', async () => {
  if (!invoke) {
    setSaveStatus('Fullscreen command requires the Tauri runtime', 'error');
    return;
  }
  try {
    const fullscreen = await invoke('toggle_fullscreen');
    fullscreenButton.textContent = fullscreen ? 'Exit fullscreen' : 'Fullscreen';
  } catch (error) {
    console.error(error);
    setSaveStatus(String(error), 'error');
  }
});

window.addEventListener('keydown', (event) => {
  if (!hasVideo || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  if (event.code === 'Space') {
    event.preventDefault();
    playButton.click();
  } else if (event.key === 'ArrowLeft') {
    video.currentTime = Math.max(0, video.currentTime - 5);
  } else if (event.key === 'ArrowRight') {
    video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 5);
  }
});

function resizeCanvasIfNeeded() {
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(stage.clientWidth * pixelRatio));
  const height = Math.max(1, Math.round(stage.clientHeight * pixelRatio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    createFeedbackTargets(width, height);
    renderSizeLabel.textContent = `${width} × ${height}`;
  }
}

function uploadVideoFrame() {
  if (!hasVideo || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
  const current = video.currentTime;
  const frameCallbackAvailable = typeof video.requestVideoFrameCallback === 'function';
  if (frameCallbackAvailable ? !videoFrameDirty : current === latestUploadedTime) return;
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, videoTexture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  try {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    latestUploadedTime = current;
    videoFrameDirty = false;
    if (!frameCallbackAvailable) {
      presentedFrames += 1;
      frameLabel.textContent = `${presentedFrames} frames`;
    }
  } catch (error) {
    console.error('Could not upload video frame', error);
    decoderLabel.textContent = 'GPU upload failed';
  }
}

let startTime = performance.now();
let fpsWindowStart = startTime;
let fpsFrames = 0;

function render(now) {
  resizeCanvasIfNeeded();
  uploadVideoFrame();

  const writeIndex = feedbackIndex;
  const readIndex = 1 - feedbackIndex;
  const elapsed = (now - startTime) / 1000;

  gl.bindFramebuffer(gl.FRAMEBUFFER, feedbackFramebuffers[writeIndex]);
  gl.viewport(0, 0, canvas.width, canvas.height);
  bindQuad(effectProgram);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, videoTexture);
  uniform1i(effectProgram, 'u_video', 0);

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, feedbackTextures[readIndex]);
  uniform1i(effectProgram, 'u_previous', 1);

  uniform2f(effectProgram, 'u_resolution', canvas.width, canvas.height);
  uniform1f(effectProgram, 'u_videoAspect', hasVideo && video.videoHeight > 0 ? video.videoWidth / video.videoHeight : 16 / 9);
  uniform1f(effectProgram, 'u_hasVideo', hasVideo ? 1 : 0);
  uniform1f(effectProgram, 'u_time', elapsed);
  uniform1f(effectProgram, 'u_fitMode', params.fitMode);
  uniform1f(effectProgram, 'u_zoom', params.zoom);
  uniform1f(effectProgram, 'u_rotation', params.rotation);
  uniform1f(effectProgram, 'u_mirrorX', params.mirrorX);
  uniform1f(effectProgram, 'u_mirrorY', params.mirrorY);
  uniform1f(effectProgram, 'u_effect', params.effect);
  uniform1f(effectProgram, 'u_amount', params.amount);
  uniform1f(effectProgram, 'u_speed', params.speed);
  uniform1f(effectProgram, 'u_feedback', params.feedback);
  uniform1f(effectProgram, 'u_feedbackZoom', params.feedbackZoom);
  uniform1f(effectProgram, 'u_hue', params.hue);
  uniform1f(effectProgram, 'u_saturation', params.saturation);
  uniform1f(effectProgram, 'u_brightness', params.brightness);
  uniform1f(effectProgram, 'u_contrast', params.contrast);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  bindQuad(displayProgram);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, feedbackTextures[writeIndex]);
  uniform1i(displayProgram, 'u_texture', 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  feedbackIndex = readIndex;

  fpsFrames += 1;
  if (now - fpsWindowStart >= 500) {
    const fps = fpsFrames * 1000 / (now - fpsWindowStart);
    fpsLabel.textContent = `${fps.toFixed(0)} fps`;
    fpsFrames = 0;
    fpsWindowStart = now;
  }

  if (hasVideo && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    updateTransportLabels();
  }

  requestAnimationFrame(render);
}

window.addEventListener('beforeunload', () => {
  frameCallbackGeneration += 1;
  video.pause();
  if (objectUrl) URL.revokeObjectURL(objectUrl);
});

if (!invoke || !convertFileSrc || !tauriDialog?.open) {
  nativeOpenButton.textContent = 'Open video';
  setSaveStatus('Browser mode: native commands unavailable');
} else {
  setSaveStatus('Tauri v2 native commands ready', 'success');
}

createFeedbackTargets(1, 1);
requestAnimationFrame(render);
