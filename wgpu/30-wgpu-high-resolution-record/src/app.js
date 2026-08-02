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
  const units = ["KB", "MB", "GB", "TB"];
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

function selectedSettings() {
  const [width, height] = byId("resolutionSelect").value.split("x").map(Number);
  return {
    width,
    height,
    fps: Number(byId("fpsSelect").value),
  };
}

function estimateWorkload(width, height, fps) {
  const bytesPerPixel = 4;
  const packedFrame = width * height * bytesPerPixel;
  const packedRow = width * bytesPerPixel;
  const paddedRow = Math.ceil(packedRow / 256) * 256;
  const paddedFrame = paddedRow * height;
  const readbackSlots = 2;
  const workerQueue = 2;
  const gpuBytes = packedFrame * 2 + paddedFrame * readbackSlots;
  const cpuQueueBytes = packedFrame * workerQueue;
  const peakBytes = gpuBytes + cpuQueueBytes + packedFrame;
  const rawBytesPerSecond = packedFrame * fps;
  return { packedFrame, paddedFrame, gpuBytes, cpuQueueBytes, peakBytes, rawBytesPerSecond };
}

function resolutionLabel(width, height) {
  if (width >= 7680) return "8K";
  if (width >= 5120) return "5K";
  if (width >= 3840) return "4K";
  if (width >= 2560) return "1440p";
  return "1080p";
}

function updateEstimate() {
  const { width, height, fps } = selectedSettings();
  if (width >= 7680 && fps > 30) {
    byId("fpsSelect").value = "30";
    return updateEstimate();
  }
  const estimate = estimateWorkload(width, height, fps);
  const extreme = width > 3840 || height > 2160;
  byId("resourceBadge").textContent = resolutionLabel(width, height);
  byId("resourceBadge").className = `badge ${extreme ? "warning" : "complete"}`;
  byId("estimateFrame").textContent = formatBytes(estimate.packedFrame);
  byId("estimateThroughput").textContent = `${formatBytes(estimate.rawBytesPerSecond)}/s`;
  byId("estimateGpu").textContent = formatBytes(estimate.gpuBytes);
  byId("estimateCpu").textContent = formatBytes(estimate.cpuQueueBytes);
  byId("estimatePeak").textContent = formatBytes(estimate.peakBytes);
  byId("extremeAck").disabled = !extreme;
  if (!extreme) byId("extremeAck").checked = false;
  byId("resourceWarning").textContent = extreme
    ? `${resolutionLabel(width, height)} is a stress test. Real-time readback and encoding depend on GPU bandwidth, unified/system memory, and FFmpeg encoder speed.`
    : "";
  updateControls();
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
  const { width, height } = selectedSettings();
  const extreme = width > 3840 || height > 2160;
  const acknowledged = !extreme || byId("extremeAck").checked;
  const gpuLimit = Number(latestSnapshot?.renderer?.maxTextureDimension2d || 8192);
  const withinGpuLimit = width <= gpuLimit && height <= gpuLimit;

  byId("startButton").disabled = actionBusy || recording || finalizing || !ffmpegAvailable || !acknowledged || !withinGpuLimit;
  byId("stopButton").disabled = actionBusy || !recording;
  byId("profileSelect").disabled = actionBusy || recording || finalizing;
  byId("resolutionSelect").disabled = actionBusy || recording || finalizing;
  byId("fpsSelect").disabled = actionBusy || recording || finalizing;
  byId("delaySelect").disabled = actionBusy || recording || finalizing;
  byId("extremeAck").disabled = actionBusy || recording || finalizing || !extreme;
  byId("folderButton").disabled = actionBusy;
  byId("fullscreenButton").disabled = actionBusy;

  if (!withinGpuLimit) {
    byId("resourceWarning").textContent = `${width} × ${height} exceeds this GPU's reported max texture dimension of ${gpuLimit}.`;
  }
}

function setSnapshot(snapshot) {
  latestSnapshot = snapshot;
  const { renderer, recording, ffmpeg, recordingFrame, sourceFrame } = snapshot;
  const state = stateClass(recording.state);
  const healthy = renderer.running && !renderer.lastError && !recording.lastError;

  byId("statusDot").className = `dot ${healthy ? "good" : "bad"}`;
  byId("statusText").textContent = recording.lastError || renderer.lastError || `${prettyState(recording.state)} · high-resolution recorder`;
  byId("frameCounter").textContent = `frame ${formatNumber(renderer.frameCount)}`;
  byId("contractSummary").textContent = snapshot.contractSummary;

  byId("ffmpegBadge").textContent = ffmpeg.available ? "available" : "missing";
  byId("ffmpegBadge").className = `badge ${ffmpeg.available ? "complete" : "error"}`;
  byId("ffmpegExecutable").textContent = ffmpeg.executable || "—";
  byId("ffmpegVersion").textContent = ffmpeg.version || "—";
  byId("ffmpegError").textContent = ffmpeg.error || "";
  byId("gpuLimit").textContent = `${formatNumber(renderer.maxTextureDimension2d)} × ${formatNumber(renderer.maxTextureDimension2d)}`;

  byId("recordingBadge").textContent = prettyState(recording.state);
  byId("recordingBadge").className = `badge ${state}`;
  byId("recordingFormat").textContent = `${formatNumber(recordingFrame.width)} × ${formatNumber(recordingFrame.height)} · ${recordingFrame.nominalFps.numerator} fps`;
  byId("sourceResolution").textContent = `${formatNumber(sourceFrame.width)} × ${formatNumber(sourceFrame.height)}`;
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
  byId("slotsBusy").textContent = `${formatNumber(recording.readbackSlotsBusy)} / ${formatNumber(recording.readbackSlotCount)}`;
  byId("rawBytes").textContent = formatBytes(recording.rawBytesWritten);
  byId("rawRate").textContent = `${Number(recording.rawMegabytesPerSecond || 0).toFixed(1)} MiB/s`;
  byId("runtimePeak").textContent = formatBytes(recording.estimatedPeakBytes);
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

  updateEstimate();
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
  const { width, height, fps } = selectedSettings();
  const outputPath = await runAction("start_recording", {
    profile: byId("profileSelect").value,
    width,
    height,
    fps,
    workerDelayMs: Number(byId("delaySelect").value),
  });
  if (outputPath) byId("statusText").textContent = "high-resolution recording started";
});

byId("stopButton").addEventListener("click", () => runAction("stop_recording"));
byId("folderButton").addEventListener("click", () => runAction("open_recordings_folder"));
byId("fullscreenButton").addEventListener("click", () => runAction("toggle_renderer_fullscreen"));
byId("resolutionSelect").addEventListener("change", updateEstimate);
byId("fpsSelect").addEventListener("change", updateEstimate);
byId("extremeAck").addEventListener("change", updateControls);

updateEstimate();
refresh();
setInterval(refresh, 300);
