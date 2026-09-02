const invoke = window.__TAURI__.core.invoke;
const $ = (id) => document.getElementById(id);
let audioMode = "none";
let selectedAudioFile = null;
let runtime = null;
let av = null;
let busy = false;

function formatBytes(value) {
  let bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB"];
  let unit = units[0];
  bytes /= 1024;
  for (let i = 1; i < units.length && bytes >= 1024; i += 1) { bytes /= 1024; unit = units[i]; }
  return `${bytes.toFixed(bytes >= 100 ? 0 : bytes >= 10 ? 1 : 2)} ${unit}`;
}

function setMode(mode) {
  audioMode = mode;
  document.querySelectorAll(".mode").forEach((button) => button.classList.toggle("active", button.dataset.mode === mode));
  $("micPanel").classList.toggle("hidden", mode !== "microphone");
  $("filePanel").classList.toggle("hidden", mode !== "file");
  $("audioDescription").textContent = mode === "none" ? "Video only." : mode === "microphone" ? "Live microphone will be captured with the video." : "Selected audio file will be muxed with the finished video.";
  updateControls();
}

async function refreshMicrophones() {
  try {
    const devices = await invoke("list_microphones");
    const select = $("microphone");
    const previous = select.value;
    select.innerHTML = "";
    for (const device of devices) {
      const option = document.createElement("option");
      option.value = device.name;
      option.textContent = `${device.name}${device.isDefault ? " · default" : ""}`;
      select.appendChild(option);
    }
    if (previous && devices.some((device) => device.name === previous)) select.value = previous;
    if (!devices.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No microphone inputs found";
      select.appendChild(option);
    }
  } catch (error) {
    showError(error);
  }
  updateControls();
}

async function chooseAudioFile() {
  try {
    const info = await invoke("select_audio_file");
    if (!info) return;
    selectedAudioFile = info;
    $("audioFilePath").textContent = info.path;
    $("audioFileCodec").textContent = info.codec || "—";
    $("audioFileRate").textContent = info.sampleRate ? `${info.sampleRate.toLocaleString()} Hz` : "—";
    $("audioFileChannels").textContent = info.channels || "—";
    $("audioFileDuration").textContent = info.durationSeconds ? `${info.durationSeconds.toFixed(2)} s` : "unknown";
    showError("");
  } catch (error) {
    showError(error);
  }
  updateControls();
}

function selectedVideoSettings() {
  const [width, height] = $("resolution").value.split("x").map(Number);
  return { width, height, fps: Number($("fps").value), codec: $("codec").value, workerDelayMs: Number($("workerDelay").value) };
}

async function startRecording() {
  busy = true; updateControls(); showError("");
  try {
    const settings = selectedVideoSettings();
    await invoke("start_av_recording", {
      ...settings,
      audioMode,
      microphoneDevice: $("microphone").value || "",
      audioFile: selectedAudioFile?.path || "",
    });
  } catch (error) { showError(error); }
  busy = false; updateControls();
}

async function stopRecording() {
  busy = true; updateControls(); showError("");
  try { await invoke("stop_av_recording"); }
  catch (error) { showError(error); }
  busy = false; updateControls();
}

function showError(error) { $("error").textContent = error ? String(error) : ""; }

function updateControls() {
  const avState = av?.state || "idle";
  const videoState = runtime?.recording?.state || "idle";
  const recording = avState === "recording" || videoState === "recording";
  const finalizing = avState === "finalizing" || videoState === "finalizing";
  const fileReady = audioMode !== "file" || Boolean(selectedAudioFile?.valid);
  const micReady = audioMode !== "microphone" || Boolean($("microphone").value);
  const ffmpegReady = runtime?.ffmpeg?.available !== false;
  $("startButton").disabled = busy || recording || finalizing || !fileReady || !micReady || !ffmpegReady;
  $("stopButton").disabled = busy || !recording;
  for (const id of ["codec", "resolution", "fps", "workerDelay", "microphone", "refreshMics", "chooseAudio", "chooseOutputFolder", "resetOutputFolder"]) {
    $(id).disabled = busy || recording || finalizing;
  }
  document.querySelectorAll(".mode").forEach((button) => button.disabled = busy || recording || finalizing);
}

function updateView() {
  if (!runtime || !av) return;
  const r = runtime.recording;
  const mic = av.mic || {};
  $("stateBadge").textContent = av.state;
  $("stateBadge").className = `badge ${av.state}`;
  $("avBadge").textContent = av.state;
  $("avBadge").className = `badge ${av.state}`;
  $("videoBadge").textContent = r.state;
  $("videoBadge").className = `badge ${String(r.state).toLowerCase()}`;
  $("micBadge").textContent = mic.active ? "recording" : "idle";
  $("micBadge").className = `badge ${mic.active ? "recording" : "idle"}`;

  $("outputDirectory").textContent = r.outputDirectory || "—";
  $("sessionAudioMode").textContent = av.audioMode || "none";
  $("sessionAudioDescription").textContent = av.audioDescription || "Video only";
  $("videoIntermediate").textContent = av.videoIntermediate || "—";
  $("finalOutput").textContent = av.finalOutput || "—";
  $("muxResult").textContent = av.muxLog || "—";

  $("micDevice").textContent = mic.deviceName || "—";
  $("micFormat").textContent = mic.sampleRate ? `${mic.sampleRate.toLocaleString()} Hz · ${mic.channels} ch · ${mic.sampleFormat}` : "—";
  $("micElapsed").textContent = `${Number(mic.elapsedSeconds || 0).toFixed(2)} s`;
  $("micSamples").textContent = Number(mic.samplesWritten || 0).toLocaleString();
  $("micDrops").textContent = Number(mic.chunksDropped || 0).toLocaleString();
  $("micError").textContent = mic.lastError || "";

  $("targetFps").textContent = `${r.fps || 0} fps`;
  $("captureFps").textContent = `${Number(r.captureRateFps || 0).toFixed(1)} fps`;
  $("readbackFps").textContent = `${Number(r.readbackRateFps || 0).toFixed(1)} fps`;
  $("encodeFps").textContent = `${Number(r.encodeRateFps || 0).toFixed(1)} fps`;
  $("gpuDrops").textContent = Number(r.droppedGpu || 0).toLocaleString();
  $("packerDrops").textContent = Number(r.droppedPacker || 0).toLocaleString();
  $("workerDrops").textContent = Number(r.droppedWorker || 0).toLocaleString();
  $("delivery").textContent = `${Number(r.deliveryPercent || 0).toFixed(1)}%`;
  $("jitter").textContent = `${Number(r.captureJitterP95Ms || 0).toFixed(2)} ms`;
  $("queue").textContent = `${Number(r.queueUtilizationPercent || 0).toFixed(0)}%`;
  $("throughput").textContent = `${Number(r.actualRawMegabytesPerSecond || 0).toFixed(0)} MiB/s`;
  $("outputBytes").textContent = formatBytes(r.outputBytes || 0);
  $("diagnosticDetail").textContent = r.diagnosticDetail || "Start recording to analyze the selected format.";

  $("gpu").textContent = runtime.renderer.adapterName || "—";
  $("backend").textContent = runtime.renderer.backend || "—";
  $("rendererFps").textContent = `${Number(runtime.renderer.fps || 0).toFixed(1)} fps`;
  $("gpuLimit").textContent = `${Number(runtime.renderer.maxTextureDimension2d || 0).toLocaleString()} px`;
  $("ffmpeg").textContent = runtime.ffmpeg.available ? runtime.ffmpeg.version || "available" : runtime.ffmpeg.error || "unavailable";
  const errors = [av.lastError, r.lastError].filter(Boolean).join("\n");
  if (errors) showError(errors);
  updateControls();
}

async function poll() {
  try {
    [runtime, av] = await Promise.all([invoke("get_runtime_snapshot"), invoke("get_av_status")]);
    updateView();
  } catch (error) { showError(error); }
}

async function chooseOutputFolder() {
  try { await invoke("select_recording_output_folder"); await poll(); }
  catch (error) { showError(error); }
}

async function resetOutputFolder() {
  try { await invoke("reset_recording_output_folder"); await poll(); }
  catch (error) { showError(error); }
}

document.querySelectorAll(".mode").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));
$("refreshMics").addEventListener("click", refreshMicrophones);
$("chooseAudio").addEventListener("click", chooseAudioFile);
$("startButton").addEventListener("click", startRecording);
$("stopButton").addEventListener("click", stopRecording);
$("chooseOutputFolder").addEventListener("click", chooseOutputFolder);
$("resetOutputFolder").addEventListener("click", resetOutputFolder);
$("openOutputFolder").addEventListener("click", () => invoke("open_recordings_folder").catch(showError));
$("fullscreen").addEventListener("click", () => invoke("toggle_renderer_fullscreen").catch(showError));

await refreshMicrophones();
setMode("none");
await poll();
setInterval(poll, 250);
