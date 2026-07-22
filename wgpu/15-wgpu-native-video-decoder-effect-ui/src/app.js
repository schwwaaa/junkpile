const invoke = window.__TAURI__.core.invoke;

const modeLabels = {
  clean: "Clean source",
  edge: "Edge extraction",
  lumaWarp: "Luma displacement",
  rgbSplit: "RGB separation",
  posterize: "Posterize",
  blocks: "Pixel blocks",
  scanlines: "Scanlines"
};

const sliders = [
  { name: "zoom", label: "Zoom", min: 0.2, max: 4, step: 0.01, value: 1, group: "global" },
  { name: "exposure", label: "Exposure", min: 0, max: 3, step: 0.01, value: 1, group: "global" },
  { name: "contrast", label: "Contrast", min: 0, max: 2.5, step: 0.01, value: 1, group: "global" },
  { name: "saturation", label: "Saturation", min: 0, max: 2.5, step: 0.01, value: 1, group: "global" },
  {
    name: "effectStrength",
    label: "Effect strength",
    min: 0,
    max: 3,
    step: 0.01,
    value: 1,
    group: "effect",
    modes: ["edge", "lumaWarp", "rgbSplit", "scanlines"]
  },
  {
    name: "chroma",
    label: "RGB separation (source px)",
    min: 0,
    max: 160,
    step: 1,
    value: 24,
    group: "effect",
    modes: ["rgbSplit"],
    activateMode: "rgbSplit"
  },
  {
    name: "blockSize",
    label: "Block size",
    min: 1,
    max: 96,
    step: 1,
    value: 12,
    group: "effect",
    modes: ["blocks"],
    activateMode: "blocks"
  },
  {
    name: "posterize",
    label: "Posterize levels",
    min: 2,
    max: 24,
    step: 1,
    value: 6,
    group: "effect",
    modes: ["posterize"],
    activateMode: "posterize"
  }
];

const $ = (selector) => document.querySelector(selector);
const sliderElements = new Map();
let seeking = false;

function showError(error) {
  $("#error").textContent = String(error ?? "Unknown error");
}

function createSlider(definition) {
  const wrapper = document.createElement("label");
  wrapper.className = "slider";
  wrapper.dataset.parameter = definition.name;
  wrapper.innerHTML = `
    <span>${definition.label}</span>
    <output id="${definition.name}-value">${definition.value}</output>
    <input
      id="${definition.name}"
      type="range"
      min="${definition.min}"
      max="${definition.max}"
      step="${definition.step}"
      value="${definition.value}"
    >`;

  const root = definition.group === "global" ? $("#global-sliders") : $("#effect-sliders");
  root.append(wrapper);

  const input = wrapper.querySelector("input");
  const output = wrapper.querySelector("output");
  sliderElements.set(definition.name, { definition, wrapper, input, output });

  input.addEventListener("input", async () => {
    output.value = input.value;

    // Defensive behavior for future UI changes: a parameter that belongs to one
    // specific effect automatically activates that effect when moved.
    if (definition.activateMode && $("#mode").value !== definition.activateMode) {
      await setProcessingMode(definition.activateMode);
    }

    invoke("set_param", { name: definition.name, value: Number(input.value) }).catch(showError);
  });
}

for (const definition of sliders) {
  createSlider(definition);
}

function updateEffectControls(mode) {
  const label = modeLabels[mode] ?? mode;
  const visible = [];

  for (const { definition, wrapper, input } of sliderElements.values()) {
    if (definition.group !== "effect") continue;
    const isVisible = definition.modes.includes(mode);
    wrapper.hidden = !isVisible;
    input.disabled = !isVisible;
    if (isVisible) visible.push(definition.label);
  }

  $("#active-effect-name").textContent = label;
  $("#processing-state").textContent = label;

  const noControls = visible.length === 0;
  $("#no-effect-controls").hidden = !noControls;
  $("#effect-sliders").hidden = noControls;

  if (mode === "clean") {
    $("#effect-control-hint").textContent = "Clean source is active. Choose a processing mode to reveal its controls.";
  } else if (visible.length === 1) {
    $("#effect-control-hint").textContent = `${visible[0]} is active for this processing mode.`;
  } else {
    $("#effect-control-hint").textContent = `${visible.join(" and ")} are active for this processing mode.`;
  }
}

async function setProcessingMode(mode) {
  $("#mode").value = mode;
  updateEffectControls(mode);
  await invoke("set_mode", { mode }).catch(showError);
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${remainder.toFixed(3).padStart(6, "0")}`;
}

async function poll() {
  try {
    const [video, renderer] = await Promise.all([
      invoke("get_video_status"),
      invoke("get_renderer_info")
    ]);
    $("#ffmpeg-state").textContent = video.ffmpegAvailable ? "available" : "missing";
    $("#playback-state").textContent = !video.loaded ? "no file" : video.playing ? "playing" : video.ended ? "ended" : "paused";
    $("#source-format").textContent = video.width ? `${video.width}×${video.height}` : "—";
    $("#gpu").textContent = renderer.backend;
    $("#decode-fps").textContent = video.decodeFps.toFixed(1);
    $("#render-fps").textContent = renderer.fps.toFixed(1);
    $("#file-name").textContent = video.fileName || "No video loaded";
    $("#codec-line").textContent = video.loaded ? `${video.codec} · ${video.sourceFps.toFixed(3)} FPS · ${formatTime(video.durationSeconds)}` : "Codec and duration appear after opening a file.";
    if (!seeking) {
      $("#timeline").max = Math.max(video.durationSeconds, 0.001);
      $("#timeline").value = Math.min(video.positionSeconds, video.durationSeconds || video.positionSeconds);
    }
    $("#time-display").value = `${formatTime(video.positionSeconds)} / ${formatTime(video.durationSeconds)}`;
    $("#ffmpeg-version").textContent = video.ffmpegVersion || "—";
    $("#file-path").textContent = video.filePath || "—";
    $("#codec").textContent = video.codec || "—";
    $("#pixel-format").textContent = video.pixelFormat || "—";
    $("#source-definition").textContent = video.width ? `${video.width}×${video.height}` : "—";
    $("#source-fps").textContent = video.sourceFps.toFixed(3);
    $("#active-decode-mode").textContent = video.decodeMode;
    $("#decode-time").textContent = `${video.decodeMs.toFixed(2)} ms`;
    $("#delivered-frames").textContent = video.deliveredFrames.toLocaleString();
    $("#decoder-restarts").textContent = video.decoderRestarts.toLocaleString();
    $("#uploaded-frames").textContent = renderer.uploadedFrames.toLocaleString();
    $("#skipped-frames").textContent = renderer.droppedBeforeUpload.toLocaleString();
    $("#frame-age").textContent = `${renderer.videoFrameAgeMs.toFixed(1)} ms`;
    $("#render-target").textContent = `${renderer.width}×${renderer.height} ← ${renderer.sourceWidth}×${renderer.sourceHeight}`;
    $("#surface-format").textContent = `${renderer.surfaceFormat} · ${renderer.adapterName}`;
    $("#error").textContent = video.lastError || renderer.lastError || "";
  } catch (error) {
    showError(error);
  }
}

$("#open").addEventListener("click", () => invoke("open_video_file").catch(showError));
$("#play").addEventListener("click", () => invoke("play_video").catch(showError));
$("#pause").addEventListener("click", () => invoke("pause_video").catch(showError));
$("#stop").addEventListener("click", () => invoke("stop_video").catch(showError));
$("#step-back").addEventListener("click", () => invoke("step_video", { direction: -1 }).catch(showError));
$("#step-forward").addEventListener("click", () => invoke("step_video", { direction: 1 }).catch(showError));
$("#fullscreen").addEventListener("click", () => invoke("toggle_renderer_fullscreen").catch(showError));
$("#rate").addEventListener("change", (event) => invoke("set_playback_rate", { rate: Number(event.target.value) }).catch(showError));
$("#decode-mode").addEventListener("change", (event) => invoke("set_decode_mode", { mode: event.target.value }).catch(showError));
$("#loop").addEventListener("change", (event) => invoke("set_video_loop", { looping: event.target.checked }).catch(showError));
$("#mode").addEventListener("change", (event) => setProcessingMode(event.target.value));
$("#fit").addEventListener("change", (event) => invoke("set_fit_mode", { mode: event.target.value }).catch(showError));
$("#filter").addEventListener("change", (event) => invoke("set_filter_mode", { mode: event.target.value }).catch(showError));
$("#rotation").addEventListener("change", (event) => invoke("set_rotation", { rotation: Number(event.target.value) }).catch(showError));
$("#mirror").addEventListener("change", (event) => invoke("set_mirror", { mirrored: event.target.checked }).catch(showError));

$("#timeline").addEventListener("pointerdown", () => { seeking = true; });
$("#timeline").addEventListener("input", (event) => {
  $("#time-display").value = `${formatTime(Number(event.target.value))} / ${formatTime(Number(event.target.max))}`;
});
async function commitSeek() {
  const seconds = Number($("#timeline").value);
  seeking = false;
  await invoke("seek_video", { seconds }).catch(showError);
}
$("#timeline").addEventListener("change", commitSeek);

$("#reset").addEventListener("click", async () => {
  await invoke("reset_params").catch(showError);
  for (const definition of sliders) {
    const elements = sliderElements.get(definition.name);
    elements.input.value = definition.value;
    elements.output.value = definition.value;
  }
  $("#fit").value = "cover";
  $("#filter").value = "linear";
  $("#rotation").value = "0";
  $("#mirror").checked = false;
  $("#mode").value = "clean";
  updateEffectControls("clean");
});

updateEffectControls($("#mode").value);
poll();
setInterval(poll, 400);
