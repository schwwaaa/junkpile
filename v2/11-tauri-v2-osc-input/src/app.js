'use strict';

const tauri = window.__TAURI__;
if (!tauri?.core?.invoke || !tauri?.event?.listen) {
  document.body.innerHTML = '<pre style="padding:24px;color:#ff7883">Tauri v2 global API is unavailable. Confirm app.withGlobalTauri is true.</pre>';
  throw new Error('Tauri v2 global API unavailable');
}

const { invoke } = tauri.core;
const { listen } = tauri.event;
const byId = (id) => document.getElementById(id);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const PARAMS = {
  hue:        { label: 'Hue',        min: 0,   max: 360, step: 1,    value: 188, address: '/hue',        mode: 'normalized', decimals: 0 },
  zoom:       { label: 'Zoom',       min: 0.4, max: 4.5, step: 0.01, value: 1.35, address: '/zoom',       mode: 'normalized', decimals: 2 },
  speed:      { label: 'Speed',      min: 0,   max: 2.5, step: 0.01, value: 0.55, address: '/speed',      mode: 'normalized', decimals: 2 },
  brightness: { label: 'Brightness', min: 0,   max: 2.2, step: 0.01, value: 1.1,  address: '/brightness', mode: 'normalized', decimals: 2 },
  distortion: { label: 'Distortion', min: 0,   max: 1.2, step: 0.01, value: 0.35, address: '/distortion', mode: 'normalized', decimals: 2 },
  complexity: { label: 'Complexity', min: 1,   max: 8,   step: 1,    value: 5,    address: '/complexity', mode: 'normalized', decimals: 0 },
};

const DEFAULT_ROUTES = Object.fromEntries(
  Object.entries(PARAMS).map(([key, spec]) => [key, { address: spec.address, mode: spec.mode }])
);
const savedRoutes = safeJsonParse(localStorage.getItem('junkpile-v2-osc-routes'));
let routes = normalizeRoutes(savedRoutes);
let learnTarget = null;
let listenerRunning = false;
let listenerPort = Number(localStorage.getItem('junkpile-v2-osc-port') || 9000);
let listenerBindAddress = localStorage.getItem('junkpile-v2-osc-bind') || '0.0.0.0';
let oscActivity = 0;
let oscValue = 0.5;
let eventCount = 0;
let eventTimes = [];
let logs = [];
let unlistenOsc = null;
let unlistenError = null;

function safeJsonParse(value) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

function normalizeRoutes(value) {
  const output = {};
  for (const [key, defaults] of Object.entries(DEFAULT_ROUTES)) {
    const candidate = value?.[key];
    output[key] = {
      address: typeof candidate?.address === 'string' && candidate.address.trim()
        ? normalizeAddress(candidate.address)
        : defaults.address,
      mode: ['normalized', 'midi127', 'bipolar', 'direct'].includes(candidate?.mode)
        ? candidate.mode
        : defaults.mode,
    };
  }
  return output;
}

function normalizeAddress(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '/';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function saveRoutes() {
  localStorage.setItem('junkpile-v2-osc-routes', JSON.stringify(routes));
}

function formatValue(key, value) {
  return Number(value).toFixed(PARAMS[key].decimals);
}

function buildParameterControls() {
  const list = byId('parameter-list');
  list.innerHTML = '';

  for (const [key, spec] of Object.entries(PARAMS)) {
    const row = document.createElement('div');
    row.className = 'parameter-row';
    row.innerHTML = `
      <div class="parameter-header">
        <span class="parameter-name">${spec.label}</span>
        <output class="parameter-value" id="${key}-value">${formatValue(key, spec.value)}</output>
      </div>
      <div class="parameter-route">
        <input id="${key}-address" type="text" value="${escapeHtml(routes[key].address)}" aria-label="${spec.label} OSC address" spellcheck="false">
        <select id="${key}-mode" aria-label="${spec.label} input scale">
          <option value="normalized">0–1 normalized</option>
          <option value="midi127">0–127</option>
          <option value="bipolar">−1–1 bipolar</option>
          <option value="direct">Direct value</option>
        </select>
      </div>
      <input id="${key}" type="range" min="${spec.min}" max="${spec.max}" step="${spec.step}" value="${spec.value}" aria-label="${spec.label}">
    `;
    list.appendChild(row);

    const slider = byId(key);
    const addressInput = byId(`${key}-address`);
    const modeSelect = byId(`${key}-mode`);
    modeSelect.value = routes[key].mode;

    slider.addEventListener('input', () => {
      spec.value = Number(slider.value);
      byId(`${key}-value`).textContent = formatValue(key, spec.value);
    });
    addressInput.addEventListener('change', () => {
      routes[key].address = normalizeAddress(addressInput.value);
      addressInput.value = routes[key].address;
      saveRoutes();
      logMessage('route', `${routes[key].address} → ${spec.label}`);
    });
    modeSelect.addEventListener('change', () => {
      routes[key].mode = modeSelect.value;
      saveRoutes();
      logMessage('scale', `${spec.label} uses ${modeSelect.options[modeSelect.selectedIndex].text}`);
    });
  }
}

function setParamValue(key, value) {
  const spec = PARAMS[key];
  if (!spec || !Number.isFinite(value)) return;
  const stepped = Math.round(value / spec.step) * spec.step;
  spec.value = clamp(stepped, spec.min, spec.max);
  byId(key).value = String(spec.value);
  byId(`${key}-value`).textContent = formatValue(key, spec.value);
}

function routeMatches(pattern, address) {
  if (pattern.endsWith('*')) return address.startsWith(pattern.slice(0, -1));
  return pattern === address;
}

function applyOscValue(key, rawValue) {
  const spec = PARAMS[key];
  const route = routes[key];
  if (!Number.isFinite(rawValue)) return;

  if (route.mode === 'direct') {
    setParamValue(key, rawValue);
    return;
  }

  let normalized = rawValue;
  if (route.mode === 'midi127') normalized = rawValue / 127;
  if (route.mode === 'bipolar') normalized = (rawValue + 1) * 0.5;
  normalized = clamp(normalized, 0, 1);
  setParamValue(key, spec.min + normalized * (spec.max - spec.min));
}

function setListenerState(state, label) {
  listenerRunning = state === 'connected';
  const pill = byId('listener-pill');
  pill.className = `status-pill ${state}`;
  pill.textContent = label;
}

function logMessage(kind, text, detail = '', isError = false) {
  const time = new Date().toLocaleTimeString([], { hour12: false });
  logs.unshift({ time, kind, text, detail, isError });
  logs = logs.slice(0, 100);
  byId('osc-log').innerHTML = logs.map((line) => `
    <div class="log-line ${line.isError ? 'log-error' : ''}">
      <span class="log-time">${escapeHtml(line.time)}</span>
      <span class="log-kind">${escapeHtml(line.kind)}</span>
      <span class="log-raw">${escapeHtml(line.text)}${line.detail ? ` · ${escapeHtml(line.detail)}` : ''}</span>
    </div>`).join('');
}

async function refreshEndpoints() {
  const port = readPort();
  try {
    const endpoints = await invoke('get_network_hints', { port });
    byId('endpoint-list').innerHTML = endpoints.map((endpoint) => `<div>${escapeHtml(endpoint)}</div>`).join('');
  } catch (error) {
    byId('endpoint-list').textContent = `Could not inspect endpoints: ${error}`;
  }
}

function readPort() {
  const port = Math.round(Number(byId('port-input').value));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('UDP port must be between 1 and 65535');
  }
  return port;
}

async function startListener() {
  const port = readPort();
  const bindAddress = byId('bind-address').value;
  setListenerState('idle', 'starting');
  try {
    const info = await invoke('start_osc_listener', { bindAddress, port });
    listenerPort = info.port;
    listenerBindAddress = info.bindAddress;
    localStorage.setItem('junkpile-v2-osc-port', String(listenerPort));
    localStorage.setItem('junkpile-v2-osc-bind', listenerBindAddress);
    setListenerState('connected', `UDP ${listenerPort}`);
    logMessage('system', `Listening on ${info.endpoint}`);
    await refreshEndpoints();
  } catch (error) {
    setListenerState('error', 'bind error');
    logMessage('error', String(error), '', true);
  }
}

async function stopListener() {
  try {
    await invoke('stop_osc_listener');
    setListenerState('idle', 'stopped');
    logMessage('system', 'OSC listener stopped');
  } catch (error) {
    setListenerState('error', 'stop error');
    logMessage('error', String(error), '', true);
  }
}

async function sendTestBurst() {
  if (!listenerRunning) await startListener();
  if (!listenerRunning) return;

  const sequence = [
    ['hue', 0.12],
    ['zoom', 0.72],
    ['distortion', 0.78],
    ['complexity', 0.88],
    ['brightness', 0.64],
    ['speed', 0.42],
  ];

  logMessage('test', 'Sending six local OSC messages');
  for (const [key, normalized] of sequence) {
    const route = routes[key];
    let value = normalized;
    if (route.mode === 'midi127') value *= 127;
    if (route.mode === 'bipolar') value = normalized * 2 - 1;
    if (route.mode === 'direct') {
      const spec = PARAMS[key];
      value = spec.min + normalized * (spec.max - spec.min);
    }
    await invoke('send_test_osc', {
      port: listenerPort,
      address: route.address.replace(/\*$/, 'test'),
      value,
    });
    await new Promise((resolve) => setTimeout(resolve, 55));
  }
}

function armLearn() {
  if (learnTarget) {
    learnTarget = null;
    byId('learn-pill').className = 'status-pill idle';
    byId('learn-pill').textContent = 'off';
    byId('learn-btn').classList.remove('active');
    byId('learn-btn').textContent = 'Arm learn';
    return;
  }

  learnTarget = byId('learn-param').value;
  byId('learn-pill').className = 'status-pill armed';
  byId('learn-pill').textContent = `waiting · ${PARAMS[learnTarget].label}`;
  byId('learn-btn').classList.add('active');
  byId('learn-btn').textContent = 'Cancel learn';
  logMessage('learn', `Send one OSC address to map ${PARAMS[learnTarget].label}`);
}

function assignLearnedAddress(address) {
  routes[learnTarget].address = address;
  byId(`${learnTarget}-address`).value = address;
  saveRoutes();
  logMessage('learn', `${address} → ${PARAMS[learnTarget].label}`);
  learnTarget = null;
  byId('learn-pill').className = 'status-pill idle';
  byId('learn-pill').textContent = 'off';
  byId('learn-btn').classList.remove('active');
  byId('learn-btn').textContent = 'Arm learn';
}

function resetRoutes() {
  routes = normalizeRoutes(DEFAULT_ROUTES);
  saveRoutes();
  for (const [key, route] of Object.entries(routes)) {
    byId(`${key}-address`).value = route.address;
    byId(`${key}-mode`).value = route.mode;
  }
  logMessage('system', 'Restored default OSC routes');
}

function handleOscEvent(event) {
  eventCount += 1;
  eventTimes.push(performance.now());
  pruneEventTimes();
  byId('osc-overlay').classList.add('hidden');
  byId('last-address').textContent = event.address;

  const argsText = event.args.length
    ? event.args.map((argument) => `${argument.kind}:${argument.text}`).join(', ')
    : 'no arguments';
  byId('last-message').textContent = `${argsText} · ${event.sender}`;
  byId('sender-value').textContent = event.sender;

  if (Number.isFinite(event.numericValue)) {
    const raw = Number(event.numericValue);
    byId('numeric-value').textContent = formatCompact(raw);
    const displayValue = clamp(Math.abs(raw) <= 1 ? Math.abs(raw) : (Math.abs(raw) % 128) / 127, 0, 1);
    byId('numeric-meter').style.width = `${displayValue * 100}%`;
    oscValue = displayValue;
    oscActivity = Math.max(oscActivity, 0.25 + displayValue * 0.75);
  } else {
    byId('numeric-value').textContent = 'non-numeric';
    oscActivity = Math.max(oscActivity, 0.35);
  }
  byId('activity-meter').style.width = '100%';

  if (learnTarget) assignLearnedAddress(event.address);
  if (Number.isFinite(event.numericValue)) {
    for (const key of Object.keys(PARAMS)) {
      if (routeMatches(routes[key].address, event.address)) {
        applyOscValue(key, Number(event.numericValue));
      }
    }
  }

  const bundle = event.bundleDepth > 0 ? `bundle depth ${event.bundleDepth}` : 'message';
  logMessage(event.address, argsText, `${event.sender} · ${bundle}`);
}

function pruneEventTimes() {
  const cutoff = performance.now() - 1000;
  eventTimes = eventTimes.filter((time) => time >= cutoff);
  const rate = eventTimes.length;
  byId('rate-value').textContent = String(rate);
  byId('rate-meter').style.width = `${clamp(rate / 120, 0, 1) * 100}%`;
}

function formatCompact(value) {
  const absolute = Math.abs(value);
  if (absolute >= 1000 || (absolute > 0 && absolute < 0.001)) return value.toExponential(2);
  return Number(value).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

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
uniform float u_hue;
uniform float u_zoom;
uniform float u_brightness;
uniform float u_distortion;
uniform float u_complexity;
uniform float u_activity;
uniform float u_osc_value;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise2(vec2 p) {
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
  float sum = 0.0;
  float amplitude = 0.5;
  float octave = 0.0;
  for (int i = 0; i < 8; i++) {
    if (octave >= u_complexity) break;
    sum += noise2(p) * amplitude;
    p = p * 2.03 + vec2(17.1, 9.2);
    amplitude *= 0.5;
    octave += 1.0;
  }
  return sum;
}

vec3 hsb2rgb(vec3 c) {
  vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  rgb = rgb * rgb * (3.0 - 2.0 * rgb);
  return c.z * mix(vec3(1.0), rgb, c.y);
}

mat2 rotate2d(float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return mat2(c, -s, s, c);
}

void main() {
  vec2 aspect = vec2(u_resolution.x / max(u_resolution.y, 1.0), 1.0);
  vec2 uv = (v_uv - 0.5) * aspect * u_zoom;
  uv = rotate2d((u_osc_value - 0.5) * 0.7 + u_time * 0.04) * uv;

  vec2 warp = vec2(
    fbm(uv * 1.4 + vec2(u_time * 0.17, 0.0)),
    fbm(uv * 1.4 + vec2(0.0, -u_time * 0.14))
  ) - 0.5;
  vec2 domain = uv + warp * u_distortion * (1.7 + u_osc_value);

  float field = fbm(domain * 2.1 + u_time * 0.08);
  field += 0.45 * fbm(domain * 4.2 - u_time * 0.12);
  field = smoothstep(0.18, 1.18, field);

  float radius = length(uv);
  float packetRing = exp(-70.0 * abs(radius - mix(0.08, 0.75, u_osc_value))) * u_activity;
  float hue = fract(u_hue / 360.0 + field * 0.3 + u_time * 0.015 + u_osc_value * 0.12);
  vec3 color = hsb2rgb(vec3(hue, 0.82, field * u_brightness + packetRing));
  color += vec3(0.28, 0.12, 0.04) * packetRing;
  gl_FragColor = vec4(color, 1.0);
}`;

class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance' });
    if (!this.gl) throw new Error('WebGL 1 is unavailable in this WebView');
    this.program = this.createProgram(VERTEX_SHADER, FRAGMENT_SHADER);
    this.uniforms = {};
    for (const name of ['u_resolution', 'u_time', 'u_hue', 'u_zoom', 'u_brightness', 'u_distortion', 'u_complexity', 'u_activity', 'u_osc_value']) {
      this.uniforms[name] = this.gl.getUniformLocation(this.program, name);
    }

    const buffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), this.gl.STATIC_DRAW);
    const position = this.gl.getAttribLocation(this.program, 'a_position');
    this.gl.enableVertexAttribArray(position);
    this.gl.vertexAttribPointer(position, 2, this.gl.FLOAT, false, 0, 0);

    this.startedAt = performance.now();
    this.lastFrame = performance.now();
    this.frameCounter = 0;
    this.lastFpsUpdate = performance.now();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
    this.resize();
  }

  createShader(type, source) {
    const shader = this.gl.createShader(type);
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      throw new Error(this.gl.getShaderInfoLog(shader) || 'Unknown shader compile error');
    }
    return shader;
  }

  createProgram(vertexSource, fragmentSource) {
    const program = this.gl.createProgram();
    this.gl.attachShader(program, this.createShader(this.gl.VERTEX_SHADER, vertexSource));
    this.gl.attachShader(program, this.createShader(this.gl.FRAGMENT_SHADER, fragmentSource));
    this.gl.linkProgram(program);
    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
      throw new Error(this.gl.getProgramInfoLog(program) || 'Unknown shader link error');
    }
    return program;
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.gl.viewport(0, 0, width, height);
    }
  }

  render(now) {
    const elapsed = (now - this.startedAt) / 1000;
    const delta = Math.min((now - this.lastFrame) / 1000, 0.1);
    oscActivity *= Math.pow(0.025, delta);
    this.lastFrame = now;
    byId('activity-meter').style.width = `${clamp(oscActivity, 0, 1) * 100}%`;

    this.gl.useProgram(this.program);
    this.gl.uniform2f(this.uniforms.u_resolution, this.canvas.width, this.canvas.height);
    this.gl.uniform1f(this.uniforms.u_time, elapsed * PARAMS.speed.value);
    this.gl.uniform1f(this.uniforms.u_hue, PARAMS.hue.value);
    this.gl.uniform1f(this.uniforms.u_zoom, PARAMS.zoom.value);
    this.gl.uniform1f(this.uniforms.u_brightness, PARAMS.brightness.value);
    this.gl.uniform1f(this.uniforms.u_distortion, PARAMS.distortion.value);
    this.gl.uniform1f(this.uniforms.u_complexity, PARAMS.complexity.value);
    this.gl.uniform1f(this.uniforms.u_activity, oscActivity);
    this.gl.uniform1f(this.uniforms.u_osc_value, oscValue);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);

    this.frameCounter += 1;
    if (now - this.lastFpsUpdate >= 500) {
      const fps = this.frameCounter * 1000 / (now - this.lastFpsUpdate);
      byId('fps-readout').textContent = `${fps.toFixed(0)} fps`;
      this.frameCounter = 0;
      this.lastFpsUpdate = now;
    }
    requestAnimationFrame((time) => this.render(time));
  }
}

async function initialize() {
  buildParameterControls();
  byId('port-input').value = String(listenerPort);
  byId('bind-address').value = listenerBindAddress;

  byId('start-btn').addEventListener('click', startListener);
  byId('stop-btn').addEventListener('click', stopListener);
  byId('test-btn').addEventListener('click', sendTestBurst);
  byId('refresh-endpoints-btn').addEventListener('click', refreshEndpoints);
  byId('learn-btn').addEventListener('click', armLearn);
  byId('reset-mapping-btn').addEventListener('click', resetRoutes);
  byId('clear-log-btn').addEventListener('click', () => {
    logs = [];
    byId('osc-log').innerHTML = '';
  });
  byId('port-input').addEventListener('change', refreshEndpoints);

  unlistenOsc = await listen('osc-event', (message) => handleOscEvent(message.payload));
  unlistenError = await listen('osc-error', (message) => logMessage('decode error', String(message.payload), '', true));

  window.addEventListener('beforeunload', () => {
    if (unlistenOsc) unlistenOsc();
    if (unlistenError) unlistenError();
    invoke('stop_osc_listener').catch(() => {});
  });

  setInterval(pruneEventTimes, 250);
  const renderer = new Renderer(byId('gl-canvas'));
  requestAnimationFrame((time) => renderer.render(time));
  logMessage('system', 'Tauri v2 OSC event listener ready');
  await refreshEndpoints();
  await startListener();
}

initialize().catch((error) => {
  console.error(error);
  setListenerState('error', 'startup error');
  logMessage('error', String(error?.stack || error), '', true);
});
