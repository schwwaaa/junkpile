'use strict';

// =============================================================================
// Junkpile 23 — Tauri v2 Audio File FFT Visualizer
//
// Signal path:
//   local audio file → HTMLAudioElement → MediaElementAudioSourceNode
//     → AnalyserNode → speakers + MediaStreamDestination
//     → FFT/waveform byte textures → WebGL 1 fragment shader
//     → canvas capture + analysed audio → MediaRecorder
// =============================================================================

const $ = (id) => document.getElementById(id);
const canvas = $('gl-canvas');
const stage = $('stage');
const emptyState = $('empty-state');
const audioElement = $('audio-element');
const audioInput = $('audio-input');
const dropZone = $('drop-zone');
const sourceState = $('source-state');
const fileLabel = $('file-label');
const durationLabel = $('duration-label');
const formatLabel = $('format-label');
const sampleRateLabel = $('sample-rate-label');
const hudFile = $('hud-file');
const hudMode = $('hud-mode');
const seekInput = $('seek');
const playPauseButton = $('play-pause');
const stopButton = $('stop');
const clearButton = $('clear-audio');
const transportTime = $('transport-time');
const regionLabel = $('region-label');
const recordState = $('record-state');

const tauriCore = window.__TAURI__?.core ?? null;
const invoke = tauriCore?.invoke?.bind(tauriCore) ?? null;
const tauriDialog = window.__TAURI__?.dialog ?? null;
const tauriWebview = window.__TAURI__?.webview ?? null;

const spectrumMonitor = $('spectrum-monitor');
const waveformMonitor = $('waveform-monitor');
const spectrum2d = spectrumMonitor.getContext('2d');
const waveform2d = waveformMonitor.getContext('2d');

const MODE_NAMES = [
  'Spectrum rings',
  'Waveform tunnel',
  'Frequency terrain',
  'Aurora field',
  'Beat grid',
  'Spectral ribbons',
];

const params = {
  fftSize: 2048,
  smoothing: 0.7,
  sensitivity: 1.3,
  attack: 0.64,
  release: 0.055,
  beatThreshold: 1.28,
  beatCooldown: 170,
  beatEnabled: true,
  visualMode: 0,
  intensity: 1.15,
  motionSpeed: 0.6,
  frequencyScale: 1.0,
  feedback: 0.78,
  feedbackZoom: 1.003,
  hue: 0,
  saturation: 1.15,
  brightness: 1.0,
  contrast: 1.08,
};

const analysis = { sub: 0, bass: 0, mid: 0, high: 0, air: 0, rms: 0, peakDb: -120, beat: 0 };
const meterBindings = {
  sub: { bar: $('sub-meter'), value: $('sub-value') },
  bass: { bar: $('bass-meter'), value: $('bass-value') },
  mid: { bar: $('mid-meter'), value: $('mid-value') },
  high: { bar: $('high-meter'), value: $('high-value') },
  air: { bar: $('air-meter'), value: $('air-value') },
  rms: { bar: $('rms-meter'), value: $('rms-value') },
};
const beatLight = $('beat-light');
const beatValue = $('beat-value');
const peakLabel = $('peak-label');

let objectUrl = '';
let currentFile = null;
let audioLoaded = false;
let audioContext = null;
let sourceNode = null;
let analyser = null;
let outputGain = null;
let recordDestination = null;
let frequencyData = new Uint8Array(params.fftSize / 2);
let waveformData = new Uint8Array(params.fftSize);
waveformData.fill(128);
let lastBeatAt = -Infinity;
let lowEnergyAverage = 0.08;
let lastAnalysisAt = performance.now();
let loopIn = 0;
let loopOut = Infinity;
let draggingSeek = false;

let recorder = null;
let recordChunks = [];
let recordBytes = 0;
let recordingStartedAt = 0;
let recordingPausedAt = 0;
let totalPausedMs = 0;
let lastRecordingBlob = null;
let lastRecordingMime = '';

function clamp(value, min = 0, max = 1) { return Math.min(max, Math.max(min, value)); }
function formatTime(seconds, decimals = 3) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const minutes = Math.floor(seconds / 60);
  const remain = seconds - minutes * 60;
  const whole = Math.floor(remain);
  const fraction = decimals ? `.${Math.floor((remain - whole) * (10 ** decimals)).toString().padStart(decimals, '0')}` : '';
  return `${String(minutes).padStart(2, '0')}:${String(whole).padStart(2, '0')}${fraction}`;
}
function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / (1024 ** index)).toFixed(index ? 1 : 0)} ${units[index]}`;
}
function safeBaseName(name = 'audio-visual') {
  return name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'audio-visual';
}

const AUDIO_EXTENSIONS = ['mp3', 'wav', 'wave', 'aif', 'aiff', 'm4a', 'aac', 'flac', 'ogg', 'oga', 'opus'];
function pathExtension(path = '') { return String(path).split(/[\\/]/).pop()?.split('.').pop()?.toLowerCase() || ''; }
function isSupportedAudioPath(path = '') { return AUDIO_EXTENSIONS.includes(pathExtension(path)); }
function audioMimeType(name = '') {
  return ({
    mp3: 'audio/mpeg', wav: 'audio/wav', wave: 'audio/wav', aif: 'audio/aiff', aiff: 'audio/aiff',
    m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg; codecs=opus'
  })[pathExtension(name)] || 'application/octet-stream';
}
function setSourceState(text, className = 'idle') {
  sourceState.textContent = text;
  sourceState.className = `status-pill ${className}`;
}
function setRecordState(text, className = 'idle') {
  recordState.textContent = text;
  recordState.className = `status-pill ${className}`;
}

function bindRange(id, key, formatter, onChange = null) {
  const input = $(id);
  const output = $(`${id}-output`);
  const apply = () => {
    const value = Number(input.value);
    params[key] = value;
    output.textContent = formatter(value);
    onChange?.(value);
  };
  input.addEventListener('input', apply);
  apply();
}
bindRange('smoothing', 'smoothing', (v) => v.toFixed(2), (v) => { if (analyser) analyser.smoothingTimeConstant = v; });
bindRange('sensitivity', 'sensitivity', (v) => `${v.toFixed(2)}×`);
bindRange('attack', 'attack', (v) => v.toFixed(2));
bindRange('release', 'release', (v) => v.toFixed(3));
bindRange('beat-threshold', 'beatThreshold', (v) => `${v.toFixed(2)}×`);
bindRange('beat-cooldown', 'beatCooldown', (v) => `${Math.round(v)} ms`);
bindRange('intensity', 'intensity', (v) => v.toFixed(2));
bindRange('motion-speed', 'motionSpeed', (v) => v.toFixed(2));
bindRange('frequency-scale', 'frequencyScale', (v) => v.toFixed(2));
bindRange('feedback', 'feedback', (v) => v.toFixed(2));
bindRange('feedback-zoom', 'feedbackZoom', (v) => v.toFixed(3));
bindRange('hue', 'hue', (v) => `${Math.round(v)}°`);
bindRange('saturation', 'saturation', (v) => v.toFixed(2));
bindRange('brightness', 'brightness', (v) => v.toFixed(2));
bindRange('contrast', 'contrast', (v) => v.toFixed(2));

function configureAnalyserArrays() {
  if (analyser) {
    analyser.fftSize = params.fftSize;
    analyser.smoothingTimeConstant = params.smoothing;
    frequencyData = new Uint8Array(analyser.frequencyBinCount);
    waveformData = new Uint8Array(analyser.fftSize);
  } else {
    frequencyData = new Uint8Array(params.fftSize / 2);
    waveformData = new Uint8Array(params.fftSize);
    waveformData.fill(128);
  }
  spectrumTextureWidth = 0;
  waveformTextureWidth = 0;
}

async function ensureAudioGraph() {
  if (audioContext) {
    if (audioContext.state === 'suspended') await audioContext.resume();
    return;
  }
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error('Web Audio API is unavailable');
  audioContext = new AudioContextClass({ latencyHint: 'interactive' });
  sourceNode = audioContext.createMediaElementSource(audioElement);
  analyser = audioContext.createAnalyser();
  outputGain = audioContext.createGain();
  recordDestination = audioContext.createMediaStreamDestination();
  analyser.minDecibels = -95;
  analyser.maxDecibels = -10;
  sourceNode.connect(analyser);
  analyser.connect(outputGain);
  outputGain.connect(audioContext.destination);
  analyser.connect(recordDestination);
  configureAnalyserArrays();
  updateOutputGain();
  sampleRateLabel.textContent = `${audioContext.sampleRate.toLocaleString()} Hz`;
  await audioContext.resume();
}
function updateOutputGain() {
  if (!outputGain || !audioContext) return;
  const volume = Number($('volume').value);
  const target = $('mute').checked ? 0 : volume;
  outputGain.gain.setTargetAtTime(target, audioContext.currentTime, 0.012);
}

async function loadAudioFile(file) {
  if (!file) return;
  setSourceState('Loading', 'starting');
  audioElement.pause();
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(file);
  currentFile = file;
  audioLoaded = false;
  audioElement.src = objectUrl;
  audioElement.load();
  fileLabel.textContent = file.name;
  formatLabel.textContent = file.type || file.name.split('.').pop()?.toUpperCase() || 'Unknown';
  hudFile.textContent = file.name;
  lastRecordingBlob = null;
  $('save-recording').disabled = true;
  try {
    await new Promise((resolve, reject) => {
      const ready = () => { cleanup(); resolve(); };
      const failed = () => { cleanup(); reject(new Error(audioElement.error?.message || 'The WebView could not decode this audio file')); };
      const cleanup = () => { audioElement.removeEventListener('loadedmetadata', ready); audioElement.removeEventListener('error', failed); };
      audioElement.addEventListener('loadedmetadata', ready, { once: true });
      audioElement.addEventListener('error', failed, { once: true });
    });
    audioLoaded = true;
    loopIn = 0;
    loopOut = audioElement.duration;
    audioElement.currentTime = 0;
    durationLabel.textContent = formatTime(audioElement.duration);
    seekInput.max = String(audioElement.duration || 1);
    seekInput.value = '0';
    [seekInput, playPauseButton, stopButton, clearButton, $('back-ten'), $('forward-ten'), $('set-in'), $('set-out'), $('clear-region')].forEach((node) => { node.disabled = false; });
    setSourceState('Ready', 'ready');
    emptyState.classList.add('hidden');
    updateRegionLabel();
    return true;
  } catch (error) {
    console.error('Audio load failed', error);
    setSourceState('Decode error', 'error');
    fileLabel.textContent = error.message;
    hudFile.textContent = 'Audio decode failed';
    emptyState.classList.remove('hidden');
    return false;
  }
}

function clearAudio() {
  audioElement.pause();
  audioElement.removeAttribute('src');
  audioElement.load();
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = '';
  currentFile = null;
  audioLoaded = false;
  loopIn = 0;
  loopOut = Infinity;
  fileLabel.textContent = '—';
  durationLabel.textContent = '—';
  formatLabel.textContent = '—';
  hudFile.textContent = 'No audio loaded';
  sampleRateLabel.textContent = audioContext ? `${audioContext.sampleRate.toLocaleString()} Hz` : '—';
  setSourceState('No file');
  emptyState.classList.remove('hidden');
  playPauseButton.textContent = 'Play';
  [seekInput, playPauseButton, stopButton, clearButton, $('back-ten'), $('forward-ten'), $('set-in'), $('set-out'), $('clear-region')].forEach((node) => { node.disabled = true; });
  frequencyData.fill(0);
  waveformData.fill(128);
  updateRegionLabel();
}

async function loadNativeAudioPath(path, origin = 'native') {
  if (!invoke) throw new Error('Native audio loading requires the Tauri runtime.');
  setSourceState('Reading', 'starting');
  const selected = await invoke('inspect_audio_file', { path });
  const bytes = await invoke('read_audio_file', { path: selected.path });
  const file = new File([bytes], selected.name, { type: audioMimeType(selected.name) });
  const loaded = await loadAudioFile(file);
  if (!loaded) throw new Error('The WebView could not decode the selected audio file.');
  formatLabel.textContent = selected.extension?.toUpperCase() || file.type || 'Unknown';
  setSourceState(`${origin} ready`, 'ready');
}

async function openNativeAudio() {
  if (!invoke || !tauriDialog?.open) { audioInput.click(); return; }
  const button = $('native-open');
  button.disabled = true;
  setSourceState('Opening', 'starting');
  try {
    const path = await tauriDialog.open({
      multiple: false,
      directory: false,
      title: 'Open audio file',
      filters: [{ name: 'Audio files', extensions: AUDIO_EXTENSIONS }]
    });
    if (!path || Array.isArray(path)) { setSourceState(audioLoaded ? 'Ready' : 'No file', audioLoaded ? 'ready' : 'idle'); return; }
    await loadNativeAudioPath(path, 'Native');
  } catch (error) {
    console.error('Native audio open failed', error);
    setSourceState('Open failed', 'error');
    fileLabel.textContent = error.message || String(error);
  } finally { button.disabled = false; }
}

$('native-open').addEventListener('click', openNativeAudio);
$('choose-audio').addEventListener('click', () => audioInput.click());
audioInput.addEventListener('change', () => { const file = audioInput.files?.[0]; if (file) loadAudioFile(file); audioInput.value = ''; });
clearButton.addEventListener('click', clearAudio);
['dragenter', 'dragover'].forEach((name) => dropZone.addEventListener(name, (event) => { event.preventDefault(); dropZone.classList.add('dragging'); }));
['dragleave', 'drop'].forEach((name) => dropZone.addEventListener(name, (event) => { event.preventDefault(); dropZone.classList.remove('dragging'); }));
dropZone.addEventListener('drop', (event) => { const file = [...(event.dataTransfer?.files || [])].find((item) => item.type.startsWith('audio/') || /\.(mp3|wav|aiff?|m4a|aac|flac|ogg|opus)$/i.test(item.name)); if (file) loadAudioFile(file); });
dropZone.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); audioInput.click(); } });

async function installNativeDropHandler() {
  if (!tauriWebview?.getCurrentWebview) return;
  try {
    const currentWebview = tauriWebview.getCurrentWebview();
    await currentWebview.onDragDropEvent((event) => {
      const payload = event.payload || {};
      if (payload.type === 'over' || payload.type === 'enter') { dropZone.classList.add('dragging'); return; }
      if (payload.type === 'drop') {
        dropZone.classList.remove('dragging');
        const path = Array.from(payload.paths || []).find(isSupportedAudioPath);
        if (!path) { setSourceState('Unsupported drop', 'error'); return; }
        void loadNativeAudioPath(path, 'Dropped').catch((error) => {
          console.error('Native audio drop failed', error);
          setSourceState('Drop failed', 'error');
          fileLabel.textContent = error.message || String(error);
        });
        return;
      }
      dropZone.classList.remove('dragging');
    });
  } catch (error) {
    console.error('Could not install native audio drop handler', error);
  }
}
void installNativeDropHandler();

async function togglePlayback() {
  if (!audioLoaded) return;
  try {
    await ensureAudioGraph();
    if (audioElement.paused) {
      if (audioElement.currentTime >= loopOut - 0.01) audioElement.currentTime = loopIn;
      await audioElement.play();
    } else {
      audioElement.pause();
    }
  } catch (error) {
    console.error('Playback failed', error);
    setSourceState('Playback error', 'error');
  }
}
playPauseButton.addEventListener('click', togglePlayback);
stopButton.addEventListener('click', () => { audioElement.pause(); audioElement.currentTime = loopIn; });
$('back-ten').addEventListener('click', () => { audioElement.currentTime = clamp(audioElement.currentTime - 10, loopIn, Number.isFinite(loopOut) ? loopOut : audioElement.duration); });
$('forward-ten').addEventListener('click', () => { audioElement.currentTime = clamp(audioElement.currentTime + 10, loopIn, Number.isFinite(loopOut) ? loopOut : audioElement.duration); });
audioElement.addEventListener('play', () => { playPauseButton.textContent = 'Pause'; setSourceState('Playing', 'ready'); });
audioElement.addEventListener('pause', () => { playPauseButton.textContent = 'Play'; if (audioLoaded) setSourceState('Ready', 'ready'); });
audioElement.addEventListener('ended', () => { if ($('loop').checked) { audioElement.currentTime = loopIn; audioElement.play().catch(() => {}); } });
seekInput.addEventListener('pointerdown', () => { draggingSeek = true; });
window.addEventListener('pointerup', () => { draggingSeek = false; });
seekInput.addEventListener('input', () => { if (audioLoaded) audioElement.currentTime = Number(seekInput.value); });
$('playback-rate').addEventListener('input', (event) => { const value = Number(event.target.value); audioElement.playbackRate = value; $('playback-rate-output').textContent = `${value.toFixed(2)}×`; });
$('playback-rate').dispatchEvent(new Event('input'));
$('volume').addEventListener('input', (event) => { $('volume-output').textContent = `${Math.round(Number(event.target.value) * 100)}%`; updateOutputGain(); });
$('volume').dispatchEvent(new Event('input'));
$('mute').addEventListener('change', updateOutputGain);
$('loop').addEventListener('change', () => { audioElement.loop = false; });
function updateRegionLabel() { regionLabel.textContent = audioLoaded && Number.isFinite(loopOut) ? `${formatTime(loopIn)} → ${formatTime(loopOut)}` : 'Full duration'; }
$('set-in').addEventListener('click', () => { if (!audioLoaded) return; loopIn = Math.min(audioElement.currentTime, loopOut - 0.05); updateRegionLabel(); });
$('set-out').addEventListener('click', () => { if (!audioLoaded) return; loopOut = Math.max(audioElement.currentTime, loopIn + 0.05); updateRegionLabel(); });
$('clear-region').addEventListener('click', () => { if (!audioLoaded) return; loopIn = 0; loopOut = audioElement.duration; updateRegionLabel(); });

$('fft-size').addEventListener('change', (event) => { params.fftSize = Number(event.target.value); configureAnalyserArrays(); });
$('visual-mode').addEventListener('change', (event) => { params.visualMode = Number(event.target.value); hudMode.textContent = MODE_NAMES[params.visualMode] || 'Unknown'; });
$('visual-mode').dispatchEvent(new Event('change'));
$('beat-enabled').addEventListener('change', (event) => { params.beatEnabled = event.target.checked; });
$('manual-beat').addEventListener('click', () => { analysis.beat = 1; lastBeatAt = performance.now(); });

function bandAverage(minHz, maxHz) {
  if (!audioContext || frequencyData.length === 0) return 0;
  const hzPerBin = audioContext.sampleRate / params.fftSize;
  const start = clamp(Math.floor(minHz / hzPerBin), 0, frequencyData.length - 1);
  const end = clamp(Math.ceil(maxHz / hzPerBin), start + 1, frequencyData.length);
  let power = 0;
  let count = 0;
  for (let i = start; i < end; i += 1) { const normalized = frequencyData[i] / 255; power += normalized * normalized; count += 1; }
  return count ? Math.sqrt(power / count) : 0;
}
function smoothBand(key, target) { const current = analysis[key]; const coefficient = target > current ? params.attack : params.release; analysis[key] = current + (target - current) * coefficient; }
function updateAudioAnalysis(now) {
  const deltaSeconds = clamp((now - lastAnalysisAt) / 1000, 0, 0.1);
  lastAnalysisAt = now;
  if (audioLoaded && analyser) {
    analyser.getByteFrequencyData(frequencyData);
    analyser.getByteTimeDomainData(waveformData);
    const nyquist = audioContext.sampleRate * 0.5;
    const sensitivity = params.sensitivity;
    smoothBand('sub', clamp(bandAverage(20, 60) * sensitivity));
    smoothBand('bass', clamp(bandAverage(60, 250) * sensitivity));
    smoothBand('mid', clamp(bandAverage(250, 2000) * sensitivity));
    smoothBand('high', clamp(bandAverage(2000, Math.min(8000, nyquist)) * sensitivity));
    smoothBand('air', clamp(bandAverage(Math.min(8000, nyquist * 0.75), nyquist) * sensitivity));
    let squareSum = 0;
    for (let i = 0; i < waveformData.length; i += 1) { const sample = (waveformData[i] - 128) / 128; squareSum += sample * sample; }
    const rmsTarget = clamp(Math.sqrt(squareSum / waveformData.length) * sensitivity * 1.8);
    smoothBand('rms', rmsTarget);
    analysis.peakDb = 20 * Math.log10(Math.max(rmsTarget, 0.000001));
    const lowEnergy = analysis.sub * 0.55 + analysis.bass * 0.45;
    lowEnergyAverage += (lowEnergy - lowEnergyAverage) * 0.025;
    const threshold = Math.max(0.085, lowEnergyAverage * params.beatThreshold);
    if (params.beatEnabled && !audioElement.paused && lowEnergy > threshold && now - lastBeatAt >= params.beatCooldown) { analysis.beat = 1; lastBeatAt = now; }
  } else {
    ['sub', 'bass', 'mid', 'high', 'air', 'rms'].forEach((key) => smoothBand(key, 0));
    analysis.peakDb = -120;
  }
  analysis.beat *= Math.exp(-deltaSeconds * 7.5);
  if (analysis.beat < 0.001) analysis.beat = 0;
}
function updateAnalysisUi() {
  Object.entries(meterBindings).forEach(([key, binding]) => { const value = clamp(analysis[key]); binding.bar.style.width = `${(value * 100).toFixed(1)}%`; binding.value.textContent = value.toFixed(2); });
  beatValue.textContent = analysis.beat.toFixed(2);
  beatLight.classList.toggle('active', analysis.beat > 0.3);
  beatLight.style.opacity = String(0.25 + analysis.beat * 0.75);
  peakLabel.textContent = analysis.peakDb <= -100 ? '−∞ dB' : `${analysis.peakDb.toFixed(1)} dB`;
}
function drawMonitors() {
  const sw = spectrumMonitor.width, sh = spectrumMonitor.height;
  spectrum2d.clearRect(0, 0, sw, sh); spectrum2d.fillStyle = '#090b0e'; spectrum2d.fillRect(0, 0, sw, sh);
  spectrum2d.strokeStyle = 'rgba(255,255,255,0.055)'; spectrum2d.lineWidth = 1;
  for (let x = 0; x <= sw; x += sw / 8) { spectrum2d.beginPath(); spectrum2d.moveTo(x, 0); spectrum2d.lineTo(x, sh); spectrum2d.stroke(); }
  for (let y = 0; y <= sh; y += sh / 4) { spectrum2d.beginPath(); spectrum2d.moveTo(0, y); spectrum2d.lineTo(sw, y); spectrum2d.stroke(); }
  const bars = Math.min(128, frequencyData.length), barWidth = sw / bars;
  for (let i = 0; i < bars; i += 1) { const normalizedIndex = i / Math.max(1, bars - 1); const bin = Math.min(frequencyData.length - 1, Math.floor(Math.pow(normalizedIndex, 2.2) * (frequencyData.length - 1))); const value = frequencyData[bin] / 255; const height = value * sh; spectrum2d.fillStyle = `rgba(137, ${Math.round(170 + value * 85)}, 205, ${0.28 + value * 0.72})`; spectrum2d.fillRect(i * barWidth, sh - height, Math.max(1, barWidth - 1), height); }
  const ww = waveformMonitor.width, wh = waveformMonitor.height;
  waveform2d.clearRect(0, 0, ww, wh); waveform2d.fillStyle = '#090b0e'; waveform2d.fillRect(0, 0, ww, wh);
  waveform2d.strokeStyle = 'rgba(255,255,255,0.07)'; waveform2d.beginPath(); waveform2d.moveTo(0, wh * 0.5); waveform2d.lineTo(ww, wh * 0.5); waveform2d.stroke();
  waveform2d.strokeStyle = '#89ffcd'; waveform2d.lineWidth = 1.5; waveform2d.beginPath();
  const samples = Math.min(600, waveformData.length);
  for (let i = 0; i < samples; i += 1) { const sourceIndex = Math.floor((i / Math.max(1, samples - 1)) * (waveformData.length - 1)); const y = (waveformData[sourceIndex] / 255) * wh; const x = (i / Math.max(1, samples - 1)) * ww; if (!i) waveform2d.moveTo(x, y); else waveform2d.lineTo(x, y); }
  waveform2d.stroke();
}
function updateTransportUi() {
  if (!audioLoaded) { transportTime.textContent = '00:00.000 / 00:00.000'; return; }
  if ($('loop').checked && Number.isFinite(loopOut) && audioElement.currentTime >= loopOut - 0.015) {
    audioElement.currentTime = loopIn;
    if (audioElement.paused) audioElement.play().catch(() => {});
  } else if (!$('loop').checked && Number.isFinite(loopOut) && audioElement.currentTime >= loopOut - 0.015 && !audioElement.paused) {
    audioElement.pause(); audioElement.currentTime = loopOut;
  }
  if (!draggingSeek) seekInput.value = String(audioElement.currentTime);
  transportTime.textContent = `${formatTime(audioElement.currentTime)} / ${formatTime(audioElement.duration)}`;
}

function chooseRecordingMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  return ['video/mp4;codecs=h264,aac', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((candidate) => { try { return MediaRecorder.isTypeSupported(candidate); } catch (_) { return false; } }) || '';
}
const preferredMime = chooseRecordingMime();
$('codec-label').textContent = preferredMime || 'Unavailable';
async function startRecording() {
  if (!preferredMime || typeof canvas.captureStream !== 'function') { setRecordState('Unsupported', 'error'); return; }
  try {
    await ensureAudioGraph();
    const canvasStream = canvas.captureStream(Number($('record-fps').value));
    const audioTracks = (recordDestination?.stream.getAudioTracks() || []).map((track) => track.clone());
    const tracks = [...canvasStream.getVideoTracks(), ...audioTracks];
    const stream = new MediaStream(tracks);
    recordChunks = []; recordBytes = 0; totalPausedMs = 0; recordingPausedAt = 0; lastRecordingBlob = null;
    const options = { mimeType: preferredMime, videoBitsPerSecond: Number($('video-bitrate').value), audioBitsPerSecond: 192000 };
    recorder = new MediaRecorder(stream, options);
    recorder.addEventListener('dataavailable', (event) => { if (event.data?.size) { recordChunks.push(event.data); recordBytes += event.data.size; } });
    recorder.addEventListener('stop', () => { lastRecordingBlob = new Blob(recordChunks, { type: recorder.mimeType || preferredMime }); lastRecordingMime = lastRecordingBlob.type; stream.getTracks().forEach((track) => track.stop()); $('save-recording').disabled = !lastRecordingBlob.size; $('record').disabled = false; $('pause-record').disabled = true; $('stop-record').disabled = true; $('record').classList.remove('active'); $('record-size').textContent = formatBytes(lastRecordingBlob.size); setRecordState('Captured', 'ready'); });
    recorder.addEventListener('error', (event) => { console.error('MediaRecorder error', event.error || event); setRecordState('Recorder error', 'error'); });
    recorder.start(500);
    recordingStartedAt = performance.now();
    $('record').disabled = true; $('pause-record').disabled = false; $('stop-record').disabled = false; $('save-recording').disabled = true; $('record').classList.add('active'); setRecordState('Recording', 'error');
  } catch (error) { console.error('Could not start recording', error); setRecordState('Start failed', 'error'); }
}
function pauseRecording() {
  if (!recorder) return;
  if (recorder.state === 'recording') { recorder.pause(); recordingPausedAt = performance.now(); $('pause-record').textContent = 'Resume'; setRecordState('Paused', 'starting'); }
  else if (recorder.state === 'paused') { totalPausedMs += performance.now() - recordingPausedAt; recorder.resume(); $('pause-record').textContent = 'Pause'; setRecordState('Recording', 'error'); }
}
function stopRecording() { if (recorder && recorder.state !== 'inactive') { if (recorder.state === 'paused') totalPausedMs += performance.now() - recordingPausedAt; recorder.stop(); $('pause-record').textContent = 'Pause'; } }
function updateRecordingUi(now) {
  if (!recorder || recorder.state === 'inactive') return;
  const pausedNow = recorder.state === 'paused' ? now - recordingPausedAt : 0;
  const elapsed = Math.max(0, now - recordingStartedAt - totalPausedMs - pausedNow);
  $('record-duration').textContent = formatTime(elapsed / 1000, 1);
  $('record-size').textContent = formatBytes(recordBytes);
}
async function writeBlobNative(path, blob) {
  const chunkSize = 1024 * 1024;
  if (blob.size <= chunkSize * 4) {
    const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
    return invoke('write_binary', { path, bytes });
  }
  await invoke('create_binary', { path });
  let written = 0;
  for (let offset = 0; offset < blob.size; offset += chunkSize) {
    const chunk = blob.slice(offset, Math.min(blob.size, offset + chunkSize));
    const bytes = Array.from(new Uint8Array(await chunk.arrayBuffer()));
    await invoke('append_binary', { path, bytes });
    written += chunk.size;
    setRecordState(`Saving ${Math.round((written / blob.size) * 100)}%`, 'starting');
  }
  return path;
}
async function saveBlob(blob, suggestedName, extension) {
  if (invoke && tauriDialog?.save) {
    const path = await tauriDialog.save({
      defaultPath: suggestedName,
      title: extension === 'png' ? 'Save visual frame' : 'Save audio-reactive recording',
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }]
    });
    if (!path) return null;
    return writeBlobNative(path, blob);
  }
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = suggestedName; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); return suggestedName;
}
async function saveLastRecording() {
  if (!lastRecordingBlob) return;
  try { const extension = lastRecordingMime.includes('mp4') ? 'mp4' : 'webm'; const path = await saveBlob(lastRecordingBlob, `${safeBaseName(currentFile?.name)}-visual.${extension}`, extension); if (path) { $('last-save').textContent = path.split(/[\\/]/).pop(); setRecordState('Saved', 'ready'); } } catch (error) { console.error('Save failed', error); setRecordState('Save failed', 'error'); }
}
async function saveSnapshot() {
  try { const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('PNG encoding failed')), 'image/png')); const path = await saveBlob(blob, `${safeBaseName(currentFile?.name)}-frame.png`, 'png'); if (path) { $('last-save').textContent = path.split(/[\\/]/).pop(); setRecordState('PNG saved', 'ready'); } } catch (error) { console.error('Snapshot failed', error); setRecordState('PNG failed', 'error'); }
}
$('record').addEventListener('click', startRecording);
$('pause-record').addEventListener('click', pauseRecording);
$('stop-record').addEventListener('click', stopRecording);
$('save-recording').addEventListener('click', saveLastRecording);
$('snapshot').addEventListener('click', saveSnapshot);
$('fullscreen-preview').addEventListener('click', async () => {
  try {
    if (invoke) await invoke('toggle_fullscreen');
    else if (!document.fullscreenElement) await stage.requestFullscreen();
    else await document.exitFullscreen();
  } catch (error) { console.error('Fullscreen failed', error); }
});
window.addEventListener('beforeunload', () => { if (objectUrl) URL.revokeObjectURL(objectUrl); try { recorder?.stop(); } catch (_) {} });

// =============================================================================
// WebGL renderer
// =============================================================================

const gl = canvas.getContext('webgl', {
  alpha: false,
  antialias: false,
  depth: false,
  stencil: false,
  preserveDrawingBuffer: true,
});

if (!gl) {
  document.body.innerHTML = '<p style="padding:2rem;color:#ff848f">WebGL is unavailable in this WebView.</p>';
  throw new Error('WebGL unavailable');
}

const VERTEX_SHADER = `
  precision highp float;
  attribute vec2 a_position;
  varying vec2 v_uv;
  void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

const EFFECT_SHADER = `
  precision highp float;
  varying vec2 v_uv;

  uniform sampler2D u_spectrum;
  uniform sampler2D u_waveform;
  uniform sampler2D u_previous;
  uniform vec2 u_resolution;
  uniform float u_time;
  uniform float u_mode;
  uniform float u_intensity;
  uniform float u_speed;
  uniform float u_frequencyScale;
  uniform float u_feedback;
  uniform float u_feedbackZoom;
  uniform float u_sub;
  uniform float u_bass;
  uniform float u_mid;
  uniform float u_high;
  uniform float u_air;
  uniform float u_rms;
  uniform float u_beat;
  uniform float u_hue;
  uniform float u_saturation;
  uniform float u_brightness;
  uniform float u_contrast;

  const float PI = 3.141592653589793;
  const float TAU = 6.283185307179586;

  float sat(float value) { return clamp(value, 0.0, 1.0); }
  float spectrum(float x) {
    float mapped = clamp(pow(sat(x), 2.15) * u_frequencyScale, 0.0, 0.999);
    return texture2D(u_spectrum, vec2(mapped, 0.5)).r;
  }
  float waveform(float x) {
    return texture2D(u_waveform, vec2(fract(x), 0.5)).r * 2.0 - 1.0;
  }
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
  }
  vec3 palette(float phase, float energy) {
    float hue = fract((u_hue / 360.0) + phase + u_time * 0.012 + u_high * 0.08);
    return hsv2rgb(vec3(hue, sat(0.55 + u_saturation * 0.3), sat(0.25 + energy * 1.25)));
  }

  vec3 spectrumRings(vec2 p) {
    float radius = length(p);
    float angle = atan(p.y, p.x) / TAU + 0.5;
    float spec = spectrum(angle);
    float wave = waveform(angle + u_time * 0.025 * u_speed);
    float target = 0.23 + spec * (0.25 + u_bass * 0.2) * u_intensity;
    float ring = exp(-abs(radius - target - wave * 0.025) * (38.0 - u_rms * 12.0));
    float ring2 = exp(-abs(radius - (0.47 + spectrum(fract(angle + 0.23)) * 0.11)) * 70.0);
    float spokes = pow(sat(sin(angle * TAU * (8.0 + floor(u_mid * 14.0))) * 0.5 + 0.5), 10.0) * spec;
    vec3 color = palette(angle * 0.42 + radius * 0.18, ring + ring2);
    color *= ring * 1.4 + ring2 * 0.7 + spokes * 0.23;
    color += palette(0.13, u_beat) * u_beat * exp(-radius * 3.5);
    return color;
  }

  vec3 waveformTunnel(vec2 p) {
    float radius = length(p);
    float angle = atan(p.y, p.x) / TAU + 0.5;
    float wave = waveform(angle + radius * 0.17 - u_time * u_speed * 0.035);
    float tunnel = abs(fract(radius * (8.0 + u_bass * 8.0) - u_time * u_speed * 0.28) - 0.5);
    float rings = exp(-tunnel * (18.0 + u_high * 24.0));
    float line = exp(-abs(wave - (radius - 0.43) * 2.4) * 14.0);
    float spec = spectrum(angle);
    vec3 color = palette(angle * 0.55 + radius * 0.3, rings + line);
    color *= rings * (0.28 + spec * 1.4) + line * (0.8 + u_mid);
    color += palette(0.62, u_beat) * u_beat * exp(-abs(radius - 0.3) * 15.0);
    return color;
  }

  vec3 frequencyTerrain(vec2 p) {
    vec2 uv = p * 0.5 + 0.5;
    float spec = spectrum(uv.x);
    float wave = waveform(uv.x * 0.63 + u_time * 0.018 * u_speed);
    float horizon = -0.48 + spec * (0.9 + u_bass * 0.5) * u_intensity + wave * 0.06;
    float line = exp(-abs(p.y - horizon) * 42.0);
    float fill = smoothstep(p.y, p.y - 0.025, horizon) * 0.16;
    float scan = pow(sat(sin((p.y - horizon) * 150.0 - u_time * 2.0) * 0.5 + 0.5), 18.0);
    vec3 color = palette(uv.x * 0.48 + spec * 0.16, spec);
    color *= line * 1.4 + fill * (0.25 + spec) + scan * fill * u_high;
    color += palette(0.07, u_beat) * u_beat * exp(-abs(p.y - horizon) * 7.0);
    return color;
  }

  vec3 auroraField(vec2 p) {
    float t = u_time * u_speed * 0.16;
    float field = 0.0;
    float glow = 0.0;
    for (int i = 0; i < 5; i++) {
      float fi = float(i);
      float sampleX = fract(p.x * 0.18 + fi * 0.17 + 0.5);
      float spec = spectrum(sampleX);
      float y = sin(p.x * (1.6 + fi * 0.43) + t * (0.7 + fi * 0.12) + fi) * (0.08 + spec * 0.25);
      y += (fi - 2.0) * 0.11;
      float strand = exp(-abs(p.y - y) * (15.0 + fi * 4.0));
      field += strand * (0.18 + spec * 1.2);
      glow += strand * spectrum(fract(sampleX + 0.29));
    }
    float fog = noise(p * (2.0 + u_mid * 2.0) + vec2(t, -t * 0.4));
    vec3 color = palette(p.x * 0.12 + p.y * 0.08 + field * 0.04, field);
    color *= field * (0.65 + u_intensity * 0.55) + fog * 0.08 * u_air;
    color += palette(0.82, glow) * glow * 0.3;
    color += palette(0.14, u_beat) * u_beat * 0.28;
    return color;
  }

  vec3 beatGrid(vec2 p) {
    float t = u_time * u_speed * 0.22;
    float warp = sin(p.y * 4.0 + t) * u_bass * 0.18 + sin(p.x * 7.0 - t * 1.3) * u_mid * 0.08;
    vec2 q = p;
    q.x += warp;
    q.y += sin(p.x * 3.0 - t) * u_sub * 0.12;
    float scale = 6.0 + u_high * 14.0 + u_beat * 5.0;
    vec2 cell = abs(fract(q * scale) - 0.5);
    float grid = exp(-min(cell.x, cell.y) * (40.0 - u_beat * 18.0));
    float spec = spectrum(fract((q.x + q.y) * 0.22 + 0.5));
    float pulse = exp(-abs(length(p) - fract(t * 0.3) * 0.9) * 20.0) * u_beat;
    vec3 color = palette((q.x + q.y) * 0.08 + spec * 0.2, grid + pulse);
    color *= grid * (0.2 + spec * 1.35) + pulse * 1.4;
    return color;
  }

  vec3 spectralRibbons(vec2 p) {
    float x = p.x * 0.5 + 0.5;
    float timeShift = u_time * u_speed * 0.035;
    float energy = spectrum(x);
    float wave = waveform(x + timeShift) * 0.18;
    vec3 color = vec3(0.0);
    for (int i = 0; i < 7; i++) {
      float fi = float(i);
      float sampleX = fract(x + fi * 0.071 + timeShift * (0.15 + fi * 0.02));
      float band = spectrum(sampleX);
      float center = (fi - 3.0) * 0.145 + (band - 0.35) * 0.34 + wave;
      float ribbon = exp(-abs(p.y - center) * (22.0 + u_high * 16.0));
      color += palette(fi * 0.085 + sampleX * 0.35, ribbon) * ribbon * (0.25 + band * 1.2);
    }
    float flash = u_beat * exp(-abs(p.y) * 4.0) * (0.3 + energy);
    color += palette(x * 0.22 + 0.4, flash) * flash;
    return color;
  }

  void main() {
    vec2 p = (gl_FragCoord.xy * 2.0 - u_resolution.xy) / min(u_resolution.x, u_resolution.y);
    vec3 color;
    if (u_mode < 0.5) color = spectrumRings(p);
    else if (u_mode < 1.5) color = waveformTunnel(p);
    else if (u_mode < 2.5) color = frequencyTerrain(p);
    else if (u_mode < 3.5) color = auroraField(p);
    else if (u_mode < 4.5) color = beatGrid(p);
    else color = spectralRibbons(p);

    color *= 0.58 + u_intensity * 0.48;
    color += vec3(0.003, 0.005, 0.007);

    vec2 previousUv = (v_uv - 0.5) / u_feedbackZoom + 0.5;
    vec3 previous = texture2D(u_previous, previousUv).rgb;
    previous *= 0.982 - u_beat * 0.025;
    color = mix(color, max(color, previous), u_feedback);

    float luminance = dot(color, vec3(0.299, 0.587, 0.114));
    color = mix(vec3(luminance), color, u_saturation);
    color = (color - 0.5) * u_contrast + 0.5;
    color *= u_brightness;
    gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
  }
`;

const DISPLAY_SHADER = `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_texture;
  void main() {
    gl_FragColor = texture2D(u_texture, v_uv);
  }
`;

function compileShader(type, source, label) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || `Unknown ${label} shader error`;
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(fragmentSource, label) {
  const program = gl.createProgram();
  const vertex = compileShader(gl.VERTEX_SHADER, VERTEX_SHADER, `${label} vertex`);
  const fragment = compileShader(gl.FRAGMENT_SHADER, fragmentSource, `${label} fragment`);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || `Unknown ${label} link error`;
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}

let effectProgram;
let displayProgram;
try {
  effectProgram = createProgram(EFFECT_SHADER, 'effect');
  displayProgram = createProgram(DISPLAY_SHADER, 'display');
} catch (error) {
  console.error(error);
  document.body.innerHTML = `<pre style="padding:2rem;color:#ff848f;white-space:pre-wrap">Shader compilation failed:\n${error.message}</pre>`;
  throw error;
}

const quadBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

function bindQuad(program) {
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  const attributeLocation = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(attributeLocation);
  gl.vertexAttribPointer(attributeLocation, 2, gl.FLOAT, false, 0, 0);
}

function getUniformLocation(program, name) {
  return gl.getUniformLocation(program, name);
}
function uniform1f(program, name, value) {
  const target = getUniformLocation(program, name);
  if (target !== null) gl.uniform1f(target, value);
}
function uniform1i(program, name, value) {
  const target = getUniformLocation(program, name);
  if (target !== null) gl.uniform1i(target, value);
}
function uniform2f(program, name, x, y) {
  const target = getUniformLocation(program, name);
  if (target !== null) gl.uniform2f(target, x, y);
}

function createTexture(filter = gl.LINEAR) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  return texture;
}

const spectrumTexture = createTexture(gl.LINEAR);
const waveformTexture = createTexture(gl.LINEAR);
let spectrumTextureWidth = 0;
let waveformTextureWidth = 0;

function uploadAudioTextures() {
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, spectrumTexture);
  if (spectrumTextureWidth !== frequencyData.length) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, frequencyData.length, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, frequencyData);
    spectrumTextureWidth = frequencyData.length;
  } else {
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, frequencyData.length, 1, gl.LUMINANCE, gl.UNSIGNED_BYTE, frequencyData);
  }

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, waveformTexture);
  if (waveformTextureWidth !== waveformData.length) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, waveformData.length, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, waveformData);
    waveformTextureWidth = waveformData.length;
  } else {
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, waveformData.length, 1, gl.LUMINANCE, gl.UNSIGNED_BYTE, waveformData);
  }
}

let feedbackTextures = [null, null];
let feedbackFramebuffers = [null, null];
let feedbackIndex = 0;

function disposeFeedbackTargets() {
  feedbackTextures.forEach((texture) => texture && gl.deleteTexture(texture));
  feedbackFramebuffers.forEach((framebuffer) => framebuffer && gl.deleteFramebuffer(framebuffer));
  feedbackTextures = [null, null];
  feedbackFramebuffers = [null, null];
}

function createFeedbackTargets(width, height) {
  disposeFeedbackTargets();
  for (let index = 0; index < 2; index += 1) {
    const texture = createTexture(gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('Could not create audio feedback framebuffer');
    }
    feedbackTextures[index] = texture;
    feedbackFramebuffers[index] = framebuffer;
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  feedbackIndex = 0;

  gl.clearColor(0, 0, 0, 1);
  feedbackFramebuffers.forEach((framebuffer) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.clear(gl.COLOR_BUFFER_BIT);
  });
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function resizeCanvasIfNeeded() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(stage.clientWidth * dpr));
  const height = Math.max(1, Math.round(stage.clientHeight * dpr));
  if (canvas.width === width && canvas.height === height) return;
  canvas.width = width;
  canvas.height = height;
  createFeedbackTargets(width, height);
  $('render-size').textContent = `${width} × ${height}`;
}

let renderStartedAt = performance.now();
let fpsWindowAt = renderStartedAt;
let fpsFrames = 0;
let monitorLastDraw = 0;

function render(now) {
  resizeCanvasIfNeeded();
  updateAudioAnalysis(now);
  uploadAudioTextures();

  const writeIndex = feedbackIndex;
  const readIndex = 1 - feedbackIndex;
  const elapsed = (now - renderStartedAt) / 1000;

  gl.bindFramebuffer(gl.FRAMEBUFFER, feedbackFramebuffers[writeIndex]);
  gl.viewport(0, 0, canvas.width, canvas.height);
  bindQuad(effectProgram);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, spectrumTexture);
  uniform1i(effectProgram, 'u_spectrum', 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, waveformTexture);
  uniform1i(effectProgram, 'u_waveform', 1);
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, feedbackTextures[readIndex]);
  uniform1i(effectProgram, 'u_previous', 2);

  uniform2f(effectProgram, 'u_resolution', canvas.width, canvas.height);
  uniform1f(effectProgram, 'u_time', audioLoaded ? audioElement.currentTime : elapsed);
  uniform1f(effectProgram, 'u_mode', params.visualMode);
  uniform1f(effectProgram, 'u_intensity', params.intensity);
  uniform1f(effectProgram, 'u_speed', params.motionSpeed);
  uniform1f(effectProgram, 'u_frequencyScale', params.frequencyScale);
  uniform1f(effectProgram, 'u_feedback', params.feedback);
  uniform1f(effectProgram, 'u_feedbackZoom', params.feedbackZoom);
  uniform1f(effectProgram, 'u_sub', analysis.sub);
  uniform1f(effectProgram, 'u_bass', analysis.bass);
  uniform1f(effectProgram, 'u_mid', analysis.mid);
  uniform1f(effectProgram, 'u_high', analysis.high);
  uniform1f(effectProgram, 'u_air', analysis.air);
  uniform1f(effectProgram, 'u_rms', analysis.rms);
  uniform1f(effectProgram, 'u_beat', analysis.beat);
  uniform1f(effectProgram, 'u_hue', params.hue);
  uniform1f(effectProgram, 'u_saturation', params.saturation);
  uniform1f(effectProgram, 'u_brightness', params.brightness);
  uniform1f(effectProgram, 'u_contrast', params.contrast);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  bindQuad(displayProgram);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, feedbackTextures[writeIndex]);
  uniform1i(displayProgram, 'u_texture', 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  feedbackIndex = readIndex;

  updateAnalysisUi();
  updateTransportUi();
  updateRecordingUi(now);
  if (now - monitorLastDraw >= 33) {
    drawMonitors();
    monitorLastDraw = now;
  }

  fpsFrames += 1;
  if (now - fpsWindowAt >= 500) {
    const fps = (fpsFrames * 1000) / (now - fpsWindowAt);
    $('fps-label').textContent = `${fps.toFixed(0)} fps`;
    fpsFrames = 0;
    fpsWindowAt = now;
  }

  requestAnimationFrame(render);
}


configureAnalyserArrays();
resizeCanvasIfNeeded();
drawMonitors();
requestAnimationFrame(render);
