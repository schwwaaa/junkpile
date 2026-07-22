const invoke = window.__TAURI__.core.invoke;

const byId = (id) => document.getElementById(id);
const modeNames = ["Spectrum bars", "Radial spectrum", "Oscilloscope", "Spectral field"];
let knownDevices = [];
let activeMode = 0;

function formatNumber(value, digits = 2) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "—";
}

function formatInteger(value) {
  return Number.isFinite(Number(value)) ? Math.round(Number(value)).toLocaleString() : "—";
}

function setMeter(name, value) {
  const normalized = Math.max(0, Math.min(1, Number(value) || 0));
  byId(`${name}Bar`).style.width = `${normalized * 100}%`;
  byId(`${name}Value`).textContent = formatNumber(value, 3);
}

function updateDeviceOptions(devices, selected) {
  const stable = JSON.stringify(devices) === JSON.stringify(knownDevices);
  const select = byId("audioDevice");
  if (!stable) {
    knownDevices = [...devices];
    select.replaceChildren();
    if (devices.length === 0) {
      const option = document.createElement("option");
      option.textContent = "No input devices found";
      option.value = "";
      select.append(option);
    } else {
      for (const name of devices) {
        const option = document.createElement("option");
        option.textContent = name;
        option.value = name;
        select.append(option);
      }
    }
  }
  if (selected && [...select.options].some((option) => option.value === selected)) {
    select.value = selected;
  }
}

async function pollAudio() {
  try {
    const info = await invoke("get_audio_info");
    updateDeviceOptions(info.devices || [], info.selectedDevice || "");
    byId("runtimeAudio").textContent = info.running ? `${info.selectedDevice || "Input"} · live` : "Stopped";
    byId("audioHost").textContent = info.host || "—";
    byId("audioFormat").textContent = info.sampleFormat || "—";
    byId("sampleRate").textContent = info.sampleRate ? `${formatInteger(info.sampleRate)} Hz` : "—";
    byId("channels").textContent = info.channels || "—";
    byId("audioError").textContent = info.lastError || "";
    byId("callbackCount").textContent = formatInteger(info.callbackCount);
    byId("capturedSamples").textContent = formatInteger(info.capturedSamples);
    byId("droppedChunks").textContent = formatInteger(info.droppedChunks);
    byId("streamErrors").textContent = formatInteger(info.streamErrors);
    byId("analysisFps").textContent = formatNumber(info.analysisFps, 1);
    setMeter("rms", info.rms);
    setMeter("peak", info.peak);
    setMeter("bass", info.bass);
    setMeter("lowMid", info.lowMid);
    setMeter("highMid", info.highMid);
    setMeter("treble", info.treble);
    byId("centroid").textContent = `${formatInteger(info.spectralCentroidHz)} Hz`;
    byId("transient").textContent = formatNumber(info.transient, 3);
    byId("startAudio").disabled = Boolean(info.running);
    byId("stopAudio").disabled = !info.running;
  } catch (error) {
    byId("audioError").textContent = String(error);
  }
}

async function pollRenderer() {
  try {
    const info = await invoke("get_renderer_info");
    activeMode = Number(info.mode) || 0;
    byId("runtimeBackend").textContent = info.backend || "—";
    byId("runtimeRenderer").textContent = `${info.width}×${info.height} · ${formatNumber(info.fps, 1)} FPS`;
    byId("runtimeMode").textContent = modeNames[activeMode] || "Unknown";
    byId("renderFps").textContent = formatNumber(info.fps, 1);
    byId("gpuSurface").textContent = `${info.surfaceFormat || "—"} · ${info.adapter || "—"}`;
    byId("audioSequence").textContent = formatInteger(info.audioSequence);
    document.querySelectorAll("[data-mode]").forEach((button) => {
      button.classList.toggle("active", Number(button.dataset.mode) === activeMode);
    });
  } catch (error) {
    byId("runtimeRenderer").textContent = String(error);
  }
}

function bindRange(id, command, name, digits) {
  const input = byId(id);
  const output = document.querySelector(`output[for="${id}"]`);
  let timer = null;
  const update = () => {
    output.textContent = Number(input.value).toFixed(digits);
    clearTimeout(timer);
    timer = setTimeout(() => {
      invoke(command, { name, value: Number(input.value) }).catch((error) => {
        byId("audioError").textContent = String(error);
      });
    }, 18);
  };
  input.addEventListener("input", update);
}

byId("refreshDevices").addEventListener("click", () => invoke("refresh_audio_devices"));
byId("startAudio").addEventListener("click", () => invoke("start_audio"));
byId("stopAudio").addEventListener("click", () => invoke("stop_audio"));
byId("audioDevice").addEventListener("change", (event) => {
  const name = event.target.value;
  if (name) invoke("select_audio_device", { name });
});
byId("fftSize").addEventListener("change", (event) => {
  invoke("set_fft_size", { size: Number(event.target.value) });
});

bindRange("inputGain", "set_analysis_param", "input_gain", 2);
bindRange("smoothing", "set_analysis_param", "smoothing", 2);
bindRange("gate", "set_analysis_param", "gate", 3);
bindRange("transientSensitivity", "set_analysis_param", "transient_sensitivity", 3);
bindRange("spectrumGain", "set_render_param", "spectrum_gain", 2);
bindRange("waveformGain", "set_render_param", "waveform_gain", 2);
bindRange("exposure", "set_render_param", "exposure", 2);
bindRange("hue", "set_render_param", "hue", 3);
bindRange("lineWidth", "set_render_param", "line_width", 1);
bindRange("zoom", "set_render_param", "zoom", 2);
bindRange("rotation", "set_render_param", "rotation", 2);

document.querySelectorAll("[data-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    const mode = Number(button.dataset.mode);
    invoke("set_visualization_mode", { mode });
  });
});

byId("rendererFullscreen").addEventListener("click", () => invoke("toggle_renderer_fullscreen"));
byId("resetVisual").addEventListener("click", async () => {
  await invoke("reset_visual_params");
  const defaults = {
    spectrumGain: 1.8,
    waveformGain: 1,
    exposure: 1.15,
    hue: 0.58,
    lineWidth: 2,
    zoom: 1,
    rotation: 0,
  };
  for (const [id, value] of Object.entries(defaults)) {
    const input = byId(id);
    input.value = String(value);
    input.dispatchEvent(new Event("input"));
  }
});

await pollAudio();
await pollRenderer();
setInterval(pollAudio, 120);
setInterval(pollRenderer, 220);
