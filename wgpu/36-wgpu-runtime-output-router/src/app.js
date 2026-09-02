const invoke = window.__TAURI__.core.invoke;
const byId = (id) => document.getElementById(id);
let snapshot = null;
let profileStatus = null;
let busy = false;

const fmt = (value) => Number(value || 0).toLocaleString();
const stateClass = (state) => {
  const value = String(state || "idle").toLowerCase();
  if (value.includes("error")) return "error";
  if (value.includes("record") || value.includes("send") || value.includes("complete")) return "complete";
  if (value.includes("final") || value.includes("start")) return "warning";
  return "";
};
const activeProfile = () => profileStatus?.profiles?.find((profile) => profile.id === profileStatus.activeProfileId);
const selectedProfile = () => profileStatus?.profiles?.find((profile) => profile.id === byId("profileSelect").value);

function populateProfiles() {
  if (!profileStatus) return;
  const select = byId("profileSelect");
  const chosen = select.value || profileStatus.activeProfileId;
  select.innerHTML = "";
  for (const profile of profileStatus.profiles) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = `[${profile.hotkey}] ${profile.label}`;
    select.appendChild(option);
  }
  select.value = profileStatus.profiles.some((p) => p.id === chosen) ? chosen : profileStatus.activeProfileId;
  updateProfileView();
}

function updateProfileView() {
  const profile = selectedProfile();
  if (!profile) return;
  byId("profileDescription").textContent = profile.description;
  byId("hotkeyNotice").textContent = `Hotkey ${profile.hotkey} arms this route. Profiles are startup/route declarations; saving JSON does not silently start a sink.`;
  const routeNames = [];
  if (profile.preview.enabled) routeNames.push("preview");
  if (profile.ndi.enabled) routeNames.push("NDI");
  if (profile.recording.enabled) routeNames.push(profile.recording.codec === "prores" ? "ProRes" : "H.264");
  byId("routeBadge").textContent = routeNames.join(" + ") || "offscreen only";
  byId("previewNode").classList.toggle("disabled", !profile.preview.enabled);
  byId("ndiNode").classList.toggle("disabled", !profile.ndi.enabled);
  byId("recordNode").classList.toggle("disabled", !profile.recording.enabled);
  byId("previewDetail").textContent = profile.preview.enabled ? "enabled" : "hidden";
  byId("ndiDetail").textContent = profile.ndi.enabled ? `${profile.ndi.fpsN / profile.ndi.fpsD} fps · ${profile.ndi.name}` : "disabled";
  byId("recordDetail").textContent = profile.recording.enabled ? `${profile.recording.codec} · ${profile.recording.fps} fps` : "disabled";
}

function setProfiles(status) {
  const changed = !profileStatus || profileStatus.generation !== status.generation;
  profileStatus = status;
  if (changed) populateProfiles();
  byId("activeBadge").textContent = activeProfile()?.label || status.activeProfileId;
  byId("watcherBadge").textContent = status.watching ? "watching" : "stopped";
  byId("watcherBadge").className = `badge ${status.watching ? "complete" : "error"}`;
  byId("configGeneration").textContent = fmt(status.generation);
  byId("schemaVersion").textContent = status.schemaVersion;
  byId("profileCount").textContent = fmt(status.profiles.length);
  byId("lastConfigEvent").textContent = status.lastEvent || "—";
  byId("configPath").textContent = status.configPath;
  byId("configError").textContent = status.lastError || "";
}

function setSnapshot(next) {
  snapshot = next;
  const { renderer, sourceFrame, recording, ndi, ffmpeg, preview } = next;
  const recordingState = String(recording.state || "idle").toLowerCase();
  const healthy = renderer.running && !renderer.lastError && !recording.lastError && !ndi.lastError;
  byId("statusDot").className = `dot ${healthy ? "good" : "bad"}`;
  byId("statusText").textContent = renderer.lastError || recording.lastError || ndi.lastError || "router running";
  byId("frameCounter").textContent = `frame ${fmt(renderer.frameCount)}`;
  byId("sourceNode").textContent = `${fmt(sourceFrame.width)} × ${fmt(sourceFrame.height)} · RGBA`;
  byId("contractSummary").textContent = next.contractSummary;

  byId("ndiBadge").textContent = ndi.state;
  byId("ndiBadge").className = `badge ${stateClass(ndi.state)}`;
  byId("ndiName").textContent = ndi.name;
  byId("ndiFormat").textContent = `${fmt(ndi.width)} × ${fmt(ndi.height)} · ${(ndi.fpsN / ndi.fpsD).toFixed(2)} fps · BGRA`;
  byId("ndiRequests").textContent = fmt(ndi.captureRequests);
  byId("ndiReadbacks").textContent = fmt(ndi.readbacksCompleted);
  byId("ndiSent").textContent = fmt(ndi.framesSent);
  byId("ndiGpuDrops").textContent = fmt(ndi.droppedGpu);
  byId("ndiCpuDrops").textContent = fmt(ndi.droppedCpuPool);
  byId("ndiWorkerDrops").textContent = fmt(ndi.droppedWorker);
  byId("ndiPending").textContent = fmt(ndi.pendingWorker);
  byId("ndiTraffic").textContent = `${Number(ndi.rawMegabytesPerSecond || 0).toFixed(1)} MiB/s`;
  byId("ndiError").textContent = ndi.lastError || "";
  byId("ndiLog").textContent = ndi.lastLog || "";

  byId("recordingBadge").textContent = recordingState;
  byId("recordingBadge").className = `badge ${stateClass(recordingState)}`;
  byId("recordingFormat").textContent = `${fmt(recording.width)} × ${fmt(recording.height)} · ${recording.fps} fps · ${recording.profile}`;
  byId("encodedFrames").textContent = fmt(recording.encodedFrames);
  byId("recordDrops").textContent = `${fmt(recording.droppedGpu)} / ${fmt(recording.droppedPacker)} / ${fmt(recording.droppedWorker)}`;
  byId("delivery").textContent = `${Number(recording.deliveryPercent || 0).toFixed(2)}%`;
  byId("jitter").textContent = `${Number(recording.captureJitterP95Ms || 0).toFixed(2)} ms`;
  byId("recordQueue").textContent = `${Number(recording.queueUtilizationPercent || 0).toFixed(0)}%`;
  byId("outputPath").textContent = recording.outputPath || "—";
  byId("recordingError").textContent = recording.lastError || "";

  byId("outputDirectory").textContent = recording.outputDirectory || "—";
  byId("ffmpegBadge").textContent = ffmpeg.available ? "FFmpeg available" : "FFmpeg missing";
  byId("ffmpegBadge").className = `badge ${ffmpeg.available ? "complete" : "error"}`;
  byId("ffmpegError").textContent = ffmpeg.error || "";

  byId("rendererBadge").textContent = renderer.running ? "running" : "stopped";
  byId("rendererBadge").className = `badge ${renderer.running ? "complete" : "error"}`;
  byId("adapter").textContent = renderer.adapterName;
  byId("backend").textContent = renderer.backend;
  byId("sourceResolution").textContent = `${fmt(sourceFrame.width)} × ${fmt(sourceFrame.height)}`;
  byId("rendererFps").textContent = Number(renderer.fps || 0).toFixed(1);
  byId("frameTime").textContent = `${Number(renderer.frameTimeMs || 0).toFixed(2)} ms`;
  byId("gpuLimit").textContent = `${fmt(renderer.maxTextureDimension2d)} × ${fmt(renderer.maxTextureDimension2d)}`;
  byId("rendererError").textContent = renderer.lastError || "";

  const profile = activeProfile();
  if (profile) {
    byId("previewDetail").textContent = profile.preview.enabled ? `${fmt(preview.width)} × ${fmt(preview.height)} · active` : "hidden; offscreen render continues";
  }
  updateButtons();
}

function updateButtons() {
  if (!snapshot || !profileStatus) return;
  const profile = activeProfile();
  const recordingState = String(snapshot.recording.state || "idle").toLowerCase();
  const recordingBusy = recordingState === "recording" || recordingState === "finalizing";
  const anyOutput = recordingBusy || snapshot.ndi.active;
  byId("armButton").disabled = busy || anyOutput;
  byId("startAllButton").disabled = busy || anyOutput || (!profile?.recording.enabled && !profile?.ndi.enabled);
  byId("stopAllButton").disabled = busy || !anyOutput;
  byId("startRecordButton").disabled = busy || recordingBusy || !profile?.recording.enabled;
  byId("stopRecordButton").disabled = busy || !recordingBusy;
  byId("startNdiButton").disabled = busy || snapshot.ndi.active || !profile?.ndi.enabled;
  byId("stopNdiButton").disabled = busy || !snapshot.ndi.active;
  byId("chooseOutputFolderButton").disabled = busy || recordingBusy;
  byId("resetOutputFolderButton").disabled = busy || recordingBusy;
}

async function refresh() {
  try {
    const [nextSnapshot, nextProfiles] = await Promise.all([
      invoke("get_runtime_snapshot"),
      invoke("get_profile_status"),
    ]);
    setProfiles(nextProfiles);
    setSnapshot(nextSnapshot);
  } catch (error) {
    byId("statusDot").className = "dot bad";
    byId("statusText").textContent = String(error);
  }
}

async function action(command, args = {}) {
  if (busy) return;
  busy = true;
  updateButtons();
  try {
    const result = await invoke(command, args);
    byId("actionMessage").textContent = typeof result === "string" ? result : `${command} complete`;
    await new Promise((resolve) => setTimeout(resolve, 120));
    await refresh();
  } catch (error) {
    byId("actionMessage").textContent = String(error);
    byId("statusDot").className = "dot bad";
  } finally {
    busy = false;
    updateButtons();
  }
}

byId("profileSelect").addEventListener("change", updateProfileView);
byId("armButton").addEventListener("click", () => action("select_io_profile", { profileId: byId("profileSelect").value }));
byId("startAllButton").addEventListener("click", () => action("start_profile_outputs"));
byId("stopAllButton").addEventListener("click", () => action("stop_all_outputs"));
byId("startRecordButton").addEventListener("click", () => action("start_profile_recording"));
byId("stopRecordButton").addEventListener("click", () => action("stop_recording"));
byId("startNdiButton").addEventListener("click", () => action("start_profile_ndi"));
byId("stopNdiButton").addEventListener("click", () => action("stop_ndi"));
byId("showPreviewButton").addEventListener("click", () => action("show_renderer_window"));
byId("fullscreenButton").addEventListener("click", () => action("toggle_renderer_fullscreen"));
byId("resetMetricsButton").addEventListener("click", () => action("reset_router_metrics"));
byId("chooseOutputFolderButton").addEventListener("click", () => action("select_recording_output_folder"));
byId("recordingsButton").addEventListener("click", () => action("open_recordings_folder"));
byId("resetOutputFolderButton").addEventListener("click", () => action("reset_recording_output_folder"));
byId("reloadButton").addEventListener("click", () => action("reload_io_profiles"));
byId("restoreButton").addEventListener("click", () => action("restore_io_profiles"));
byId("configFolderButton").addEventListener("click", () => action("open_profile_config_folder"));

document.addEventListener("keydown", async (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey || ["INPUT", "SELECT", "TEXTAREA"].includes(event.target.tagName)) return;
  const profile = profileStatus?.profiles?.find((item) => item.hotkey.toLowerCase() === event.key.toLowerCase());
  if (!profile) return;
  event.preventDefault();
  byId("profileSelect").value = profile.id;
  updateProfileView();
  await action("select_io_profile", { profileId: profile.id });
});

refresh();
setInterval(refresh, 350);
