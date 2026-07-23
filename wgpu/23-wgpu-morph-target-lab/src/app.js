const invoke = window.__TAURI__?.core?.invoke;

const statusPill = document.querySelector('[data-status-pill]');
const statusText = statusPill.querySelector('span');
const errorBox = document.querySelector('[data-error]');
const paramInputs = [...document.querySelectorAll('[data-param]')];
const toggleInputs = [...document.querySelectorAll('[data-toggle]')];
const blendSelect = document.querySelector('[data-select="blend_mode"]');
const viewSelect = document.querySelector('[data-select="view_mode"]');
const presetButtons = [...document.querySelectorAll('[data-preset]')];
let initialized = false;
let polling = false;
let lastError = '';

const infoToControl = {
  cameraYawDegrees: 'camera_yaw',
  cameraPitchDegrees: 'camera_pitch',
  cameraDistance: 'camera_distance',
  cameraFovDegrees: 'camera_fov',
  autoOrbitDegrees: 'auto_orbit',
  cubeWeight: 'cube_weight',
  torusWeight: 'torus_weight',
  bloomWeight: 'bloom_weight',
  autoAmount: 'auto_amount',
  autoSpeed: 'auto_speed',
  displacementScale: 'displacement_scale',
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
  statusPill.classList.remove('ready', 'error');
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
  renderOutput(input);
  input.addEventListener('input', () => {
    renderOutput(input);
    command('set_param', { name: input.dataset.param, value: Number(input.value) }).catch(showError);
  });
});

toggleInputs.forEach((input) => {
  input.addEventListener('change', () => {
    command('set_toggle', { name: input.dataset.toggle, enabled: input.checked }).catch(showError);
  });
});

blendSelect.addEventListener('change', () => command('set_blend_mode', { mode: blendSelect.value }).catch(showError));
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

document.querySelector('[data-command="renderer-fullscreen"]').addEventListener('click', async () => {
  try {
    await command('toggle_renderer_fullscreen');
  } catch (error) {
    showError(error);
  }
});

document.querySelector('[data-command="reset"]').addEventListener('click', async () => {
  try {
    await command('reset_lab');
    presetButtons.forEach((item) => item.classList.toggle('active', item.dataset.preset === 'cycle'));
    setTimeout(pollInfo, 40);
  } catch (error) {
    showError(error);
  }
});

function setText(selector, value) {
  const node = document.querySelector(selector);
  if (node) node.textContent = value;
}

function syncControls(info) {
  for (const [infoKey, paramName] of Object.entries(infoToControl)) {
    const input = document.querySelector(`[data-param="${paramName}"]`);
    if (!input || document.activeElement === input || info[infoKey] == null) continue;
    input.value = info[infoKey];
    renderOutput(input);
  }
  const autoMorph = document.querySelector('[data-toggle="auto_morph"]');
  const backface = document.querySelector('[data-toggle="backface_culling"]');
  if (document.activeElement !== autoMorph) autoMorph.checked = Boolean(info.autoMorph);
  if (document.activeElement !== backface) backface.checked = Boolean(info.backfaceCulling);
  if (document.activeElement !== blendSelect) blendSelect.value = info.blendMode;
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
  setText('[data-info="adapter"]', info.adapter || 'Unknown adapter');
  setText('[data-info="driver"]', `${info.deviceType || ''}${info.driver ? ` · ${info.driver}` : ''}`);

  for (const key of ['effectiveCubeWeight', 'effectiveTorusWeight', 'effectiveBloomWeight']) {
    const value = Math.max(0, Math.min(1, Number(info[key] || 0)));
    setText(`[data-effective="${key}"]`, value.toFixed(3));
    const bar = document.querySelector(`[data-effective-bar="${key}"]`);
    if (bar) bar.style.width = `${value * 100}%`;
  }

  if (info.lastError) {
    if (info.lastError !== lastError) showError(info.lastError);
  } else if (lastError && initialized) {
    clearError();
  }
  if (!info.lastError) setStatus('ready', `${info.backend} · ${Number(info.fps || 0).toFixed(0)} fps`);
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
