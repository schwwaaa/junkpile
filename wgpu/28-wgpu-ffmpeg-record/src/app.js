const invoke = window.__TAURI__.core.invoke;
const byId = (id) => document.getElementById(id);
let latestSnapshot = null;
let actionBusy = false;

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let size = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && size >= 1024; index += 1) {
    size /= 1024;
    unit = units[index];
  }
  return `${size.toFixed(size >= 100 ? 0 : size >= 10 ? 1 : 2)} ${unit}`;
}

function prettyState(value) {
  const text = String(value || "idle");
  return text.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase());
}

function stateClass(value) {
  return String(value || "idle").toLowerCase();
}

function isBusyState(state) {
  return state === "recording" || state === "finalizing";
}

function setActionBusy(next) {
  actionBusy = next;
  updateControls();
}

function updateControls() {
  const state = latestSnapshot?.recording?.state || "idle";
  const recording = state === "recording";
  const finalizing = state === "finalizing";
  const ffmpegAvailable = latestSnapshot?.ffmpeg?.available !== false;

  byId("startButton").disabled = actionBusy || recording || finalizing || !ffmpegAvailable;
  byId("stopButton").disabled = actionBusy || !recording;
  byId("profileSelect").disabled = actionBusy || recording || finalizing;
  byId("resolutionSelect").disabled = actionBusy || recording || finalizing;
  byId("fpsSelect").disabled = actionBusy || recording || finalizing;
  byId("delaySelect").disabled = actionBusy || recording || finalizing;
  byId("folderButton").disabled = actionBusy;
  byId("fullscreenButton").disabled = actionBusy;
}

function setSnapshot(snapshot) {
  latestSnapshot = snapshot;
  const { renderer, recording, ffmpeg, recordingFrame } = snapshot;
  const state = stateClass(recording.state);
  const healthy = renderer.running && !renderer.lastError && !recording.lastError;

  byId("statusDot").className = `dot ${healthy ? "good" : "bad"}`;
  byId("statusText").textContent = recording.lastError || renderer.lastError || `${prettyState(recording.state)} · recorder`;
  byId("frameCounter").textContent = `frame ${formatNumber(renderer.frameCount)}`;
  byId("contractSummary").textContent = snapshot.contractSummary;

  byId("ffmpegBadge").textContent = ffmpeg.available ? "available" : "missing";
  byId("ffmpegBadge").className = `badge ${ffmpeg.available ? "complete" : "error"}`;
  byId("ffmpegExecutable").textContent = ffmpeg.executable || "—";
  byId("ffmpegVersion").textContent = ffmpeg.version || "—";
  byId("ffmpegError").textContent = ffmpeg.error || "";

  byId("recordingBadge").textContent = prettyState(recording.state);
  byId("recordingBadge").className = `badge ${state}`;
  byId("recordingFormat").textContent = `${formatNumber(recordingFrame.width)} × ${formatNumber(recordingFrame.height)} · ${recordingFrame.nominalFps.numerator} fps`;
  byId("recordingProfile").textContent = recording.profile;
  byId("elapsed").textContent = `${Number(recording.elapsedSeconds || 0).toFixed(2)} s`;
  byId("outputPath").textContent = recording.outputPath || "—";
  byId("outputPath").title = recording.outputPath || "";
  byId("outputBytes").textContent = formatBytes(recording.outputBytes);
  byId("recordingError").textContent = recording.lastError || "";

  byId("captureRequests").textContent = formatNumber(recording.captureRequests);
  byId("readbacks").textContent = formatNumber(recording.readbacksCompleted);
  byId("encodedFrames").textContent = formatNumber(recording.encodedFrames);
  byId("gpuDrops").textContent = formatNumber(recording.droppedGpu);
  byId("workerDrops").textContent = formatNumber(recording.droppedWorker);
  byId("workerPending").textContent = formatNumber(recording.pendingWorker);
  byId("slotsBusy").textContent = `${formatNumber(recording.readbackSlotsBusy)} / 3`;
  byId("rawBytes").textContent = formatBytes(recording.rawBytesWritten);
  byId("dropBadge").textContent = `${formatNumber(recording.droppedTotal)} drops`;
  byId("dropBadge").className = `badge ${recording.droppedTotal > 0 ? "warning" : "complete"}`;

  byId("verification").textContent = recording.verification || "No completed recording yet.";
  byId("ffmpegLog").textContent = recording.ffmpegLog ? `Latest FFmpeg message: ${recording.ffmpegLog}` : "";

  byId("rendererState").textContent = renderer.running ? "running" : "stopped";
  byId("rendererState").className = `badge ${renderer.running ? "complete" : "error"}`;
  byId("backend").textContent = renderer.backend;
  byId("adapter").textContent = renderer.adapterName;
  byId("surface").textContent = renderer.surfaceFormat;
  byId("windowSize").textContent = `${formatNumber(renderer.windowWidth)} × ${formatNumber(renderer.windowHeight)}`;
  byId("measuredFps").textContent = Number(renderer.fps || 0).toFixed(1);
  byId("frameTime").textContent = `${Number(renderer.frameTimeMs || 0).toFixed(2)} ms`;

  updateControls();
}

async function refresh() {
  try {
    setSnapshot(await invoke("get_runtime_snapshot"));
  } catch (error) {
    console.error(error);
    byId("statusDot").className = "dot bad";
    byId("statusText").textContent = String(error);
  }
}

async function runAction(command, args = {}) {
  if (actionBusy) return null;
  setActionBusy(true);
  try {
    const result = await invoke(command, args);
    await new Promise((resolve) => setTimeout(resolve, 120));
    await refresh();
    return result;
  } catch (error) {
    console.error(command, error);
    byId("statusDot").className = "dot bad";
    byId("statusText").textContent = String(error);
    return null;
  } finally {
    setActionBusy(false);
  }
}

byId("startButton").addEventListener("click", async () => {
  const [width, height] = byId("resolutionSelect").value.split("x").map(Number);
  const outputPath = await runAction("start_recording", {
    profile: byId("profileSelect").value,
    width,
    height,
    fps: Number(byId("fpsSelect").value),
    workerDelayMs: Number(byId("delaySelect").value),
  });
  if (outputPath) {
    byId("statusText").textContent = "recording started";
  }
});

byId("stopButton").addEventListener("click", () => runAction("stop_recording"));
byId("folderButton").addEventListener("click", () => runAction("open_recordings_folder"));
byId("fullscreenButton").addEventListener("click", () => runAction("toggle_renderer_fullscreen"));

refresh();
setInterval(refresh, 300);
