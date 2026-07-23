const invoke = window.__TAURI__?.core?.invoke;

const statusPill = document.querySelector('[data-status-pill]');
const statusText = statusPill.querySelector('span');
const errorBox = document.querySelector('[data-error]');
const paramInputs = [...document.querySelectorAll('[data-param]')];
const toggleInputs = [...document.querySelectorAll('[data-toggle]')];
const viewSelect = document.querySelector('[data-select="view_mode"]');
const presetButtons = [...document.querySelectorAll('[data-preset]')];
let initialized = false;
let polling = false;
let lastError = '';

// Range inputs can emit hundreds of events per second. Keep only the newest
// value, serialize IPC flushes, and temporarily protect locally edited values
// from the slower renderer telemetry poll.
const queuedParams = new Map();
const localParams = new Map();
const activeParams = new Set();
let paramFlushScheduled = false;
let paramFlushActive = false;

function valuesMatch(input, a, b) {
  const step = Math.max(Number(input.step || 0), 0.0001);
  return Math.abs(Number(a) - Number(b)) <= step * 0.51;
}

function queueParam(name, value) {
  queuedParams.set(name, value);
  localParams.set(name, { value, protectUntil: performance.now() + 500 });
  scheduleParamFlush();
}

function scheduleParamFlush() {
  if (paramFlushScheduled || paramFlushActive) return;
  paramFlushScheduled = true;
  requestAnimationFrame(() => {
    paramFlushScheduled = false;
    flushParamQueue();
  });
}

async function flushParamQueue() {
  if (paramFlushActive || queuedParams.size === 0) return;
  paramFlushActive = true;
  const batch = [...queuedParams.entries()];
  queuedParams.clear();

  try {
    await Promise.all(batch.map(([name, value]) =>
      command('set_param', { name, value })
    ));
  } catch (error) {
    showError(error);
  } finally {
    paramFlushActive = false;
    if (queuedParams.size > 0) scheduleParamFlush();
  }
}

const infoToControl = {
  cameraYawDegrees: 'camera_yaw',
  cameraPitchDegrees: 'camera_pitch',
  cameraDistance: 'camera_distance',
  cameraFovDegrees: 'camera_fov',
  autoOrbitDegrees: 'auto_orbit',
  simulationSpeed: 'simulation_speed',
  feedback: 'feedback',
  damping: 'damping',
  spring: 'spring',
  smoothing: 'smoothing',
  drive: 'drive',
  noiseScale: 'noise_scale',
  noiseSpeed: 'noise_speed',
  twist: 'twist',
  curl: 'curl',
  pulse: 'pulse',
  gravity: 'gravity',
  maxDisplacement: 'max_displacement',
  impulseStrength: 'impulse_strength',
  impulseRadius: 'impulse_radius',
  autoImpulseInterval: 'auto_impulse_interval',
  exposure: 'exposure',
  roughness: 'roughness',
  lightAzimuthDegrees: 'light_azimuth',
  lightElevationDegrees: 'light_elevation',
  lightIntensity: 'light_intensity',
  background: 'background'
};

function decimalsFor(input) {
  const step = Number(input.step || 1);
  if (step >= 1) return 0;
  if (step >= 0.1) return 1;
  if (step >= 0.01) return 2;
  return 3;
}

function renderOutput(input) {
  const output = document.querySelector(`[data-output="${input.dataset.param}"]`);
  if (!output) return;
  const value = Number(input.value);
  output.value = `${value.toFixed(decimalsFor(input))}${input.dataset.unit || ''}`;
}

function setStatus(kind, text) {
  statusPill.classList.remove('ready', 'error', 'paused');
  if (kind) statusPill.classList.add(kind);
  statusText.textContent = text;
}

async function command(name, payload = {}) {
  if (!invoke) throw new Error('Tauri IPC is unavailable. Run this page through `npm run dev`, not a normal browser tab.');
  return invoke(name, payload);
}

function showError(message) {
  lastError = String(message || 'Unknown renderer error');
  errorBox.hidden = false;
  errorBox.textContent = lastError;
  setStatus('error', 'Renderer error');
}

function clearError() {
  lastError = '';
  errorBox.hidden = true;
  errorBox.textContent = '';
}

paramInputs.forEach((input) => {
  const name = input.dataset.param;
  renderOutput(input);

  input.addEventListener('pointerdown', () => {
    activeParams.add(name);
  });

  input.addEventListener('input', () => {
    const value = Number(input.value);
    activeParams.add(name);
    renderOutput(input);
    queueParam(name, value);
  });

  const finishInteraction = () => {
    activeParams.delete(name);
    const local = localParams.get(name);
    if (local) local.protectUntil = performance.now() + 350;
    scheduleParamFlush();
  };

  input.addEventListener('pointerup', finishInteraction);
  input.addEventListener('pointercancel', finishInteraction);
  input.addEventListener('change', finishInteraction);
  input.addEventListener('blur', finishInteraction);
});

toggleInputs.forEach((input) => {
  input.addEventListener('change', () => {
    command('set_toggle', { name: input.dataset.toggle, enabled: input.checked }).catch(showError);
  });
});

viewSelect.addEventListener('change', () => command('set_view_mode', { mode: viewSelect.value }).catch(showError));

presetButtons.forEach((button) => {
  button.addEventListener('click', async () => {
    try {
      await command('apply_preset', { preset: button.dataset.preset });
      presetButtons.forEach((item) => item.classList.toggle('active', item === button));
      setTimeout(pollInfo, 40);
    } catch (error) {
      showError(error);
    }
  });
});

document.querySelector('[data-command="impulse"]').addEventListener('click', () => command('trigger_impulse').catch(showError));
document.querySelector('[data-command="reset-simulation"]').addEventListener('click', () => command('reset_simulation').catch(showError));
document.querySelector('[data-command="renderer-fullscreen"]').addEventListener('click', () => command('toggle_renderer_fullscreen').catch(showError));
document.querySelector('[data-command="reset"]').addEventListener('click', async () => {
  try {
    await command('reset_lab');
    presetButtons.forEach((item) => item.classList.toggle('active', item.dataset.preset === 'liquid'));
    setTimeout(pollInfo, 40);
  } catch (error) {
    showError(error);
  }
});

function setText(selector, value) {
  const node = document.querySelector(selector);
  if (node) node.textContent = value;
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} MiB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${value} B`;
}

function syncControls(info) {
  for (const [infoKey, paramName] of Object.entries(infoToControl)) {
    const input = document.querySelector(`[data-param="${paramName}"]`);
    if (!input || info[infoKey] == null) continue;

    const local = localParams.get(paramName);
    const backendValue = Number(info[infoKey]);
    const backendCaughtUp = Boolean(local && valuesMatch(input, local.value, backendValue));
    if (backendCaughtUp) localParams.delete(paramName);

    const protectedLocally = activeParams.has(paramName)
      || document.activeElement === input
      || (!backendCaughtUp && local && performance.now() < local.protectUntil);
    if (protectedLocally) continue;

    input.value = backendValue;
    renderOutput(input);
  }

  const paused = document.querySelector('[data-toggle="paused"]');
  const autoImpulse = document.querySelector('[data-toggle="auto_impulse"]');
  const backface = document.querySelector('[data-toggle="backface_culling"]');
  if (document.activeElement !== paused) paused.checked = Boolean(info.paused);
  if (document.activeElement !== autoImpulse) autoImpulse.checked = Boolean(info.autoImpulse);
  if (document.activeElement !== backface) backface.checked = Boolean(info.backfaceCulling);
  if (document.activeElement !== viewSelect) viewSelect.value = info.viewMode;
}

function renderInfo(info) {
  setText('[data-backend]', info.backend || 'wgpu');
  setText('[data-info="fps"]', Number(info.fps || 0).toFixed(1));
  setText('[data-info="frameTimeMs"]', `${Number(info.frameTimeMs || 0).toFixed(2)} ms`);
  setText('[data-info="resolution"]', `${info.width} × ${info.height}`);
  setText('[data-info="vertexCount"]', Number(info.vertexCount || 0).toLocaleString());
  setText('[data-info="triangleCount"]', Number(info.triangleCount || 0).toLocaleString());
  setText('[data-info="topology"]', `${info.latitudeSegments} × ${info.longitudeSegments}`);
  setText('[data-info="dispatchGroups"]', Number(info.dispatchGroups || 0).toLocaleString());
  setText('[data-info="storageBytes"]', formatBytes(info.storageBytes));
  setText('[data-info="simulationStep"]', Number(info.simulationStep || 0).toLocaleString());
  setText('[data-info="activeBuffer"]', info.activeBuffer || 'A');
  setText('[data-info="impulseCount"]', Number(info.impulseCount || 0).toLocaleString());
  setText('[data-info="adapter"]', info.adapter || 'Unknown adapter');
  setText('[data-info="driver"]', `${info.deviceType || ''}${info.driver ? ` · ${info.driver}` : ''}`);

  document.querySelectorAll('[data-buffer]').forEach((node) => {
    node.classList.toggle('active', node.dataset.buffer === info.activeBuffer);
  });

  if (info.lastError) {
    if (info.lastError !== lastError) showError(info.lastError);
  } else if (lastError && initialized) {
    clearError();
  }

  if (!info.lastError) {
    if (info.paused) setStatus('paused', `${info.backend} · simulation paused`);
    else setStatus('ready', `${info.backend} · ${Number(info.fps || 0).toFixed(0)} fps`);
  }
  syncControls(info);
}

async function pollInfo() {
  if (polling) return;
  polling = true;
  try {
    const info = await command('renderer_info');
    initialized = true;
    renderInfo(info);
  } catch (error) {
    const text = String(error);
    if (!text.includes('has not finished initializing')) showError(text);
  } finally {
    polling = false;
  }
}

async function boot() {
  if (!invoke) {
    showError('Tauri IPC is unavailable. Launch with `npm install` and `npm run dev`.');
    return;
  }
  for (let attempt = 0; attempt < 80 && !initialized; attempt += 1) {
    await pollInfo();
    if (!initialized) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!initialized) showError('The native renderer did not initialize. Check the terminal for a wgpu validation error.');
  window.setInterval(pollInfo, 180);
}

boot();
