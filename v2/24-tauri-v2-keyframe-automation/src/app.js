(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const tauriCore = window.__TAURI__?.core ?? null;
  const invoke = tauriCore?.invoke?.bind(tauriCore) ?? null;
  const tauriDialog = window.__TAURI__?.dialog ?? null;
  const tauriWebview = window.__TAURI__?.webview ?? null;

  const PARAMS = [
    { id: 'zoom', label: 'Zoom', min: 0.25, max: 5, step: 0.01, value: 1.35 },
    { id: 'distortion', label: 'Distortion', min: 0, max: 2.5, step: 0.01, value: 0.72 },
    { id: 'complexity', label: 'Complexity', min: 1, max: 8, step: 0.01, value: 5.2 },
    { id: 'hue', label: 'Hue', min: 0, max: 360, step: 1, value: 205 },
    { id: 'saturation', label: 'Saturation', min: 0, max: 2, step: 0.01, value: 1.18 },
    { id: 'brightness', label: 'Brightness', min: 0, max: 2, step: 0.01, value: 1.05 },
    { id: 'contrast', label: 'Contrast', min: 0.25, max: 2.5, step: 0.01, value: 1.12 },
    { id: 'speed', label: 'Shader speed', min: -2, max: 2, step: 0.01, value: 0.45 },
    { id: 'rotation', label: 'Rotation', min: -3.1416, max: 3.1416, step: 0.01, value: 0 },
    { id: 'pulse', label: 'Pulse', min: 0, max: 2, step: 0.01, value: 0.25 }
  ];

  const FACTORY_PRESETS = [
    { name: 'Lime Orbit', description: 'Fast orbital interference', mode: 1, values: { zoom: 1.8, distortion: 0.4, complexity: 4.2, hue: 92, saturation: 1.4, brightness: 1.15, contrast: 1.3, speed: 0.75, rotation: 0.2, pulse: 0.8 } },
    { name: 'Deep Current', description: 'Slow blue domain warp', mode: 0, values: { zoom: 1.15, distortion: 1.1, complexity: 6.4, hue: 218, saturation: 1.2, brightness: 0.85, contrast: 1.25, speed: 0.18, rotation: -0.25, pulse: 0.18 } },
    { name: 'Cell Bloom', description: 'Organic cellular expansion', mode: 2, values: { zoom: 2.1, distortion: 0.8, complexity: 5.5, hue: 326, saturation: 1.5, brightness: 1.18, contrast: 1.42, speed: 0.42, rotation: 0.6, pulse: 1.25 } },
    { name: 'Prism Drive', description: 'High-energy tunnel', mode: 3, values: { zoom: 1.5, distortion: 1.55, complexity: 7.2, hue: 42, saturation: 1.6, brightness: 1.25, contrast: 1.55, speed: 1.15, rotation: -0.5, pulse: 0.55 } }
  ];

  const state = {
    values: Object.fromEntries(PARAMS.map((p) => [p.id, p.value])),
    controls: new Map(),
    tracks: new Map(PARAMS.map((p) => [p.id, []])),
    currentTime: 0,
    duration: 12,
    rate: 1,
    loop: true,
    pingPong: false,
    playing: false,
    pingDirection: 1,
    recordingAutomation: false,
    selectedKey: null,
    snap: 0.1,
    defaultInterpolation: 'ease',
    lastFrameTime: performance.now(),
    shaderTime: 0,
    fpsFrames: 0,
    fpsStamp: performance.now(),
    visualMode: 0,
    draggingKey: null,
    timelineRenderPending: false,
    suppressSlider: false,
    projectTitle: 'Untitled automation'
  };

  const canvas = $('glCanvas');
  const gl = canvas.getContext('webgl', { antialias: false, preserveDrawingBuffer: true });
  if (!gl) {
    $('statusText').textContent = 'WebGL unavailable';
    return;
  }

  const VERTEX = `
    attribute vec2 a_position;
    void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
  `;

  const FRAGMENT = `
    precision highp float;
    uniform vec2 u_resolution;
    uniform float u_time;
    uniform float u_zoom;
    uniform float u_distortion;
    uniform float u_complexity;
    uniform float u_hue;
    uniform float u_saturation;
    uniform float u_brightness;
    uniform float u_contrast;
    uniform float u_speed;
    uniform float u_rotation;
    uniform float u_pulse;
    uniform int u_mode;

    float hash21(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash21(i), hash21(i + vec2(1.,0.)), f.x), mix(hash21(i + vec2(0.,1.)), hash21(i + vec2(1.)), f.x), f.y);
    }
    float fbm(vec2 p) {
      float sum = 0.0, amp = 0.5;
      for (int i = 0; i < 8; i++) {
        if (float(i) >= u_complexity) break;
        sum += amp * noise(p);
        p = mat2(1.65,1.2,-1.2,1.65) * p + 0.17;
        amp *= 0.52;
      }
      return sum;
    }
    vec3 hsv2rgb(vec3 c) {
      vec3 p = abs(fract(c.xxx + vec3(0.,2./3.,1./3.)) * 6. - 3.);
      return c.z * mix(vec3(1.), clamp(p - 1., 0., 1.), c.y);
    }
    void main() {
      vec2 uv = (gl_FragCoord.xy * 2.0 - u_resolution.xy) / min(u_resolution.x, u_resolution.y);
      float c = cos(u_rotation), s = sin(u_rotation);
      uv = mat2(c,-s,s,c) * uv * u_zoom;
      float t = u_time * u_speed;
      float signal = 0.0;
      if (u_mode == 0) {
        vec2 q = vec2(fbm(uv + t * .13), fbm(uv + vec2(4.2,1.7) - t * .11));
        vec2 r = vec2(fbm(uv + q * u_distortion + vec2(1.7,9.2) + t*.08), fbm(uv + q * u_distortion + vec2(8.3,2.8) - t*.06));
        signal = fbm(uv + r * (1.2 + u_distortion));
      } else if (u_mode == 1) {
        float a = atan(uv.y, uv.x);
        float d = length(uv);
        signal = sin(d * (11.0 + u_complexity * 2.0) - t * 3.0 + sin(a * 6.0 + t) * u_distortion * 3.0);
        signal = 0.5 + 0.5 * signal;
      } else if (u_mode == 2) {
        vec2 cell = floor(uv * (2.0 + u_complexity));
        vec2 f = fract(uv * (2.0 + u_complexity)) - .5;
        float md = 2.0;
        for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++) {
          vec2 n = vec2(float(x),float(y));
          vec2 o = vec2(hash21(cell+n),hash21(cell+n+7.3));
          o = .5 + .5*sin(t + 6.2831*o);
          md = min(md,length(n+o-f));
        }
        signal = 1.0 - smoothstep(.05,.8,md + sin(t + length(uv)*8.0)*u_distortion*.08);
      } else {
        float a = atan(uv.y,uv.x);
        float r = max(.08,length(uv));
        signal = sin(12.0/r + a*(3.0+u_complexity*.5) - t*4.0 + fbm(uv*2.0)*u_distortion*5.0);
        signal = .5 + .5*signal;
      }
      float beat = 1.0 + sin(t * 2.5) * u_pulse * 0.12;
      float hue = fract(u_hue / 360.0 + signal * .22 + t * .015);
      vec3 col = hsv2rgb(vec3(hue, clamp(u_saturation,0.0,2.0), signal * 1.12 * u_brightness * beat));
      col = (col - .5) * u_contrast + .5;
      float vignette = smoothstep(1.55,.15,length(uv));
      col *= .65 + .35*vignette;
      gl_FragColor = vec4(max(col,0.0),1.0);
    }
  `;

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'Shader compile failed');
    return shader;
  }

  function makeProgram() {
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'Program link failed');
    return program;
  }

  let program;
  try { program = makeProgram(); } catch (error) {
    $('statusText').textContent = error.message;
    return;
  }

  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const uniforms = {};
  ['resolution','time','zoom','distortion','complexity','hue','saturation','brightness','contrast','speed','rotation','pulse','mode'].forEach((name) => {
    uniforms[name] = gl.getUniformLocation(program, `u_${name}`);
  });

  function formatValue(param, value) {
    if (param.id === 'hue') return `${Math.round(value)}°`;
    if (param.id === 'rotation') return `${value.toFixed(2)} rad`;
    return value.toFixed(param.step >= 1 ? 0 : 2);
  }

  function createParameterControls() {
    const host = $('parameterControls');
    host.innerHTML = '';
    PARAMS.forEach((param) => {
      const row = document.createElement('div');
      row.className = 'parameter-row';
      row.innerHTML = `
        <div class="parameter-head"><span class="parameter-name">${param.label}</span><output class="parameter-value">${formatValue(param, state.values[param.id])}</output></div>
        <div class="parameter-controls"><input type="range" min="${param.min}" max="${param.max}" step="${param.step}" value="${state.values[param.id]}" /><button class="key-btn" title="Add or update keyframe">◆</button></div>`;
      const slider = row.querySelector('input');
      const output = row.querySelector('output');
      const keyButton = row.querySelector('button');
      slider.addEventListener('input', () => {
        const value = Number(slider.value);
        state.values[param.id] = value;
        output.textContent = formatValue(param, value);
        if (state.recordingAutomation && !state.suppressSlider) addOrUpdateKey(param.id, state.currentTime, value, state.defaultInterpolation);
      });
      keyButton.addEventListener('click', () => addOrUpdateKey(param.id, state.currentTime, state.values[param.id], state.defaultInterpolation));
      state.controls.set(param.id, { slider, output, keyButton });
      host.appendChild(row);
    });
    refreshKeyButtons();
  }

  function snapTime(time) {
    const snap = Number(state.snap);
    return snap > 0 ? clamp(Math.round(time / snap) * snap, 0, state.duration) : clamp(time, 0, state.duration);
  }

  function findKey(paramId, time, tolerance = 0.0005) {
    return state.tracks.get(paramId).find((key) => Math.abs(key.time - time) <= tolerance);
  }

  function addOrUpdateKey(paramId, rawTime, value, interpolation) {
    const time = snapTime(rawTime);
    const track = state.tracks.get(paramId);
    let key = findKey(paramId, time, Math.max(0.0005, Number(state.snap) * 0.25));
    if (key) {
      key.time = time;
      key.value = value;
      key.interpolation = interpolation || key.interpolation;
    } else {
      key = { id: uid(), time, value, interpolation: interpolation || state.defaultInterpolation };
      track.push(key);
    }
    track.sort((a, b) => a.time - b.time);
    state.selectedKey = { paramId, keyId: key.id };
    scheduleTimelineRender();
    if (!state.recordingAutomation) setStatus(`Keyed ${labelFor(paramId)} at ${time.toFixed(2)}s`);
  }

  function scheduleTimelineRender() {
    if (state.timelineRenderPending) return;
    state.timelineRenderPending = true;
    requestAnimationFrame(() => {
      state.timelineRenderPending = false;
      renderTimeline();
      updateSummary();
    });
  }

  function deleteKey(paramId, keyId) {
    const track = state.tracks.get(paramId);
    const index = track.findIndex((key) => key.id === keyId);
    if (index >= 0) track.splice(index, 1);
    state.selectedKey = null;
    renderTimeline();
    updateSummary();
  }

  function labelFor(paramId) {
    return PARAMS.find((p) => p.id === paramId)?.label || paramId;
  }

  function ease(t) { return t * t * (3 - 2 * t); }

  function evaluateTrack(paramId, time) {
    const keys = state.tracks.get(paramId);
    if (!keys.length) return state.values[paramId];
    if (time <= keys[0].time) return keys[0].value;
    if (time >= keys[keys.length - 1].time) return keys[keys.length - 1].value;
    for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i], b = keys[i + 1];
      if (time >= a.time && time <= b.time) {
        if (a.interpolation === 'step') return a.value;
        let t = (time - a.time) / Math.max(0.000001, b.time - a.time);
        if (a.interpolation === 'ease') t = ease(t);
        return lerp(a.value, b.value, t);
      }
    }
    return keys[keys.length - 1].value;
  }

  function applyAutomation(time) {
    state.suppressSlider = true;
    PARAMS.forEach((param) => {
      const track = state.tracks.get(param.id);
      if (!track.length) return;
      const value = evaluateTrack(param.id, time);
      state.values[param.id] = value;
      const control = state.controls.get(param.id);
      control.slider.value = String(value);
      control.output.textContent = formatValue(param, value);
    });
    state.suppressSlider = false;
    refreshKeyButtons();
  }

  function setCurrentTime(time, apply = true) {
    state.currentTime = clamp(time, 0, state.duration);
    $('currentTimeInput').value = state.currentTime.toFixed(2);
    updatePlayhead();
    if (apply) applyAutomation(state.currentTime);
  }

  function updatePlayback(dt) {
    if (!state.playing || state.rate === 0) return;
    const delta = dt * state.rate * state.pingDirection;
    let next = state.currentTime + delta;
    if (state.pingPong && (next > state.duration || next < 0)) {
      state.pingDirection *= -1;
      next = clamp(next, 0, state.duration);
    } else if (next > state.duration || next < 0) {
      if (state.loop) {
        next = ((next % state.duration) + state.duration) % state.duration;
      } else {
        next = clamp(next, 0, state.duration);
        setPlaying(false);
      }
    }
    setCurrentTime(next, true);
  }

  function setPlaying(value) {
    state.playing = value;
    $('playBtn').textContent = value ? 'Pause' : 'Play';
    $('playBtn').classList.toggle('primary', !value);
    $('canvasBadge').textContent = value ? 'AUTOMATION PLAYBACK' : (state.recordingAutomation ? 'AUTOMATION ARMED' : 'MANUAL');
    state.lastFrameTime = performance.now();
  }

  function renderTimeline() {
    renderRuler();
    const host = $('tracks');
    host.innerHTML = '';
    PARAMS.forEach((param) => {
      const keys = state.tracks.get(param.id);
      const row = document.createElement('div');
      row.className = 'track-row';
      const label = document.createElement('div');
      label.className = 'track-label';
      label.textContent = `${param.label} · ${keys.length}`;
      const lane = document.createElement('div');
      lane.className = 'track-lane';
      lane.dataset.paramId = param.id;
      lane.addEventListener('dblclick', (event) => {
        const rect = lane.getBoundingClientRect();
        const time = snapTime(((event.clientX - rect.left) / rect.width) * state.duration);
        addOrUpdateKey(param.id, time, state.values[param.id], state.defaultInterpolation);
      });
      keys.forEach((key) => lane.appendChild(makeKeyDot(param, key)));
      row.append(label, lane);
      host.appendChild(row);
    });
    updatePlayhead();
    renderKeyEditor();
    refreshKeyButtons();
  }

  function makeKeyDot(param, key) {
    const dot = document.createElement('div');
    dot.className = 'key-dot';
    if (state.selectedKey?.paramId === param.id && state.selectedKey?.keyId === key.id) dot.classList.add('selected');
    dot.style.left = `${(key.time / state.duration) * 100}%`;
    dot.title = `${param.label}: ${formatValue(param, key.value)} @ ${key.time.toFixed(2)}s (${key.interpolation})`;
    dot.addEventListener('click', (event) => {
      event.stopPropagation();
      state.selectedKey = { paramId: param.id, keyId: key.id };
      renderTimeline();
    });
    dot.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      dot.setPointerCapture(event.pointerId);
      state.draggingKey = { paramId: param.id, keyId: key.id, lane: dot.parentElement };
    });
    dot.addEventListener('pointermove', (event) => {
      if (!state.draggingKey || state.draggingKey.keyId !== key.id) return;
      const rect = state.draggingKey.lane.getBoundingClientRect();
      key.time = snapTime(((event.clientX - rect.left) / rect.width) * state.duration);
      state.tracks.get(param.id).sort((a, b) => a.time - b.time);
      dot.style.left = `${(key.time / state.duration) * 100}%`;
      setCurrentTime(key.time, true);
      renderKeyEditor();
    });
    dot.addEventListener('pointerup', () => { state.draggingKey = null; renderTimeline(); updateSummary(); });
    return dot;
  }

  function renderRuler() {
    const ruler = $('timeRuler');
    ruler.innerHTML = '';
    const divisions = Math.min(24, Math.max(6, Math.round(state.duration)));
    for (let i = 0; i <= divisions; i++) {
      const mark = document.createElement('div');
      mark.className = 'ruler-mark';
      mark.style.left = `${(i / divisions) * 100}%`;
      mark.textContent = `${(state.duration * i / divisions).toFixed(state.duration <= 20 ? 1 : 0)}s`;
      ruler.appendChild(mark);
    }
    ruler.onclick = (event) => {
      const rect = ruler.getBoundingClientRect();
      setCurrentTime(snapTime(((event.clientX - rect.left) / rect.width) * state.duration), true);
    };
  }

  function renderKeyEditor() {
    const host = $('keyEditor');
    if (!state.selectedKey) {
      host.innerHTML = '<span class="muted">Select a keyframe to edit it. Double-click a track to add one.</span>';
      return;
    }
    const track = state.tracks.get(state.selectedKey.paramId);
    const key = track.find((item) => item.id === state.selectedKey.keyId);
    const param = PARAMS.find((item) => item.id === state.selectedKey.paramId);
    if (!key || !param) { state.selectedKey = null; renderKeyEditor(); return; }
    host.innerHTML = `
      <b>${param.label}</b>
      <label>Time <input id="keyTimeEdit" type="number" min="0" max="${state.duration}" step="0.01" value="${key.time.toFixed(3)}" /></label>
      <label>Value <input id="keyValueEdit" type="number" min="${param.min}" max="${param.max}" step="${param.step}" value="${key.value}" /></label>
      <label>Interpolation <select id="keyInterpolationEdit"><option value="linear">Linear</option><option value="ease">Ease</option><option value="step">Step</option></select></label>
      <button id="goToKeyBtn">Go to key</button>
      <button id="deleteKeyBtn" class="danger">Delete key</button>`;
    $('keyInterpolationEdit').value = key.interpolation;
    $('keyTimeEdit').addEventListener('change', () => {
      key.time = snapTime(Number($('keyTimeEdit').value));
      track.sort((a, b) => a.time - b.time);
      renderTimeline(); updateSummary();
    });
    $('keyValueEdit').addEventListener('input', () => {
      key.value = clamp(Number($('keyValueEdit').value), param.min, param.max);
      setCurrentTime(state.currentTime, true);
      updateSummary();
    });
    $('keyInterpolationEdit').addEventListener('change', () => { key.interpolation = $('keyInterpolationEdit').value; renderTimeline(); });
    $('goToKeyBtn').addEventListener('click', () => setCurrentTime(key.time, true));
    $('deleteKeyBtn').addEventListener('click', () => deleteKey(param.id, key.id));
  }

  function updatePlayhead() {
    $('playhead').style.left = `calc(150px + ${(state.currentTime / state.duration) * 100}% - ${(state.currentTime / state.duration) * 150}px)`;
  }

  function refreshKeyButtons() {
    PARAMS.forEach((param) => {
      const control = state.controls.get(param.id);
      if (!control) return;
      control.keyButton.classList.toggle('has-key', Boolean(findKey(param.id, snapTime(state.currentTime), Math.max(.001, Number(state.snap) * .25))));
    });
  }

  function countKeys() { return [...state.tracks.values()].reduce((sum, track) => sum + track.length, 0); }
  function countTracks() { return [...state.tracks.values()].filter((track) => track.length).length; }

  function updateSummary() {
    const keys = countKeys();
    const tracks = countTracks();
    $('keyframeCount').textContent = keys;
    $('trackCount').textContent = tracks;
    $('summaryKeys').textContent = keys;
    $('summaryTracks').textContent = tracks;
    $('summaryDuration').textContent = `${state.duration.toFixed(2)}s`;
    $('summaryMode').textContent = state.pingPong ? 'Ping-pong' : (state.loop ? 'Loop' : 'Once');
    $('durationReadout').textContent = state.duration.toFixed(2);
    $('timelineTitle').textContent = state.projectTitle;
  }

  function setStatus(message) {
    $('statusText').textContent = message;
    clearTimeout(setStatus.timer);
    setStatus.timer = setTimeout(() => { $('statusText').textContent = state.playing ? 'Playing automation' : 'Ready'; }, 1800);
  }

  function applyPreset(preset) {
    state.visualMode = preset.mode;
    $('visualMode').value = String(preset.mode);
    state.suppressSlider = true;
    PARAMS.forEach((param) => {
      const value = preset.values[param.id] ?? param.value;
      state.values[param.id] = value;
      const control = state.controls.get(param.id);
      control.slider.value = value;
      control.output.textContent = formatValue(param, value);
    });
    state.suppressSlider = false;
    setStatus(`Loaded preset: ${preset.name}`);
  }

  function createFactoryPresets() {
    const host = $('factoryPresets');
    FACTORY_PRESETS.forEach((preset) => {
      const button = document.createElement('button');
      button.className = 'preset-card';
      button.innerHTML = `<b>${preset.name}</b><span>${preset.description}</span>`;
      button.onclick = () => applyPreset(preset);
      host.appendChild(button);
    });
  }

  const LOCAL_KEY = 'junkpile-v2-24-presets';
  function readLocalPresets() {
    try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}'); } catch { return {}; }
  }
  function writeLocalPresets(presets) { localStorage.setItem(LOCAL_KEY, JSON.stringify(presets)); refreshLocalPresets(); }
  function refreshLocalPresets() {
    const select = $('localPresetSelect');
    const selected = select.value;
    select.innerHTML = '<option value="">Local presets…</option>';
    Object.keys(readLocalPresets()).sort().forEach((name) => {
      const option = document.createElement('option'); option.value = name; option.textContent = name; select.appendChild(option);
    });
    if ([...select.options].some((option) => option.value === selected)) select.value = selected;
  }

  function serializeProject() {
    return {
      format: 'junkpile-tauri-v2-keyframe-automation',
      version: 1,
      title: state.projectTitle,
      duration: state.duration,
      rate: state.rate,
      loop: state.loop,
      pingPong: state.pingPong,
      visualMode: state.visualMode,
      values: { ...state.values },
      tracks: Object.fromEntries([...state.tracks.entries()].map(([id, keys]) => [id, keys.map((key) => ({ ...key }))]))
    };
  }

  function loadProject(project) {
    if (!project || !['junkpile-tauri-v2-keyframe-automation', 'junkpile-tauri-v1-keyframe-automation'].includes(project.format)) throw new Error('This is not a compatible Junkpile Example 24 automation project.');
    setPlaying(false);
    state.projectTitle = String(project.title || 'Imported automation');
    state.duration = clamp(Number(project.duration) || 12, 1, 300);
    state.rate = clamp(Number(project.rate) || 1, -2, 2);
    state.loop = project.loop !== false;
    state.pingPong = Boolean(project.pingPong);
    state.visualMode = clamp(Number(project.visualMode) || 0, 0, 3);
    PARAMS.forEach((param) => {
      state.values[param.id] = clamp(Number(project.values?.[param.id] ?? param.value), param.min, param.max);
      const incoming = Array.isArray(project.tracks?.[param.id]) ? project.tracks[param.id] : [];
      state.tracks.set(param.id, incoming.map((key) => ({ id: key.id || uid(), time: clamp(Number(key.time) || 0, 0, state.duration), value: clamp(Number(key.value) || 0, param.min, param.max), interpolation: ['linear','ease','step'].includes(key.interpolation) ? key.interpolation : 'ease' })).sort((a,b) => a.time-b.time));
    });
    $('projectTitleInput').value = state.projectTitle;
    $('durationInput').value = state.duration;
    $('rateInput').value = state.rate;
    $('rateValue').textContent = `${state.rate.toFixed(2)}×`;
    $('loopToggle').checked = state.loop;
    $('pingPongToggle').checked = state.pingPong;
    $('visualMode').value = state.visualMode;
    setCurrentTime(0, true);
    renderTimeline(); updateSummary();
    setStatus('Project imported');
  }

  async function writeBytesNative(path, bytes) {
    const chunkSize = 1024 * 1024;
    if (!invoke) throw new Error('Native saving requires the Tauri runtime.');
    if (bytes.byteLength <= chunkSize * 4) {
      return invoke('write_binary', { path, bytes: Array.from(bytes) });
    }
    await invoke('create_binary', { path });
    let written = 0;
    for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
      const chunk = bytes.subarray(offset, Math.min(bytes.byteLength, offset + chunkSize));
      await invoke('append_binary', { path, bytes: Array.from(chunk) });
      written += chunk.byteLength;
      setStatus(`Saving ${Math.round((written / bytes.byteLength) * 100)}%`);
    }
    return path;
  }

  async function saveBytes(bytes, defaultPath, filters, title = 'Save file') {
    if (invoke && tauriDialog?.save) {
      const path = await tauriDialog.save({ defaultPath, title, filters });
      if (!path) return false;
      await writeBytesNative(path, bytes);
      return true;
    }
    const blob = new Blob([bytes]);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = defaultPath;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  }

  async function exportProject() {
    const bytes = new TextEncoder().encode(JSON.stringify(serializeProject(), null, 2));
    const safe = state.projectTitle.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-|-$/g, '') || 'automation';
    if (await saveBytes(bytes, `${safe}.junkpile-automation.json`, [{ name: 'Junkpile automation', extensions: ['json'] }], 'Export automation project')) setStatus('Project exported');
  }

  async function loadNativeProjectPath(path, origin = 'Native') {
    if (!invoke) throw new Error('Native project loading requires the Tauri runtime.');
    const text = await invoke('read_text_file', { path });
    loadProject(JSON.parse(text));
    setStatus(`${origin} project loaded`);
  }

  async function importProject() {
    if (invoke && tauriDialog?.open) {
      const path = await tauriDialog.open({
        multiple: false,
        directory: false,
        title: 'Import automation project',
        filters: [{ name: 'Junkpile automation', extensions: ['json'] }]
      });
      if (!path || Array.isArray(path)) return;
      await loadNativeProjectPath(path);
    } else $('projectFileInput').click();
  }

  async function installNativeDropHandler() {
    if (!tauriWebview?.getCurrentWebview) return;
    try {
      const currentWebview = tauriWebview.getCurrentWebview();
      await currentWebview.onDragDropEvent((event) => {
        const payload = event.payload || {};
        if (payload.type !== 'drop') return;
        const path = Array.from(payload.paths || []).find((value) => /\.json$/i.test(value));
        if (!path) { setStatus('Drop a .json automation project'); return; }
        void loadNativeProjectPath(path, 'Dropped').catch((error) => {
          console.error('Native project drop failed', error);
          setStatus(error.message || String(error));
        });
      });
    } catch (error) {
      console.warn('Native drop handler unavailable', error);
    }
  }

  async function saveSnapshot() {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Could not encode the canvas.');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (await saveBytes(bytes, `junkpile-24-${Date.now()}.png`, [{ name: 'PNG image', extensions: ['png'] }])) setStatus('PNG saved');
  }

  function clearProject() {
    if (!confirm('Clear all keyframes and reset the automation project?')) return;
    setPlaying(false);
    state.tracks = new Map(PARAMS.map((p) => [p.id, []]));
    state.selectedKey = null;
    state.projectTitle = 'Untitled automation';
    $('projectTitleInput').value = state.projectTitle;
    setCurrentTime(0, false);
    renderTimeline(); updateSummary(); setStatus('New project');
  }

  function addDemoAutomation() {
    const demo = [
      ['zoom', [[0,1.1],[4,2.4],[8,.8],[12,1.1]]],
      ['distortion', [[0,.25],[3,1.6],[7,.45],[10,2.0],[12,.25]]],
      ['hue', [[0,190],[4,320],[8,55],[12,190]]],
      ['rotation', [[0,-.4],[6,.8],[12,-.4]]],
      ['pulse', [[0,.15],[5,1.4],[8,.25],[12,.15]]]
    ];
    demo.forEach(([id, values]) => values.forEach(([time,value]) => {
      state.tracks.get(id).push({ id: uid(), time, value, interpolation: 'ease' });
    }));
    renderTimeline(); updateSummary(); applyAutomation(0);
  }

  function bindUI() {
    document.querySelectorAll('.tab').forEach((button) => button.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab === button));
      document.querySelectorAll('.tab-page').forEach((page) => page.classList.toggle('active', page.id === `tab-${button.dataset.tab}`));
    }));
    $('playBtn').onclick = () => setPlaying(!state.playing);
    $('jumpStartBtn').onclick = () => setCurrentTime(0, true);
    $('jumpEndBtn').onclick = () => setCurrentTime(state.duration, true);
    $('stepBackBtn').onclick = () => setCurrentTime(snapTime(state.currentTime - (state.snap || .1)), true);
    $('stepForwardBtn').onclick = () => setCurrentTime(snapTime(state.currentTime + (state.snap || .1)), true);
    $('currentTimeInput').onchange = () => setCurrentTime(snapTime(Number($('currentTimeInput').value)), true);
    $('durationInput').onchange = () => {
      state.duration = clamp(Number($('durationInput').value) || 12, 1, 300);
      for (const track of state.tracks.values()) track.forEach((key) => { key.time = clamp(key.time, 0, state.duration); });
      setCurrentTime(state.currentTime, true); renderTimeline(); updateSummary();
    };
    $('rateInput').oninput = () => { state.rate = Number($('rateInput').value); $('rateValue').textContent = `${state.rate.toFixed(2)}×`; };
    $('loopToggle').onchange = () => { state.loop = $('loopToggle').checked; updateSummary(); };
    $('pingPongToggle').onchange = () => { state.pingPong = $('pingPongToggle').checked; state.pingDirection = 1; updateSummary(); };
    $('recordAutomationBtn').onclick = () => {
      state.recordingAutomation = !state.recordingAutomation;
      $('recordAutomationBtn').classList.toggle('active', state.recordingAutomation);
      $('recordAutomationBtn').textContent = state.recordingAutomation ? 'Automation armed' : 'Arm automation';
      $('canvasBadge').textContent = state.recordingAutomation ? 'AUTOMATION ARMED' : (state.playing ? 'AUTOMATION PLAYBACK' : 'MANUAL');
    };
    $('visualMode').onchange = () => { state.visualMode = Number($('visualMode').value); };
    $('snapSelect').onchange = () => { state.snap = Number($('snapSelect').value); refreshKeyButtons(); };
    $('defaultInterpolation').onchange = () => { state.defaultInterpolation = $('defaultInterpolation').value; };
    $('addAllKeyframesBtn').onclick = () => PARAMS.forEach((param) => addOrUpdateKey(param.id, state.currentTime, state.values[param.id], state.defaultInterpolation));
    $('clearAtTimeBtn').onclick = () => {
      const target = snapTime(state.currentTime);
      PARAMS.forEach((param) => state.tracks.set(param.id, state.tracks.get(param.id).filter((key) => Math.abs(key.time-target) > Math.max(.001,state.snap*.25))));
      state.selectedKey = null; renderTimeline(); updateSummary();
    };
    $('resetParametersBtn').onclick = () => applyPreset({ name: 'Defaults', mode: 0, values: Object.fromEntries(PARAMS.map((p) => [p.id,p.value])) });
    $('clearAllBtn').onclick = () => { if (confirm('Delete every keyframe?')) { PARAMS.forEach((p) => state.tracks.set(p.id, [])); state.selectedKey=null; renderTimeline(); updateSummary(); } };
    $('projectTitleInput').oninput = () => { state.projectTitle = $('projectTitleInput').value || 'Untitled automation'; updateSummary(); };
    $('newProjectBtn').onclick = clearProject;
    $('exportProjectBtn').onclick = () => exportProject().catch((error) => setStatus(error.message));
    $('importProjectBtn').onclick = () => importProject().catch((error) => setStatus(error.message));
    $('projectFileInput').onchange = async () => {
      const file = $('projectFileInput').files[0]; if (!file) return;
      try { loadProject(JSON.parse(await file.text())); } catch (error) { setStatus(error.message); }
      $('projectFileInput').value = '';
    };
    $('savePresetBtn').onclick = () => {
      const name = $('presetNameInput').value.trim(); if (!name) return;
      const presets = readLocalPresets(); presets[name] = { name, mode: state.visualMode, values: { ...state.values } }; writeLocalPresets(presets); $('localPresetSelect').value=name; setStatus(`Saved preset: ${name}`);
    };
    $('deletePresetBtn').onclick = () => {
      const name = $('localPresetSelect').value; if (!name) return;
      const presets = readLocalPresets(); delete presets[name]; writeLocalPresets(presets); setStatus(`Deleted preset: ${name}`);
    };
    $('localPresetSelect').onchange = () => { const preset = readLocalPresets()[$('localPresetSelect').value]; if (preset) applyPreset(preset); };
    $('snapshotBtn').onclick = () => saveSnapshot().catch((error) => setStatus(error.message));
    $('fullscreenBtn').onclick = async () => {
      try {
        if (invoke) await invoke('toggle_fullscreen');
        else if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
        else await document.exitFullscreen();
      } catch (error) { setStatus(error.message || String(error)); }
    };
    window.addEventListener('keydown', (event) => {
      if (event.target.matches('input,select,textarea')) return;
      if (event.code === 'Space') { event.preventDefault(); setPlaying(!state.playing); }
      if (event.key === 'ArrowLeft') setCurrentTime(snapTime(state.currentTime - (state.snap || .1)), true);
      if (event.key === 'ArrowRight') setCurrentTime(snapTime(state.currentTime + (state.snap || .1)), true);
      if (event.key.toLowerCase() === 'k') PARAMS.forEach((param) => addOrUpdateKey(param.id, state.currentTime, state.values[param.id], state.defaultInterpolation));
    });
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(2, Math.round(rect.width * dpr));
    const height = Math.max(2, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; gl.viewport(0,0,width,height); }
  }

  function render(now) {
    resize();
    const dt = Math.min(.1, (now - state.lastFrameTime) / 1000);
    state.lastFrameTime = now;
    state.shaderTime += dt;
    updatePlayback(dt);
    gl.useProgram(program);
    gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
    gl.uniform1f(uniforms.time, state.shaderTime);
    PARAMS.forEach((param) => gl.uniform1f(uniforms[param.id], state.values[param.id]));
    gl.uniform1i(uniforms.mode, state.visualMode);
    gl.drawArrays(gl.TRIANGLES,0,6);
    state.fpsFrames++;
    if (now - state.fpsStamp >= 500) {
      $('fpsReadout').textContent = Math.round(state.fpsFrames * 1000 / (now-state.fpsStamp));
      state.fpsFrames=0; state.fpsStamp=now;
    }
    requestAnimationFrame(render);
  }

  createParameterControls();
  createFactoryPresets();
  refreshLocalPresets();
  bindUI();
  addDemoAutomation();
  setCurrentTime(0, true);
  updateSummary();
  void installNativeDropHandler();
  requestAnimationFrame(render);
})();
