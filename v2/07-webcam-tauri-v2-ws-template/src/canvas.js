"use strict";

// Junkpile Example 07 — Webcam Texture WebSocket Windows
//
// Signal path:
// navigator.mediaDevices.getUserMedia()
//   → hidden HTMLVideoElement
//   → texImage2D camera upload
//   → GLSL effect program
//   → ping-pong framebuffer feedback
//   → simple blit program
//   → visible WebGL canvas
// Commands and telemetry travel through an embedded loopback WebSocket relay.

const DEFAULTS = Object.freeze({
  effect: 0,
  distortion: 0,
  feedback: 0,
  zoom: 1,
  speed: 0.3,
  hue: 0,
  saturation: 1,
  brightness: 1,
  contrast: 1,
  mirror: false,
  invert: false,
  greyscale: false,
});

const EFFECT_NAMES = Object.freeze([
  "Passthrough",
  "Wave Distort",
  "Radial Warp",
  "Kaleidoscope",
  "Edge Detect",
  "Glitch",
]);

const RANGE_IDS = Object.freeze([
  "effect",
  "distortion",
  "feedback",
  "zoom",
  "speed",
  "hue",
  "saturation",
  "brightness",
  "contrast",
]);

const TOGGLE_IDS = Object.freeze(["mirror", "invert", "greyscale"]);

const params = { ...DEFAULTS };

const VERTEX_SHADER_SOURCE = `
precision highp float;
attribute vec2 a_position;
varying vec2 vTexCoord;

void main() {
  vTexCoord = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const EFFECT_FRAGMENT_SHADER_SOURCE = `
precision highp float;

uniform sampler2D u_webcam;
uniform sampler2D u_prevFrame;

uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_sourceResolution;

uniform float u_effect;
uniform float u_distortion;
uniform float u_feedback;
uniform float u_zoom;

uniform float u_hue;
uniform float u_saturation;
uniform float u_brightness;
uniform float u_contrast;

uniform float u_mirror;
uniform float u_invert;
uniform float u_greyscale;

varying vec2 vTexCoord;

float luma(vec3 color) {
  return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

vec3 rotateHue(vec3 color, float degrees) {
  float angle = degrees * 3.14159265 / 180.0;
  float cosine = cos(angle);
  float sine = sin(angle);
  float third = 1.0 / 3.0;
  float rootThird = sqrt(third);

  mat3 transform = mat3(
    cosine + (1.0 - cosine) * third,
    (1.0 - cosine) * third - rootThird * sine,
    (1.0 - cosine) * third + rootThird * sine,

    (1.0 - cosine) * third + rootThird * sine,
    cosine + (1.0 - cosine) * third,
    (1.0 - cosine) * third - rootThird * sine,

    (1.0 - cosine) * third - rootThird * sine,
    (1.0 - cosine) * third + rootThird * sine,
    cosine + (1.0 - cosine) * third
  );

  return clamp(transform * color, 0.0, 1.0);
}

float sobel(vec2 uv) {
  vec2 pixel = 1.0 / max(u_sourceResolution, vec2(1.0));

  float gx =
    -1.0 * luma(texture2D(u_webcam, uv + vec2(-pixel.x, -pixel.y)).rgb) +
     1.0 * luma(texture2D(u_webcam, uv + vec2( pixel.x, -pixel.y)).rgb) +
    -2.0 * luma(texture2D(u_webcam, uv + vec2(-pixel.x,  0.0)).rgb) +
     2.0 * luma(texture2D(u_webcam, uv + vec2( pixel.x,  0.0)).rgb) +
    -1.0 * luma(texture2D(u_webcam, uv + vec2(-pixel.x,  pixel.y)).rgb) +
     1.0 * luma(texture2D(u_webcam, uv + vec2( pixel.x,  pixel.y)).rgb);

  float gy =
    -1.0 * luma(texture2D(u_webcam, uv + vec2(-pixel.x, -pixel.y)).rgb) +
    -2.0 * luma(texture2D(u_webcam, uv + vec2( 0.0,    -pixel.y)).rgb) +
    -1.0 * luma(texture2D(u_webcam, uv + vec2( pixel.x, -pixel.y)).rgb) +
     1.0 * luma(texture2D(u_webcam, uv + vec2(-pixel.x,  pixel.y)).rgb) +
     2.0 * luma(texture2D(u_webcam, uv + vec2( 0.0,     pixel.y)).rgb) +
     1.0 * luma(texture2D(u_webcam, uv + vec2( pixel.x, pixel.y)).rgb);

  return clamp(sqrt(gx * gx + gy * gy) * 4.0, 0.0, 1.0);
}

vec3 applyEffect(vec2 uv) {
  float time = u_time;

  if (u_effect < 0.5) {
    return texture2D(u_webcam, uv).rgb;
  } else if (u_effect < 1.5) {
    vec2 warpedUv = uv + u_distortion * vec2(
      sin(uv.y * 10.0 + time) * 0.05,
      cos(uv.x * 10.0 + time) * 0.05
    );
    return texture2D(u_webcam, warpedUv).rgb;
  } else if (u_effect < 2.5) {
    vec2 centered = uv - 0.5;
    float radius = length(centered);
    float angle = atan(centered.y, centered.x);
    float warpedRadius = radius + u_distortion * 0.3 * sin(radius * 8.0 - time);
    return texture2D(
      u_webcam,
      vec2(cos(angle), sin(angle)) * warpedRadius + 0.5
    ).rgb;
  } else if (u_effect < 3.5) {
    vec2 centered = uv - 0.5;
    float radius = length(centered);
    float angle = atan(centered.y, centered.x);
    float sector = 3.14159265 * 2.0 / 6.0;
    angle = mod(angle, sector);
    if (angle > sector * 0.5) {
      angle = sector - angle;
    }
    angle += time * u_distortion * 0.5;
    return texture2D(u_webcam, vec2(cos(angle), sin(angle)) * radius + 0.5).rgb;
  } else if (u_effect < 4.5) {
    float edge = sobel(uv);
    return mix(vec3(0.0), texture2D(u_webcam, uv).rgb, edge);
  }

  float band = floor(uv.y * 20.0) / 20.0;
  float randomValue = fract(
    sin(band * 127.1 + floor(time * 8.0) * 31.7) * 43758.5
  );
  float shift = (randomValue - 0.5) * u_distortion * 0.3;
  float redShift = shift + (fract(randomValue * 3.7) - 0.5) * u_distortion * 0.05;
  float blueShift = shift - (fract(randomValue * 5.3) - 0.5) * u_distortion * 0.05;

  float red = texture2D(u_webcam, vec2(uv.x + redShift, uv.y)).r;
  float green = texture2D(u_webcam, vec2(uv.x + shift, uv.y)).g;
  float blue = texture2D(u_webcam, vec2(uv.x + blueShift, uv.y)).b;
  return vec3(red, green, blue);
}

void main() {
  vec2 uv = vTexCoord;

  if (u_mirror > 0.5) {
    uv.x = 1.0 - uv.x;
  }

  uv = (uv - 0.5) / max(u_zoom, 0.001) + 0.5;

  vec3 color = applyEffect(uv);

  if (u_feedback > 0.001) {
    color = mix(color, texture2D(u_prevFrame, vTexCoord).rgb, u_feedback);
  }

  if (abs(u_hue) > 0.5) {
    color = rotateHue(color, u_hue);
  }

  if (u_greyscale > 0.5) {
    color = vec3(luma(color));
  } else if (abs(u_saturation - 1.0) > 0.01) {
    color = mix(vec3(luma(color)), color, u_saturation);
  }

  color *= u_brightness;
  color = (color - 0.5) * u_contrast + 0.5;

  if (u_invert > 0.5) {
    color = 1.0 - color;
  }

  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

const BLIT_FRAGMENT_SHADER_SOURCE = `
precision highp float;
uniform sampler2D u_texture;
varying vec2 vTexCoord;

void main() {
  gl_FragColor = texture2D(u_texture, vTexCoord);
}
`;

const elements = {
  canvas: document.getElementById("gl-canvas"),
  rendererPanel: document.getElementById("renderer-panel"),
  video: document.getElementById("camera-video"),
  cameraNotice: document.getElementById("camera-notice"),
  cameraNoticeTitle: document.getElementById("camera-notice-title"),
  cameraNoticeMessage: document.getElementById("camera-notice-message"),
  rendererError: document.getElementById("renderer-error"),
  rendererErrorMessage: document.getElementById("renderer-error-message"),
  hudEffect: document.getElementById("hud-effect"),
  hudCamera: document.getElementById("hud-camera"),
  hudRuntime: document.getElementById("hud-runtime"),
  hudFps: document.getElementById("hud-fps"),
  hudResolution: document.getElementById("hud-resolution"),
};

const WS_URL = "ws://127.0.0.1:2727";
const diagnostics = Object.create(null);

let ws = null;
let reconnectTimer = 0;
let gl = null;
let effectProgram = null;
let blitProgram = null;
let quadBuffer = null;
let effectPositionLocation = -1;
let blitPositionLocation = -1;
let effectUniforms = Object.create(null);
let blitTextureLocation = null;
let webcamTexture = null;
let framebuffers = [];
let framebufferTextures = [];
let writeTarget = 0;
let readTarget = 1;
let rendererReady = false;
let contextLost = false;
let paused = false;
let shaderTime = 0;
let previousFrameTime = performance.now();
let renderMetricStart = performance.now();
let renderMetricFrames = 0;
let cameraStream = null;
let activeDeviceId = "";
let cameraBusy = false;
let lastUploadedVideoTime = -1;
let uploadMetricStart = performance.now();
let uploadMetricFrames = 0;
let sourceWidth = 1;
let sourceHeight = 1;
let lastRuntime = { state: "initializing", text: "Initializing WebGL" };
let lastError = { scope: "", message: "" };

function send(message) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  try { ws.send(JSON.stringify(message)); return true; } catch { return false; }
}

function setRuntimeStatus(state, text) {
  lastRuntime = { state, text };
  elements.hudRuntime.textContent = text.toUpperCase();
  send({ type: "runtime", state, text });
}

function setDiagnostic(id, text, result = "") {
  diagnostics[id] = { text, result };
  if (id === "render-fps") elements.hudFps.textContent = text.toUpperCase();
  if (id === "drawing-resolution") elements.hudResolution.textContent = text;
  send({ type: "diagnostic", id, text, result });
}

function replayTelemetry() {
  send({ type: "runtime", ...lastRuntime });
  for (const [id, value] of Object.entries(diagnostics)) send({ type: "diagnostic", id, ...value });
  send({ type: "error-log", ...lastError });
  send({ type: "paused-state", paused });
  sendCameraStatus(cameraBusy ? "requesting" : cameraStream ? "running" : "stopped");
}

function showCameraNotice(title, message, state = "idle") {
  elements.cameraNotice.hidden = false;
  elements.cameraNotice.dataset.state = state;
  elements.cameraNoticeTitle.textContent = title;
  elements.cameraNoticeMessage.textContent = message;
}

function hideCameraNotice() {
  elements.cameraNotice.hidden = true;
  delete elements.cameraNotice.dataset.state;
}

function showErrorLog(scope, message) {
  lastError = { scope, message };
  send({ type: "error-log", scope, message });
}

function clearErrorLog(scope = "") {
  if (scope && lastError.scope !== scope) return;
  lastError = { scope: "", message: "" };
  send({ type: "error-log", scope: "", message: "" });
}

function failRenderer(message, details = "") {
  rendererReady = false;
  setRuntimeStatus("error", "Renderer error");
  elements.rendererError.hidden = false;
  elements.rendererErrorMessage.textContent = details ? `${message}\n\n${details}` : message;
  showErrorLog("webgl", details || message);
  console.error(message, details);
}

function compileShader(type, source, label) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error(`Could not allocate the ${label} shader.`);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  const log = (gl.getShaderInfoLog(shader) || "").trim();
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    throw new Error(`${label} shader compilation failed.\n${log || "No compiler log was returned."}`);
  }
  return { shader, log };
}

function linkProgram(vertexShader, fragmentShader, label) {
  const program = gl.createProgram();
  if (!program) throw new Error(`Could not allocate the ${label} program.`);
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  const log = (gl.getProgramInfoLog(program) || "").trim();
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    throw new Error(`${label} program linking failed.\n${log || "No linker log was returned."}`);
  }
  return { program, log };
}

function createPrograms() {
  try {
    const vertex = compileShader(gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE, "Vertex");
    setDiagnostic("vertex-status", vertex.log ? "Compiled with notes" : "Compiled", "success");
    const effectFragment = compileShader(gl.FRAGMENT_SHADER, EFFECT_FRAGMENT_SHADER_SOURCE, "Effect fragment");
    setDiagnostic("fragment-status", effectFragment.log ? "Compiled with notes" : "Compiled", "success");
    const blitFragment = compileShader(gl.FRAGMENT_SHADER, BLIT_FRAGMENT_SHADER_SOURCE, "Blit fragment");
    const effectLink = linkProgram(vertex.shader, effectFragment.shader, "Effect");
    const blitLink = linkProgram(vertex.shader, blitFragment.shader, "Blit");
    effectProgram = effectLink.program;
    blitProgram = blitLink.program;
    gl.deleteShader(vertex.shader); gl.deleteShader(effectFragment.shader); gl.deleteShader(blitFragment.shader);
    setDiagnostic("link-status", effectLink.log || blitLink.log ? "Linked with notes" : "Effect + blit linked", "success");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("vertex")) setDiagnostic("vertex-status", "Failed", "error");
    else setDiagnostic("fragment-status", "Failed", "error");
    setDiagnostic("link-status", "Unavailable", "error");
    throw error;
  }
}

function createQuad() {
  quadBuffer = gl.createBuffer();
  if (!quadBuffer) throw new Error("Could not allocate the fullscreen-quad buffer.");
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  effectPositionLocation = gl.getAttribLocation(effectProgram, "a_position");
  blitPositionLocation = gl.getAttribLocation(blitProgram, "a_position");
  if (effectPositionLocation < 0 || blitPositionLocation < 0) throw new Error("A linked program does not expose a_position.");
}

function bindQuad(location) {
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
}

function cacheUniforms() {
  const names = ["u_webcam","u_prevFrame","u_time","u_resolution","u_sourceResolution","u_effect","u_distortion","u_feedback","u_zoom","u_hue","u_saturation","u_brightness","u_contrast","u_mirror","u_invert","u_greyscale"];
  effectUniforms = Object.create(null);
  for (const name of names) effectUniforms[name] = gl.getUniformLocation(effectProgram, name);
  blitTextureLocation = gl.getUniformLocation(blitProgram, "u_texture");
}

function setUniform1f(name, value) { const location = effectUniforms[name]; if (location !== null && location !== undefined) gl.uniform1f(location, value); }
function setUniform1i(name, value) { const location = effectUniforms[name]; if (location !== null && location !== undefined) gl.uniform1i(location, value); }
function setUniform2f(name, x, y) { const location = effectUniforms[name]; if (location !== null && location !== undefined) gl.uniform2f(location, x, y); }

function makeTexture() {
  const texture = gl.createTexture();
  if (!texture) throw new Error("Could not allocate a WebGL texture.");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return texture;
}

function writePlaceholderTexture() {
  if (!gl || !webcamTexture) return;
  gl.bindTexture(gl.TEXTURE_2D, webcamTexture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([3,4,7,255]));
  sourceWidth = 1; sourceHeight = 1; lastUploadedVideoTime = -1;
}

function uploadCameraFrame() {
  if (!cameraStream || elements.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return false;
  const videoTime = elements.video.currentTime;
  if (videoTime === lastUploadedVideoTime) return false;
  gl.bindTexture(gl.TEXTURE_2D, webcamTexture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, elements.video);
  lastUploadedVideoTime = videoTime;
  sourceWidth = elements.video.videoWidth || sourceWidth;
  sourceHeight = elements.video.videoHeight || sourceHeight;
  uploadMetricFrames += 1;
  return true;
}

function createFramebufferTarget(width, height) {
  const texture = makeTexture();
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const framebuffer = gl.createFramebuffer();
  if (!framebuffer) { gl.deleteTexture(texture); throw new Error("Could not allocate a WebGL framebuffer."); }
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    gl.deleteFramebuffer(framebuffer); gl.deleteTexture(texture);
    throw new Error(`Feedback framebuffer is incomplete (status 0x${status.toString(16)}).`);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { framebuffer, texture };
}

function destroyFramebufferTargets() {
  for (const framebuffer of framebuffers) if (framebuffer) gl.deleteFramebuffer(framebuffer);
  for (const texture of framebufferTextures) if (texture) gl.deleteTexture(texture);
  framebuffers = []; framebufferTextures = [];
}

function rebuildFramebufferTargets(width, height) {
  if (!gl || width < 1 || height < 1) return;
  destroyFramebufferTargets();
  for (let index = 0; index < 2; index += 1) {
    const target = createFramebufferTarget(width, height);
    framebuffers.push(target.framebuffer); framebufferTextures.push(target.texture);
  }
  writeTarget = 0; readTarget = 1; clearFeedbackTargets();
}

function clearFeedbackTargets() {
  if (!gl || framebuffers.length !== 2) return;
  gl.disable(gl.BLEND); gl.clearColor(.012,.016,.027,1);
  for (const framebuffer of framebuffers) { gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer); gl.clear(gl.COLOR_BUFFER_BIT); }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); writeTarget = 0; readTarget = 1;
}

function resizeCanvas() {
  if (!gl) return;
  const rect = elements.rendererPanel.getBoundingClientRect();
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * pixelRatio));
  const height = Math.max(1, Math.round(rect.height * pixelRatio));
  if (elements.canvas.width === width && elements.canvas.height === height) return;
  elements.canvas.width = width; elements.canvas.height = height;
  rebuildFramebufferTargets(width, height);
  setDiagnostic("drawing-resolution", `${width}×${height}`);
}

function updateEffectUniforms() {
  gl.useProgram(effectProgram);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, webcamTexture); setUniform1i("u_webcam",0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, framebufferTextures[readTarget]); setUniform1i("u_prevFrame",1);
  setUniform1f("u_time", shaderTime); setUniform2f("u_resolution", elements.canvas.width, elements.canvas.height);
  setUniform2f("u_sourceResolution", sourceWidth, sourceHeight); setUniform1f("u_effect", params.effect);
  setUniform1f("u_distortion", params.distortion); setUniform1f("u_feedback", params.feedback); setUniform1f("u_zoom", params.zoom);
  setUniform1f("u_hue", params.hue); setUniform1f("u_saturation", params.saturation); setUniform1f("u_brightness", params.brightness);
  setUniform1f("u_contrast", params.contrast); setUniform1f("u_mirror", params.mirror ? 1 : 0);
  setUniform1f("u_invert", params.invert ? 1 : 0); setUniform1f("u_greyscale", params.greyscale ? 1 : 0);
}

function renderEffectPass() {
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[writeTarget]); gl.viewport(0,0,elements.canvas.width,elements.canvas.height);
  updateEffectUniforms(); bindQuad(effectPositionLocation); gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
}

function renderBlitPass() {
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0,0,elements.canvas.width,elements.canvas.height);
  gl.useProgram(blitProgram); bindQuad(blitPositionLocation);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, framebufferTextures[writeTarget]);
  if (blitTextureLocation !== null) gl.uniform1i(blitTextureLocation,0);
  gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
}

function updateMetrics(now) {
  if (now - renderMetricStart >= 1000) {
    const elapsed = (now - renderMetricStart) / 1000;
    const fps = paused ? 0 : renderMetricFrames / elapsed;
    setDiagnostic("render-fps", paused ? "0 (paused)" : `${fps.toFixed(1)} fps`);
    renderMetricStart = now; renderMetricFrames = 0;
  }
  if (now - uploadMetricStart >= 1000) {
    const elapsed = (now - uploadMetricStart) / 1000;
    const fps = cameraStream && !paused ? uploadMetricFrames / elapsed : 0;
    setDiagnostic("upload-fps", `${fps.toFixed(1)} fps`);
    uploadMetricStart = now; uploadMetricFrames = 0;
  }
}

function render(now) {
  requestAnimationFrame(render);
  if (!rendererReady || contextLost) return;
  const deltaSeconds = Math.min((now - previousFrameTime) / 1000, .1);
  previousFrameTime = now;
  resizeCanvas();
  if (paused) { updateMetrics(now); return; }
  shaderTime += deltaSeconds * params.speed; uploadCameraFrame();
  renderEffectPass(); renderBlitPass(); [writeTarget,readTarget] = [readTarget,writeTarget];
  renderMetricFrames += 1; updateMetrics(now);
}

function detectRenderer() {
  const extension = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  setDiagnostic("renderer-name", renderer || "WebGL 1 renderer");
}

function initializeWebGL() {
  gl = elements.canvas.getContext("webgl", { alpha:false, antialias:false, depth:false, stencil:false, preserveDrawingBuffer:false, powerPreference:"high-performance" });
  if (!gl) throw new Error("WebGL 1 is unavailable in this WebView.");
  createPrograms(); createQuad(); cacheUniforms(); webcamTexture = makeTexture(); writePlaceholderTexture(); resizeCanvas(); detectRenderer();
  gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
  rendererReady = true; setRuntimeStatus("camera-idle", "Renderer ready · camera idle"); clearErrorLog("webgl"); requestAnimationFrame(render);
}

function mediaDevicesAvailable() { return Boolean(navigator.mediaDevices?.getUserMedia && navigator.mediaDevices?.enumerateDevices); }

async function enumerateCameras(preferredDeviceId = "") {
  if (!mediaDevicesAvailable()) {
    setDiagnostic("camera-state", "Unsupported", "error");
    showCameraNotice("Camera API unavailable", "This WebView does not expose navigator.mediaDevices.getUserMedia().", "error");
    send({ type:"camera-devices", devices:[], activeDeviceId:"" });
    return [];
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter((device) => device.kind === "videoinput");
    send({ type:"camera-devices", devices:cameras.map((device,index) => ({ deviceId:device.deviceId, label:device.label || `Camera ${index+1} — permission required` })), activeDeviceId: preferredDeviceId || activeDeviceId });
    if (!cameras.length && !cameraStream) setDiagnostic("camera-state", "No devices", "warning");
    return cameras;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setDiagnostic("camera-state", "Enumeration failed", "error"); showErrorLog("camera", `Could not enumerate camera devices. ${message}`);
    send({ type:"camera-devices", devices:[], activeDeviceId:"" });
    return [];
  }
}

function describeCameraError(error) {
  const name = error?.name || "CameraError"; const message = error?.message || "The camera request failed.";
  switch (name) {
    case "NotAllowedError": case "PermissionDeniedError": return "Camera access was denied. Allow access in system privacy settings, then start the camera again.";
    case "NotFoundError": case "DevicesNotFoundError": return "No usable camera was found. Connect a camera and refresh the device list.";
    case "NotReadableError": case "TrackStartError": return "The camera is already in use or could not be opened by the renderer WebView.";
    case "OverconstrainedError": return `The selected camera cannot satisfy the requested constraints: ${message}`;
    case "SecurityError": return "The WebView blocked camera access because the current context is not authorized.";
    default: return `${name}: ${message}`;
  }
}

function stopMediaTracks() {
  if (cameraStream) for (const track of cameraStream.getTracks()) track.stop();
  cameraStream = null; elements.video.srcObject = null;
}

async function waitForVideoMetadata() {
  if (elements.video.readyState >= HTMLMediaElement.HAVE_METADATA) return;
  await new Promise((resolve,reject) => {
    const timeout = window.setTimeout(() => { cleanup(); reject(new Error("Timed out while waiting for camera metadata.")); },10000);
    const cleanup = () => { clearTimeout(timeout); elements.video.removeEventListener("loadedmetadata",loaded); elements.video.removeEventListener("error",failed); };
    const loaded = () => { cleanup(); resolve(); }; const failed = () => { cleanup(); reject(new Error("The video element could not decode the camera stream.")); };
    elements.video.addEventListener("loadedmetadata",loaded,{once:true}); elements.video.addEventListener("error",failed,{once:true});
  });
}

function createVideoConstraints(deviceId = "") {
  return { video: { ...(deviceId ? {deviceId:{exact:deviceId}} : {}), width:{ideal:1280}, height:{ideal:720}, frameRate:{ideal:30,max:60} }, audio:false };
}

async function requestCameraStream(deviceId) {
  try { return await navigator.mediaDevices.getUserMedia(createVideoConstraints(deviceId)); }
  catch (error) {
    if (!(deviceId && ["NotFoundError","OverconstrainedError"].includes(error?.name))) throw error;
    await enumerateCameras(); return navigator.mediaDevices.getUserMedia(createVideoConstraints());
  }
}

function sendCameraStatus(state, help = "") { send({ type:"camera-status", state, activeDeviceId, help }); }

async function startCamera(deviceId = "") {
  if (cameraBusy) return;
  if (!mediaDevicesAvailable()) {
    const message = "This WebView does not expose navigator.mediaDevices.getUserMedia().";
    setDiagnostic("camera-state", "Unsupported", "error"); showCameraNotice("Camera API unavailable", message, "error");
    sendCameraStatus("error", message); return;
  }
  cameraBusy = true; sendCameraStatus("requesting", "Approve the camera permission prompt in the renderer window."); setRuntimeStatus("camera-idle", "Requesting camera access"); setDiagnostic("camera-state", "Requesting…", "warning");
  showCameraNotice("Requesting camera access", "Approve the operating-system permission prompt in this renderer window.");
  stopMediaTracks();
  try {
    const stream = await requestCameraStream(deviceId);
    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error("The media stream contains no video track.");
    cameraStream = stream; elements.video.srcObject = stream; await waitForVideoMetadata(); await elements.video.play();
    const settings = track.getSettings ? track.getSettings() : {};
    activeDeviceId = settings.deviceId || deviceId || ""; lastUploadedVideoTime = -1; uploadMetricFrames = 0; uploadMetricStart = performance.now();
    track.addEventListener("ended", () => { if (cameraStream?.getVideoTracks()[0] === track) stopCamera("The active camera track ended.", true); }, {once:true});
    const width = settings.width || elements.video.videoWidth || 0; const height = settings.height || elements.video.videoHeight || 0;
    const fps = Number.isFinite(settings.frameRate) ? ` @ ${settings.frameRate.toFixed(1)} fps` : "";
    const resolution = width && height ? `${width}×${height}${fps}` : "Active stream";
    const label = track.label || "Camera permission granted";
    sourceWidth = width || sourceWidth; sourceHeight = height || sourceHeight;
    setDiagnostic("camera-state", "Running", "success"); setDiagnostic("camera-name", label); setDiagnostic("camera-resolution", resolution);
    elements.hudCamera.textContent = width && height ? `${width}×${height}` : "CAMERA LIVE";
    await enumerateCameras(activeDeviceId); clearErrorLog("camera"); clearFeedbackTargets(); hideCameraNotice();
    setRuntimeStatus(paused ? "paused" : "running", paused ? "Paused · camera live" : "Running · camera live");
    sendCameraStatus("running", `Renderer owns ${label}. Camera frames are uploaded locally; only commands and telemetry cross the socket.`);
  } catch (error) {
    stopMediaTracks(); activeDeviceId = ""; writePlaceholderTexture(); clearFeedbackTargets();
    const message = describeCameraError(error);
    setDiagnostic("camera-state", "Error", "error"); setDiagnostic("camera-name", "—"); setDiagnostic("camera-resolution", "—");
    elements.hudCamera.textContent = "CAMERA ERROR"; showCameraNotice("Camera could not start", message, "error"); showErrorLog("camera", message);
    setRuntimeStatus("camera-idle", "Renderer ready · camera error"); await enumerateCameras(); sendCameraStatus("error", message);
  } finally { cameraBusy = false; }
}

function stopCamera(message = "Camera stopped. The renderer remains active.", endedUnexpectedly = false) {
  stopMediaTracks(); activeDeviceId = ""; writePlaceholderTexture(); clearFeedbackTargets(); cameraBusy = false;
  setDiagnostic("camera-state", endedUnexpectedly ? "Track ended" : "Stopped", endedUnexpectedly ? "warning" : "");
  setDiagnostic("camera-name", "—"); setDiagnostic("camera-resolution", "—"); setDiagnostic("upload-fps", "0.0 fps");
  elements.hudCamera.textContent = "NO CAMERA"; showCameraNotice(endedUnexpectedly ? "Camera track ended" : "Camera input idle", message, endedUnexpectedly ? "error" : "idle");
  setRuntimeStatus(paused ? "paused" : "camera-idle", paused ? "Paused · camera idle" : "Renderer ready · camera idle");
  sendCameraStatus(endedUnexpectedly ? "ended" : "stopped", message); void enumerateCameras();
}

function updateEffectLabel() { elements.hudEffect.textContent = (EFFECT_NAMES[Math.round(params.effect)] || "Unknown").toUpperCase(); }

function applyState(message) {
  if (message.params && typeof message.params === "object") {
    for (const [name,value] of Object.entries(message.params)) if (Object.prototype.hasOwnProperty.call(DEFAULTS,name)) params[name] = value;
    updateEffectLabel();
  }
  if (typeof message.paused === "boolean") setPaused(message.paused);
}

function setPaused(next) {
  paused = Boolean(next); previousFrameTime = performance.now();
  if (paused) { setRuntimeStatus("paused", cameraStream ? "Paused · camera live" : "Paused · camera idle"); setDiagnostic("render-fps", "0 (paused)"); setDiagnostic("upload-fps", "0.0 fps"); }
  else setRuntimeStatus(cameraStream ? "running" : "camera-idle", cameraStream ? "Running · camera live" : "Renderer ready · camera idle");
  send({ type:"paused-state", paused });
}

function resetRenderer() {
  Object.assign(params, DEFAULTS); shaderTime = 0; updateEffectLabel(); clearFeedbackTargets(); setPaused(false);
  send({ type: "renderer-state", params: { ...params }, paused });
}

async function toggleFullscreen() {
  try {
    const invoke = window.__TAURI__?.core?.invoke;
    if (typeof invoke === "function") { await invoke("toggle_canvas_fullscreen"); clearErrorLog("tauri"); return; }
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
    else if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen();
  } catch (error) { showErrorLog("tauri", `Fullscreen request failed. ${error instanceof Error ? error.message : String(error)}`); }
}

function handleMessage(message) {
  if (!message || typeof message !== "object") return;
  if (message.type === "param" && Object.prototype.hasOwnProperty.call(DEFAULTS,message.name)) { params[message.name] = message.value; if (message.name === "effect") updateEffectLabel(); }
  else if (message.type === "state-sync") applyState(message);
  else if (message.type === "camera-command") {
    if (message.action === "start") void startCamera(message.deviceId || "");
    else if (message.action === "stop") stopCamera();
    else if (message.action === "enumerate") void enumerateCameras(activeDeviceId);
  } else if (message.type === "action") {
    if (message.name === "set-paused") setPaused(Boolean(message.value));
    else if (message.name === "reset-feedback") { shaderTime = 0; clearFeedbackTargets(); }
    else if (message.name === "fullscreen") void toggleFullscreen();
  } else if (message.type === "request-state" && message.role !== "canvas") {
    send({ type:"canvas-ready" }); replayTelemetry(); void enumerateCameras(activeDeviceId);
  }
}

function connect() {
  clearTimeout(reconnectTimer); ws = new WebSocket(WS_URL);
  ws.addEventListener("open", () => {
    elements.hudRuntime.textContent = lastRuntime.text.toUpperCase();
    send({ type:"hello", role:"canvas" }); send({ type:"canvas-ready" });
    replayTelemetry(); void enumerateCameras(activeDeviceId);
  });
  ws.addEventListener("message", (event) => { if (typeof event.data !== "string") return; try { handleMessage(JSON.parse(event.data)); } catch {} });
  ws.addEventListener("close", () => { elements.hudRuntime.textContent = "WS RECONNECTING"; reconnectTimer = setTimeout(connect,1500); });
  ws.addEventListener("error", () => { elements.hudRuntime.textContent = "WS ERROR"; });
}

function wireLifecycleEvents() {
  elements.canvas.addEventListener("webglcontextlost", (event) => { event.preventDefault(); contextLost = true; failRenderer("The WebGL context was lost.", "Reload the example to rebuild the camera texture and feedback framebuffers."); });
  elements.canvas.addEventListener("webglcontextrestored", () => window.location.reload());
  if (navigator.mediaDevices?.addEventListener) navigator.mediaDevices.addEventListener("devicechange", () => void enumerateCameras(activeDeviceId));
  window.addEventListener("beforeunload", stopMediaTracks);
  window.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === " ") { event.preventDefault(); setPaused(!paused); }
    else if (key === "r") resetRenderer();
    else if (key === "c") cameraStream ? stopCamera() : void startCamera(activeDeviceId);
    else if (key === "f") void toggleFullscreen();
  });
}

async function start() {
  updateEffectLabel(); wireLifecycleEvents();
  setDiagnostic("camera-state", "Idle"); setDiagnostic("camera-name", "—");
  setDiagnostic("camera-resolution", "—"); setDiagnostic("upload-fps", "0.0 fps");
  try { initializeWebGL(); }
  catch (error) {
    failRenderer("WebGL initialization failed.", error instanceof Error ? error.message : String(error));
    connect();
    return;
  }
  new ResizeObserver(resizeCanvas).observe(elements.rendererPanel);
  connect();
  await enumerateCameras();
}

void start();
