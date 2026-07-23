const invoke = window.__TAURI__?.core?.invoke;

const statusPill = document.querySelector('[data-status-pill]');
const statusText = statusPill.querySelector('span');
const errorBox = document.querySelector('[data-error]');
const paramInputs = [...document.querySelectorAll('[data-param]')];
const toggleInputs = [...document.querySelectorAll('[data-toggle]')];
const presetButtons = [...document.querySelectorAll('[data-preset]')];
const resolutionButtons = [...document.querySelectorAll('[data-resolution]')];
const exportWidth = document.querySelector('[data-export="width"]');
const exportHeight = document.querySelector('[data-export="height"]');
const exportTileSize = document.querySelector('[data-export="tileSize"]');
const exportSamples = document.querySelector('[data-export="samples"]');
const exportButton = document.querySelector('[data-command="export"]');
let initialized = false;
let polling = false;
let lastError = '';
let exportConfigEditing = false;

// Coalesce dense slider input, serialize IPC, and protect locally edited values
// from slower telemetry updates. This is inherited from the Example 24 fix.
const queuedParams = new Map();
const localParams = new Map();
const activeParams = new Set();
let paramFlushScheduled = false;
let paramFlushActive = false;

const infoToControl = {
  animationSpeed: 'animation_speed',
  zoom: 'zoom',
  rotationDegrees: 'rotation',
  warp: 'warp',
  fold: 'fold',
  density: 'density',
  detail: 'detail',
  glow: 'glow',
  hue: 'hue',
  saturation: 'saturation',
  exposure: 'exposure',
  contrast: 'contrast',
  vignette: 'vignette',
  grain: 'grain',
  background: 'background'
};

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
    await Promise.all(batch.map(([name, value]) => command('set_param', { name, value })));
  } catch (error) {
    showError(error);
  } finally {
    paramFlushActive = false;
    if (queuedParams.size > 0) scheduleParamFlush();
  }
}

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
  statusPill.classList.remove('ready', 'error', 'paused', 'exporting');
  if (kind) statusPill.classList.add(kind);
  statusText.textContent = text;
}

async function command(name, payload = {}) {
  if (!invoke) throw new Error('Tauri IPC is unavailable. Run this page through `npm run dev`, not a browser tab.');
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
  input.addEventListener('pointerdown', () => activeParams.add(name));
  input.addEventListener('input', () => {
    const value = Number(input.value);
    activeParams.add(name);
    renderOutput(input);
    queueParam(name, value);
  });
  const finish = () => {
    activeParams.delete(name);
    const local = localParams.get(name);
    if (local) local.protectUntil = performance.now() + 350;
    scheduleParamFlush();
  };
  input.addEventListener('pointerup', finish);
  input.addEventListener('pointercancel', finish);
  input.addEventListener('change', finish);
  input.addEventListener('blur', finish);
});

toggleInputs.forEach((input) => {
  input.addEventListener('change', () => {
    command('set_toggle', { name: input.dataset.toggle, enabled: input.checked }).catch(showError);
  });
});

presetButtons.forEach((button) => {
  button.addEventListener('click', async () => {
    try {
      await command('apply_preset', { preset: button.dataset.preset });
      presetButtons.forEach((item) => item.classList.toggle('active', item === button));
      setTimeout(pollInfo, 35);
    } catch (error) {
      showError(error);
    }
  });
});

function currentExportConfig() {
  return {
    width: Math.round(Number(exportWidth.value)),
    height: Math.round(Number(exportHeight.value)),
    tileSize: Math.round(Number(exportTileSize.value)),
    samples: Math.round(Number(exportSamples.value))
  };
}

async function pushExportConfig() {
  const config = currentExportConfig();
  await command('set_export_config', config);
  renderLocalExportSummary(config);
}

function renderLocalExportSummary(config) {
  const columns = Math.ceil(config.width / config.tileSize);
  const rows = Math.ceil(config.height / config.tileSize);
  setText('[data-export-summary="tiles"]', `${columns} × ${rows} · ${columns * rows}`);
  setText('[data-export-summary="bytes"]', formatBytes(config.width * config.height * 4));
}

[exportWidth, exportHeight, exportTileSize, exportSamples].forEach((input) => {
  input.addEventListener('focus', () => { exportConfigEditing = true; });
  input.addEventListener('change', async () => {
    exportConfigEditing = false;
    resolutionButtons.forEach((button) => button.classList.remove('active'));
    try {
      await pushExportConfig();
    } catch (error) {
      showError(error);
    }
  });
  input.addEventListener('blur', () => { exportConfigEditing = false; });
});

resolutionButtons.forEach((button) => {
  button.addEventListener('click', async () => {
    const [width, height] = button.dataset.resolution.split('x').map(Number);
    exportWidth.value = width;
    exportHeight.value = height;
    resolutionButtons.forEach((item) => item.classList.toggle('active', item === button));
    try {
      await pushExportConfig();
    } catch (error) {
      showError(error);
    }
  });
});

exportButton.addEventListener('click', async () => {
  try {
    clearError();
    await pushExportConfig();
    await command('export_frame');
    setStatus('exporting', 'Export queued');
    pollInfo();
  } catch (error) {
    showError(error);
  }
});

document.querySelector('[data-command="renderer-fullscreen"]').addEventListener('click', () => command('toggle_renderer_fullscreen').catch(showError));
document.querySelector('[data-command="open-folder"]').addEventListener('click', () => command('open_export_folder').catch(showError));
document.querySelector('[data-command="reset"]').addEventListener('click', async () => {
  try {
    await command('reset_lab');
    presetButtons.forEach((item) => item.classList.toggle('active', item.dataset.preset === 'nebula'));
    resolutionButtons.forEach((item) => item.classList.toggle('active', item.dataset.resolution === '3840x2160'));
    setTimeout(pollInfo, 35);
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
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GiB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(2)} MiB`;
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
  if (document.activeElement !== paused) paused.checked = Boolean(info.paused);

  if (!exportConfigEditing && !info.exporting) {
    exportWidth.value = info.exportWidth;
    exportHeight.value = info.exportHeight;
    exportTileSize.value = String(info.tileSize);
    exportSamples.value = String(info.exportSamples);
  }
}

function renderInfo(info) {
  setText('[data-backend]', info.backend || 'wgpu');
  setText('[data-info="fps"]', Number(info.fps || 0).toFixed(1));
  setText('[data-info="frameTimeMs"]', `${Number(info.frameTimeMs || 0).toFixed(2)} ms`);
  setText('[data-info="resolution"]', `${info.width} × ${info.height}`);
  setText('[data-info="surfaceFormat"]', info.surfaceFormat || '—');
  setText('[data-info="exportFormat"]', info.exportFormat || '—');
  setText('[data-info="textureLimit"]', `${Number(info.maxTextureDimension2d || 0).toLocaleString()} px`);
  setText('[data-info="exportResolution"]', `${info.exportWidth} × ${info.exportHeight}`);
  setText('[data-info="tileProgress"]', `${info.tilesCompleted} / ${info.totalTiles}`);
  setText('[data-info="lastExportMs"]', info.lastExportMs > 0 ? `${(info.lastExportMs / 1000).toFixed(2)} s` : '—');
  setText('[data-info="lastExportBytes"]', info.lastExportBytes > 0 ? formatBytes(info.lastExportBytes) : '—');
  setText('[data-info="adapter"]', info.adapter || 'Unknown adapter');
  setText('[data-info="driver"]', `${info.deviceType || ''}${info.driver ? ` · ${info.driver}` : ''}`);
  setText('[data-info="exportDirectory"]', info.exportDirectory || '—');
  setText('[data-info="sceneTime"]', Number(info.sceneTime || 0).toFixed(3));
  setText('[data-export-summary="tiles"]', `${info.tileColumns} × ${info.tileRows} · ${info.totalTiles}`);
  setText('[data-export-summary="bytes"]', formatBytes(info.estimatedRgbaBytes));

  const progress = Math.max(0, Math.min(1, Number(info.exportProgress || 0)));
  document.querySelector('[data-progress]').value = progress;
  setText('[data-progress-label]', `${Math.round(progress * 100)}%`);
  setText('[data-progress-stage]', info.exportStage || 'Ready');
  exportButton.disabled = Boolean(info.exporting);
  exportButton.textContent = info.exporting ? 'Exporting…' : 'Export PNG';

  const path = document.querySelector('[data-export-path]');
  if (info.lastExportPath) {
    path.textContent = info.lastExportPath;
    path.title = info.lastExportPath;
  }

  if (info.lastError) {
    if (info.lastError !== lastError) showError(info.lastError);
  } else if (lastError && initialized) {
    clearError();
  }

  if (!info.lastError) {
    if (info.exporting) setStatus('exporting', `${info.exportStage} · ${Math.round(progress * 100)}%`);
    else if (info.paused) setStatus('paused', `${info.backend} · frame frozen`);
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
  renderLocalExportSummary(currentExportConfig());
  if (!invoke) {
    showError('Tauri IPC is unavailable. Launch with `npm install` and `npm run dev`.');
    return;
  }
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await pollInfo();
    if (initialized) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  setInterval(pollInfo, 160);
}

boot();
