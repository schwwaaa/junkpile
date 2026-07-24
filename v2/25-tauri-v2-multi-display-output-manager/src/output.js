const canvas = document.getElementById("canvas");
const hud = document.getElementById("hud");
const hudLabel = document.getElementById("hud-label");
const hudRoute = document.getElementById("hud-route");
const hudSize = document.getElementById("hud-size");
const tauriEvent = window.__TAURI__?.event ?? null;
const tauriCore = window.__TAURI__?.core ?? null;
const invoke = tauriCore?.invoke?.bind(tauriCore) ?? null;
const tauriDialog = window.__TAURI__?.dialog ?? null;
let label = "output-1";
let outputIndex = 0;

const state = {
  gl: null,
  program: null,
  buffer: null,
  uniform: {},
  payload: {
    master: { speed: 1, brightness: 1, phase: 0, epochMs: Date.now(), colorA: [0.47, .91, 1], colorB: [1, .44, .71], colorC: [.47, 1, .62] },
    output: {
      name: `Output ${outputIndex + 1}`, source: outputIndex, speed: 1, phase: outputIndex * .7,
      zoom: 1, panX: 0, panY: 0, rotation: 0, brightness: 1, saturation: 1, gamma: 1,
      feather: 0, mirrorX: false, mirrorY: false, showHud: true, showGrid: false, blackout: false
    }
  },
  startedAt: performance.now(),
  fpsAt: performance.now(),
  fpsFrames: 0,
  fps: 0,
  lastStatus: 0
};

const VERTEX_SHADER = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `
precision highp float;
varying vec2 v_uv;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_source;
uniform float u_speed;
uniform float u_phase;
uniform float u_zoom;
uniform vec2 u_pan;
uniform float u_rotation;
uniform float u_brightness;
uniform float u_saturation;
uniform float u_gamma;
uniform float u_feather;
uniform float u_mirror_x;
uniform float u_mirror_y;
uniform float u_grid;
uniform float u_blackout;
uniform vec3 u_color_a;
uniform vec3 u_color_b;
uniform vec3 u_color_c;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float value = 0.0; float amplitude = 0.5;
  for (int i = 0; i < 5; i++) { value += noise(p) * amplitude; p = mat2(1.6, -1.2, 1.2, 1.6) * p; amplitude *= 0.5; }
  return value;
}
vec3 palette(float t) {
  vec3 base = mix(u_color_a, u_color_b, smoothstep(0.05, 0.95, t));
  return mix(base, u_color_c, 0.22 + 0.22 * sin(t * 6.283 + 1.4));
}
vec3 sourceA(vec2 p, float t) {
  float n1 = fbm(p * 2.1 + vec2(t * .09, -t * .06));
  float n2 = fbm(p * 3.7 + vec2(n1 * 2.0, t * .08));
  float bands = .5 + .5 * sin((n1 + n2) * 10.0 + length(p) * 7.0 - t);
  return palette(clamp(.24 + n2 * .65 + bands * .18, 0.0, 1.0));
}
vec3 sourceB(vec2 p, float t) {
  float r = length(p); float a = atan(p.y, p.x);
  float rings = .5 + .5 * cos(r * 32.0 - t * 2.0 + sin(a * 5.0 + t));
  float spokes = .5 + .5 * cos(a * 12.0 + t * .7 + r * 8.0);
  float glow = .08 / max(.02, abs(r - .43 - .08 * sin(t + a * 3.0)));
  return palette(rings * .62 + spokes * .22) * (.48 + glow * .18);
}
vec3 sourceC(vec2 p, float t) {
  float field = 0.0;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float y = sin(p.x * (3.0 + fi * .4) + t * (.6 + fi * .08) + fi) * (.12 + fi * .008);
    field += .012 / max(.003, abs(p.y - y + (fi - 2.5) * .105));
  }
  float scan = .5 + .5 * sin((p.y + t * .08) * 120.0);
  return palette(fract(p.x * .28 + t * .06 + field * .08)) * (field * .7 + scan * .05);
}
vec3 sourceD(vec2 p, float t) {
  vec2 q = p;
  float gridX = 1.0 - smoothstep(.018, .035, abs(fract((q.x + 1.0) * 5.0) - .5));
  float gridY = 1.0 - smoothstep(.018, .035, abs(fract((q.y + 1.0) * 5.0) - .5));
  float pulse = .5 + .5 * sin(t * 2.0 - length(q) * 18.0);
  float cross = 1.0 - smoothstep(.008, .02, min(abs(q.x), abs(q.y)));
  vec3 color = mix(vec3(.025), u_color_a * .45, max(gridX, gridY));
  color += u_color_c * cross * .55 + u_color_b * pulse * .2;
  return color;
}
vec3 grade(vec3 color, float saturation) {
  float luma = dot(color, vec3(.2126, .7152, .0722));
  return mix(vec3(luma), color, saturation);
}
void main() {
  vec2 uv = v_uv;
  if (u_mirror_x > .5) uv.x = 1.0 - uv.x;
  if (u_mirror_y > .5) uv.y = 1.0 - uv.y;
  vec2 p = uv - .5;
  p.x *= u_resolution.x / max(1.0, u_resolution.y);
  float angle = radians(u_rotation);
  p = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * p;
  p = p / max(.001, u_zoom) + u_pan;
  float t = u_time * u_speed + u_phase;
  vec3 color;
  if (u_source < .5) color = sourceA(p, t);
  else if (u_source < 1.5) color = sourceB(p, t);
  else if (u_source < 2.5) color = sourceC(p, t);
  else color = sourceD(p, t);
  if (u_grid > .5) {
    vec2 cell = abs(fract(uv * 12.0) - .5);
    float line = 1.0 - smoothstep(.46, .49, max(cell.x, cell.y));
    float center = 1.0 - smoothstep(.004, .012, min(abs(uv.x - .5), abs(uv.y - .5)));
    color = mix(color, vec3(.95), line * .2 + center * .45);
  }
  float feather = max(0.0001, u_feather);
  float edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  float alpha = u_feather <= .0001 ? 1.0 : smoothstep(0.0, feather, edge);
  color = grade(color, u_saturation) * u_brightness;
  color = pow(max(color, 0.0), vec3(1.0 / max(.05, u_gamma)));
  color *= alpha * (1.0 - u_blackout);
  gl_FragColor = vec4(color, 1.0);
}`;

function compileShader(gl, type, source) {
  const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || "Shader compilation failed");
  return shader;
}

function initializeGl() {
  const gl = canvas.getContext("webgl", { antialias: false, alpha: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error("WebGL is unavailable in this output window.");
  const program = gl.createProgram();
  gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "Program link failed");
  const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
  gl.useProgram(program);
  const position = gl.getAttribLocation(program, "a_position"); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  state.gl = gl; state.program = program; state.buffer = buffer;
  ["u_resolution","u_time","u_source","u_speed","u_phase","u_zoom","u_pan","u_rotation","u_brightness","u_saturation","u_gamma","u_feather","u_mirror_x","u_mirror_y","u_grid","u_blackout","u_color_a","u_color_b","u_color_c"].forEach((name) => { state.uniform[name] = gl.getUniformLocation(program, name); });
}

function resizeCanvas() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(innerWidth * dpr));
  const height = Math.max(1, Math.round(innerHeight * dpr));
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; state.gl.viewport(0, 0, width, height); }
}

function draw(now) {
  resizeCanvas();
  const gl = state.gl; const master = state.payload.master; const output = state.payload.output;
  gl.useProgram(state.program);
  gl.uniform2f(state.uniform.u_resolution, canvas.width, canvas.height);
  const sharedSeconds = (Date.now() - Number(master.epochMs || Date.now())) / 1000;
  gl.uniform1f(state.uniform.u_time, sharedSeconds * Number(master.speed || 0) + Number(master.phase || 0));
  gl.uniform1f(state.uniform.u_source, Number(output.source || 0));
  gl.uniform1f(state.uniform.u_speed, Number(output.speed || 0));
  gl.uniform1f(state.uniform.u_phase, Number(output.phase || 0));
  gl.uniform1f(state.uniform.u_zoom, Number(output.zoom || 1));
  gl.uniform2f(state.uniform.u_pan, Number(output.panX || 0), Number(output.panY || 0));
  gl.uniform1f(state.uniform.u_rotation, Number(output.rotation || 0));
  gl.uniform1f(state.uniform.u_brightness, Number(output.brightness || 1) * Number(master.brightness || 1));
  gl.uniform1f(state.uniform.u_saturation, Number(output.saturation || 1));
  gl.uniform1f(state.uniform.u_gamma, Number(output.gamma || 1));
  gl.uniform1f(state.uniform.u_feather, Number(output.feather || 0));
  gl.uniform1f(state.uniform.u_mirror_x, output.mirrorX ? 1 : 0);
  gl.uniform1f(state.uniform.u_mirror_y, output.mirrorY ? 1 : 0);
  gl.uniform1f(state.uniform.u_grid, output.showGrid ? 1 : 0);
  gl.uniform1f(state.uniform.u_blackout, output.blackout ? 1 : 0);
  gl.uniform3fv(state.uniform.u_color_a, master.colorA || [.47,.91,1]);
  gl.uniform3fv(state.uniform.u_color_b, master.colorB || [1,.44,.71]);
  gl.uniform3fv(state.uniform.u_color_c, master.colorC || [.47,1,.62]);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  hud.classList.toggle("hidden", !output.showHud);
  hudLabel.textContent = output.name || label.toUpperCase();
  hudRoute.textContent = `Source ${String.fromCharCode(65 + Number(output.source || 0))}`;
  hudSize.textContent = `${canvas.width} × ${canvas.height}`;

  state.fpsFrames += 1;
  if (now - state.fpsAt > 500) { state.fps = state.fpsFrames * 1000 / (now - state.fpsAt); state.fpsFrames = 0; state.fpsAt = now; }
  if (now - state.lastStatus > 600) { state.lastStatus = now; emitStatus({ width: canvas.width, height: canvas.height, fps: state.fps }); }
  requestAnimationFrame(draw);
}

async function emitStatus(payload = {}) {
  if (!tauriEvent) return;
  try { await tauriEvent.emit("multi-display-status", { label, ...payload }); } catch {}
}

async function writeNativeBytes(path, bytes, statusPrefix = "Saving") {
  if (!invoke) throw new Error("Native binary writing is unavailable");
  const chunkSize = 1024 * 1024;
  if (bytes.length <= chunkSize) {
    await invoke("write_binary", { path, bytes: Array.from(bytes) });
    return;
  }
  await invoke("create_binary", { path });
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize));
    await invoke("append_binary", { path, bytes: Array.from(chunk) });
    const percent = Math.min(100, Math.round(((offset + chunk.length) / bytes.length) * 100));
    await emitStatus({ message: `${statusPrefix}… ${percent}%` });
  }
}

async function snapshot() {
  try {
    const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("PNG encoding failed")), "image/png"));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `junkpile-25-v2-${label}-${stamp}.png`;
    if (tauriDialog?.save && invoke) {
      const path = await tauriDialog.save({ defaultPath: filename, filters: [{ name: "PNG image", extensions: ["png"] }] });
      if (!path) return;
      await writeNativeBytes(path, bytes, "Saving PNG");
      await emitStatus({ message: `Snapshot saved: ${path}` });
    } else {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
    }
  } catch (error) {
    await emitStatus({ message: `Snapshot failed: ${error.message || error}` });
  }
}

async function handleCommand(payload) {
  if (!payload || payload.label !== label) return;
  if (payload.command === "snapshot") await snapshot();
  else if (payload.command === "ping") await emitStatus({ message: "Connected" });
}

async function bindEvents() {
  if (!tauriEvent) return;
  await tauriEvent.listen("multi-display-state", (event) => {
    const payload = event.payload || {};
    const output = Array.isArray(payload.outputs) ? payload.outputs.find((item) => item.label === label) : null;
    if (payload.master) state.payload.master = payload.master;
    if (output) state.payload.output = output;
  });
  await tauriEvent.listen("multi-display-command", (event) => handleCommand(event.payload));
  await tauriEvent.emit("multi-display-ready", { label });
}

async function initialize() {
  if (invoke) {
    label = await invoke("current_window_label");
    outputIndex = Math.max(0, Number(label.split("-").pop()) - 1);
    state.payload.output.name = `Output ${outputIndex + 1}`;
    state.payload.output.source = outputIndex % 4;
    state.payload.output.phase = outputIndex * 0.7;
  }
  initializeGl();
  await bindEvents();
  await emitStatus({ message: "Connected" });
  requestAnimationFrame(draw);
}

initialize().catch((error) => { document.body.innerHTML = `<pre style="color:#ff8b8b;padding:20px;white-space:pre-wrap">${error.stack || error.message || error}</pre>`; emitStatus({ message: error.message || String(error) }); });
