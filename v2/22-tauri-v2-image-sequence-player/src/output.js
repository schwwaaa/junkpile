const canvas = document.getElementById("output-canvas");
const hudName = document.getElementById("hud-name");
const hudFrame = document.getElementById("hud-frame");
const hudSize = document.getElementById("hud-size");
const outputError = document.getElementById("output-error");
const outputErrorMessage = document.getElementById("output-error-message");

const tauriEvent = window.__TAURI__?.event ?? null;
const tauriCore = window.__TAURI__?.core ?? null;
const tauriDialog = window.__TAURI__?.dialog ?? null;
const invoke = tauriCore?.invoke?.bind(tauriCore) ?? null;

const defaultConfig = {
  playback: { fps: 24, rate: 1, loopMode: "loop", handling: "hold", inFrame: 0, outFrame: 179, interpolate: true },
  cache: { strategy: "window", radius: 12 },
  image: { fit: "contain", background: "#05070a", zoom: 1, rotation: 0, panX: 0, panY: 0, brightness: 1, contrast: 1, saturation: 1, gamma: 1, mirrorX: false, mirrorY: false, showGrid: false }
};

const state = {
  gl: null,
  program: null,
  locations: {},
  buffers: {},
  textures: [],
  config: JSON.parse(JSON.stringify(defaultConfig)),
  mode: "demo",
  name: "Generated demo",
  paths: [],
  count: 180,
  frame: 0,
  direction: 1,
  playing: false,
  requestedPlaying: false,
  buffering: false,
  dropped: 0,
  lastTime: performance.now(),
  lastTelemetry: 0,
  fpsFrames: 0,
  fpsWindowStart: performance.now(),
  outputFps: 0,
  sourceWidth: 1280,
  sourceHeight: 720,
  cache: new Map(),
  loadQueue: [],
  activeLoads: 0,
  maxLoads: 4,
  cacheGeneration: 0,
  uploadedA: null,
  uploadedB: null,
  lastReadySource: null,
  lastPresentedFrame: 0,
  monitors: [],
  demoCanvasA: document.createElement("canvas"),
  demoCanvasB: document.createElement("canvas")
};
state.demoCanvasA.width = state.demoCanvasB.width = 1280;
state.demoCanvasA.height = state.demoCanvasB.height = 720;

const vertexShader = `
  attribute vec2 a_position;
  varying vec2 v_uv;
  void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

const fragmentShader = `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_frameA;
  uniform sampler2D u_frameB;
  uniform vec2 u_sourceSize;
  uniform vec2 u_resolution;
  uniform float u_blend;
  uniform int u_fit;
  uniform float u_zoom;
  uniform vec2 u_pan;
  uniform float u_rotation;
  uniform vec2 u_mirror;
  uniform vec3 u_background;
  uniform float u_brightness;
  uniform float u_contrast;
  uniform float u_saturation;
  uniform float u_gamma;
  uniform float u_showGrid;

  vec2 transformedUv(vec2 uv) {
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

  vec4 framedSample(sampler2D tex, vec2 uv) {
    vec2 p = transformedUv(uv);
    float sourceAspect = max(u_sourceSize.x, 1.0) / max(u_sourceSize.y, 1.0);
    float outputAspect = max(u_resolution.x, 1.0) / max(u_resolution.y, 1.0);
    vec2 framed = p;
    if (u_fit == 1) {
      if (sourceAspect > outputAspect) framed.x = (p.x - 0.5) * outputAspect / sourceAspect + 0.5;
      else framed.y = (p.y - 0.5) * sourceAspect / outputAspect + 0.5;
    } else if (u_fit == 0) {
      if (sourceAspect > outputAspect) framed.y = (p.y - 0.5) * sourceAspect / outputAspect + 0.5;
      else framed.x = (p.x - 0.5) * outputAspect / sourceAspect + 0.5;
    }
    if (framed.x < 0.0 || framed.x > 1.0 || framed.y < 0.0 || framed.y > 1.0) return vec4(0.0);
    return vec4(texture2D(tex, framed).rgb, 1.0);
  }

  vec3 grade(vec3 color) {
    color = (color - 0.5) * u_contrast + 0.5;
    float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color = mix(vec3(luma), color, u_saturation);
    color *= u_brightness;
    return pow(max(color, vec3(0.0)), vec3(1.0 / max(u_gamma, 0.001)));
  }

  float gridLine(float value, float density) {
    float distanceToLine = abs(fract(value * density) - 0.5);
    return 1.0 - smoothstep(0.47, 0.5, distanceToLine);
  }

  void main() {
    vec4 a = framedSample(u_frameA, v_uv);
    vec4 b = framedSample(u_frameB, v_uv);
    vec4 frame = mix(a, b, clamp(u_blend, 0.0, 1.0));
    vec3 color = mix(u_background, frame.rgb, frame.a);
    color = grade(color);
    float grid = max(gridLine(v_uv.x, 12.0), gridLine(v_uv.y, 12.0)) * u_showGrid;
    float center = max(1.0 - smoothstep(0.001, 0.004, abs(v_uv.x - 0.5)), 1.0 - smoothstep(0.001, 0.004, abs(v_uv.y - 0.5))) * u_showGrid;
    color = mix(color, vec3(0.2, 0.9, 1.0), grid * 0.55);
    color = mix(color, vec3(1.0), center * 0.75);
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

function createProgram(gl, vsSource, fsSource) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vsSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
  gl.deleteShader(vertex); gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || "Program linking failed";
    gl.deleteProgram(program); throw new Error(message);
  }
  return program;
}

function createTexture(gl, unit) {
  const texture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([8, 12, 17, 255]));
  return texture;
}

function initializeWebGL() {
  const gl = canvas.getContext("webgl", { alpha: false, antialias: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error("WebGL 1 is unavailable in the image-sequence output WebView.");
  state.gl = gl;
  state.program = createProgram(gl, vertexShader, fragmentShader);
  const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
  state.buffers.position = buffer;
  state.textures = [createTexture(gl, 0), createTexture(gl, 1)];
  const names = ["u_frameA","u_frameB","u_sourceSize","u_resolution","u_blend","u_fit","u_zoom","u_pan","u_rotation","u_mirror","u_background","u_brightness","u_contrast","u_saturation","u_gamma","u_showGrid"];
  state.locations.position = gl.getAttribLocation(state.program, "a_position");
  names.forEach((name) => { state.locations[name] = gl.getUniformLocation(state.program, name); });
  gl.useProgram(state.program); gl.uniform1i(state.locations.u_frameA, 0); gl.uniform1i(state.locations.u_frameB, 1);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
}

function fitModeValue(value) { return value === "contain" ? 0 : value === "cover" ? 1 : 2; }
function hexRgb(hex) {
  const value = String(hex || "#000000").replace("#", "");
  const normalized = value.length === 3 ? value.split("").map((c) => c + c).join("") : value.padEnd(6, "0");
  return [parseInt(normalized.slice(0,2),16)/255, parseInt(normalized.slice(2,4),16)/255, parseInt(normalized.slice(4,6),16)/255];
}

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width; canvas.height = height; hudSize.textContent = `${width} × ${height}`;
  }
}

function normalizeIndex(index) {
  const count = Math.max(1, state.count);
  return ((Math.floor(index) % count) + count) % count;
}

function cacheCounts() {
  let ready = 0, loading = 0, errors = 0;
  state.cache.forEach((entry) => { if (entry.status === "ready") ready += 1; else if (entry.status === "loading" || entry.status === "queued") loading += 1; else if (entry.status === "error") errors += 1; });
  return { ready, loading, errors };
}

function disposeEntry(entry) {
  if (entry?.image) { entry.image.onload = null; entry.image.onerror = null; entry.image.src = ""; }
  if (entry?.objectUrl) URL.revokeObjectURL(entry.objectUrl);
}

function clearCache() {
  state.cacheGeneration += 1;
  state.cache.forEach(disposeEntry);
  state.cache.clear(); state.loadQueue.length = 0; state.uploadedA = null; state.uploadedB = null; state.lastReadySource = null;
}

function queueFrame(index, priority = false) {
  if (state.mode !== "files" || !state.paths.length) return;
  const normalized = normalizeIndex(index);
  const existing = state.cache.get(normalized);
  if (existing && existing.status !== "error") { existing.lastUse = performance.now(); return; }
  const entry = { status: "queued", image: null, error: "", lastUse: performance.now(), generation: state.cacheGeneration };
  state.cache.set(normalized, entry);
  if (priority) state.loadQueue.unshift(normalized); else state.loadQueue.push(normalized);
  pumpLoads();
}

function frameMimeType(path) {
  const extension = String(path || "").split(".").pop()?.toLowerCase();
  return ({ png:"image/png", jpg:"image/jpeg", jpeg:"image/jpeg", webp:"image/webp", gif:"image/gif", bmp:"image/bmp", tif:"image/tiff", tiff:"image/tiff", avif:"image/avif" })[extension] || "application/octet-stream";
}

async function decodeFrame(index, entry, generation) {
  try {
    if (!invoke) throw new Error("Native frame reader is unavailable");
    const bytes = await invoke("read_image_file", { path: state.paths[index] });
    if (generation !== state.cacheGeneration || !state.cache.has(index)) return;
    const objectUrl = URL.createObjectURL(new Blob([bytes], { type: frameMimeType(state.paths[index]) }));
    entry.objectUrl = objectUrl;
    const image = new Image();
    entry.image = image;
    image.decoding = "async";
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error(`Could not decode ${state.paths[index]}`));
      image.src = objectUrl;
    });
    if (generation !== state.cacheGeneration || !state.cache.has(index)) { disposeEntry(entry); return; }
    entry.status = "ready"; entry.lastUse = performance.now();
    if (!state.sourceWidth || state.sourceWidth === 1 || index === 0) {
      state.sourceWidth = image.naturalWidth || image.width;
      state.sourceHeight = image.naturalHeight || image.height;
    }
    maybeFinishBuffering();
  } catch (error) {
    if (generation === state.cacheGeneration && state.cache.has(index)) {
      entry.status = "error"; entry.error = error.message || String(error);
      disposeEntry(entry);
    }
  } finally {
    state.activeLoads = Math.max(0, state.activeLoads - 1);
    pumpLoads();
  }
}

function pumpLoads() {
  while (state.activeLoads < state.maxLoads && state.loadQueue.length) {
    const index = state.loadQueue.shift();
    const entry = state.cache.get(index);
    if (!entry || entry.status !== "queued") continue;
    entry.status = "loading"; state.activeLoads += 1;
    void decodeFrame(index, entry, state.cacheGeneration);
  }
}

function frameEntry(index) {
  const normalized = normalizeIndex(index);
  const entry = state.cache.get(normalized);
  if (entry?.status === "ready") { entry.lastUse = performance.now(); return entry; }
  queueFrame(normalized, true); return null;
}

function isFrameReady(index) {
  if (state.mode === "demo") return true;
  return state.cache.get(normalizeIndex(index))?.status === "ready";
}

function playbackNeighbor(index, direction = state.direction) {
  clampPlaybackRange();
  const { inFrame, outFrame, loopMode } = state.config.playback;
  let next = Math.floor(index) + (direction >= 0 ? 1 : -1);
  if (next > outFrame) return loopMode === "loop" ? inFrame : outFrame;
  if (next < inFrame) return loopMode === "loop" ? outFrame : inFrame;
  return next;
}

function hasStartupBuffer() {
  if (state.mode !== "files") return true;
  const current = Math.floor(state.frame);
  if (!isFrameReady(current)) return false;
  if (state.count <= 1) return true;
  return isFrameReady(playbackNeighbor(current));
}

function maybeFinishBuffering() {
  if (!state.buffering || !hasStartupBuffer()) return;
  state.buffering = false;
  state.playing = state.requestedPlaying;
  state.lastTime = performance.now();
}

function beginBuffering() {
  if (state.mode !== "files") return;
  state.buffering = true;
  state.playing = false;
  const current = Math.floor(state.frame);
  queueFrame(current, true);
  queueFrame(playbackNeighbor(current), true);
  scheduleCacheAround(current);
}

function nearestReadyEntry(index) {
  const normalized = normalizeIndex(index);
  const exact = state.cache.get(normalized);
  if (exact?.status === "ready") return { index: normalized, entry: exact };
  const limit = Math.min(state.count, Math.max(8, Math.floor(state.config.cache.radius) * 2));
  for (let distance = 1; distance < limit; distance += 1) {
    const behind = normalizeIndex(normalized - state.direction * distance);
    const behindEntry = state.cache.get(behind);
    if (behindEntry?.status === "ready") return { index: behind, entry: behindEntry };
    const ahead = normalizeIndex(normalized + state.direction * distance);
    const aheadEntry = state.cache.get(ahead);
    if (aheadEntry?.status === "ready") return { index: ahead, entry: aheadEntry };
  }
  return null;
}

function scheduleCacheAround(frameIndex) {
  if (state.mode !== "files") return;
  const radius = Math.max(2, Math.floor(state.config.cache.radius));
  const center = normalizeIndex(frameIndex);
  if (state.config.cache.strategy === "all") {
    for (let i = 0; i < state.count; i += 1) queueFrame(i, Math.abs(i - center) <= 1);
    return;
  }
  queueFrame(center, true); queueFrame(center + state.direction, true);
  for (let distance = 1; distance <= radius; distance += 1) { queueFrame(center + distance); queueFrame(center - distance); }
  if (state.cache.size > radius * 3 + 12) {
    const keep = new Set();
    for (let distance = -radius; distance <= radius; distance += 1) keep.add(normalizeIndex(center + distance));
    [...state.cache.entries()].forEach(([index, entry]) => {
      if (!keep.has(index) && entry.status !== "loading") { disposeEntry(entry); state.cache.delete(index); }
    });
  }
}

function retryErrors() {
  [...state.cache.entries()].forEach(([index, entry]) => { if (entry.status === "error") { state.cache.delete(index); queueFrame(index); } });
}

function drawDemoFrame(target, index) {
  const ctx = target.getContext("2d"); const w = target.width; const h = target.height; const frame = normalizeIndex(index); const t = frame / Math.max(1, state.count);
  const gradient = ctx.createLinearGradient(0, 0, w, h); gradient.addColorStop(0, `hsl(${(t*360+330)%360} 85% 18%)`); gradient.addColorStop(.5, `hsl(${(t*360+190)%360} 85% 30%)`); gradient.addColorStop(1, `hsl(${(t*360+90)%360} 85% 16%)`); ctx.fillStyle = gradient; ctx.fillRect(0,0,w,h);
  ctx.save(); ctx.translate(w/2,h/2); ctx.rotate(t*Math.PI*4);
  for (let i=0;i<28;i+=1) { const a=i/28*Math.PI*2; const radius=70+i*12+Math.sin(t*Math.PI*2+i)*18; const x=Math.cos(a+t*Math.PI*2)*radius; const y=Math.sin(a-t*Math.PI*2)*radius*.55; ctx.fillStyle=`hsla(${(i*17+frame*3)%360},95%,70%,${.18+i/90})`; ctx.beginPath(); ctx.arc(x,y,8+(i%5)*4,0,Math.PI*2); ctx.fill(); }
  ctx.restore();
  ctx.strokeStyle="rgba(255,255,255,.16)"; ctx.lineWidth=2; for(let x=0;x<=16;x+=1){ctx.beginPath();ctx.moveTo(x/16*w,0);ctx.lineTo(x/16*w,h);ctx.stroke()} for(let y=0;y<=9;y+=1){ctx.beginPath();ctx.moveTo(0,y/9*h);ctx.lineTo(w,y/9*h);ctx.stroke()}
  ctx.fillStyle="rgba(3,8,12,.68)"; ctx.fillRect(30,30,370,108); ctx.strokeStyle="#72e7ff"; ctx.strokeRect(30,30,370,108); ctx.fillStyle="#eafcff"; ctx.font="700 34px ui-monospace, monospace"; ctx.fillText(`FRAME ${String(frame+1).padStart(4,"0")}`,52,78); ctx.font="18px ui-monospace, monospace"; ctx.fillStyle="#7bff9f"; ctx.fillText("JUNKPILE IMAGE SEQUENCE",52,112);
}

function uploadTexture(unit, texture, source) {
  const gl = state.gl; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
}

function sourceForIndex(index, demoTarget) {
  if (state.mode === "demo") { drawDemoFrame(demoTarget, index); return demoTarget; }
  return frameEntry(index)?.image || null;
}

function clampPlaybackRange() {
  const playback = state.config.playback;
  playback.inFrame = Math.max(0, Math.min(state.count - 1, Math.floor(playback.inFrame || 0)));
  playback.outFrame = Math.max(playback.inFrame, Math.min(state.count - 1, Math.floor(playback.outFrame ?? state.count - 1)));
}

function advancePlayback(deltaSeconds) {
  if (!state.playing || state.buffering || state.count <= 1) return;
  clampPlaybackRange();
  const config = state.config.playback;
  const advance = deltaSeconds * Math.max(1, config.fps) * Math.max(.01, config.rate) * state.direction;
  let next = state.frame + advance; const low = config.inFrame; const high = config.outFrame;
  if (state.direction > 0 && next > high) {
    if (config.loopMode === "loop") next = low + ((next - low) % Math.max(1, high - low + 1));
    else if (config.loopMode === "pingpong") { next = high - (next - high); state.direction = -1; }
    else { next = high; state.playing = false; state.requestedPlaying = false; }
  } else if (state.direction < 0 && next < low) {
    if (config.loopMode === "loop") { const length=Math.max(1,high-low+1); next = high - ((low - next - 1) % length); }
    else if (config.loopMode === "pingpong") { next = low + (low - next); state.direction = 1; }
    else { next = low; state.playing = false; state.requestedPlaying = false; }
  }
  next = Math.max(low, Math.min(high, next));

  if (state.mode === "files" && config.handling === "hold") {
    const targetBase = state.direction >= 0 ? Math.floor(next) : Math.ceil(next);
    if (!isFrameReady(targetBase)) {
      state.frame = state.direction >= 0 ? Math.floor(state.frame) : Math.ceil(state.frame);
      beginBuffering();
      return;
    }
  } else if (Math.abs(advance) > 1) {
    state.dropped += Math.max(0, Math.floor(Math.abs(advance)) - 1);
  }
  state.frame = next;
}

function framePair() {
  const direction = state.direction >= 0 ? 1 : -1;
  const base = direction > 0 ? Math.floor(state.frame) : Math.ceil(state.frame);
  let next = base + direction;
  const { inFrame, outFrame, loopMode } = state.config.playback;
  if (next > outFrame) next = loopMode === "loop" ? inFrame : outFrame;
  if (next < inFrame) next = loopMode === "loop" ? outFrame : inFrame;
  const blend = state.config.playback.interpolate ? Math.min(1, Math.abs(state.frame - base)) : 0;
  return { base: normalizeIndex(base), next: normalizeIndex(next), blend };
}

function renderFrame() {
  const gl = state.gl; resizeCanvas(); gl.viewport(0,0,canvas.width,canvas.height); gl.useProgram(state.program);
  const pair = framePair(); scheduleCacheAround(pair.base);
  let sourceA = sourceForIndex(pair.base, state.demoCanvasA);
  let sourceB = sourceForIndex(pair.next, state.demoCanvasB);
  let blend = pair.blend;

  if (state.mode === "demo") {
    if (sourceA) uploadTexture(0, state.textures[0], sourceA);
    if (sourceB) uploadTexture(1, state.textures[1], sourceB);
    state.lastPresentedFrame = pair.base;
  } else {
    if (!sourceA && state.config.playback.handling === "drop") {
      const fallback = nearestReadyEntry(pair.base);
      if (fallback) { sourceA = fallback.entry.image; state.lastPresentedFrame = fallback.index; state.dropped += fallback.index === pair.base ? 0 : 1; }
    }
    if (sourceA) {
      state.lastReadySource = sourceA;
      state.lastPresentedFrame = pair.base;
      if (state.uploadedA !== sourceA) { uploadTexture(0, state.textures[0], sourceA); state.uploadedA = sourceA; }
    } else if (state.lastReadySource && !state.uploadedA) {
      uploadTexture(0, state.textures[0], state.lastReadySource); state.uploadedA = state.lastReadySource;
    }

    if (!sourceB) { sourceB = sourceA; blend = 0; }
    if (sourceB && state.uploadedB !== sourceB) { uploadTexture(1, state.textures[1], sourceB); state.uploadedB = sourceB; }
    if (!sourceA) blend = 0;
  }
  const config = state.config.image; const background = hexRgb(config.background);
  gl.bindBuffer(gl.ARRAY_BUFFER, state.buffers.position); gl.enableVertexAttribArray(state.locations.position); gl.vertexAttribPointer(state.locations.position,2,gl.FLOAT,false,0,0);
  gl.uniform2f(state.locations.u_sourceSize, state.sourceWidth, state.sourceHeight); gl.uniform2f(state.locations.u_resolution, canvas.width, canvas.height); gl.uniform1f(state.locations.u_blend, sourceA && sourceB ? blend : 0); gl.uniform1i(state.locations.u_fit, fitModeValue(config.fit)); gl.uniform1f(state.locations.u_zoom, config.zoom); gl.uniform2f(state.locations.u_pan, config.panX, config.panY); gl.uniform1f(state.locations.u_rotation, config.rotation); gl.uniform2f(state.locations.u_mirror, config.mirrorX ? 1 : 0, config.mirrorY ? 1 : 0); gl.uniform3f(state.locations.u_background, ...background); gl.uniform1f(state.locations.u_brightness, config.brightness); gl.uniform1f(state.locations.u_contrast, config.contrast); gl.uniform1f(state.locations.u_saturation, config.saturation); gl.uniform1f(state.locations.u_gamma, config.gamma); gl.uniform1f(state.locations.u_showGrid, config.showGrid ? 1 : 0);
  gl.drawArrays(gl.TRIANGLES,0,6);
  hudName.textContent = state.name; hudFrame.textContent = `${Math.floor(state.frame)+1} / ${state.count}${state.buffering ? " · BUFFERING" : ""}`;
}

function timecode(frame) {
  const fps = Math.max(1, Math.round(state.config.playback.fps)); let total = Math.max(0, Math.floor(frame)); const ff = total % fps; total = Math.floor(total/fps); const ss=total%60; total=Math.floor(total/60); const mm=total%60; const hh=Math.floor(total/60); return [hh,mm,ss,ff].map((value)=>String(value).padStart(2,"0")).join(":");
}

async function emitStatus(extra = {}) {
  if (!tauriEvent) return;
  const counts = cacheCounts();
  await tauriEvent.emit("sequence-status", {
    frame: state.frame, playing: state.playing, requestedPlaying: state.requestedPlaying, buffering: state.buffering, direction: state.direction, timecode: timecode(state.frame), width: state.sourceWidth, height: state.sourceHeight, outputWidth: canvas.width, outputHeight: canvas.height, outputFps: state.outputFps, dropped: state.dropped,
    cacheReady: state.mode === "demo" ? state.count : counts.ready, cacheLoading: counts.loading, cacheErrors: counts.errors, cacheTotal: state.count,
    decodeStatus: state.mode === "demo" ? "procedural" : state.buffering ? "buffering" : counts.errors ? "decode errors" : counts.loading ? "loading ahead" : "ready", ...extra
  });
}

function draw(now) {
  const delta = Math.min(.1, Math.max(0, (now - state.lastTime)/1000)); state.lastTime = now; maybeFinishBuffering(); advancePlayback(delta); renderFrame();
  state.fpsFrames += 1; if (now - state.fpsWindowStart >= 500) { state.outputFps = state.fpsFrames * 1000 / (now - state.fpsWindowStart); state.fpsFrames = 0; state.fpsWindowStart = now; }
  if (now - state.lastTelemetry > 180) { state.lastTelemetry = now; emitStatus().catch(console.error); }
  requestAnimationFrame(draw);
}

async function loadSequence(payload) {
  const paths = Array.isArray(payload.paths) ? payload.paths : [];
  clearCache(); state.mode = "files"; state.paths = paths; state.count = Math.max(1, paths.length); state.name = payload.name || "Image sequence"; state.frame = 0; state.direction = 1; state.requestedPlaying = !payload.startPaused; state.playing = false; state.buffering = true; state.dropped = 0; state.sourceWidth = 1; state.sourceHeight = 1; state.config.playback.inFrame = 0; state.config.playback.outFrame = state.count - 1; state.lastTime = performance.now();
  queueFrame(0, true); queueFrame(1, true); queueFrame(2, false); scheduleCacheAround(0); hudName.textContent = state.name;
  await emitStatus({ message: `Buffering ${state.count} frames…` });
}

async function loadDemo(payload = {}) {
  clearCache(); state.mode = "demo"; state.paths = []; state.count = Math.max(2, Number(payload.count) || 180); state.name = "Generated demo"; state.frame = 0; state.direction = 1; state.requestedPlaying = !payload.startPaused; state.playing = state.requestedPlaying; state.buffering = false; state.dropped = 0; state.sourceWidth = 1280; state.sourceHeight = 720; state.config.playback.inFrame = 0; state.config.playback.outFrame = state.count - 1; state.uploadedA = null; state.uploadedB = null; state.lastTime = performance.now();
  await emitStatus({ message: "Generated demo ready" });
}

async function refreshMonitors() {
  try {
    state.monitors = invoke ? await invoke("list_monitors") : [];
    if (tauriEvent) await tauriEvent.emit("sequence-monitors", state.monitors);
  } catch (error) {
    console.warn("Monitor enumeration failed", error);
    state.monitors = [];
    if (tauriEvent) await tauriEvent.emit("sequence-monitors", []);
  }
}

async function moveToMonitor(index, fullscreen = false) {
  if (!invoke) { await emitStatus({ message: "Display placement API unavailable" }); return; }
  try {
    const message = await invoke("place_output", { index, fullscreen });
    await emitStatus({ message });
  } catch (error) { await emitStatus({ message: `Could not move output: ${error.message || error}` }); }
}

async function toggleFullscreen(index) {
  if (!invoke) return;
  try {
    const fullscreen = await invoke("toggle_output_fullscreen", { index });
    await emitStatus({ message: fullscreen ? `Fullscreen on display ${index + 1}` : "Output windowed" });
  } catch (error) { await emitStatus({ message: `Fullscreen failed: ${error.message || error}` }); }
}

function snapshotName() { return `junkpile-22-sequence-frame-${String(Math.floor(state.frame)+1).padStart(5,"0")}-${new Date().toISOString().replace(/[:.]/g,"-")}.png`; }
async function saveBlobNative(blob, path) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length <= 1024 * 1024) {
    await invoke("write_binary", { path, bytes: Array.from(bytes) });
    return;
  }
  await invoke("create_binary", { path });
  const chunkSize = 1024 * 1024;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    await invoke("append_binary", { path, bytes: Array.from(bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize))) });
  }
}

async function snapshot() {
  try {
    const blob = await new Promise((resolve,reject)=>canvas.toBlob((value)=>value?resolve(value):reject(new Error("PNG creation failed")),"image/png"));
    const name = snapshotName();
    if (tauriDialog?.save && invoke) {
      const path = await tauriDialog.save({ defaultPath:name, filters:[{name:"PNG image",extensions:["png"]}] });
      if (!path) return;
      await saveBlobNative(blob, path);
      await emitStatus({message:`Saved ${path}`});
    } else {
      const url=URL.createObjectURL(blob); const anchor=document.createElement("a"); anchor.href=url; anchor.download=name; anchor.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); await emitStatus({message:"PNG downloaded"});
    }
  } catch(error){ await emitStatus({message:`Snapshot failed: ${error.message||error}`}); }
}

function seek(frame) {
  clampPlaybackRange();
  state.frame = Math.max(state.config.playback.inFrame, Math.min(state.config.playback.outFrame, Number(frame) || 0));
  state.uploadedA = null; state.uploadedB = null; state.lastTime = performance.now();
  scheduleCacheAround(state.frame);
  if (state.mode === "files" && !isFrameReady(Math.floor(state.frame))) beginBuffering();
}

async function handleCommand(payload = {}) {
  switch (payload.command) {
    case "ping": if (tauriEvent) await tauriEvent.emit("sequence-ready", { ready: true }); break;
    case "load-sequence": await loadSequence(payload); break;
    case "load-demo": await loadDemo(payload); break;
    case "toggle-play":
      state.requestedPlaying = !state.requestedPlaying;
      if (state.buffering) state.playing = false;
      else { state.playing = state.requestedPlaying; state.lastTime = performance.now(); }
      break;
    case "step": state.requestedPlaying = false; state.playing = false; seek(Math.round(state.frame) + (Number(payload.amount) || 0)); break;
    case "jump": state.requestedPlaying = false; state.playing = false; seek(payload.target === "out" ? state.config.playback.outFrame : state.config.playback.inFrame); break;
    case "reverse": state.direction *= -1; break;
    case "seek": seek(payload.frame); break;
    case "preload": if (state.mode === "files") { for(let i=0;i<state.count;i+=1) queueFrame(i); } break;
    case "clear-cache": if (state.mode === "files") { clearCache(); beginBuffering(); } break;
    case "retry-errors": retryErrors(); break;
    case "refresh-monitors": await refreshMonitors(); break;
    case "move-monitor": await moveToMonitor(Number(payload.index)||0,false); break;
    case "toggle-fullscreen": await toggleFullscreen(Number(payload.index)||0); break;
    case "show-output": if (invoke) await invoke("show_output"); break;
    case "hide-output": if (invoke) await invoke("hide_output"); break;
    case "snapshot": await snapshot(); break;
    default: break;
  }
  await emitStatus();
}

async function bindEvents() {
  if (!tauriEvent) return;
  await tauriEvent.listen("sequence-config", (event) => {
    const next = event.payload || {};
    const previousFps = state.config.playback.fps;
    const previousRate = state.config.playback.rate;
    const previousHandling = state.config.playback.handling;
    if (next.playback) Object.assign(state.config.playback, next.playback);
    if (next.cache) Object.assign(state.config.cache, next.cache);
    if (next.image) Object.assign(state.config.image, next.image);
    clampPlaybackRange(); scheduleCacheAround(state.frame);
    if (previousFps !== state.config.playback.fps || previousRate !== state.config.playback.rate || previousHandling !== state.config.playback.handling) {
      state.lastTime = performance.now();
      if (state.mode === "files" && state.config.playback.handling === "hold" && !isFrameReady(Math.floor(state.frame))) beginBuffering();
    }
  });
  await tauriEvent.listen("sequence-command", (event) => handleCommand(event.payload));
}

async function initialize() {
  initializeWebGL(); await bindEvents(); await refreshMonitors();
  if (tauriEvent) await tauriEvent.emit("sequence-ready", { ready: true });
  requestAnimationFrame(draw);
}

initialize().catch((error) => { console.error(error); outputError.classList.remove("hidden"); outputErrorMessage.textContent = error.message || String(error); emitStatus({ message: error.message || String(error) }).catch(console.error); });
