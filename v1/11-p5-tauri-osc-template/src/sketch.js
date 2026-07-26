'use strict';

const tauri = window.__TAURI__;
const invoke = tauri?.tauri?.invoke || tauri?.invoke;
const listen = tauri?.event?.listen;

const PARAMS = {
  hue:        { label: 'Hue',        min: 0,   max: 360, step: 1,    value: 180, decimals: 0, suffix: '°' },
  zoom:       { label: 'Zoom',       min: 0.5, max: 4,   step: 0.01, value: 1.5, decimals: 2, suffix: '' },
  speed:      { label: 'Speed',      min: 0,   max: 2,   step: 0.01, value: 0.5, decimals: 2, suffix: '×' },
  brightness: { label: 'Brightness', min: 0,   max: 2,   step: 0.01, value: 1,   decimals: 2, suffix: '' },
  distortion: { label: 'Distortion', min: 0,   max: 1,   step: 0.01, value: 0.3, decimals: 2, suffix: '' },
  complexity: { label: 'Complexity', min: 1,   max: 8,   step: 1,    value: 4,   decimals: 0, suffix: '' },
  saturation: { label: 'Saturation', min: 0,   max: 1,   step: 0.01, value: 0.8, decimals: 2, suffix: '' },
  glow:       { label: 'Glow',       min: 0,   max: 1,   step: 0.01, value: 0.4, decimals: 2, suffix: '' },
};

const DEFAULT_VALUES = Object.fromEntries(Object.entries(PARAMS).map(([key, spec]) => [key, spec.value]));
const DEFAULT_ROUTES = {
  hue:        { address: '/hue',        mode: 'normalized' },
  zoom:       { address: '/zoom',       mode: 'normalized' },
  speed:      { address: '/speed',      mode: 'normalized' },
  brightness: { address: '/brightness', mode: 'normalized' },
  distortion: { address: '/distortion', mode: 'normalized' },
  complexity: { address: '/complexity', mode: 'normalized' },
  saturation: { address: '/saturation', mode: 'normalized' },
  glow:       { address: '/glow',       mode: 'normalized' },
};

const PRESETS = {
  default: { ...DEFAULT_VALUES },
  soft: { hue: 195, zoom: 1.05, speed: 0.22, brightness: 1.05, distortion: 0.14, complexity: 4, saturation: 0.58, glow: 0.78 },
  prism: { hue: 310, zoom: 2.2, speed: 0.72, brightness: 1.18, distortion: 0.67, complexity: 7, saturation: 1, glow: 0.52 },
  mono: { hue: 190, zoom: 1.7, speed: 0.38, brightness: 1.28, distortion: 0.4, complexity: 5, saturation: 0.08, glow: 0.9 },
};

let routes = loadRoutes();
let learnTarget = null;
let listenerRunning = false;
let listenerPort = 9000;
let listenerBindAddress = '0.0.0.0';
let eventCount = 0;
let eventTimes = [];
let logs = [];
let oscActivity = 0;
let oscValue = 0;
let paused = false;
let elapsedSeconds = 0;
let shaderProgram;
let fpsFrames = 0;
let fpsWindowStart = performance.now();
let unlistenOsc = null;
let unlistenError = null;

const byId = (id) => document.getElementById(id);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function normalizeAddress(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '/unnamed';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function normalizeRoutes(candidate) {
  const normalized = {};
  for (const key of Object.keys(PARAMS)) {
    const fallback = DEFAULT_ROUTES[key];
    const route = candidate?.[key] || fallback;
    normalized[key] = {
      address: normalizeAddress(route.address || fallback.address),
      mode: ['normalized', 'midi127', 'bipolar', 'direct'].includes(route.mode) ? route.mode : fallback.mode,
    };
  }
  return normalized;
}

function loadRoutes() {
  try {
    return normalizeRoutes(JSON.parse(localStorage.getItem('junkpile-v1-osc-routes') || 'null'));
  } catch {
    return normalizeRoutes(DEFAULT_ROUTES);
  }
}

function saveRoutes() {
  localStorage.setItem('junkpile-v1-osc-routes', JSON.stringify(routes));
}

function formatValue(key, value) {
  const spec = PARAMS[key];
  return `${Number(value).toFixed(spec.decimals)}${spec.suffix}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function buildParameterControls() {
  const list = byId('parameter-list');
  const learnSelect = byId('learn-param');
  list.innerHTML = '';
  learnSelect.innerHTML = '';

  for (const [key, spec] of Object.entries(PARAMS)) {
    const learnOption = document.createElement('option');
    learnOption.value = key;
    learnOption.textContent = spec.label;
    learnSelect.appendChild(learnOption);

    const row = document.createElement('div');
    row.className = 'parameter-row';
    row.innerHTML = `
      <div class="parameter-header">
        <span class="parameter-name">${escapeHtml(spec.label)}</span>
        <output class="parameter-value" id="${key}-value">${formatValue(key, spec.value)}</output>
      </div>
      <div class="route-grid">
        <input id="${key}-address" type="text" value="${escapeHtml(routes[key].address)}" aria-label="${escapeHtml(spec.label)} OSC address" spellcheck="false" />
        <select id="${key}-mode" aria-label="${escapeHtml(spec.label)} input scaling">
          <option value="normalized">0–1</option>
          <option value="midi127">0–127</option>
          <option value="bipolar">−1–1</option>
          <option value="direct">Direct</option>
        </select>
      </div>
      <input id="${key}" type="range" min="${spec.min}" max="${spec.max}" step="${spec.step}" value="${spec.value}" aria-label="${escapeHtml(spec.label)} manual value" />`;
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
  const stepped = Math.round((value - spec.min) / spec.step) * spec.step + spec.min;
  spec.value = clamp(stepped, spec.min, spec.max);
  const input = byId(key);
  const output = byId(`${key}-value`);
  if (input) input.value = String(spec.value);
  if (output) output.textContent = formatValue(key, spec.value);
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

function applyPreset(name) {
  const preset = PRESETS[name];
  if (!preset) return;
  for (const [key, value] of Object.entries(preset)) setParamValue(key, value);
  elapsedSeconds = 0;
  logMessage('preset', `Applied ${name} state`);
}

function resetAll() {
  for (const [key, value] of Object.entries(DEFAULT_VALUES)) setParamValue(key, value);
  elapsedSeconds = 0;
  oscActivity = 0;
  oscValue = 0;
  logMessage('system', 'Restored visual defaults');
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

function setListenerState(state, label) {
  listenerRunning = state === 'connected';
  const pill = byId('listener-pill');
  pill.className = `status-pill ${state}`;
  pill.textContent = label;
}

function logMessage(kind, text, detail = '', isError = false) {
  const time = new Date().toLocaleTimeString([], { hour12: false });
  logs.unshift({ time, kind, text, detail, isError });
  logs = logs.slice(0, 120);
  byId('osc-log').innerHTML = logs.map((line) => `
    <div class="log-line ${line.isError ? 'log-error' : ''}">
      <span class="log-time">${escapeHtml(line.time)}</span>
      <span class="log-kind">${escapeHtml(line.kind)}</span>
      <span class="log-raw">${escapeHtml(line.text)}${line.detail ? ` · ${escapeHtml(line.detail)}` : ''}</span>
    </div>`).join('');
}

function readPort() {
  const port = Math.round(Number(byId('port-input').value));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('UDP port must be between 1 and 65535');
  }
  return port;
}

async function refreshEndpoints() {
  if (!invoke) return;
  try {
    const port = readPort();
    const endpoints = await invoke('get_network_hints', { port });
    byId('endpoint-list').innerHTML = endpoints.map((endpoint) => `<div>${escapeHtml(endpoint)}</div>`).join('');
  } catch (error) {
    byId('endpoint-list').textContent = `Could not inspect endpoints: ${error}`;
  }
}

async function startListener() {
  if (!invoke) return;
  let port;
  try {
    port = readPort();
  } catch (error) {
    setListenerState('error', 'invalid port');
    logMessage('error', String(error), '', true);
    return;
  }
  const bindAddress = byId('bind-address').value;
  setListenerState('idle', 'starting');
  try {
    const info = await invoke('start_osc_listener', { bindAddress, port });
    listenerPort = info.port;
    listenerBindAddress = info.bindAddress;
    localStorage.setItem('junkpile-v1-osc-port', String(listenerPort));
    localStorage.setItem('junkpile-v1-osc-bind', listenerBindAddress);
    setListenerState('connected', `UDP ${listenerPort}`);
    logMessage('system', `Listening on ${info.endpoint}`);
    await refreshEndpoints();
  } catch (error) {
    setListenerState('error', 'bind error');
    logMessage('error', String(error), '', true);
  }
}

async function stopListener() {
  if (!invoke) return;
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
  if (!invoke) return;
  if (!listenerRunning) await startListener();
  if (!listenerRunning) return;

  const sequence = [
    ['hue', 0.12],
    ['zoom', 0.72],
    ['distortion', 0.78],
    ['complexity', 0.88],
    ['brightness', 0.64],
    ['speed', 0.42],
    ['saturation', 0.95],
    ['glow', 0.7],
  ];

  logMessage('test', 'Sending eight local OSC messages');
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

function handleOscEvent(event) {
  eventCount += 1;
  eventTimes.push(performance.now());
  pruneEventTimes();
  byId('osc-overlay').classList.add('hidden');
  byId('last-address').textContent = event.address;
  byId('event-count').textContent = String(eventCount);

  const argsText = event.args.length
    ? event.args.map((argument) => `${argument.kind}:${argument.text}`).join(', ')
    : 'no arguments';
  byId('last-message').textContent = `${argsText} · ${event.sender}`;
  byId('sender-value').textContent = event.sender;
  byId('sender-meter').style.width = '100%';

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

function togglePause() {
  paused = !paused;
  byId('pause-btn').textContent = paused ? 'Resume' : 'Pause';
  byId('pause-btn').classList.toggle('active', paused);
  byId('canvas-badge').textContent = paused ? 'PAUSED' : 'RUNNING';
  if (paused) noLoop(); else loop();
}

async function toggleFullscreen() {
  try {
    if (invoke) await invoke('toggle_fullscreen');
    else if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  } catch (error) {
    logMessage('error', `Fullscreen failed: ${error}`, '', true);
  }
}

const VERT_SHADER = `
  precision highp float;
  attribute vec3 aPosition;
  attribute vec2 aTexCoord;
  varying vec2 vTexCoord;
  void main() {
    vTexCoord = aTexCoord;
    vec4 position = vec4(aPosition, 1.0);
    position.xy = position.xy * 2.0 - 1.0;
    gl_Position = position;
  }
`;

const FRAG_SHADER = `
  precision highp float;
  varying vec2 vTexCoord;
  uniform vec2 u_resolution;
  uniform float u_time;
  uniform float u_hue;
  uniform float u_zoom;
  uniform float u_brightness;
  uniform float u_saturation;
  uniform float u_distortion;
  uniform float u_complexity;
  uniform float u_glow;
  uniform float u_activity;
  uniform float u_osc_value;

  vec3 hsb2rgb(float h, float s, float b) {
    vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    rgb = rgb * rgb * (3.0 - 2.0 * rgb);
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
    float v = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;
    float octave = 0.0;
    for (int i = 0; i < 8; i++) {
      if (octave >= u_complexity) break;
      v += amplitude * vnoise(p * frequency);
      frequency *= 2.0;
      amplitude *= 0.5;
      octave += 1.0;
    }
    return v;
  }

  void main() {
    vec2 uv = (vTexCoord - 0.5) * vec2(u_resolution.x / max(u_resolution.y, 1.0), 1.0) * u_zoom;
    float t = u_time * 0.5;
    float activity = u_activity;
    vec2 warp = uv + (u_distortion * 2.0 + activity * 0.35) * vec2(
      fbm(uv + vec2(t, 0.0)) - 0.5,
      fbm(uv + vec2(0.0, t)) - 0.5
    );
    float field = fbm(warp * 2.0 + vec2(t, t * 0.7)) * 0.5;
    field += fbm(warp * 3.0 + vec2(-t * 0.8, t)) * 0.3;
    field += fbm(warp * 1.5 + vec2(t * 0.3, -t)) * 0.2;
    float radial = 1.0 - smoothstep(0.0, 0.85, length(warp));
    field *= 1.0 + u_glow * radial + activity * (0.2 + u_osc_value * 0.35);
    float hue = mod((u_hue / 360.0) + field * 0.4 + u_time * 0.04 + u_osc_value * 0.08, 1.0);
    vec3 color = hsb2rgb(hue, u_saturation, clamp(field * u_brightness, 0.0, 1.5));
    color += activity * vec3(0.08, 0.16, 0.22) * radial;
    gl_FragColor = vec4(color, 1.0);
  }
`;

function setup() {
  const container = byId('canvas-container');
  const canvas = createCanvas(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight), WEBGL);
  canvas.parent('canvas-container');
  pixelDensity(1);
  shaderProgram = createShader(VERT_SHADER, FRAG_SHADER);
  noStroke();
  frameRate(60);
}

function draw() {
  const dt = Math.min(deltaTime || 16.67, 100) / 1000;
  elapsedSeconds += dt * PARAMS.speed.value;
  oscActivity *= Math.pow(0.035, dt);
  oscValue *= Math.pow(0.16, dt);

  shader(shaderProgram);
  shaderProgram.setUniform('u_resolution', [width, height]);
  shaderProgram.setUniform('u_time', elapsedSeconds);
  shaderProgram.setUniform('u_hue', PARAMS.hue.value);
  shaderProgram.setUniform('u_zoom', PARAMS.zoom.value);
  shaderProgram.setUniform('u_brightness', PARAMS.brightness.value);
  shaderProgram.setUniform('u_saturation', PARAMS.saturation.value);
  shaderProgram.setUniform('u_distortion', PARAMS.distortion.value);
  shaderProgram.setUniform('u_complexity', PARAMS.complexity.value);
  shaderProgram.setUniform('u_glow', PARAMS.glow.value);
  shaderProgram.setUniform('u_activity', oscActivity);
  shaderProgram.setUniform('u_osc_value', oscValue);
  rect(-width / 2, -height / 2, width, height);

  fpsFrames += 1;
  const now = performance.now();
  if (now - fpsWindowStart >= 500) {
    const fps = Math.round((fpsFrames * 1000) / (now - fpsWindowStart));
    byId('fps-readout').textContent = `${fps} fps`;
    byId('size-readout').textContent = `${width} × ${height}`;
    fpsFrames = 0;
    fpsWindowStart = now;
  }

  pruneEventTimes();
  byId('activity-meter').style.width = `${clamp(oscActivity, 0, 1) * 100}%`;
  if (oscActivity < 0.02) byId('sender-meter').style.width = '0%';
}

function windowResized() {
  const container = byId('canvas-container');
  if (!container) return;
  resizeCanvas(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight));
}

async function initializeTauriEvents() {
  if (!listen) return;
  unlistenOsc = await listen('osc-event', (event) => handleOscEvent(event.payload));
  unlistenError = await listen('osc-error', (event) => logMessage('decode error', String(event.payload), '', true));
}

function wireUi() {
  byId('start-btn').addEventListener('click', startListener);
  byId('stop-btn').addEventListener('click', stopListener);
  byId('endpoints-btn').addEventListener('click', refreshEndpoints);
  byId('test-btn').addEventListener('click', sendTestBurst);
  byId('learn-btn').addEventListener('click', armLearn);
  byId('reset-btn').addEventListener('click', resetAll);
  byId('reset-routes-btn').addEventListener('click', resetRoutes);
  byId('pause-btn').addEventListener('click', togglePause);
  byId('fullscreen-btn').addEventListener('click', toggleFullscreen);
  byId('clear-log-btn').addEventListener('click', () => {
    logs = [];
    byId('osc-log').innerHTML = '';
  });
  document.querySelectorAll('[data-preset]').forEach((button) => {
    button.addEventListener('click', () => applyPreset(button.dataset.preset));
  });
  window.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    if (event.code === 'Space') { event.preventDefault(); togglePause(); }
    if (event.key.toLowerCase() === 'r') resetAll();
    if (event.key.toLowerCase() === 'f') toggleFullscreen();
  });
  window.addEventListener('beforeunload', () => {
    if (typeof unlistenOsc === 'function') unlistenOsc();
    if (typeof unlistenError === 'function') unlistenError();
  });
}

async function initialize() {
  listenerPort = Number(localStorage.getItem('junkpile-v1-osc-port')) || 9000;
  listenerBindAddress = localStorage.getItem('junkpile-v1-osc-bind') || '0.0.0.0';
  byId('port-input').value = String(listenerPort);
  byId('bind-address').value = listenerBindAddress;
  buildParameterControls();
  wireUi();
  await initializeTauriEvents();
  await refreshEndpoints();
  await startListener();
  logMessage('system', 'OSC input ready. Press “Send test burst” to verify the full path.');
}

document.addEventListener('DOMContentLoaded', initialize);
