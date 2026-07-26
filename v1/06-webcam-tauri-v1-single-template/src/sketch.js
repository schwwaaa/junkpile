"use strict";

const DEFAULT_PARAMS = Object.freeze({
  effect: 0,
  distortion: 0,
  feedback: 0,
  zoom: 1,
  speed: 0.3,
  hue: 0,
  saturation: 1,
  brightness: 1,
  contrast: 1,
  mirror: 0,
  invert: 0,
  greyscale: 0,
  fitMode: 1,
});

const PRESETS = Object.freeze({
  clean: { effect: 0, distortion: 0, feedback: 0, zoom: 1, speed: 0.3, hue: 0, saturation: 1, brightness: 1, contrast: 1, mirror: 0, invert: 0, greyscale: 0 },
  echo: { effect: 1, distortion: 0.18, feedback: 0.82, zoom: 1.02, speed: 0.42, hue: 12, saturation: 1.15, brightness: 1.02, contrast: 1.08, mirror: 1, invert: 0, greyscale: 0 },
  prism: { effect: 3, distortion: 0.58, feedback: 0.36, zoom: 1.16, speed: 0.65, hue: 48, saturation: 1.55, brightness: 1.05, contrast: 1.18, mirror: 0, invert: 0, greyscale: 0 },
  edge: { effect: 4, distortion: 0.12, feedback: 0.22, zoom: 1, speed: 0.24, hue: -18, saturation: 0.2, brightness: 1.25, contrast: 1.8, mirror: 0, invert: 0, greyscale: 1 },
});

const params = { ...DEFAULT_PARAMS };
const canvas = document.getElementById("glcanvas");
const container = document.getElementById("canvas-container");
const video = document.getElementById("webcam-video");

let gl = null;
let effectProgram = null;
let blitProgram = null;
let quadBuffer = null;
let cameraTexture = null;
let framebuffers = [];
let framebufferTextures = [];
let ping = 0;
let renderPaused = false;
let elapsedSeconds = 0;
let lastFrameMs = performance.now();
let fpsWindowStart = performance.now();
let fpsFrames = 0;
let cameraFpsWindowStart = performance.now();
let cameraFrames = 0;
let lastVideoTime = -1;
let activeStream = null;
let activeDeviceId = "";
let cameraReady = false;
let sourceWidth = 1280;
let sourceHeight = 720;
let resizeObserver = null;
let animationHandle = 0;

const VERTEX_SHADER = `
precision highp float;
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const EFFECT_SHADER = `
precision highp float;
uniform sampler2D u_webcam;
uniform sampler2D u_history;
uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_sourceResolution;
uniform float u_cameraReady;
uniform float u_effect;
uniform float u_distortion;
uniform float u_feedback;
uniform float u_zoom;
uniform float u_speed;
uniform float u_hue;
uniform float u_saturation;
uniform float u_brightness;
uniform float u_contrast;
uniform float u_mirror;
uniform float u_invert;
uniform float u_greyscale;
uniform float u_fitMode;
varying vec2 v_uv;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

vec3 rotateHue(vec3 col, float degrees) {
  float a = radians(degrees);
  float c = cos(a);
  float s = sin(a);
  float k = 1.0 / 3.0;
  float q = sqrt(k);
  mat3 m = mat3(
    c + (1.0-c)*k, (1.0-c)*k-q*s, (1.0-c)*k+q*s,
    (1.0-c)*k+q*s, c + (1.0-c)*k, (1.0-c)*k-q*s,
    (1.0-c)*k-q*s, (1.0-c)*k+q*s, c + (1.0-c)*k
  );
  return clamp(m * col, 0.0, 1.0);
}

vec3 calibration(vec2 uv) {
  vec2 p = uv * 2.0 - 1.0;
  vec2 cells = floor(uv * vec2(16.0, 9.0));
  float checker = mod(cells.x + cells.y, 2.0);
  float gridX = step(0.965, fract(uv.x * 16.0));
  float gridY = step(0.94, fract(uv.y * 9.0));
  float cross = max(1.0 - smoothstep(0.0, 0.009, abs(p.x)), 1.0 - smoothstep(0.0, 0.009, abs(p.y)));
  float ring = 1.0 - smoothstep(0.012, 0.025, abs(length(p) - 0.42));
  vec3 base = mix(vec3(0.025, 0.035, 0.04), vec3(0.07, 0.09, 0.08), checker);
  base = mix(base, vec3(0.25, 0.32, 0.28), max(gridX, gridY) * 0.35);
  base = mix(base, vec3(0.71, 1.0, 0.29), max(cross, ring) * 0.72);
  float pulse = 0.5 + 0.5 * sin(u_time * 1.2);
  base += vec3(0.02, 0.08, 0.07) * pulse * (1.0 - smoothstep(0.15, 0.8, length(p)));
  return base;
}

vec2 mapSourceUv(vec2 uv, out float valid) {
  valid = 1.0;
  if (u_fitMode > 1.5) return uv;
  float destinationAspect = u_resolution.x / max(u_resolution.y, 1.0);
  float sourceAspect = u_sourceResolution.x / max(u_sourceResolution.y, 1.0);
  vec2 mapped = uv;
  if (u_fitMode < 0.5) {
    if (destinationAspect > sourceAspect) mapped.x = (uv.x - 0.5) * destinationAspect / sourceAspect + 0.5;
    else mapped.y = (uv.y - 0.5) * sourceAspect / destinationAspect + 0.5;
    valid = step(0.0, mapped.x) * step(mapped.x, 1.0) * step(0.0, mapped.y) * step(mapped.y, 1.0);
  } else {
    if (destinationAspect > sourceAspect) mapped.y = (uv.y - 0.5) * sourceAspect / destinationAspect + 0.5;
    else mapped.x = (uv.x - 0.5) * destinationAspect / sourceAspect + 0.5;
  }
  return mapped;
}

vec3 sampleSource(vec2 displayUv) {
  if (u_cameraReady < 0.5) return calibration(displayUv);
  float valid = 1.0;
  vec2 uv = mapSourceUv(displayUv, valid);
  if (u_mirror > 0.5) uv.x = 1.0 - uv.x;
  uv = (uv - 0.5) / max(u_zoom, 0.001) + 0.5;
  valid *= step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  return texture2D(u_webcam, clamp(uv, 0.0, 1.0)).rgb * valid;
}

float sobel(vec2 uv) {
  vec2 px = 1.0 / max(u_resolution, vec2(1.0));
  float tl = luma(sampleSource(uv + vec2(-px.x, -px.y)));
  float tc = luma(sampleSource(uv + vec2(0.0, -px.y)));
  float tr = luma(sampleSource(uv + vec2(px.x, -px.y)));
  float ml = luma(sampleSource(uv + vec2(-px.x, 0.0)));
  float mr = luma(sampleSource(uv + vec2(px.x, 0.0)));
  float bl = luma(sampleSource(uv + vec2(-px.x, px.y)));
  float bc = luma(sampleSource(uv + vec2(0.0, px.y)));
  float br = luma(sampleSource(uv + vec2(px.x, px.y)));
  float gx = -tl + tr - 2.0*ml + 2.0*mr - bl + br;
  float gy = -tl - 2.0*tc - tr + bl + 2.0*bc + br;
  return clamp(length(vec2(gx, gy)) * 4.0, 0.0, 1.0);
}

vec3 effectColor(vec2 uv) {
  float t = u_time * u_speed;
  if (u_effect < 0.5) return sampleSource(uv);
  if (u_effect < 1.5) {
    vec2 warped = uv + u_distortion * vec2(sin(uv.y * 10.0 + t), cos(uv.x * 10.0 + t)) * 0.05;
    return sampleSource(warped);
  }
  if (u_effect < 2.5) {
    vec2 p = uv - 0.5;
    float r = length(p);
    float a = atan(p.y, p.x);
    float rw = r + u_distortion * 0.3 * sin(r * 8.0 - t);
    return sampleSource(vec2(cos(a), sin(a)) * rw + 0.5);
  }
  if (u_effect < 3.5) {
    vec2 p = uv - 0.5;
    float r = length(p);
    float a = atan(p.y, p.x);
    float sector = 6.2831853 / 6.0;
    a = mod(a, sector);
    if (a > sector * 0.5) a = sector - a;
    a += t * u_distortion * 0.5;
    return sampleSource(vec2(cos(a), sin(a)) * r + 0.5);
  }
  if (u_effect < 4.5) {
    float edge = sobel(uv);
    return vec3(edge) * mix(vec3(0.55, 0.95, 1.0), sampleSource(uv) + 0.15, 0.45);
  }
  float band = floor(uv.y * 24.0) / 24.0;
  float randomValue = hash21(vec2(band, floor(t * 8.0)));
  float shift = (randomValue - 0.5) * u_distortion * 0.3;
  float red = sampleSource(vec2(uv.x + shift + 0.025*u_distortion, uv.y)).r;
  float green = sampleSource(vec2(uv.x + shift, uv.y)).g;
  float blue = sampleSource(vec2(uv.x + shift - 0.025*u_distortion, uv.y)).b;
  return vec3(red, green, blue);
}

void main() {
  vec3 color = effectColor(v_uv);
  color = mix(color, texture2D(u_history, v_uv).rgb, u_feedback);
  color = rotateHue(color, u_hue);
  if (u_greyscale > 0.5) color = vec3(luma(color));
  else color = mix(vec3(luma(color)), color, u_saturation);
  color *= u_brightness;
  color = (color - 0.5) * u_contrast + 0.5;
  if (u_invert > 0.5) color = 1.0 - color;
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}`;

const BLIT_SHADER = `
precision highp float;
uniform sampler2D u_texture;
varying vec2 v_uv;
void main() { gl_FragColor = texture2D(u_texture, v_uv); }`;

function setStatus(message, tone = "ok") {
  document.getElementById("statusText").textContent = message;
  const badge = document.getElementById("canvasBadge");
  badge.className = `canvas-badge ${tone === "paused" ? "paused" : tone === "ok" && cameraReady ? "live" : ""}`;
  badge.textContent = renderPaused ? "RENDER PAUSED" : cameraReady ? "CAMERA LIVE" : "NO CAMERA";
}

function setDiagnostics(title, message, tone = "ok") {
  document.getElementById("compileStatus").textContent = title;
  document.getElementById("diagnostics").textContent = message;
  document.getElementById("compileDot").className = `status-dot ${tone}`;
}

function setCameraStatus(title, message, tone = "warning") {
  document.getElementById("cameraState").textContent = title;
  document.getElementById("cameraMessage").textContent = message;
  document.getElementById("cameraDot").className = `status-dot ${tone}`;
}

function compileShader(type, source, label) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) || `${label} shader failed without a compiler message.`;
    gl.deleteShader(shader);
    throw new Error(`${label} shader\n${info}`);
  }
  return shader;
}

function buildProgram(fragmentSource, label) {
  const vertex = compileShader(gl.VERTEX_SHADER, VERTEX_SHADER, `${label} vertex`);
  const fragment = compileShader(gl.FRAGMENT_SHADER, fragmentSource, `${label} fragment`);
  const nextProgram = gl.createProgram();
  gl.attachShader(nextProgram, vertex);
  gl.attachShader(nextProgram, fragment);
  gl.linkProgram(nextProgram);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(nextProgram, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(nextProgram) || `${label} program failed without a linker message.`;
    gl.deleteProgram(nextProgram);
    throw new Error(`${label} program link\n${info}`);
  }
  return nextProgram;
}

function rebuildPrograms() {
  if (!gl) return false;
  try {
    const nextEffect = buildProgram(EFFECT_SHADER, "Effect");
    const nextBlit = buildProgram(BLIT_SHADER, "Blit");
    if (effectProgram) gl.deleteProgram(effectProgram);
    if (blitProgram) gl.deleteProgram(blitProgram);
    effectProgram = nextEffect;
    blitProgram = nextBlit;
    configureQuad(effectProgram);
    configureQuad(blitProgram);
    setDiagnostics("Shaders ready", "Effect vertex: OK\nEffect fragment: OK\nEffect link: OK\nBlit vertex: OK\nBlit fragment: OK\nBlit link: OK", "ok");
    setStatus(renderPaused ? "Rendering paused · shaders ready" : "Rendering · shaders ready");
    return true;
  } catch (error) {
    console.error("[junkpile] shader build failed", error);
    setDiagnostics("Shader error", String(error?.message || error), "error");
    setStatus("Shader compilation failed", "error");
    return false;
  }
}

function configureQuad(program) {
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  const location = gl.getAttribLocation(program, "a_position");
  if (location >= 0) {
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
  }
}

function uniform1f(program, name, value) {
  const location = gl.getUniformLocation(program, name);
  if (location !== null) gl.uniform1f(location, value);
}
function uniform1i(program, name, value) {
  const location = gl.getUniformLocation(program, name);
  if (location !== null) gl.uniform1i(location, value);
}
function uniform2f(program, name, x, y) {
  const location = gl.getUniformLocation(program, name);
  if (location !== null) gl.uniform2f(location, x, y);
}

function createTexture() {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return texture;
}

function deleteHistoryBuffers() {
  framebuffers.forEach((framebuffer) => framebuffer && gl.deleteFramebuffer(framebuffer));
  framebufferTextures.forEach((texture) => texture && gl.deleteTexture(texture));
  framebuffers = [];
  framebufferTextures = [];
}

function createHistoryBuffers(width, height) {
  deleteHistoryBuffers();
  for (let index = 0; index < 2; index += 1) {
    const texture = createTexture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("Feedback framebuffer is incomplete.");
    framebuffers.push(framebuffer);
    framebufferTextures.push(texture);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  ping = 0;
  clearHistory();
}

function clearHistory() {
  if (!gl || framebuffers.length !== 2) return;
  framebuffers.forEach((framebuffer) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  });
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.floor(container.clientWidth * dpr));
  const height = Math.max(1, Math.floor(container.clientHeight * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    document.getElementById("sizeReadout").textContent = `${width} × ${height}`;
    if (gl && framebufferTextures.length === 2) createHistoryBuffers(width, height);
  }
}

function updateCameraTexture() {
  if (!cameraReady || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, cameraTexture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  try {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    cameraFrames += 1;
  } catch (error) {
    setCameraStatus("Texture upload failed", String(error?.message || error), "error");
  }
}

function render(nowMs) {
  const delta = Math.min(Math.max((nowMs - lastFrameMs) / 1000, 0), 0.1);
  lastFrameMs = nowMs;
  if (!renderPaused) elapsedSeconds += delta;

  if (gl && effectProgram && blitProgram && !gl.isContextLost() && framebuffers.length === 2) {
    resizeCanvas();
    if (!renderPaused) updateCameraTexture();

    if (!renderPaused) {
      const previous = 1 - ping;
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[ping]);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(effectProgram);
      configureQuad(effectProgram);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, cameraTexture);
      uniform1i(effectProgram, "u_webcam", 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, framebufferTextures[previous]);
      uniform1i(effectProgram, "u_history", 1);

      uniform1f(effectProgram, "u_time", elapsedSeconds);
      uniform2f(effectProgram, "u_resolution", canvas.width, canvas.height);
      uniform2f(effectProgram, "u_sourceResolution", sourceWidth, sourceHeight);
      uniform1f(effectProgram, "u_cameraReady", cameraReady ? 1 : 0);
      uniform1f(effectProgram, "u_effect", params.effect);
      uniform1f(effectProgram, "u_distortion", params.distortion);
      uniform1f(effectProgram, "u_feedback", params.feedback);
      uniform1f(effectProgram, "u_zoom", params.zoom);
      uniform1f(effectProgram, "u_speed", params.speed);
      uniform1f(effectProgram, "u_hue", params.hue);
      uniform1f(effectProgram, "u_saturation", params.saturation);
      uniform1f(effectProgram, "u_brightness", params.brightness);
      uniform1f(effectProgram, "u_contrast", params.contrast);
      uniform1f(effectProgram, "u_mirror", params.mirror);
      uniform1f(effectProgram, "u_invert", params.invert);
      uniform1f(effectProgram, "u_greyscale", params.greyscale);
      uniform1f(effectProgram, "u_fitMode", params.fitMode);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(blitProgram);
      configureQuad(blitProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, framebufferTextures[ping]);
      uniform1i(blitProgram, "u_texture", 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      ping = previous;
    }
  }

  fpsFrames += 1;
  const fpsElapsed = nowMs - fpsWindowStart;
  if (fpsElapsed >= 600) {
    document.getElementById("fpsReadout").textContent = String(Math.round((fpsFrames * 1000) / fpsElapsed));
    fpsFrames = 0;
    fpsWindowStart = nowMs;
  }
  const cameraElapsed = nowMs - cameraFpsWindowStart;
  if (cameraElapsed >= 1000) {
    document.getElementById("cameraFpsReadout").textContent = String(Math.round((cameraFrames * 1000) / cameraElapsed));
    cameraFrames = 0;
    cameraFpsWindowStart = nowMs;
  }

  animationHandle = requestAnimationFrame(render);
}

function getCaptureConstraints() {
  const preset = document.getElementById("capturePreset").value;
  const deviceId = document.getElementById("cam-select").value || activeDeviceId;
  const base = deviceId ? { deviceId: { exact: deviceId } } : {};
  if (preset === "480") return { ...base, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } };
  if (preset === "1080") return { ...base, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } };
  if (preset === "highest") return { ...base, width: { ideal: 3840 }, height: { ideal: 2160 }, frameRate: { ideal: 60 } };
  return { ...base, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
}

function stopStreamTracks() {
  if (activeStream) activeStream.getTracks().forEach((track) => track.stop());
  activeStream = null;
  video.srcObject = null;
  cameraReady = false;
  lastVideoTime = -1;
  document.getElementById("cameraFpsReadout").textContent = "0";
}

async function refreshCameraDevices(preferredId = activeDeviceId) {
  const select = document.getElementById("cam-select");
  if (!navigator.mediaDevices?.enumerateDevices) {
    select.innerHTML = '<option value="">Camera API unavailable</option>';
    document.getElementById("cam-btn").disabled = true;
    setCameraStatus("Unavailable", "This WebView does not expose navigator.mediaDevices.", "error");
    return;
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter((device) => device.kind === "videoinput");
    select.innerHTML = "";
    if (!cameras.length) {
      select.innerHTML = '<option value="">No cameras reported</option>';
      setCameraStatus("No devices", "Approve permission or attach a camera, then refresh.", "warning");
      return;
    }
    cameras.forEach((camera, index) => {
      const option = document.createElement("option");
      option.value = camera.deviceId;
      option.textContent = camera.label || `Camera ${index + 1}`;
      select.appendChild(option);
    });
    if (preferredId && Array.from(select.options).some((option) => option.value === preferredId)) select.value = preferredId;
    if (!cameraReady) setCameraStatus("Ready to request", `${cameras.length} camera input${cameras.length === 1 ? "" : "s"} reported.`, "warning");
  } catch (error) {
    select.innerHTML = '<option value="">Unable to enumerate</option>';
    setCameraStatus("Enumeration failed", String(error?.message || error), "error");
  }
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setCameraStatus("Unavailable", "getUserMedia is unavailable in this WebView.", "error");
    return;
  }
  const button = document.getElementById("cam-btn");
  button.disabled = true;
  setCameraStatus("Requesting permission", "Waiting for the operating-system camera response…", "warning");
  stopStreamTracks();
  try {
    activeStream = await navigator.mediaDevices.getUserMedia({ video: getCaptureConstraints(), audio: false });
    video.srcObject = activeStream;
    await video.play();
    const track = activeStream.getVideoTracks()[0];
    const settings = track?.getSettings?.() || {};
    activeDeviceId = settings.deviceId || document.getElementById("cam-select").value || "";
    sourceWidth = settings.width || video.videoWidth || 1280;
    sourceHeight = settings.height || video.videoHeight || 720;
    cameraReady = true;
    button.textContent = "Stop camera";
    document.getElementById("inputReadout").textContent = `${sourceWidth} × ${sourceHeight}`;
    document.getElementById("sourceName").textContent = track?.label || "Live camera";
    document.getElementById("sourceDetails").textContent = `${sourceWidth} × ${sourceHeight}${settings.frameRate ? ` · ${Math.round(settings.frameRate)} fps requested` : ""}`;
    setCameraStatus("Camera live", track?.label || `${sourceWidth} × ${sourceHeight} input`, "ok");
    setStatus(renderPaused ? "Camera live · rendering paused" : "Camera live · rendering through WebGL");
    await refreshCameraDevices(activeDeviceId);
    track?.addEventListener?.("ended", () => {
      if (cameraReady) stopCamera("Camera track ended");
    }, { once: true });
  } catch (error) {
    const name = error?.name || "CameraError";
    setCameraStatus(name, String(error?.message || error), "error");
    setStatus("Camera request failed · calibration source remains active", "error");
  } finally {
    button.disabled = false;
  }
}

function stopCamera(reason = "Camera stopped") {
  stopStreamTracks();
  document.getElementById("cam-btn").textContent = "Start camera";
  document.getElementById("inputReadout").textContent = "No camera";
  document.getElementById("sourceName").textContent = "Generated calibration source";
  document.getElementById("sourceDetails").textContent = "Start a camera to replace it";
  setCameraStatus("Not started", reason, "warning");
  setStatus(renderPaused ? "Rendering paused · no camera" : "Rendering calibration source · no camera");
}

function formatValue(id, value) {
  if (id === "hue") return `${Math.round(value)}°`;
  if (id === "speed") return `${value.toFixed(2)}×`;
  return value.toFixed(2);
}

function updateControlsFromParams() {
  ["distortion", "feedback", "zoom", "speed", "hue", "saturation", "brightness", "contrast"].forEach((id) => {
    const input = document.getElementById(id);
    input.value = String(params[id]);
    document.getElementById(`${id}-val`).textContent = formatValue(id, Number(params[id]));
  });
  document.getElementById("effect").value = String(params.effect);
  document.getElementById("fitMode").value = String(params.fitMode);
  ["mirror", "invert", "greyscale"].forEach((id) => { document.getElementById(id).checked = params[id] > 0.5; });
}

function applyPreset(name) {
  Object.assign(params, DEFAULT_PARAMS, PRESETS[name] || PRESETS.clean);
  updateControlsFromParams();
  clearHistory();
}

function resetExample() {
  Object.assign(params, DEFAULT_PARAMS);
  elapsedSeconds = 0;
  updateControlsFromParams();
  clearHistory();
  setStatus(renderPaused ? "Defaults restored · rendering paused" : cameraReady ? "Defaults restored · camera live" : "Defaults restored · calibration source");
}

async function toggleFullscreen() {
  try {
    const invoke = window.__TAURI__?.invoke || window.__TAURI__?.tauri?.invoke;
    if (invoke) await invoke("toggle_fullscreen");
    else if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  } catch (error) {
    setStatus(`Fullscreen error: ${error?.message || error}`, "error");
  }
}

function wireControls() {
  ["distortion", "feedback", "zoom", "speed", "hue", "saturation", "brightness", "contrast"].forEach((id) => {
    const input = document.getElementById(id);
    input.addEventListener("input", () => {
      params[id] = Number(input.value);
      document.getElementById(`${id}-val`).textContent = formatValue(id, params[id]);
    });
  });
  document.getElementById("effect").addEventListener("change", (event) => { params.effect = Number(event.target.value); });
  document.getElementById("fitMode").addEventListener("change", (event) => { params.fitMode = Number(event.target.value); });
  ["mirror", "invert", "greyscale"].forEach((id) => {
    document.getElementById(id).addEventListener("change", (event) => { params[id] = event.target.checked ? 1 : 0; });
  });
  document.querySelectorAll("[data-preset]").forEach((button) => button.addEventListener("click", () => applyPreset(button.dataset.preset)));
  document.getElementById("cam-btn").addEventListener("click", () => cameraReady ? stopCamera() : startCamera());
  document.getElementById("cam-refresh").addEventListener("click", () => refreshCameraDevices());
  document.getElementById("cam-select").addEventListener("change", () => { if (cameraReady) startCamera(); });
  document.getElementById("capturePreset").addEventListener("change", () => { if (cameraReady) startCamera(); });
  document.getElementById("compileBtn").addEventListener("click", rebuildPrograms);
  document.getElementById("clearBtn").addEventListener("click", clearHistory);
  document.getElementById("resetBtn").addEventListener("click", resetExample);
  document.getElementById("pauseBtn").addEventListener("click", () => {
    renderPaused = !renderPaused;
    document.getElementById("pauseBtn").textContent = renderPaused ? "Resume render" : "Pause render";
    setStatus(renderPaused ? "Rendering paused · camera stream remains open" : cameraReady ? "Camera live · rendering through WebGL" : "Rendering calibration source");
  });
  document.getElementById("fullscreenBtn").addEventListener("click", toggleFullscreen);
  window.addEventListener("keydown", (event) => {
    if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
    if (event.code === "Space") { event.preventDefault(); document.getElementById("pauseBtn").click(); }
    if (event.key.toLowerCase() === "r") resetExample();
    if (event.key.toLowerCase() === "x") clearHistory();
    if (event.key.toLowerCase() === "f") toggleFullscreen();
  });
}

function getRendererName() {
  const extension = gl.getExtension("WEBGL_debug_renderer_info");
  if (!extension) return "WebGL 1";
  return gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) || "WebGL 1";
}

function initializeWebGL() {
  gl = canvas.getContext("webgl", { alpha: false, antialias: false, preserveDrawingBuffer: false });
  if (!gl) {
    setDiagnostics("WebGL unavailable", "This WebView could not create a WebGL 1 context.", "error");
    setStatus("WebGL unavailable", "error");
    return;
  }
  quadBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

  cameraTexture = createTexture();
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  resizeCanvas();
  createHistoryBuffers(canvas.width, canvas.height);
  rebuildPrograms();
  document.getElementById("sourceDetails").textContent = `${getRendererName()} · start a camera to replace calibration`;

  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    setDiagnostics("Context lost", "The WebGL context was lost. Waiting for WebKit to restore it…", "error");
    setStatus("WebGL context lost", "error");
  });
  canvas.addEventListener("webglcontextrestored", () => {
    effectProgram = null;
    blitProgram = null;
    framebuffers = [];
    framebufferTextures = [];
    initializeWebGL();
  }, { once: true });
}

function cleanup() {
  cancelAnimationFrame(animationHandle);
  stopStreamTracks();
  resizeObserver?.disconnect();
}

function start() {
  wireControls();
  updateControlsFromParams();
  resizeObserver = new ResizeObserver(resizeCanvas);
  resizeObserver.observe(container);
  initializeWebGL();
  refreshCameraDevices();
  navigator.mediaDevices?.addEventListener?.("devicechange", () => refreshCameraDevices());
  setCameraStatus("Not started", "Choose a camera or use the default input, then approve permission.", "warning");
  animationHandle = requestAnimationFrame(render);
}

window.addEventListener("beforeunload", cleanup);
document.addEventListener("DOMContentLoaded", start, { once: true });
