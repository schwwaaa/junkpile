const byId = (id) => document.getElementById(id);
const tauriInvoke = window.__TAURI__?.core?.invoke;
const bridgeReady = typeof tauriInvoke === 'function';
byId('diag-bridge').textContent = bridgeReady ? 'ready' : 'unavailable';

async function invoke(command, args = {}) {
  if (!bridgeReady) throw new Error('Tauri bridge unavailable: app.withGlobalTauri must be enabled');
  return tauriInvoke(command, args);
}

function showError(error) {
  byId('diag-error').textContent = String(error);
}

async function safe(command, args = {}) {
  try { return await invoke(command, args); }
  catch (error) { showError(`${command}: ${error}`); throw error; }
}

function setOptions(select, values, getValue = (value) => value, getLabel = (value) => value) {
  const previous = select.value;
  const signature = JSON.stringify(values.map(getValue));
  if (select.dataset.signature === signature) return;
  select.dataset.signature = signature;
  select.replaceChildren();
  values.forEach((item) => {
    const option = document.createElement('option');
    option.value = String(getValue(item));
    option.textContent = getLabel(item);
    select.append(option);
  });
  if ([...select.options].some((option) => option.value === previous)) select.value = previous;
}

for (const input of document.querySelectorAll('[data-param]')) {
  const output = byId(`${input.id}-value`);
  const update = () => {
    const number = Number(input.value);
    output.textContent = input.step === '0.001' ? number.toFixed(3) : number.toFixed(2);
    safe('set_compositor_param', { name: input.dataset.param, value: number }).catch(() => {});
  };
  input.addEventListener('input', update);
}

byId('compositor-mode').addEventListener('change', (event) => safe('set_compositor_mode', { mode: event.target.value }).catch(() => {}));
byId('reset-compositor').addEventListener('click', () => {
  const defaults = { sourceMix: 0.5, feedback: 0.72, displacement: 0.035, chroma: 0.006, exposure: 1.2, contrast: 1.05, audioGain: 1, gestureGain: 1 };
  Object.entries(defaults).forEach(([id, value]) => {
    const input = byId(id);
    input.value = String(value);
    input.dispatchEvent(new Event('input'));
  });
  byId('compositor-mode').value = 'blend';
  safe('set_compositor_mode', { mode: 'blend' }).catch(() => {});
  safe('reset_compositor').catch(() => {});
});
byId('renderer-fullscreen').addEventListener('click', () => safe('toggle_renderer_fullscreen').catch(() => {}));

byId('camera-refresh').addEventListener('click', () => safe('refresh_cameras').catch(() => {}));
byId('camera-start').addEventListener('click', () => safe('start_camera', {
  slot: Number(byId('camera-select').value || 0),
  profile: byId('camera-profile').value,
}).catch(() => {}));
byId('camera-stop').addEventListener('click', () => safe('stop_camera').catch(() => {}));

let timelineDragging = false;
const timeline = byId('video-timeline');

function formatTime(seconds) {
  const value = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(value / 60);
  const remaining = value - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${remaining.toFixed(3).padStart(6, '0')}`;
}

function updateTimelinePreview() {
  byId('video-time').textContent = `${formatTime(Number(timeline.value))} / ${formatTime(Number(timeline.max))}`;
}

timeline.addEventListener('pointerdown', () => { timelineDragging = true; });
timeline.addEventListener('input', updateTimelinePreview);
timeline.addEventListener('change', () => {
  timelineDragging = false;
  safe('seek_video', { seconds: Number(timeline.value) }).catch(() => {});
});
timeline.addEventListener('pointerup', () => { timelineDragging = false; });
timeline.addEventListener('pointercancel', () => { timelineDragging = false; });

byId('video-open').addEventListener('click', () => safe('open_video_file').catch(() => {}));
byId('video-step-back').addEventListener('click', () => safe('step_video', { direction: -1 }).catch(() => {}));
byId('video-play').addEventListener('click', () => safe('play_video').catch(() => {}));
byId('video-pause').addEventListener('click', () => safe('pause_video').catch(() => {}));
byId('video-step-forward').addEventListener('click', () => safe('step_video', { direction: 1 }).catch(() => {}));
byId('video-stop').addEventListener('click', () => safe('stop_video').catch(() => {}));
byId('video-loop').addEventListener('change', (event) => safe('set_video_loop', { looping: event.target.checked }).catch(() => {}));
byId('video-rate').addEventListener('change', (event) => safe('set_video_rate', { rate: Number(event.target.value) }).catch(() => {}));
byId('video-decode-mode').addEventListener('change', (event) => safe('set_video_decode_mode', { mode: event.target.value }).catch(() => {}));

function updateAudioSourceUi(source) {
  const needsMicrophone = source === 'microphone' || source === 'mix';
  byId('microphone-controls').classList.toggle('is-disabled', !needsMicrophone);
  for (const control of byId('microphone-controls').querySelectorAll('select, button')) {
    control.disabled = !needsMicrophone;
  }
}

byId('audio-source').addEventListener('change', (event) => {
  const source = event.target.value;
  updateAudioSourceUi(source);
  safe('set_audio_fft_source', { source }).catch(() => {});
  if (source === 'video' || source === 'mix') {
    byId('video-audio-preview').checked = true;
    safe('set_video_audio_preview', { enabled: true }).catch(() => {});
  }
});
byId('video-audio-preview').addEventListener('change', (event) => safe('set_video_audio_preview', { enabled: event.target.checked }).catch(() => {}));
byId('audio-refresh').addEventListener('click', () => safe('refresh_audio_devices').catch(() => {}));
byId('audio-select').addEventListener('change', (event) => safe('select_audio_device', { name: event.target.value }).catch(() => {}));
byId('audio-start').addEventListener('click', () => safe('start_audio').catch(() => {}));
byId('audio-stop').addEventListener('click', () => safe('stop_audio').catch(() => {}));
updateAudioSourceUi(byId('audio-source').value);

byId('midi-refresh').addEventListener('click', () => safe('refresh_midi_ports').catch(() => {}));
byId('midi-connect').addEventListener('click', () => safe('connect_midi', { name: byId('midi-select').value }).catch(() => {}));
byId('midi-disconnect').addEventListener('click', () => safe('disconnect_midi').catch(() => {}));

byId('osc-bind').addEventListener('click', () => safe('bind_osc', {
  host: byId('osc-host').value,
  port: Number(byId('osc-port').value),
}).catch(() => {}));
byId('osc-stop').addEventListener('click', () => safe('stop_osc').catch(() => {}));
byId('osc-test').addEventListener('click', () => safe('send_osc_test', {
  host: '127.0.0.1',
  port: Number(byId('osc-port').value),
  address: '/hue',
  value: Math.random(),
}).catch(() => {}));

const pad = byId('gesture-pad');
const context = pad.getContext('2d');
let pointerDown = false;
let pointerId = null;
let previousPoint = null;
let pendingPoint = null;
let animationQueued = false;
let localGestureEvents = 0;
let visualPoints = [];

function resizePad() {
  const rect = pad.getBoundingClientRect();
  const scale = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(rect.width * scale));
  const height = Math.max(1, Math.round(rect.height * scale));
  if (pad.width !== width || pad.height !== height) {
    pad.width = width;
    pad.height = height;
  }
}

function normalized(event) {
  const rect = pad.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(rect.width, 1))),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(rect.height, 1))),
  };
}

function queueGesture(event, active) {
  const position = normalized(event);
  const now = performance.now();
  const elapsed = previousPoint ? Math.max(1, now - previousPoint.time) : 16;
  const velocityX = previousPoint ? (position.x - previousPoint.x) * 1000 / elapsed : 0;
  const velocityY = previousPoint ? (position.y - previousPoint.y) * 1000 / elapsed : 0;
  const pressure = event.pointerType === 'mouse' ? (active ? 0.72 : 0.2) : Math.max(0.05, event.pressure || 0.5);
  const tool = Number(byId('gesture-tool').value);
  pendingPoint = { x: position.x, y: position.y, velocityX, velocityY, pressure, age: 0, tool, active: active ? 1 : 0 };
  previousPoint = { ...position, time: now };
  visualPoints.unshift({ ...position, pressure, tool, born: now });
  visualPoints = visualPoints.slice(0, 64);
  localGestureEvents += 1;
  byId('gesture-count').textContent = `${localGestureEvents} local events`;

  if (!animationQueued) {
    animationQueued = true;
    requestAnimationFrame(async () => {
      animationQueued = false;
      if (!pendingPoint) return;
      const point = pendingPoint;
      pendingPoint = null;
      try { await invoke('push_gesture_point', { point }); }
      catch (error) { showError(`gesture IPC: ${error}`); }
    });
  }
}

pad.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  pointerDown = true;
  pointerId = event.pointerId;
  try { pad.setPointerCapture(pointerId); } catch (_) {}
  queueGesture(event, true);
});
pad.addEventListener('pointermove', (event) => {
  if (!pointerDown || event.pointerId !== pointerId) return;
  event.preventDefault();
  queueGesture(event, true);
});
function endPointer(event) {
  if (pointerId !== null && event.pointerId !== pointerId) return;
  event.preventDefault();
  if (pointerDown) queueGesture(event, false);
  pointerDown = false;
  pointerId = null;
  previousPoint = null;
  try { pad.releasePointerCapture(event.pointerId); } catch (_) {}
}
pad.addEventListener('pointerup', endPointer);
pad.addEventListener('pointercancel', endPointer);
byId('gesture-clear').addEventListener('click', () => {
  visualPoints = [];
  safe('clear_gesture').catch(() => {});
});

function drawPad() {
  resizePad();
  const width = pad.width;
  const height = pad.height;
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#07111f';
  context.fillRect(0, 0, width, height);
  context.strokeStyle = 'rgba(88,210,255,.13)';
  context.lineWidth = Math.max(1, window.devicePixelRatio || 1);
  for (let index = 1; index < 12; index += 1) {
    const x = width * index / 12;
    context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke();
  }
  for (let index = 1; index < 8; index += 1) {
    const y = height * index / 8;
    context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke();
  }
  const now = performance.now();
  visualPoints = visualPoints.filter((point) => now - point.born < 1800);
  visualPoints.forEach((point, index) => {
    const life = Math.max(0, 1 - (now - point.born) / 1800);
    const radius = (10 + point.pressure * 34) * (window.devicePixelRatio || 1);
    context.beginPath();
    context.arc(point.x * width, point.y * height, radius, 0, Math.PI * 2);
    context.fillStyle = `hsla(${190 + point.tool * 48}, 92%, 66%, ${life * (0.2 + 0.45 / (1 + index * 0.05))})`;
    context.fill();
  });
  requestAnimationFrame(drawPad);
}
drawPad();

function displayInfo(info) {
  const renderer = info.renderer;
  const camera = info.camera;
  const video = info.video;
  const audio = info.audio;
  const routedAudio = audio.router;
  const microphoneAudio = audio.microphone;
  const videoAudio = audio.video;
  const midi = info.midi;
  const osc = info.osc;
  const gesture = info.gesture;

  setOptions(byId('camera-select'), info.cameraDevices || [], (item) => item.slot, (item) => item.name);
  setOptions(byId('audio-select'), microphoneAudio.devices || []);
  setOptions(byId('midi-select'), midi.ports || []);

  byId('metric-renderer').textContent = `${renderer.fps.toFixed(1)} FPS`;
  byId('metric-camera').textContent = camera.streaming ? `${camera.width}×${camera.height} · ${camera.captureFps.toFixed(1)}` : camera.permission;
  byId('metric-video').textContent = video.loaded ? `${video.width}×${video.height} · ${video.decodeFps.toFixed(1)}` : 'not loaded';
  byId('metric-audio').textContent = `${routedAudio.source} · ${routedAudio.analysisFps.toFixed(1)} FFT/s`;
  byId('metric-midi').textContent = midi.connected ? midi.connectedPort : 'disconnected';
  byId('metric-osc').textContent = osc.listening ? `:${osc.port} · ${osc.messagesPerSecond.toFixed(1)}/s` : 'stopped';

  byId('camera-readout').textContent = camera.streaming
    ? `${camera.selectedName} · ${camera.sourceFormat} · ${camera.width}×${camera.height} · ${camera.captureFps.toFixed(2)} FPS`
    : (camera.lastError || `Permission ${camera.permission}`);
  byId('video-readout').textContent = video.loaded
    ? `${video.fileName} · ${video.codec} · ${video.width}×${video.height} @ ${video.sourceFps.toFixed(2)} FPS`
    : (video.lastError || 'FFmpeg source not loaded.');
  byId('video-audio-readout').textContent = videoAudio.loaded
    ? (videoAudio.hasAudio
      ? `Audio ${videoAudio.codec} · ${videoAudio.sourceSampleRate} Hz · ${videoAudio.sourceChannels} ch · output ${videoAudio.outputDevice}`
      : (videoAudio.lastError || 'This video has no readable audio stream.'))
    : 'Video audio track not inspected.';

  if (video.loaded) {
    timeline.max = String(Math.max(video.durationSeconds, 0.001));
    if (!timelineDragging) timeline.value = String(Math.min(video.positionSeconds, video.durationSeconds));
    byId('video-time').textContent = `${formatTime(timelineDragging ? Number(timeline.value) : video.positionSeconds)} / ${formatTime(video.durationSeconds)}`;
    byId('video-state').textContent = video.playing ? `${video.playbackRate.toFixed(2)}× playing` : (video.ended ? 'ended' : 'paused');
    byId('video-rate').value = String(video.playbackRate);
    byId('video-decode-mode').value = video.decodeMode;
    byId('video-loop').checked = video.looping;
  } else {
    timeline.max = '1';
    if (!timelineDragging) timeline.value = '0';
    byId('video-time').textContent = '00:00.000 / 00:00.000';
    byId('video-state').textContent = 'not loaded';
  }

  if (byId('audio-source').value !== routedAudio.source) {
    byId('audio-source').value = routedAudio.source;
    updateAudioSourceUi(routedAudio.source);
  }
  byId('video-audio-preview').checked = videoAudio.previewEnabled;
  byId('video-audio-preview').disabled = !videoAudio.hasAudio;
  byId('audio-readout').textContent = `${routedAudio.source} · RMS ${routedAudio.rms.toFixed(3)} · Bass ${routedAudio.bass.toFixed(3)} · transient ${routedAudio.transient.toFixed(3)} · mic ${microphoneAudio.rms.toFixed(3)} · video ${videoAudio.rms.toFixed(3)}`;
  byId('midi-readout').textContent = midi.connected
    ? `${midi.messagesPerSecond.toFixed(1)} msg/s · ${midi.activeNotes} active notes`
    : (midi.lastError || 'Starter mappings load on connect.');
  byId('osc-readout').textContent = osc.listening
    ? `${osc.localAddress} · ${osc.totalMessages} messages · last ${osc.lastSender || 'none'}`
    : (osc.lastError || 'OSC stopped.');

  byId('diag-backend').textContent = renderer.backend;
  byId('diag-adapter').textContent = renderer.adapter;
  byId('diag-render').textContent = `${renderer.width}×${renderer.height} · ${renderer.frameTimeMs.toFixed(2)} ms · ${renderer.mode}`;
  byId('diag-camera').textContent = `${renderer.cameraUploads} · ${renderer.cameraWidth}×${renderer.cameraHeight}`;
  byId('diag-video').textContent = `${renderer.videoUploads} · ${renderer.videoWidth}×${renderer.videoHeight}`;
  byId('diag-audio').textContent = `${renderer.audioSequence} · routed ${routedAudio.sequence}`;
  byId('diag-audio-source').textContent = routedAudio.source;
  byId('diag-video-audio').textContent = videoAudio.hasAudio ? `${videoAudio.previewEnabled ? 'audible' : 'muted'} · ${videoAudio.outputDevice} · ${videoAudio.outputUnderflows} underflows` : 'not available';
  byId('diag-audio-buffer').textContent = `${videoAudio.bufferedMs.toFixed(1)} ms · ${videoAudio.decodedSamples} samples`;
  byId('diag-midi').textContent = `${midi.totalMessages} · seq ${renderer.midiSequence}`;
  byId('diag-osc').textContent = `${osc.totalMessages} · seq ${renderer.oscSequence}`;
  byId('diag-gesture').textContent = `${gesture.receivedEvents} · ${renderer.activeGesturePoints} retained`;
  byId('diag-error').textContent = renderer.lastError || camera.lastError || video.lastError || microphoneAudio.lastError || videoAudio.lastError || midi.lastError || osc.lastError || gesture.lastError || 'none';
}

async function refresh() {
  if (!bridgeReady) {
    byId('diag-error').textContent = 'Tauri bridge unavailable';
    return;
  }
  try { displayInfo(await invoke('get_app_info')); }
  catch (error) { showError(`get_app_info: ${error}`); }
}
setInterval(refresh, 300);
refresh();
console.info('Junkpile multi-input compositor build 20.1 loaded', { bridgeReady });
