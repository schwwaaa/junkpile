const invoke = window.__TAURI__.core.invoke;

const $ = (id) => document.getElementById(id);
const els = {
  device: $("deviceSelect"), refresh: $("refreshDevicesBtn"), start: $("startMicBtn"), stop: $("stopMicBtn"),
  demo: $("demoToggle"), micBadge: $("micStateBadge"), micError: $("micError"),
  gain: $("gainSlider"), gainOut: $("gainOut"), smoothing: $("smoothSlider"), smoothOut: $("smoothOut"),
  threshold: $("thresholdSlider"), thresholdOut: $("thresholdOut"), hold: $("holdSlider"), holdOut: $("holdOut"),
  mode: $("visualModeSelect"), reactivity: $("reactivitySlider"), reactivityOut: $("reactivityOut"),
  spin: $("spinSlider"), spinOut: $("spinOut"), hue: $("hueSlider"), hueOut: $("hueOut"),
  resolution: $("resolutionSelect"), resolutionNote: $("resolutionNote"), previewMode: $("previewModeSelect"),
  fullscreen: $("fullscreenBtn"), reset: $("resetMetricsBtn"),
  analysisRate: $("analysisRate"), rms: $("rmsValue"), peak: $("peakValue"), bass: $("bassValue"), mid: $("midValue"), treble: $("trebleValue"), beat: $("beatValue"),
  adapter: $("adapterValue"), backend: $("backendValue"), fps: $("fpsValue"), frameTime: $("frameTimeValue"), renderSize: $("renderSizeValue"), windowSize: $("windowSizeValue"), micFormat: $("micFormatValue"), buffer: $("bufferValue"), callbackErrors: $("callbackErrorValue"), maxTexture: $("maxTextureValue"), rendererBadge: $("rendererBadge"), status: $("statusLine"),
  spectrumCanvas: $("spectrumCanvas"), waveCanvas: $("waveCanvas")
};

let latestRenderer = null;
let latestAudio = null;
let latestAnalysis = null;
let resolutionPopulated = false;
let pollBusy = false;

function setStatus(message) { els.status.textContent = message; }
function format3(value) { return Number(value || 0).toFixed(3); }

async function refreshDevices() {
  try {
    const devices = await invoke("list_audio_inputs");
    const previous = els.device.value;
    els.device.replaceChildren();
    const defaultOption = document.createElement("option");
    defaultOption.value = "__default__";
    defaultOption.textContent = "System default input";
    els.device.append(defaultOption);
    for (const device of devices) {
      const option = document.createElement("option");
      option.value = device.name;
      option.textContent = `${device.name}${device.isDefault ? " · default" : ""}`;
      els.device.append(option);
    }
    if ([...els.device.options].some((option) => option.value === previous)) els.device.value = previous;
    setStatus(`Found ${devices.length} microphone input${devices.length === 1 ? "" : "s"}.`);
  } catch (error) {
    setStatus(String(error));
    els.micError.textContent = String(error);
  }
}

async function call(command, args = {}, statusMessage = "") {
  try {
    const result = await invoke(command, args);
    if (statusMessage) setStatus(statusMessage);
    return result;
  } catch (error) {
    const message = String(error);
    setStatus(message);
    throw error;
  }
}

function populateResolutions(snapshot) {
  if (resolutionPopulated || !snapshot?.resolutionPresets) return;
  resolutionPopulated = true;
  els.resolution.replaceChildren();
  for (const preset of snapshot.resolutionPresets) {
    const option = document.createElement("option");
    option.value = `${preset.width}x${preset.height}`;
    option.textContent = `${preset.label} · ${preset.width}×${preset.height}${preset.supported ? "" : " · unsupported"}`;
    option.disabled = !preset.supported;
    option.dataset.mib = preset.approximateMebibytes.toFixed(1);
    els.resolution.append(option);
  }
  const current = `${snapshot.renderWidth}x${snapshot.renderHeight}`;
  if ([...els.resolution.options].some((option) => option.value === current)) els.resolution.value = current;
  updateResolutionNote();
}

function updateResolutionNote() {
  const option = els.resolution.selectedOptions[0];
  if (!option) return;
  els.resolutionNote.innerHTML = `<strong>${option.textContent.split(" · ")[0]}</strong><br>${option.value.replace("x", " × ")} authoritative RGBA target · approximately ${option.dataset.mib || "—"} MiB for one texture.`;
}

function updateUI(renderer, audio) {
  latestRenderer = renderer;
  latestAudio = audio;
  populateResolutions(renderer);

  els.micBadge.textContent = audio.running ? "LIVE" : "IDLE";
  els.micBadge.className = `badge ${audio.running ? "live" : "idle"}`;
  els.micError.textContent = audio.lastError || "";
  els.analysisRate.textContent = `${Number(audio.analysisFps || 0).toFixed(1)} Hz`;
  els.rms.textContent = format3(audio.rms);
  els.peak.textContent = format3(audio.peak);
  els.bass.textContent = format3(audio.bass);
  els.mid.textContent = format3(audio.mid);
  els.treble.textContent = format3(audio.treble);
  els.beat.textContent = String(audio.beatCount || 0);

  els.adapter.textContent = renderer.adapterName || "—";
  els.backend.textContent = renderer.backend || "—";
  els.fps.textContent = Number(renderer.fps || 0).toFixed(1);
  els.frameTime.textContent = `${Number(renderer.frameTimeMs || 0).toFixed(2)} ms`;
  els.renderSize.textContent = `${renderer.renderWidth}×${renderer.renderHeight}`;
  els.windowSize.textContent = `${renderer.windowWidth}×${renderer.windowHeight}`;
  els.micFormat.textContent = audio.running ? `${audio.sampleRate} Hz · ${audio.channels} ch · ${audio.sampleFormat}` : "—";
  els.buffer.textContent = Number(audio.samplesBuffered || 0).toLocaleString();
  els.callbackErrors.textContent = String(audio.callbackErrors || 0);
  els.maxTexture.textContent = `${renderer.maxTextureDimension2d}px`;
  els.rendererBadge.textContent = renderer.backend || "GPU";

  if (renderer.lastError) setStatus(renderer.lastError);
}

function drawSpectrum(frame, time) {
  const canvas = els.spectrumCanvas;
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#070909"; ctx.fillRect(0, 0, w, h);
  let spectrum = frame?.spectrum || [];
  if (!latestAudio?.running && els.demo.checked) {
    spectrum = Array.from({ length: 128 }, (_, i) => {
      const x = i / 127;
      return Math.min(1, Math.abs(Math.sin(x * 19 - time * 0.002)) ** 7 * (1 - x) + Math.abs(Math.sin(x * 61 + time * 0.001)) ** 13 * .35);
    });
  }
  const count = Math.min(spectrum.length, 128);
  for (let i = 0; i < count; i++) {
    const v = Math.max(0, Math.min(1, spectrum[Math.floor(i * spectrum.length / count)] || 0));
    const x = (i / count) * w;
    const barW = Math.max(1, w / count - 1);
    const barH = Math.max(1, v * (h - 8));
    const hue = 78 + (i / count) * 105;
    ctx.fillStyle = `hsl(${hue} 92% ${52 + v * 18}%)`;
    ctx.fillRect(x, h - barH, barW, barH);
  }
  ctx.strokeStyle = "rgba(255,255,255,.12)"; ctx.beginPath(); ctx.moveTo(0, h - .5); ctx.lineTo(w, h - .5); ctx.stroke();
}

function drawWave(frame, time) {
  const canvas = els.waveCanvas;
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.fillStyle = "#070909"; ctx.fillRect(0, 0, w, h);
  let wave = frame?.waveform || [];
  if (!latestAudio?.running && els.demo.checked) {
    wave = Array.from({ length: 256 }, (_, i) => Math.sin(i / 256 * Math.PI * 10 + time * .003) * .42 + Math.sin(i / 256 * Math.PI * 26 - time * .0015) * .14);
  }
  ctx.strokeStyle = "#55f2d0"; ctx.lineWidth = 1.5; ctx.beginPath();
  const count = Math.max(2, wave.length);
  for (let i = 0; i < count; i++) {
    const x = i / (count - 1) * w;
    const y = h * .5 - (wave[i] || 0) * h * .42;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,.1)"; ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
}

async function poll() {
  if (pollBusy) return;
  pollBusy = true;
  try {
    const [renderer, audio, frame] = await Promise.all([
      invoke("get_renderer_snapshot"),
      invoke("get_audio_snapshot"),
      invoke("get_audio_analysis_frame")
    ]);
    latestAnalysis = frame;
    updateUI(renderer, audio);
  } catch (error) {
    setStatus(String(error));
  } finally {
    pollBusy = false;
  }
}

function animationLoop(time) {
  drawSpectrum(latestAnalysis, time);
  drawWave(latestAnalysis, time);
  requestAnimationFrame(animationLoop);
}

els.refresh.addEventListener("click", refreshDevices);
els.start.addEventListener("click", async () => {
  els.micError.textContent = "";
  try { await call("start_microphone", { deviceName: els.device.value }, "Microphone start requested."); } catch (_) {}
});
els.stop.addEventListener("click", () => call("stop_microphone", {}, "Microphone stopped.").catch(() => {}));
els.demo.addEventListener("change", () => call("set_demo_when_idle", { enabled: els.demo.checked }).catch(() => {}));

function bindAudioSlider(element, output, name, formatter) {
  const update = () => { output.textContent = formatter(Number(element.value)); };
  element.addEventListener("input", () => {
    update();
    call("set_audio_parameter", { name, value: Number(element.value) }).catch(() => {});
  });
  update();
}
bindAudioSlider(els.gain, els.gainOut, "gain", (v) => `${v.toFixed(2)}×`);
bindAudioSlider(els.smoothing, els.smoothOut, "smoothing", (v) => v.toFixed(2));
bindAudioSlider(els.threshold, els.thresholdOut, "beatThreshold", (v) => `${v.toFixed(2)}×`);
bindAudioSlider(els.hold, els.holdOut, "beatHoldMs", (v) => `${Math.round(v)} ms`);

function bindVisualSlider(element, output, name, formatter) {
  const update = () => { output.textContent = formatter(Number(element.value)); };
  element.addEventListener("input", () => {
    update();
    call("set_visual_parameter", { name, value: Number(element.value) }).catch(() => {});
  });
  update();
}
bindVisualSlider(els.reactivity, els.reactivityOut, "reactivity", (v) => `${v.toFixed(2)}×`);
bindVisualSlider(els.spin, els.spinOut, "spin", (v) => `${v.toFixed(2)} rad/s`);
bindVisualSlider(els.hue, els.hueOut, "hue", (v) => v.toFixed(2));

els.mode.addEventListener("change", () => call("set_visual_mode", { mode: Number(els.mode.value) }, `Visual: ${els.mode.selectedOptions[0].textContent}`).catch(() => {}));
els.resolution.addEventListener("change", async () => {
  updateResolutionNote();
  const [width, height] = els.resolution.value.split("x").map(Number);
  try { await call("set_render_resolution", { width, height }, `Native render target changed to ${width}×${height}.`); } catch (_) {}
});
els.previewMode.addEventListener("change", () => call("set_preview_mode", { mode: els.previewMode.value }).catch(() => {}));
els.fullscreen.addEventListener("click", () => call("toggle_renderer_fullscreen").catch(() => {}));
els.reset.addEventListener("click", () => call("reset_diagnostics", {}, "Diagnostics reset.").catch(() => {}));

window.addEventListener("DOMContentLoaded", async () => {
  await refreshDevices();
  await poll();
  setInterval(poll, 100);
  requestAnimationFrame(animationLoop);
  setStatus("Ready. Start a microphone or explore with the generated demo signal.");
});
