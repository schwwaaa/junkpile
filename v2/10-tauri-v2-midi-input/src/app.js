'use strict';

const tauri = window.__TAURI__;
if (!tauri?.core?.invoke || !tauri?.event?.listen) {
  document.body.innerHTML = '<pre style="padding:24px;color:#ff7883">Tauri v2 global API is unavailable. Confirm app.withGlobalTauri is true.</pre>';
  throw new Error('Tauri v2 global API unavailable');
}

const { invoke } = tauri.core;
const { listen } = tauri.event;

const PARAMS = {
  hue:        { label: 'Hue',        min: 0,   max: 360, step: 1,    value: 188, cc: 1,  decimals: 0 },
  zoom:       { label: 'Zoom',       min: 0.4, max: 4.5, step: 0.01, value: 1.35, cc: 2,  decimals: 2 },
  speed:      { label: 'Speed',      min: 0,   max: 2.5, step: 0.01, value: 0.55, cc: 3,  decimals: 2 },
  brightness: { label: 'Brightness', min: 0,   max: 2.2, step: 0.01, value: 1.1,  cc: 7,  decimals: 2 },
  distortion: { label: 'Distortion', min: 0,   max: 1.2, step: 0.01, value: 0.35, cc: 10, decimals: 2 },
  complexity: { label: 'Complexity', min: 1,   max: 8,   step: 1,    value: 5,    cc: 74, decimals: 0 },
};

const DEFAULT_CC_MAP = Object.fromEntries(Object.entries(PARAMS).map(([key, spec]) => [spec.cc, key]));
const savedMap = JSON.parse(localStorage.getItem('junkpile-v2-midi-map') || 'null');
let ccMap = savedMap && typeof savedMap === 'object' ? savedMap : { ...DEFAULT_CC_MAP };
let learnTarget = null;
let connected = false;
let noteFlash = 0;
let pitchBend = 0;
let eventCount = 0;
let unlistenMidi = null;
let logs = [];

const byId = (id) => document.getElementById(id);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function saveMappings() {
  localStorage.setItem('junkpile-v2-midi-map', JSON.stringify(ccMap));
}

function ccForParam(key) {
  const entry = Object.entries(ccMap).find(([, param]) => param === key);
  return entry ? Number(entry[0]) : null;
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
        <span class="parameter-cc" id="${key}-cc">${ccForParam(key) === null ? 'unmapped' : `CC ${ccForParam(key)}`}</span>
        <output class="parameter-value" id="${key}-value">${formatValue(key, spec.value)}</output>
      </div>
      <input id="${key}" type="range" min="${spec.min}" max="${spec.max}" step="${spec.step}" value="${spec.value}" aria-label="${spec.label}">
    `;
    list.appendChild(row);
    const input = row.querySelector('input');
    input.addEventListener('input', () => {
      spec.value = Number(input.value);
      byId(`${key}-value`).textContent = formatValue(key, spec.value);
    });
  }
}

function refreshMappingLabels() {
  for (const key of Object.keys(PARAMS)) {
    const cc = ccForParam(key);
    byId(`${key}-cc`).textContent = cc === null ? 'unmapped' : `CC ${cc}`;
  }
}

function setParamFromMidi(key, normalized) {
  const spec = PARAMS[key];
  if (!spec) return;
  const scaled = spec.min + normalized * (spec.max - spec.min);
  const stepped = Math.round(scaled / spec.step) * spec.step;
  spec.value = clamp(stepped, spec.min, spec.max);
  const input = byId(key);
  input.value = String(spec.value);
  byId(`${key}-value`).textContent = formatValue(key, spec.value);
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
  logs = logs.slice(0, 80);
  byId('midi-log').innerHTML = logs.map((line) => `
    <div class="log-line ${line.isError ? 'log-error' : ''}">
      <span class="log-time">${line.time}</span>
      <span class="log-kind">${line.kind}</span>
      <span class="log-raw">${line.text}${line.raw ? ` · [${line.raw}]` : ''}</span>
    </div>`).join('');
}

async function refreshPorts() {
  const select = byId('port-select');
  const prior = select.value;
  select.innerHTML = '<option value="">Scanning…</option>';
  try {
    const ports = await invoke('list_midi_ports');
    select.innerHTML = ports.length
      ? ports.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')
      : '<option value="">— no MIDI inputs found —</option>';
    if (ports.includes(prior)) select.value = prior;
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
    logMessage('system', 'Disconnected');
  } catch (error) {
    logMessage('error', String(error), '', true);
  }
}

async function debugPorts() {
  const report = await invoke('debug_midi_ports');
  logMessage('debug', String(report).replaceAll('\n', ' / '));
  console.info(report);
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
  logMessage('learn', `Move one CC to map ${PARAMS[learnTarget].label}`);
}

function assignLearnedCc(cc) {
  for (const [mappedCc, param] of Object.entries(ccMap)) {
    if (param === learnTarget) delete ccMap[mappedCc];
  }
  delete ccMap[cc];
  ccMap[cc] = learnTarget;
  saveMappings();
  logMessage('learn', `Mapped CC ${cc} → ${PARAMS[learnTarget].label}`);
  learnTarget = null;
  byId('learn-pill').className = 'status-pill idle';
  byId('learn-pill').textContent = 'off';
  byId('learn-btn').classList.remove('active');
  byId('learn-btn').textContent = 'Arm learn';
  refreshMappingLabels();
}

function resetMappings() {
  ccMap = { ...DEFAULT_CC_MAP };
  saveMappings();
  refreshMappingLabels();
  logMessage('system', 'Restored the default CC map');
}

function updateEventMeters(event) {
  if (event.kind === 'note_on') {
    byId('note-value').textContent = String(event.data2);
    byId('note-meter').style.width = `${event.value * 100}%`;
  }
  if (event.kind === 'pitch_bend') {
    byId('bend-value').textContent = String(event.pitchBend);
    const percent = Math.abs(event.value) * 50;
    const meter = byId('bend-meter');
    meter.style.width = `${percent}%`;
    meter.style.marginLeft = event.value < 0 ? `${50 - percent}%` : '50%';
  }
  if (event.kind === 'cc') {
    byId('cc-value').textContent = `CC${event.data1} · ${event.data2}`;
    byId('cc-meter').style.width = `${event.value * 100}%`;
  }
}

function handleMidiEvent(event) {
  eventCount += 1;
  byId('midi-overlay').classList.add('hidden');
  byId('last-kind').textContent = event.kind.replaceAll('_', ' ');
  byId('last-message').textContent = describeMidiEvent(event);
  updateEventMeters(event);

  if (event.kind === 'cc') {
    if (learnTarget) assignLearnedCc(event.data1);
    const param = ccMap[event.data1];
    if (param) setParamFromMidi(param, event.value);
  } else if (event.kind === 'note_on') {
    noteFlash = Math.max(noteFlash, event.value);
  } else if (event.kind === 'pitch_bend') {
    pitchBend = event.value;
  }

  logMessage(event.kind, describeMidiEvent(event), event.raw.join(', '));
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
uniform float u_note_flash;
uniform float u_pitch_bend;

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
  uv = rotate2d(u_pitch_bend * 1.2 + u_time * 0.04) * uv;

  vec2 warp = vec2(
    fbm(uv * 1.4 + vec2(u_time * 0.17, 0.0)),
    fbm(uv * 1.4 + vec2(0.0, -u_time * 0.14))
  ) - 0.5;
  vec2 domain = uv + warp * u_distortion * 2.2;

  float field = fbm(domain * 2.1 + u_time * 0.08);
  field += 0.45 * fbm(domain * 4.2 - u_time * 0.12);
  field = smoothstep(0.18, 1.18, field);

  float hue = fract(u_hue / 360.0 + field * 0.3 + u_time * 0.015);
  float flash = u_note_flash * exp(-4.0 * length(uv));
  vec3 color = hsb2rgb(vec3(hue, 0.82, field * u_brightness + flash));
  color += vec3(0.12, 0.18, 0.22) * flash;
  gl_FragColor = vec4(color, 1.0);
}`;

class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance' });
    if (!this.gl) throw new Error('WebGL 1 is unavailable in this WebView');
    this.program = this.createProgram(VERTEX_SHADER, FRAGMENT_SHADER);
    this.uniforms = {};
    for (const name of ['u_resolution','u_time','u_hue','u_zoom','u_brightness','u_distortion','u_complexity','u_note_flash','u_pitch_bend']) {
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
    noteFlash *= Math.pow(0.02, Math.min((now - this.lastFrame) / 1000, 0.1));
    pitchBend *= 0.995;
    this.lastFrame = now;

    this.gl.useProgram(this.program);
    this.gl.uniform2f(this.uniforms.u_resolution, this.canvas.width, this.canvas.height);
    this.gl.uniform1f(this.uniforms.u_time, elapsed * PARAMS.speed.value);
    this.gl.uniform1f(this.uniforms.u_hue, PARAMS.hue.value);
    this.gl.uniform1f(this.uniforms.u_zoom, PARAMS.zoom.value);
    this.gl.uniform1f(this.uniforms.u_brightness, PARAMS.brightness.value);
    this.gl.uniform1f(this.uniforms.u_distortion, PARAMS.distortion.value);
    this.gl.uniform1f(this.uniforms.u_complexity, PARAMS.complexity.value);
    this.gl.uniform1f(this.uniforms.u_note_flash, noteFlash);
    this.gl.uniform1f(this.uniforms.u_pitch_bend, pitchBend);
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
  refreshMappingLabels();
  byId('refresh-btn').addEventListener('click', refreshPorts);
  byId('connect-btn').addEventListener('click', connectPort);
  byId('disconnect-btn').addEventListener('click', disconnectPort);
  byId('debug-btn').addEventListener('click', debugPorts);
  byId('learn-btn').addEventListener('click', armLearn);
  byId('reset-mapping-btn').addEventListener('click', resetMappings);
  byId('clear-log-btn').addEventListener('click', () => { logs = []; byId('midi-log').innerHTML = ''; });

  unlistenMidi = await listen('midi-event', (message) => handleMidiEvent(message.payload));
  window.addEventListener('beforeunload', () => {
    if (unlistenMidi) unlistenMidi();
    invoke('disconnect_midi').catch(() => {});
  });

  const renderer = new Renderer(byId('gl-canvas'));
  requestAnimationFrame((time) => renderer.render(time));
  logMessage('system', 'Tauri v2 event listener ready');
  await refreshPorts();
}

initialize().catch((error) => {
  console.error(error);
  setConnectionState('error', 'startup error');
  logMessage('error', String(error?.stack || error), '', true);
});
