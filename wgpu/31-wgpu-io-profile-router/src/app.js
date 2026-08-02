const invoke = window.__TAURI__.core.invoke;
const byId = (id) => document.getElementById(id);
let snapshot = null;
let profileStatus = null;
let busy = false;
let initializedProfiles = false;

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let size = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && size >= 1024; index += 1) {
    size /= 1024;
    unit = units[index];
  }
  return `${size.toFixed(size >= 100 ? 0 : size >= 10 ? 1 : 2)} ${unit}`;
}

function prettyState(value) {
  return String(value || "idle").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase());
}

function stateClass(value) {
  return String(value || "idle").toLowerCase();
}

function activeProfile() {
  return profileStatus?.profiles?.find((profile) => profile.id === profileStatus.activeProfileId) || null;
}

function selectedProfile() {
  return profileStatus?.profiles?.find((profile) => profile.id === byId("profileSelect").value) || null;
}

function estimate(profile) {
  if (!profile) return null;
  const { width, height } = profile.frame;
  const fps = profile.recording.fps;
  const packedFrame = width * height * 4;
  const paddedRow = Math.ceil((width * 4) / 256) * 256;
  const paddedFrame = paddedRow * height;
  const gpuBytes = packedFrame * 2 + paddedFrame * 2;
  const cpuBytes = profile.recording.enabled ? packedFrame * 2 : 0;
  return {
    packedFrame,
    rawPerSecond: profile.recording.enabled ? packedFrame * fps : 0,
    gpuBytes,
    cpuBytes,
    peakBytes: gpuBytes + cpuBytes + packedFrame,
  };
}

function resolutionLabel(width) {
  if (width >= 7680) return "8K";
  if (width >= 5120) return "5K";
  if (width >= 3840) return "4K";
  if (width >= 2560) return "1440p";
  return "1080p";
}

function populateProfiles() {
  if (!profileStatus) return;
  const select = byId("profileSelect");
  const previous = select.value;
  const ids = new Set(profileStatus.profiles.map((profile) => profile.id));
  select.innerHTML = "";
  for (const profile of profileStatus.profiles) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.label;
    select.appendChild(option);
  }
  if (previous && ids.has(previous)) select.value = previous;
  else select.value = profileStatus.activeProfileId;
  initializedProfiles = true;
}

function updateProfileView() {
  const selected = selectedProfile();
  const active = activeProfile();
  if (!selected || !active) return;
  const armed = selected.id === active.id;
  const workload = estimate(active);
  const extreme = active.frame.width > 3840;

  byId("profileDescription").textContent = selected.description;
  byId("activeBadge").textContent = `armed · ${active.label}`;
  byId("activeBadge").className = "badge complete";
  byId("selectionNotice").textContent = armed
    ? "The selected profile is armed. Starting the file route will use these exact validated settings."
    : `“${selected.label}” is selected but not armed. Click Arm selected profile before recording.`;
  byId("selectionNotice").className = `notice ${armed ? "good-text" : "warning-text"}`;

  byId("routeSource").textContent = `${formatNumber(active.frame.width)} × ${formatNumber(active.frame.height)} · renderer 60 Hz`;
  byId("routeCodec").textContent = active.recording.enabled ? active.recording.codec.toUpperCase() : "disabled";
  byId("routeFileDetail").textContent = active.recording.enabled
    ? `${active.frame.width} × ${active.frame.height} · ${active.recording.fps} fps`
    : "preview-only profile";
  byId("fileNode").className = `node file ${active.recording.enabled ? "enabled" : "disabled"}`;
  byId("routeBadge").textContent = active.recording.enabled ? "preview + file" : "preview only";
  byId("routeBadge").className = `badge ${active.recording.enabled ? "complete" : "idle"}`;

  byId("resourceBadge").textContent = resolutionLabel(active.frame.width);
  byId("resourceBadge").className = `badge ${extreme ? "warning" : "complete"}`;
  byId("estimateFrame").textContent = formatBytes(workload.packedFrame);
  byId("estimateThroughput").textContent = active.recording.enabled ? `${formatBytes(workload.rawPerSecond)}/s` : "not routed to CPU";
  byId("estimateGpu").textContent = formatBytes(workload.gpuBytes);
  byId("estimateCpu").textContent = formatBytes(workload.cpuBytes);
  byId("estimatePeak").textContent = formatBytes(workload.peakBytes);
  byId("resourceWarning").textContent = extreme
    ? `${resolutionLabel(active.frame.width)} is a capability profile. Real-time success depends on GPU readback, memory bandwidth, FFmpeg, and disk throughput.`
    : "";
  updateControls();
}

function updateControls() {
  const recordingState = snapshot?.recording?.state || "idle";
  const recording = recordingState === "recording";
  const finalizing = recordingState === "finalizing";
  const active = activeProfile();
  const selected = selectedProfile();
  const armed = Boolean(active && selected && active.id === selected.id);
  const ffmpegAvailable = snapshot?.ffmpeg?.available !== false;
  const gpuLimit = Number(snapshot?.renderer?.maxTextureDimension2d || 8192);
  const withinGpuLimit = !active || (active.frame.width <= gpuLimit && active.frame.height <= gpuLimit);

  byId("profileSelect").disabled = busy || recording || finalizing;
  byId("armButton").disabled = busy || recording || finalizing || armed;
  byId("startButton").disabled = busy || recording || finalizing || !armed || !active?.recording?.enabled || !ffmpegAvailable || !withinGpuLimit;
  byId("stopButton").disabled = busy || !recording;
  for (const id of ["reloadButton", "restoreButton", "configFolderButton", "recordingsButton", "fullscreenButton"]) {
    byId(id).disabled = busy;
  }
  if (active && !withinGpuLimit) {
    byId("resourceWarning").textContent = `${active.frame.width} × ${active.frame.height} exceeds this GPU's max 2D texture dimension of ${gpuLimit}.`;
  }
}

function setProfileStatus(status) {
  const oldGeneration = profileStatus?.generation;
  profileStatus = status;
  if (!initializedProfiles || oldGeneration !== status.generation) populateProfiles();
  byId("watcherBadge").textContent = status.watching ? "watching" : "stopped";
  byId("watcherBadge").className = `badge ${status.watching ? "complete" : "error"}`;
  byId("configGeneration").textContent = formatNumber(status.generation);
  byId("schemaVersion").textContent = status.schemaVersion;
  byId("profileCount").textContent = formatNumber(status.profiles.length);
  byId("lastConfigEvent").textContent = status.lastEvent || "—";
  byId("configPath").textContent = status.configPath;
  byId("configPath").title = status.configPath;
  byId("configError").textContent = status.lastError || "";
  updateProfileView();
}

function setSnapshot(next) {
  snapshot = next;
  const { renderer, recording, ffmpeg, recordingFrame, sourceFrame } = next;
  const state = stateClass(recording.state);
  const healthy = renderer.running && !renderer.lastError && !recording.lastError;

  byId("statusDot").className = `dot ${healthy ? "good" : "bad"}`;
  byId("statusText").textContent = recording.lastError || renderer.lastError || `${prettyState(recording.state)} · profile-routed recorder`;
  byId("frameCounter").textContent = `frame ${formatNumber(renderer.frameCount)}`;
  byId("contractSummary").textContent = "The armed JSON profile chooses one authoritative native frame contract and routes it to the GPU preview plus an optional bounded FFmpeg file sink. Invalid profile edits never replace the active last-known-good list.";

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
  byId("dropBadge").textContent = `${formatNumber(recording.droppedTotal)} drops`;
  byId("dropBadge").className = `badge ${recording.droppedTotal > 0 ? "warning" : "complete"}`;

  byId("verification").textContent = recording.verification || "No completed recording yet.";
  byId("ffmpegLog").textContent = recording.ffmpegLog ? `Latest FFmpeg message: ${recording.ffmpegLog}` : "";
  byId("ffmpegBadge").textContent = ffmpeg.available ? "available" : "missing";
  byId("ffmpegBadge").className = `badge ${ffmpeg.available ? "complete" : "error"}`;
  byId("ffmpegError").textContent = ffmpeg.error || "";

  byId("rendererState").textContent = renderer.running ? "running" : "stopped";
  byId("rendererState").className = `badge ${renderer.running ? "complete" : "error"}`;
  byId("backend").textContent = renderer.backend;
  byId("adapter").textContent = renderer.adapterName;
  byId("gpuLimit").textContent = `${formatNumber(renderer.maxTextureDimension2d)} × ${formatNumber(renderer.maxTextureDimension2d)}`;
  byId("windowSize").textContent = `${formatNumber(renderer.windowWidth)} × ${formatNumber(renderer.windowHeight)}`;
  byId("measuredFps").textContent = Number(renderer.fps || 0).toFixed(1);
  byId("frameTime").textContent = `${Number(renderer.frameTimeMs || 0).toFixed(2)} ms`;
  updateControls();
}

async function refresh() {
  try {
    const [nextSnapshot, nextProfiles] = await Promise.all([
      invoke("get_runtime_snapshot"),
      invoke("get_profile_status"),
    ]);
    setSnapshot(nextSnapshot);
    setProfileStatus(nextProfiles);
  } catch (error) {
    console.error(error);
    byId("statusDot").className = "dot bad";
    byId("statusText").textContent = String(error);
  }
}

async function action(command, args = {}) {
  if (busy) return null;
  busy = true;
  updateControls();
  try {
    const result = await invoke(command, args);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await refresh();
    return result;
  } catch (error) {
    console.error(command, error);
    byId("statusDot").className = "dot bad";
    byId("statusText").textContent = String(error);
    return null;
  } finally {
    busy = false;
    updateControls();
  }
}

byId("profileSelect").addEventListener("change", updateProfileView);
byId("armButton").addEventListener("click", () => action("select_io_profile", { profileId: byId("profileSelect").value }));
byId("startButton").addEventListener("click", () => action("start_profile_recording"));
byId("stopButton").addEventListener("click", () => action("stop_recording"));
byId("reloadButton").addEventListener("click", () => action("reload_io_profiles"));
byId("restoreButton").addEventListener("click", () => action("restore_io_profiles"));
byId("configFolderButton").addEventListener("click", () => action("open_profile_config_folder"));
byId("recordingsButton").addEventListener("click", () => action("open_recordings_folder"));
byId("fullscreenButton").addEventListener("click", () => action("toggle_renderer_fullscreen"));

refresh();
setInterval(refresh, 350);
