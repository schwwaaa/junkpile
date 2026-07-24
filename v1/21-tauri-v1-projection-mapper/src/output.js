const canvas = document.getElementById("output-canvas");
const patternCanvas = document.getElementById("pattern-canvas");
const sourceVideo = document.getElementById("source-video");
const cameraVideo = document.getElementById("camera-video");
const hudSource = document.getElementById("hud-source");
const hudSize = document.getElementById("hud-size");
const outputError = document.getElementById("output-error");
const outputErrorMessage = document.getElementById("output-error-message");
const tauriEvent = window.__TAURI__?.event;
const tauriWindow = window.__TAURI__?.window;
const tauriDialog = window.__TAURI__?.dialog;
const tauriFs = window.__TAURI__?.fs;

const state = {
  gl: null,
  program: null,
  positionBuffer: null,
  uvBuffer: null,
  vertexCount: 0,
  texture: null,
  image: null,
  imageUrl: "",
  mediaKey: "",
  cameraStream: null,
  monitors: [],
  payload: {
    source: { kind: "pattern", pattern: 0, url: "", name: "Calibration field", speed: 1, fit: "cover", cameraDeviceId: "" },
    mesh: { size: 2, points: [{x:0,y:0},{x:1,y:0},{x:0,y:1},{x:1,y:1}] },
    transform: { zoom: 1, panX: 0, panY: 0, rotation: 0, mirrorX: false, mirrorY: false },
    feather: { left: 0, right: 0, top: 0, bottom: 0, blackLevel: 0, brightness: 1, gamma: 1 },
    calibration: { showGrid: false, showPoints: false, opacity: 0.75, density: 12 },
    blackout: false
  },
  lastTime: performance.now(),
  fpsTime: performance.now(),
  fpsFrames: 0,
  fps: 0,
  lastStatusAt: 0,
  meshDirty: true,
  sourceDirty: true,
  videoPlaying: true
};

const vertexShader = `
  attribute vec2 a_position;
  attribute vec2 a_uv;
  varying vec2 v_uv;
  void main() {
    v_uv = a_uv;
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

const fragmentShader = `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_source;
  uniform vec2 u_sourceSize;
  uniform vec2 u_resolution;
  uniform int u_fit;
  uniform float u_zoom;
  uniform vec2 u_pan;
  uniform float u_rotation;
  uniform vec2 u_mirror;
  uniform vec4 u_feather;
  uniform float u_blackLevel;
  uniform float u_brightness;
  uniform float u_gamma;
  uniform float u_showGrid;
  uniform float u_showPoints;
  uniform float u_gridOpacity;
  uniform float u_gridDensity;
  uniform float u_meshSize;
  uniform float u_blackout;

  vec2 transformUv(vec2 uv) {
    vec2 p = uv - 0.5;
    p.x *= mix(1.0, -1.0, u_mirror.x);
    p.y *= mix(1.0, -1.0, u_mirror.y);
    p /= max(u_zoom, 0.001);
    float c = cos(u_rotation);
    float s = sin(u_rotation);
    p = mat2(c, -s, s, c) * p;
    p -= u_pan;
    return p + 0.5;
  }

  vec3 sampleFramed(vec2 uv) {
    vec2 p = transformUv(uv);
    float sourceAspect = max(u_sourceSize.x, 1.0) / max(u_sourceSize.y, 1.0);
    float outputAspect = max(u_resolution.x, 1.0) / max(u_resolution.y, 1.0);
    vec2 framed = p;
    if (u_fit == 0) {
      if (sourceAspect > outputAspect) framed.x = (p.x - 0.5) * outputAspect / sourceAspect + 0.5;
      else framed.y = (p.y - 0.5) * sourceAspect / outputAspect + 0.5;
    } else if (u_fit == 1) {
      if (sourceAspect > outputAspect) framed.y = (p.y - 0.5) * sourceAspect / outputAspect + 0.5;
      else framed.x = (p.x - 0.5) * outputAspect / sourceAspect + 0.5;
      if (framed.x < 0.0 || framed.x > 1.0 || framed.y < 0.0 || framed.y > 1.0) return vec3(0.0);
    }
    if (framed.x < 0.0 || framed.x > 1.0 || framed.y < 0.0 || framed.y > 1.0) return vec3(0.0);
    return texture2D(u_source, framed).rgb;
  }

  float edgeAlpha(vec2 uv) {
    float left = u_feather.x <= 0.0001 ? 1.0 : smoothstep(0.0, u_feather.x, uv.x);
    float right = u_feather.y <= 0.0001 ? 1.0 : smoothstep(0.0, u_feather.y, 1.0 - uv.x);
    float top = u_feather.z <= 0.0001 ? 1.0 : smoothstep(0.0, u_feather.z, 1.0 - uv.y);
    float bottom = u_feather.w <= 0.0001 ? 1.0 : smoothstep(0.0, u_feather.w, uv.y);
    return left * right * top * bottom;
  }

  float lineMask(float value, float density, float width) {
    float cell = abs(fract(value * density) - 0.5);
    return 1.0 - smoothstep(0.5 - width, 0.5, cell);
  }

  vec3 calibrationOverlay(vec2 uv, vec3 color) {
    float gx = lineMask(uv.x, u_gridDensity, 0.035);
    float gy = lineMask(uv.y, u_gridDensity, 0.035);
    float grid = max(gx, gy) * u_showGrid;
    float mx = lineMask(uv.x, max(u_meshSize - 1.0, 1.0), 0.08);
    float my = lineMask(uv.y, max(u_meshSize - 1.0, 1.0), 0.08);
    float points = mx * my * u_showPoints;
    vec3 gridColor = mix(vec3(0.05, 0.85, 1.0), vec3(1.0, 0.15, 0.4), step(0.5, fract((floor(uv.x * u_gridDensity) + floor(uv.y * u_gridDensity)) * 0.5)));
    color = mix(color, gridColor, grid * u_gridOpacity);
    color = mix(color, vec3(0.55, 1.0, 0.3), points * u_gridOpacity);
    float crossX = 1.0 - smoothstep(0.001, 0.004, abs(uv.x - 0.5));
    float crossY = 1.0 - smoothstep(0.001, 0.004, abs(uv.y - 0.5));
    color = mix(color, vec3(1.0), max(crossX, crossY) * u_showGrid * u_gridOpacity);
    return color;
  }

  void main() {
    if (u_blackout > 0.5) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }
    vec3 color = sampleFramed(v_uv);
    color = max(color + u_blackLevel, vec3(0.0));
    color *= u_brightness;
    color = pow(max(color, vec3(0.0)), vec3(1.0 / max(u_gamma, 0.001)));
    color = calibrationOverlay(v_uv, color);
    color *= edgeAlpha(v_uv);
    gl_FragColor = vec4(color, 1.0);
  }
`;

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || "Shader compilation failed";
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(gl, vertexSource, fragmentSource) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
  gl.deleteShader(vertex); gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || "Program linking failed";
    gl.deleteProgram(program); throw new Error(message);
  }
  return program;
}

function initializeWebGL() {
  const gl = canvas.getContext("webgl", { alpha: false, antialias: true, preserveDrawingBuffer: true });
  if (!gl) throw new Error("WebGL 1 is unavailable in the projection output WebView.");
  state.gl = gl;
  state.program = createProgram(gl, vertexShader, fragmentShader);
  state.positionBuffer = gl.createBuffer(); state.uvBuffer = gl.createBuffer();
  state.texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, state.texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([12, 18, 24, 255]));
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

  const uniforms = ["u_source","u_sourceSize","u_resolution","u_fit","u_zoom","u_pan","u_rotation","u_mirror","u_feather","u_blackLevel","u_brightness","u_gamma","u_showGrid","u_showPoints","u_gridOpacity","u_gridDensity","u_meshSize","u_blackout"];
  state.locations = { position: gl.getAttribLocation(state.program, "a_position"), uv: gl.getAttribLocation(state.program, "a_uv") };
  uniforms.forEach((name) => { state.locations[name] = gl.getUniformLocation(state.program, name); });
  gl.useProgram(state.program); gl.uniform1i(state.locations.u_source, 0);
}

function rebuildMesh() {
  const gl = state.gl; const mesh = state.payload.mesh; const size = Math.max(2, Number(mesh.size) || 2);
  if (!Array.isArray(mesh.points) || mesh.points.length !== size * size) return;
  const positions = []; const uvs = [];
  const pushVertex = (pointIndex, u, v) => {
    const point = mesh.points[pointIndex]; positions.push(point.x * 2 - 1, 1 - point.y * 2); uvs.push(u, 1 - v);
  };
  for (let row = 0; row < size - 1; row += 1) {
    for (let col = 0; col < size - 1; col += 1) {
      const i00 = row * size + col; const i10 = i00 + 1; const i01 = i00 + size; const i11 = i01 + 1;
      const u0 = col / (size - 1); const u1 = (col + 1) / (size - 1); const v0 = row / (size - 1); const v1 = (row + 1) / (size - 1);
      pushVertex(i00, u0, v0); pushVertex(i10, u1, v0); pushVertex(i01, u0, v1);
      pushVertex(i01, u0, v1); pushVertex(i10, u1, v0); pushVertex(i11, u1, v1);
    }
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, state.positionBuffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, state.uvBuffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uvs), gl.STATIC_DRAW);
  state.vertexCount = positions.length / 2; state.meshDirty = false;
}

function fitModeValue(mode) { return mode === "cover" ? 0 : mode === "contain" ? 1 : 2; }

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(canvas.clientWidth * dpr)); const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; hudSize.textContent = `${width} × ${height}`; }
}

function drawPattern(time) {
  const ctx = patternCanvas.getContext("2d"); const w = patternCanvas.width; const h = patternCanvas.height;
  const speed = Number(state.payload.source.speed) || 1; const t = time * speed; const type = Number(state.payload.source.pattern) || 0;
  ctx.clearRect(0, 0, w, h);
  if (type === 0) {
    ctx.fillStyle = "#0a0f14"; ctx.fillRect(0, 0, w, h);
    const gradient = ctx.createRadialGradient(w * .5, h * .5, 10, w * .5, h * .5, w * .65); gradient.addColorStop(0, "#203848"); gradient.addColorStop(1, "#04070a"); ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(110,230,255,.55)"; ctx.lineWidth = 2;
    for (let x = 0; x <= 16; x += 1) { ctx.beginPath(); ctx.moveTo((x/16)*w,0); ctx.lineTo((x/16)*w,h); ctx.stroke(); }
    for (let y = 0; y <= 9; y += 1) { ctx.beginPath(); ctx.moveTo(0,(y/9)*h); ctx.lineTo(w,(y/9)*h); ctx.stroke(); }
    ctx.strokeStyle = "#79ff9f"; ctx.lineWidth = 4; ctx.strokeRect(4,4,w-8,h-8);
    ctx.fillStyle = "white"; ctx.font = "700 38px ui-monospace, monospace"; ctx.textAlign = "center"; ctx.fillText("JUNKPILE PROJECTION CALIBRATION", w/2, h/2 - 10); ctx.font = "20px ui-monospace, monospace"; ctx.fillText(`${w} × ${h} · ${new Date().toLocaleTimeString()}`, w/2, h/2 + 32);
    [[0,0,"TL"],[1,0,"TR"],[0,1,"BL"],[1,1,"BR"]].forEach(([x,y,label]) => { ctx.fillStyle = x===y ? "#ff5579" : "#ffb36b"; ctx.font = "800 28px ui-monospace, monospace"; ctx.textAlign = x ? "right" : "left"; ctx.fillText(label, x ? w-28 : 28, y ? h-28 : 50); });
  } else if (type === 1) {
    const gradient = ctx.createLinearGradient(0,0,w,h); gradient.addColorStop(0,"#ff3478"); gradient.addColorStop(.35,"#673cff"); gradient.addColorStop(.7,"#00d5ff"); gradient.addColorStop(1,"#79ff9f"); ctx.fillStyle = gradient; ctx.fillRect(0,0,w,h);
    ctx.globalCompositeOperation = "difference"; ctx.strokeStyle = "white"; ctx.lineWidth = 8;
    for (let i=0;i<12;i+=1) { ctx.beginPath(); ctx.arc(w*.5,h*.5,30+i*42,0,Math.PI*2); ctx.stroke(); }
    ctx.globalCompositeOperation = "source-over";
  } else if (type === 2) {
    ctx.fillStyle = "#03050a"; ctx.fillRect(0,0,w,h); ctx.save(); ctx.translate(w/2,h/2);
    for (let i=0;i<28;i+=1) { const radius=18+i*13; ctx.strokeStyle=`hsla(${(i*27+t*60)%360},90%,65%,.8)`; ctx.lineWidth=3; ctx.beginPath(); ctx.ellipse(Math.cos(t+i*.2)*18,Math.sin(t*.7+i*.17)*15,radius,radius*.45, t*.2+i*.08,0,Math.PI*2); ctx.stroke(); }
    ctx.restore();
  } else {
    const bars=["#ffffff","#f4e84b","#42e7ef","#53de70","#e148e8","#ef4c4c","#385eff","#080808"]; const offset=((t*140)% (w/bars.length));
    bars.forEach((color,index)=>{ctx.fillStyle=color;ctx.fillRect(index*w/bars.length-offset,0,w/bars.length+2,h);ctx.fillRect(index*w/bars.length-offset+w,0,w/bars.length+2,h);});
    ctx.fillStyle="rgba(0,0,0,.35)"; for(let y=0;y<h;y+=6) ctx.fillRect(0,y,w,2);
  }
}

function currentSourceElement(time) {
  const source = state.payload.source;
  if (source.kind === "pattern") { drawPattern(time); return patternCanvas; }
  if (source.kind === "image" && state.image?.complete) return state.image;
  if (source.kind === "video" && sourceVideo.readyState >= 2) return sourceVideo;
  if (source.kind === "camera" && cameraVideo.readyState >= 2) return cameraVideo;
  drawPattern(time); return patternCanvas;
}

function sourceDimensions(element) {
  if (element instanceof HTMLVideoElement) return [element.videoWidth || 1, element.videoHeight || 1];
  if (element instanceof HTMLImageElement) return [element.naturalWidth || 1, element.naturalHeight || 1];
  return [element.width || 1, element.height || 1];
}

function updateSourceFromPayload() {
  const source = state.payload.source;
  const key = `${source.kind}|${source.url || ""}`;
  if (key === state.mediaKey) {
    if (source.kind === "video") sourceVideo.playbackRate = Math.max(.1, Math.min(3, Number(source.speed) || 1));
    return;
  }
  state.mediaKey = key;
  if (source.kind === "image" && source.url) {
    const image = new Image(); image.onload = () => { state.image = image; hudSource.textContent = source.name || "Image"; emitStatus({ source: source.name || "Image loaded" }); }; image.onerror = () => emitStatus({ message: "Image could not be decoded" }); image.src = source.url; state.image = image;
  } else if (source.kind === "video" && source.url) {
    sourceVideo.src = source.url; sourceVideo.playbackRate = Math.max(.1, Math.min(3, Number(source.speed) || 1)); sourceVideo.play().then(() => { state.videoPlaying = true; hudSource.textContent = source.name || "Video"; emitStatus({ source: source.name || "Video", videoPlaying: true }); }).catch((error) => emitStatus({ message: `Video play blocked: ${error.message || error}` }));
  } else if (source.kind === "pattern") {
    sourceVideo.pause(); sourceVideo.removeAttribute("src"); sourceVideo.load(); state.image = null; hudSource.textContent = source.name || "Generated pattern";
  }
}

async function startCamera(deviceId = "") {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera capture is unavailable in this WebView.");
  stopCamera();
  const video = deviceId ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } } : { width: { ideal: 1920 }, height: { ideal: 1080 } };
  state.cameraStream = await navigator.mediaDevices.getUserMedia({ video, audio: false }); cameraVideo.srcObject = state.cameraStream; await cameraVideo.play();
  state.payload.source.kind = "camera"; state.mediaKey = "camera"; hudSource.textContent = "Webcam"; emitStatus({ source: "Webcam active", cameraActive: true }); await refreshCameras();
}

function stopCamera() {
  state.cameraStream?.getTracks().forEach((track) => track.stop()); state.cameraStream = null; cameraVideo.srcObject = null; emitStatus({ cameraActive: false });
}

async function refreshCameras() {
  if (!navigator.mediaDevices?.enumerateDevices) { emitCameras([]); return; }
  const devices = await navigator.mediaDevices.enumerateDevices();
  emitCameras(devices.filter((device) => device.kind === "videoinput").map((device) => ({ deviceId: device.deviceId, label: device.label })));
}

function uploadTexture(element) {
  const gl = state.gl; gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, state.texture);
  try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, element); } catch (error) { console.warn("Texture upload failed", error); }
}

function drawFrame(now) {
  resizeCanvas(); if (state.meshDirty) rebuildMesh(); updateSourceFromPayload();
  const gl = state.gl; const time = now * 0.001; const sourceElement = currentSourceElement(time); uploadTexture(sourceElement);
  const [sourceWidth, sourceHeight] = sourceDimensions(sourceElement); const payload = state.payload;
  gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(0,0,0,1); gl.clear(gl.COLOR_BUFFER_BIT); gl.useProgram(state.program);
  gl.bindBuffer(gl.ARRAY_BUFFER, state.positionBuffer); gl.enableVertexAttribArray(state.locations.position); gl.vertexAttribPointer(state.locations.position, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, state.uvBuffer); gl.enableVertexAttribArray(state.locations.uv); gl.vertexAttribPointer(state.locations.uv, 2, gl.FLOAT, false, 0, 0);
  gl.uniform2f(state.locations.u_sourceSize, sourceWidth, sourceHeight); gl.uniform2f(state.locations.u_resolution, canvas.width, canvas.height); gl.uniform1i(state.locations.u_fit, fitModeValue(payload.source.fit));
  gl.uniform1f(state.locations.u_zoom, payload.transform.zoom); gl.uniform2f(state.locations.u_pan, payload.transform.panX, payload.transform.panY); gl.uniform1f(state.locations.u_rotation, payload.transform.rotation * Math.PI / 180); gl.uniform2f(state.locations.u_mirror, payload.transform.mirrorX ? 1 : 0, payload.transform.mirrorY ? 1 : 0);
  gl.uniform4f(state.locations.u_feather, payload.feather.left, payload.feather.right, payload.feather.top, payload.feather.bottom); gl.uniform1f(state.locations.u_blackLevel, payload.feather.blackLevel); gl.uniform1f(state.locations.u_brightness, payload.feather.brightness); gl.uniform1f(state.locations.u_gamma, payload.feather.gamma);
  gl.uniform1f(state.locations.u_showGrid, payload.calibration.showGrid ? 1 : 0); gl.uniform1f(state.locations.u_showPoints, payload.calibration.showPoints ? 1 : 0); gl.uniform1f(state.locations.u_gridOpacity, payload.calibration.opacity); gl.uniform1f(state.locations.u_gridDensity, payload.calibration.density); gl.uniform1f(state.locations.u_meshSize, payload.mesh.size); gl.uniform1f(state.locations.u_blackout, payload.blackout ? 1 : 0);
  gl.drawArrays(gl.TRIANGLES, 0, state.vertexCount);

  state.fpsFrames += 1; if (now - state.fpsTime >= 500) { state.fps = state.fpsFrames * 1000 / (now - state.fpsTime); state.fpsFrames = 0; state.fpsTime = now; }
  if (now - state.lastStatusAt > 500) { state.lastStatusAt = now; emitStatus({ width: canvas.width, height: canvas.height, fps: state.fps, source: payload.source.name || payload.source.kind, videoPlaying: state.videoPlaying, cameraActive: Boolean(state.cameraStream) }); }
  requestAnimationFrame(drawFrame);
}

async function emitStatus(payload) { if (tauriEvent) await tauriEvent.emit("projection-status", payload); }
async function emitCameras(payload) { if (tauriEvent) await tauriEvent.emit("projection-cameras", payload); }

async function refreshMonitors() {
  try {
    const monitors = tauriWindow?.availableMonitors ? await tauriWindow.availableMonitors() : [];
    state.monitors = monitors || [];
    const simple = state.monitors.map((monitor) => ({ name: monitor.name || "Display", width: monitor.size?.width || 0, height: monitor.size?.height || 0, x: monitor.position?.x || 0, y: monitor.position?.y || 0, scaleFactor: monitor.scaleFactor || 1 }));
    if (tauriEvent) await tauriEvent.emit("projection-monitors", simple);
  } catch (error) { console.warn("Monitor enumeration failed", error); if (tauriEvent) await tauriEvent.emit("projection-monitors", []); }
}

async function moveToMonitor(index, fullscreen = false) {
  const monitor = state.monitors[index] || state.monitors[0]; const appWindow = tauriWindow?.appWindow;
  if (!monitor || !appWindow) { emitStatus({ message: "Display placement API unavailable" }); return; }
  try {
    await appWindow.setFullscreen(false);
    const Position = tauriWindow.PhysicalPosition || tauriWindow.LogicalPosition; const Size = tauriWindow.PhysicalSize || tauriWindow.LogicalSize;
    if (Position && monitor.position) await appWindow.setPosition(new Position(monitor.position.x, monitor.position.y));
    if (Size && monitor.size) await appWindow.setSize(new Size(monitor.size.width, monitor.size.height));
    if (fullscreen) await appWindow.setFullscreen(true);
    await appWindow.show(); await appWindow.setFocus();
    emitStatus({ message: fullscreen ? `Fullscreen on display ${index + 1}` : `Moved to display ${index + 1}` });
  } catch (error) { console.error(error); emitStatus({ message: `Could not move output: ${error.message || error}` }); }
}

async function toggleFullscreen(index) {
  const appWindow = tauriWindow?.appWindow; if (!appWindow) return;
  try { const isFullscreen = await appWindow.isFullscreen(); if (isFullscreen) { await appWindow.setFullscreen(false); emitStatus({ message: "Output windowed" }); } else { await moveToMonitor(index, true); } } catch (error) { emitStatus({ message: `Fullscreen failed: ${error.message || error}` }); }
}

function timestampName() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-"); return `junkpile-21-projection-${stamp}.png`;
}

async function snapshot() {
  try {
    const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("PNG creation failed")), "image/png"));
    const suggestedName = timestampName();
    if (tauriDialog?.save && tauriFs?.writeBinaryFile) {
      const path = await tauriDialog.save({ defaultPath: suggestedName, filters: [{ name: "PNG image", extensions: ["png"] }] });
      if (!path) return; await tauriFs.writeBinaryFile(path, new Uint8Array(await blob.arrayBuffer())); emitStatus({ message: `Saved ${path}` });
    } else {
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = suggestedName; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); emitStatus({ message: "PNG downloaded" });
    }
  } catch (error) { emitStatus({ message: `Snapshot failed: ${error.message || error}` }); }
}

async function handleCommand(payload = {}) {
  switch (payload.command) {
    case "ping": if (tauriEvent) await tauriEvent.emit("projection-ready", { ready: true }); break;
    case "refresh-monitors": await refreshMonitors(); break;
    case "move-monitor": await moveToMonitor(Number(payload.index) || 0, false); break;
    case "toggle-fullscreen": await toggleFullscreen(Number(payload.index) || 0); break;
    case "show-output": await tauriWindow?.appWindow?.show(); break;
    case "hide-output": await tauriWindow?.appWindow?.hide(); break;
    case "snapshot": await snapshot(); break;
    case "refresh-cameras": await refreshCameras(); break;
    case "start-camera": try { await startCamera(payload.deviceId || ""); } catch (error) { emitStatus({ message: `Camera failed: ${error.message || error}`, cameraActive: false }); } break;
    case "stop-camera": stopCamera(); break;
    case "toggle-video": if (sourceVideo.paused) { await sourceVideo.play(); state.videoPlaying = true; } else { sourceVideo.pause(); state.videoPlaying = false; } emitStatus({ videoPlaying: state.videoPlaying }); break;
    default: break;
  }
}

async function bindEvents() {
  if (!tauriEvent) return;
  await tauriEvent.listen("projection-state", (event) => {
    const next = event.payload; if (!next) return;
    const previousMesh = JSON.stringify(state.payload.mesh); state.payload = next;
    if (JSON.stringify(next.mesh) !== previousMesh) state.meshDirty = true;
    updateSourceFromPayload();
  });
  await tauriEvent.listen("projection-command", (event) => handleCommand(event.payload));
  navigator.mediaDevices?.addEventListener?.("devicechange", refreshCameras);
}

async function initialize() {
  initializeWebGL(); await bindEvents(); await refreshMonitors(); await refreshCameras();
  if (tauriWindow?.appWindow?.onCloseRequested) {
    await tauriWindow.appWindow.onCloseRequested(async (event) => {
      event.preventDefault();
      await tauriWindow.appWindow.hide();
      emitStatus({ message: "Output hidden — use Show to reopen" });
    });
  }
  if (tauriEvent) await tauriEvent.emit("projection-ready", { ready: true });
  requestAnimationFrame(drawFrame);
}

initialize().catch((error) => {
  console.error(error); outputError.classList.remove("hidden"); outputErrorMessage.textContent = error.message || String(error); emitStatus({ message: error.message || String(error) });
});

window.addEventListener("beforeunload", stopCamera);
