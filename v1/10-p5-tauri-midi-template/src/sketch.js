'use strict';

const tauri = window.__TAURI__;
const invoke = tauri?.tauri?.invoke;
const listen = tauri?.event?.listen;

const PARAMS = {
  hue:        { label: 'Hue',        min: 0,   max: 360, step: 1,    value: 180, cc: 1,  decimals: 0, suffix: '°' },
  zoom:       { label: 'Zoom',       min: 0.5, max: 4,   step: 0.01, value: 1.5, cc: 2,  decimals: 2, suffix: '' },
  speed:      { label: 'Speed',      min: 0,   max: 2,   step: 0.01, value: 0.5, cc: 3,  decimals: 2, suffix: '×' },
  brightness: { label: 'Brightness', min: 0,   max: 2,   step: 0.01, value: 1,   cc: 7,  decimals: 2, suffix: '' },
  distortion: { label: 'Distortion', min: 0,   max: 1,   step: 0.01, value: 0.3, cc: 10, decimals: 2, suffix: '' },
  complexity: { label: 'Complexity', min: 1,   max: 8,   step: 1,    value: 4,   cc: 74, decimals: 0, suffix: '' },
  saturation: { label: 'Saturation', min: 0,   max: 1,   step: 0.01, value: 0.8, cc: null, decimals: 2, suffix: '' },
  glow:       { label: 'Glow',       min: 0,   max: 1,   step: 0.01, value: 0.4, cc: null, decimals: 2, suffix: '' },
};

const DEFAULT_VALUES = Object.fromEntries(Object.entries(PARAMS).map(([key, spec]) => [key, spec.value]));
const DEFAULT_CC_MAP = Object.fromEntries(Object.entries(PARAMS).filter(([, spec]) => spec.cc !== null).map(([key, spec]) => [spec.cc, key]));
const PRESETS = {
  default: { ...DEFAULT_VALUES },
  soft: { hue: 195, zoom: 1.05, speed: 0.22, brightness: 1.05, distortion: 0.14, complexity: 4, saturation: 0.58, glow: 0.78 },
  prism: { hue: 310, zoom: 2.2, speed: 0.72, brightness: 1.18, distortion: 0.67, complexity: 7, saturation: 1, glow: 0.52 },
  mono: { hue: 190, zoom: 1.7, speed: 0.38, brightness: 1.28, distortion: 0.4, complexity: 5, saturation: 0.08, glow: 0.9 },
};

let ccMap = loadMappings();
let learnTarget = null;
let connected = false;
let eventCount = 0;
let noteFlash = 0;
let pitchBend = 0;
let paused = false;
let elapsedSeconds = 0;
let shaderProgram;
let logs = [];
let unlistenMidi = null;
let fpsFrames = 0;
let fpsWindowStart = performance.now();

const byId = (id) => document.getElementById(id);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function loadMappings() {
  try {
    const saved = JSON.parse(localStorage.getItem('junkpile-v1-midi-map') || 'null');
    return saved && typeof saved === 'object' ? saved : { ...DEFAULT_CC_MAP };
  } catch {
    return { ...DEFAULT_CC_MAP };
  }
}

function saveMappings() {
  localStorage.setItem('junkpile-v1-midi-map', JSON.stringify(ccMap));
}

function ccForParam(key) {
  const entry = Object.entries(ccMap).find(([, param]) => param === key);
  return entry ? Number(entry[0]) : null;
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
        <span class="parameter-cc" id="${key}-cc">unmapped</span>
        <output class="parameter-value" id="${key}-value">${formatValue(key, spec.value)}</output>
      </div>
      <input id="${key}" type="range" min="${spec.min}" max="${spec.max}" step="${spec.step}" value="${spec.value}" aria-label="${escapeHtml(spec.label)}" />`;
    list.appendChild(row);

    row.querySelector('input').addEventListener('input', (event) => {
      spec.value = Number(event.currentTarget.value);
      byId(`${key}-value`).textContent = formatValue(key, spec.value);
    });
  }
  refreshMappingLabels();
}

function refreshMappingLabels() {
  for (const key of Object.keys(PARAMS)) {
    const cc = ccForParam(key);
    const label = byId(`${key}-cc`);
    if (label) label.textContent = cc === null ? 'unmapped' : `CC ${cc}`;
  }
}

function setParam(key, value, updateControl = true) {
  const spec = PARAMS[key];
  if (!spec) return;
  const steps = Math.round((value - spec.min) / spec.step);
  spec.value = clamp(spec.min + steps * spec.step, spec.min, spec.max);
  if (updateControl) {
    const input = byId(key);
    if (input) input.value = String(spec.value);
    const output = byId(`${key}-value`);
    if (output) output.textContent = formatValue(key, spec.value);
  }
}

function applyPreset(name) {
  const preset = PRESETS[name];
  if (!preset) return;
  for (const [key, value] of Object.entries(preset)) setParam(key, value);
  elapsedSeconds = 0;
  logMessage('system', `Applied ${name} preset`);
}

function resetAll() {
  for (const [key, value] of Object.entries(DEFAULT_VALUES)) setParam(key, value);
  noteFlash = 0;
  pitchBend = 0;
  elapsedSeconds = 0;
  logMessage('system', 'Restored visual defaults');
}

function resetMappings() {
  ccMap = { ...DEFAULT_CC_MAP };
  saveMappings();
  refreshMappingLabels();
  logMessage('system', 'Restored default CC map');
}

function setConnectionState(state, label) {
  connected = state === 'connected';
  const pill = byId('connection-pill');
  pill.className = `status-pill ${state}`;
  pill.textContent = label;
  byId('midi-overlay').classList.toggle('hidden', connected || eventCount > 0);
}

function logMessage(kind, text, raw = '', isError = false) {
  const time = new Date().toLocaleTimeString([], { hour12: false });
  logs.unshift({ time, kind, text, raw, isError });
  logs = logs.slice(0, 100);
  byId('midi-log').innerHTML = logs.map((line) => `
    <div class="log-line ${line.isError ? 'log-error' : ''}">
      <span class="log-time">${escapeHtml(line.time)}</span>
      <span class="log-kind">${escapeHtml(line.kind)}</span>
      <span class="log-raw">${escapeHtml(line.text)}${line.raw ? ` · [${escapeHtml(line.raw)}]` : ''}</span>
    </div>`).join('');
}

async function refreshPorts() {
  if (!invoke) return;
  const select = byId('port-select');
  const previous = select.value;
  select.innerHTML = '<option value="">Scanning…</option>';
  try {
    const ports = await invoke('list_midi_ports');
    select.innerHTML = '';
    if (ports.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = '— no MIDI inputs found —';
      select.appendChild(option);
    } else {
      for (const name of ports) {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        select.appendChild(option);
      }
      if (ports.includes(previous)) select.value = previous;
    }
    logMessage('system', `Found ${ports.length} MIDI input${ports.length === 1 ? '' : 's'}`);
  } catch (error) {
    select.innerHTML = '<option value="">— MIDI scan failed —</option>';
    setConnectionState('error', 'scan error');
    logMessage('error', String(error), '', true);
  }
}

async function connectPort() {
  const portName = byId('port-select').value;
  if (!portName) {
    logMessage('system', 'Select a MIDI input before connecting');
    return;
  }
  setConnectionState('idle', 'connecting');
  try {
    const resolved = await invoke('connect_midi_port_by_name', { portName });
    setConnectionState('connected', 'connected');
    logMessage('system', `Connected to ${resolved}`);
  } catch (error) {
    setConnectionState('error', 'connect error');
    logMessage('error', String(error), '', true);
  }
}

async function disconnectPort() {
  try {
    await invoke('disconnect_midi');
    setConnectionState('idle', 'disconnected');
    logMessage('system', 'Disconnected MIDI input');
  } catch (error) {
    logMessage('error', String(error), '', true);
  }
}

async function debugPorts() {
  try {
    const message = await invoke('debug_midi_ports');
    logMessage('debug', message.replaceAll('\n', ' · '));
    console.info(message);
  } catch (error) {
    logMessage('error', String(error), '', true);
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
  byId('learn-pill').textContent = 'armed';
  byId('learn-btn').classList.add('active');
  byId('learn-btn').textContent = 'Cancel';
  logMessage('learn', `Move one CC to map ${PARAMS[learnTarget].label}`);
}

function assignLearnedCc(ccNumber) {
  for (const [cc, param] of Object.entries(ccMap)) {
    if (param === learnTarget || Number(cc) === ccNumber) delete ccMap[cc];
  }
  ccMap[ccNumber] = learnTarget;
  saveMappings();
  logMessage('learn', `Mapped CC ${ccNumber} to ${PARAMS[learnTarget].label}`);
  learnTarget = null;
  byId('learn-pill').className = 'status-pill idle';
  byId('learn-pill').textContent = 'off';
  byId('learn-btn').classList.remove('active');
  byId('learn-btn').textContent = 'Arm learn';
  refreshMappingLabels();
}

function describeMidiEvent(event) {
  switch (event.kind) {
    case 'cc': return `Channel ${event.channel} · CC ${event.data1} = ${event.data2}`;
    case 'note_on': return `Channel ${event.channel} · note ${event.data1} on · velocity ${event.data2}`;
    case 'note_off': return `Channel ${event.channel} · note ${event.data1} off`;
    case 'pitch_bend': return `Channel ${event.channel} · pitch bend ${event.pitchBend}`;
    case 'program_change': return `Channel ${event.channel} · program ${event.data1}`;
    case 'channel_pressure': return `Channel ${event.channel} · pressure ${event.data1}`;
    case 'poly_aftertouch': return `Channel ${event.channel} · note ${event.data1} aftertouch ${event.data2}`;
    default: return `Channel ${event.channel} · ${event.kind}`;
  }
}

function updateMeters(event) {
  if (event.kind === 'note_on') {
    byId('note-value').textContent = String(event.data2);
    byId('note-meter').style.width = `${event.value * 100}%`;
  } else if (event.kind === 'pitch_bend') {
    byId('bend-value').textContent = String(event.pitchBend);
    const percent = Math.abs(event.value) * 50;
    const meter = byId('bend-meter');
    meter.style.width = `${percent}%`;
    meter.style.left = event.value < 0 ? `${50 - percent}%` : '50%';
  } else if (event.kind === 'cc') {
    byId('cc-value').textContent = `CC${event.data1} · ${event.data2}`;
    byId('cc-meter').style.width = `${event.value * 100}%`;
  }
}

function handleMidiEvent(event) {
  eventCount += 1;
  byId('midi-overlay').classList.add('hidden');
  byId('last-kind').textContent = event.kind.replaceAll('_', ' ');
  byId('last-message').textContent = describeMidiEvent(event);
  updateMeters(event);

  if (event.kind === 'cc') {
    if (learnTarget) assignLearnedCc(event.data1);
    const key = ccMap[event.data1];
    if (key) {
      const spec = PARAMS[key];
      setParam(key, spec.min + event.value * (spec.max - spec.min));
    }
  } else if (event.kind === 'note_on') {
    noteFlash = Math.max(noteFlash, event.value);
  } else if (event.kind === 'pitch_bend') {
    pitchBend = event.value;
  }

  logMessage(event.kind, describeMidiEvent(event), event.raw.join(', '));
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
}`;

const FRAG_SHADER = `
precision highp float;
uniform float u_time;
uniform vec2 u_resolution;
uniform float u_hue;
uniform float u_zoom;
uniform float u_brightness;
uniform float u_saturation;
uniform float u_distortion;
uniform float u_complexity;
uniform float u_glow;
uniform float u_noteFlash;
uniform float u_pitchBend;
varying vec2 vTexCoord;

vec3 hsb2rgb(float h, float s, float b) {
  vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return b * mix(vec3(1.0), rgb, s);
}
float hash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 19.19);
  return fract(p.x * p.y);
}
float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  float frequency = 1.0;
  float octave = 0.0;
  for (int i = 0; i < 8; i++) {
    if (octave >= u_complexity) break;
    value += amplitude * valueNoise(p * frequency);
    frequency *= 2.0;
    amplitude *= 0.5;
    octave += 1.0;
  }
  return value;
}
mat2 rotate2d(float angle) {
  return mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
}
void main() {
  vec2 uv = (vTexCoord - 0.5) * vec2(u_resolution.x / max(u_resolution.y, 1.0), 1.0) * u_zoom;
  uv = rotate2d(u_time * 0.1 + u_pitchBend * 1.5) * uv;
  float warpTime = u_time * 0.35;
  vec2 warp = uv + u_distortion * 2.0 * vec2(
    fbm(uv + vec2(warpTime, 0.0)) - 0.5,
    fbm(uv + vec2(0.0, warpTime)) - 0.5
  );
  float field = fbm(warp * 2.0 + vec2(u_time * 0.5, u_time * 0.35)) * 0.5;
  field += fbm(warp * 3.0 + vec2(-u_time * 0.4, u_time * 0.5)) * 0.3;
  field += fbm(warp * 1.5 + vec2(u_time * 0.15, -u_time * 0.5)) * 0.2;
  field *= 1.0 + u_glow * (1.0 - smoothstep(0.0, 0.8, length(warp)));
  float hue = mod((u_hue / 360.0) + field * 0.4 + u_time * 0.04, 1.0);
  float flash = u_noteFlash * exp(-3.0 * length(uv));
  vec3 color = hsb2rgb(hue, u_saturation, clamp(field * u_brightness + flash, 0.0, 1.5));
  gl_FragColor = vec4(color, 1.0);
}`;

function setup() {
  const container = byId('canvas-container');
  const canvas = createCanvas(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight), WEBGL);
  canvas.parent('canvas-container');
  pixelDensity(1);
  noStroke();
  shaderProgram = createShader(VERT_SHADER, FRAG_SHADER);
  updateCanvasTelemetry();
}

function draw() {
  const deltaSeconds = Math.min(deltaTime / 1000, 0.1);
  if (!paused) elapsedSeconds += deltaSeconds * PARAMS.speed.value;
  noteFlash *= Math.pow(0.018, deltaSeconds);

  shader(shaderProgram);
  shaderProgram.setUniform('u_time', elapsedSeconds);
  shaderProgram.setUniform('u_resolution', [width, height]);
  shaderProgram.setUniform('u_hue', PARAMS.hue.value);
  shaderProgram.setUniform('u_zoom', PARAMS.zoom.value);
  shaderProgram.setUniform('u_brightness', PARAMS.brightness.value);
  shaderProgram.setUniform('u_saturation', PARAMS.saturation.value);
  shaderProgram.setUniform('u_distortion', PARAMS.distortion.value);
  shaderProgram.setUniform('u_complexity', PARAMS.complexity.value);
  shaderProgram.setUniform('u_glow', PARAMS.glow.value);
  shaderProgram.setUniform('u_noteFlash', noteFlash);
  shaderProgram.setUniform('u_pitchBend', pitchBend);
  rect(-width / 2, -height / 2, width, height);

  fpsFrames += 1;
  const now = performance.now();
  if (now - fpsWindowStart >= 500) {
    byId('fps-readout').textContent = `${(fpsFrames * 1000 / (now - fpsWindowStart)).toFixed(0)} fps`;
    fpsFrames = 0;
    fpsWindowStart = now;
  }
}

function windowResized() {
  const container = byId('canvas-container');
  resizeCanvas(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight));
  updateCanvasTelemetry();
}

function updateCanvasTelemetry() {
  if (typeof width === 'number') byId('size-readout').textContent = `${width} × ${height}`;
}

function setPaused(next) {
  paused = next;
  byId('pause-btn').textContent = paused ? 'Resume' : 'Pause';
  byId('canvas-badge').textContent = paused ? 'PAUSED' : 'RUNNING';
  byId('canvas-badge').classList.toggle('paused', paused);
}

async function toggleFullscreen() {
  try {
    const fullscreen = await invoke('toggle_fullscreen');
    byId('fullscreen-btn').textContent = fullscreen ? 'Windowed' : 'Fullscreen';
  } catch (error) {
    logMessage('error', `Fullscreen failed: ${String(error)}`, '', true);
  }
}

function wireUi() {
  byId('refresh-btn').addEventListener('click', refreshPorts);
  byId('connect-btn').addEventListener('click', connectPort);
  byId('disconnect-btn').addEventListener('click', disconnectPort);
  byId('debug-btn').addEventListener('click', debugPorts);
  byId('learn-btn').addEventListener('click', armLearn);
  byId('reset-mapping-btn').addEventListener('click', resetMappings);
  byId('reset-btn').addEventListener('click', resetAll);
  byId('pause-btn').addEventListener('click', () => setPaused(!paused));
  byId('fullscreen-btn').addEventListener('click', toggleFullscreen);
  byId('clear-log-btn').addEventListener('click', () => { logs = []; byId('midi-log').innerHTML = ''; });
  document.querySelectorAll('[data-preset]').forEach((button) => button.addEventListener('click', () => applyPreset(button.dataset.preset)));

  window.addEventListener('keydown', (event) => {
    const tag = document.activeElement?.tagName;
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(tag)) return;
    if (event.code === 'Space') {
      event.preventDefault();
      setPaused(!paused);
    } else if (event.key.toLowerCase() === 'r') {
      resetAll();
    } else if (event.key.toLowerCase() === 'f') {
      toggleFullscreen();
    }
  });
}

async function initialize() {
  if (!invoke || !listen) throw new Error('Tauri v1 global API is unavailable. Confirm build.withGlobalTauri is true.');
  if (typeof window.p5 === 'undefined') throw new Error('p5.js is missing. Run npm install, then npm run dev.');

  buildParameterControls();
  wireUi();
  unlistenMidi = await listen('midi-event', (message) => handleMidiEvent(message.payload));
  window.addEventListener('beforeunload', () => {
    if (unlistenMidi) unlistenMidi();
    invoke('disconnect_midi').catch(() => {});
  });

  const current = await invoke('midi_connection_name');
  if (current) setConnectionState('connected', 'connected');
  logMessage('system', 'Tauri v1 MIDI event listener ready');
  await refreshPorts();
}

document.addEventListener('DOMContentLoaded', () => {
  initialize().catch((error) => {
    console.error(error);
    setConnectionState('error', 'startup error');
    logMessage('error', String(error?.stack || error), '', true);
  });
});
