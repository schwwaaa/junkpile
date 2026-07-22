const el = (id) => document.getElementById(id);
const eventRate = el('eventRate');
const historyPoints = el('historyPoints');
const fps = el('fps');
const backend = el('backend');
const adapter = el('adapter');
const driver = el('driver');
const surface = el('surface');
const renderSize = el('renderSize');
const frameTime = el('frameTime');
const receivedEvents = el('receivedEvents');
const recordedPoints = el('recordedPoints');
const lastError = el('lastError');
const recordStatus = el('recordStatus');
const rendererStatus = el('rendererStatus');
const bridgeStatus = el('bridgeStatus');
const localPointerEvents = el('localPointerEvents');
const pad = el('pad');
const ctx = pad.getContext('2d');

const tauriInvoke = window.__TAURI__?.core?.invoke;
const bridgeReady = typeof tauriInvoke === 'function';
bridgeStatus.textContent = bridgeReady ? 'ready' : 'unavailable';
if (!bridgeReady) {
  lastError.textContent = 'Tauri bridge unavailable: app.withGlobalTauri must be enabled';
  rendererStatus.textContent = 'bridge unavailable';
}

let tool = 0;
let pointerDown = false;
let activePointerId = null;
let last = null;
let pending = null;
let rafQueued = false;
let visualPoints = [];
let localEventCount = 0;

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function normalized(event) {
  const rect = pad.getBoundingClientRect();
  return {
    x: clamp01((event.clientX - rect.left) / Math.max(rect.width, 1)),
    y: clamp01((event.clientY - rect.top) / Math.max(rect.height, 1)),
  };
}

async function invoke(command, args = {}) {
  if (!bridgeReady) {
    throw new Error('Tauri JavaScript bridge is unavailable');
  }
  return tauriInvoke(command, args);
}

function markLocalEvent() {
  localEventCount += 1;
  localPointerEvents.textContent = String(localEventCount);
}

function queuePoint(event, isActive) {
  markLocalEvent();
  const p = normalized(event);
  const now = performance.now();
  const dt = last ? Math.max(1, now - last.time) : 16;
  const vx = last ? (p.x - last.x) * 1000 / dt : 0;
  const vy = last ? (p.y - last.y) * 1000 / dt : 0;
  const pressure = event.pointerType === 'mouse'
    ? (isActive ? 0.65 : 0.2)
    : Math.max(0.05, event.pressure || 0.5);

  pending = {
    x: p.x,
    y: p.y,
    velocityX: vx,
    velocityY: vy,
    pressure,
    age: 0,
    tool,
    active: isActive ? 1 : 0,
  };
  last = { ...p, time: now };
  visualPoints.unshift({ ...p, pressure, tool });
  visualPoints = visualPoints.slice(0, 64);

  el('pointerReadout').textContent = `x ${p.x.toFixed(2)} · y ${p.y.toFixed(2)} · velocity ${Math.hypot(vx, vy).toFixed(1)}`;
  el('pressureReadout').textContent = `pressure ${pressure.toFixed(2)}`;

  if (!rafQueued) {
    rafQueued = true;
    requestAnimationFrame(async () => {
      rafQueued = false;
      if (!pending) return;
      const point = pending;
      pending = null;
      try {
        await invoke('push_gesture_point', { point });
      } catch (error) {
        lastError.textContent = `Gesture IPC failed: ${String(error)}`;
      }
    });
  }
}

pad.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  pointerDown = true;
  activePointerId = event.pointerId;
  pad.focus({ preventScroll: true });
  try { pad.setPointerCapture(event.pointerId); } catch (_) {}
  queuePoint(event, true);
});

pad.addEventListener('pointermove', (event) => {
  if (!pointerDown || event.pointerId !== activePointerId) return;
  event.preventDefault();
  queuePoint(event, true);
});

function finishPointer(event) {
  if (activePointerId !== null && event.pointerId !== activePointerId) return;
  event.preventDefault();
  if (pointerDown) queuePoint(event, false);
  pointerDown = false;
  activePointerId = null;
  last = null;
  try { pad.releasePointerCapture(event.pointerId); } catch (_) {}
}

pad.addEventListener('pointerup', finishPointer);
pad.addEventListener('pointercancel', finishPointer);
pad.addEventListener('lostpointercapture', () => {
  pointerDown = false;
  activePointerId = null;
  last = null;
});

pad.addEventListener('wheel', (event) => {
  event.preventDefault();
  markLocalEvent();
  const slider = el('depth');
  slider.value = Math.max(0, Math.min(2, Number(slider.value) - event.deltaY * 0.001));
  slider.dispatchEvent(new Event('input'));
}, { passive: false });

function drawPad() {
  const w = pad.width;
  const h = pad.height;
  ctx.fillStyle = '#04070c';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(70,120,170,.18)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= w; x += w / 12) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let y = 0; y <= h; y += h / 8) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
  visualPoints.forEach((point, index) => {
    const alpha = 1 - index / Math.max(visualPoints.length, 1);
    const radius = (8 + point.pressure * 26) * (1 - index / 80);
    ctx.beginPath();
    ctx.arc(point.x * w, point.y * h, radius, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${190 + point.tool * 55},90%,65%,${alpha * .5})`;
    ctx.fill();
  });
  visualPoints = visualPoints.slice(0, 63);
  requestAnimationFrame(drawPad);
}
drawPad();

async function safeInvoke(command, args = {}) {
  try {
    return await invoke(command, args);
  } catch (error) {
    lastError.textContent = `${command}: ${String(error)}`;
    throw error;
  }
}

function wireRange(id, name, digits = 2) {
  const input = el(id);
  const out = el(`${id}Out`);
  const send = () => {
    out.textContent = Number(input.value).toFixed(digits);
    if (bridgeReady) {
      safeInvoke('set_gesture_parameter', { name, value: Number(input.value) }).catch(() => {});
    }
  };
  input.addEventListener('input', send);
  send();
}

wireRange('brushRadius', 'brushRadius', 3);
wireRange('force', 'force');
wireRange('decay', 'decay', 3);
wireRange('depth', 'depth');
wireRange('exposure', 'exposure');

el('mode').addEventListener('change', (event) => safeInvoke('set_gesture_parameter', { name: 'mode', value: Number(event.target.value) }).catch(() => {}));
el('tool').addEventListener('change', (event) => { tool = Number(event.target.value); });
el('clear').addEventListener('click', () => { visualPoints = []; safeInvoke('clear_gesture').catch(() => {}); });
el('fullscreen').addEventListener('click', () => safeInvoke('toggle_renderer_fullscreen').catch(() => {}));
el('record').addEventListener('click', () => safeInvoke('start_gesture_recording').catch(() => {}));
el('stopRecord').addEventListener('click', () => safeInvoke('stop_gesture_recording').catch(() => {}));
el('play').addEventListener('click', () => safeInvoke('play_gesture_recording').catch(() => {}));
el('stopPlay').addEventListener('click', () => safeInvoke('stop_gesture_playback').catch(() => {}));

async function refresh() {
  if (!bridgeReady) return;
  try {
    const info = await invoke('get_app_info');
    const gesture = info.gesture;
    const renderer = info.renderer;
    eventRate.textContent = `${gesture.eventRate.toFixed(1)} Hz`;
    historyPoints.textContent = `${gesture.historyPoints} / 64`;
    fps.textContent = `${renderer.fps.toFixed(1)} FPS`;
    backend.textContent = renderer.backend;
    rendererStatus.textContent = renderer.running ? 'running' : 'stopped';
    adapter.textContent = renderer.adapter;
    driver.textContent = renderer.driver;
    surface.textContent = renderer.surfaceFormat;
    renderSize.textContent = `${renderer.width} × ${renderer.height}`;
    frameTime.textContent = `${renderer.frameTimeMs.toFixed(2)} ms`;
    receivedEvents.textContent = gesture.receivedEvents;
    recordedPoints.textContent = gesture.recordedPoints;
    lastError.textContent = renderer.lastError || gesture.lastError || 'none';
    recordStatus.textContent = `${gesture.recording ? 'Recording' : gesture.playing ? 'Playing loop' : 'Idle'} · ${gesture.recordedPoints} recorded points`;
  } catch (error) {
    rendererStatus.textContent = 'not initialized';
    lastError.textContent = `Renderer unavailable: ${String(error)}`;
  }
}

setInterval(refresh, 250);
refresh();
console.info('Junkpile Gesture Field build 19.2 loaded', { bridgeReady });
