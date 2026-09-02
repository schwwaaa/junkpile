const { invoke } = window.__TAURI__.core;
const byId = (id) => document.getElementById(id);
const fmt = (value) => Number(value || 0).toLocaleString();
let snapshot = null;
let profileStatus = null;
let applianceStatus = null;
let busy = false;

function stateClass(state) {
  const value = String(state || "").toLowerCase();
  if (["sending", "recording", "complete", "running"].includes(value)) return "complete";
  if (["starting", "waiting", "finalizing"].includes(value)) return "warning";
  if (["error", "unavailable"].includes(value)) return "error";
  return "";
}

function activeProfile() {
  return profileStatus?.profiles?.find((profile) => profile.id === profileStatus.activeProfileId) || null;
}

function selectedProfile() {
  const id = byId("profileSelect").value;
  return profileStatus?.profiles?.find((profile) => profile.id === id) || null;
}

function populateProfiles() {
  const select = byId("profileSelect");
  const chosen = select.value;
  select.innerHTML = "";
  for (const profile of profileStatus.profiles) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = `[${profile.hotkey}] ${profile.label}`;
    select.appendChild(option);
  }
  select.value = profileStatus.profiles.some((profile) => profile.id === chosen)
    ? chosen
    : profileStatus.activeProfileId;
  updateProfileView();
}

function updateProfileView() {
  const profile = selectedProfile();
  if (!profile) return;
  byId("profileDescription").textContent = profile.description;
  byId("hotkeyNotice").textContent = `Hotkey ${profile.hotkey} arms this route. Arming configures outputs but never starts them automatically.`;
  const routeNames = [];
  if (profile.preview.enabled) routeNames.push("preview");
  if (profile.ndi.enabled) routeNames.push("NDI");
  if (profile.platformShare.enabled) routeNames.push("Syphon/Spout");
  if (profile.recording.enabled) routeNames.push(profile.recording.codec === "prores" ? "ProRes" : "H.264");
  byId("routeBadge").textContent = routeNames.join(" + ") || "offscreen only";
  byId("previewNode").classList.toggle("disabled", !profile.preview.enabled);
  byId("ndiNode").classList.toggle("disabled", !profile.ndi.enabled);
  byId("platformNode").classList.toggle("disabled", !profile.platformShare.enabled);
  byId("recordNode").classList.toggle("disabled", !profile.recording.enabled);
  byId("previewDetail").textContent = profile.preview.enabled ? "enabled" : "hidden";
  byId("ndiDetail").textContent = profile.ndi.enabled
    ? `${(profile.ndi.fpsN / profile.ndi.fpsD).toFixed(2)} fps · ${profile.ndi.name}`
    : "disabled";
  byId("platformDetail").textContent = profile.platformShare.enabled
    ? `${(profile.platformShare.fpsN / profile.platformShare.fpsD).toFixed(2)} fps · ${profile.platformShare.name}`
    : "disabled";
  byId("recordDetail").textContent = profile.recording.enabled
    ? `${profile.recording.codec} · ${profile.recording.fps} fps`
    : "disabled";
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


function setAppliance(status) {
  applianceStatus = status;
  const healthy = !status.lastError;
  byId("applianceBadge").textContent = status.outputsActive ? "outputs active" : "runtime ready";
  byId("applianceBadge").className = `badge ${healthy ? "complete" : "error"}`;
  byId("applianceStartupProfile").textContent = status.startupProfile || "—";
  byId("applianceActiveProfile").textContent = status.activeProfile || "—";
  byId("applianceAutostart").textContent = status.autoStartOutputs ? "enabled" : "manual";
  byId("applianceControls").textContent = status.controlsVisible ? "visible" : "hidden";
  byId("appliancePreview").textContent = status.previewPolicy || "—";
  byId("applianceHeartbeat").textContent = `${fmt(status.heartbeatMs)} ms`;
  byId("applianceUptime").textContent = `${fmt(status.uptimeSeconds)} s`;
  byId("applianceOutputs").textContent = status.outputsActive ? "active" : "idle";
  byId("applianceConfigPath").textContent = status.configPath || "—";
  byId("applianceStatusPath").textContent = status.statusPath || "—";
  byId("applianceCli").textContent = status.cliOverrides?.applied?.length
    ? status.cliOverrides.applied.join(" · ")
    : "none";
  byId("applianceEvent").textContent = status.lastEvent || "—";
  byId("applianceError").textContent = status.lastError || "";
}

function setSnapshot(next) {
  snapshot = next;
  const { renderer, sourceFrame, recording, ndi, platformShare, ffmpeg, preview } = next;
  const recordingState = String(recording.state || "idle").toLowerCase();
  const healthy = renderer.running && !renderer.lastError && !recording.lastError && !ndi.lastError && !platformShare.lastError;
  byId("statusDot").className = `dot ${healthy ? "good" : "bad"}`;
  byId("statusText").textContent = renderer.lastError || recording.lastError || ndi.lastError || platformShare.lastError || applianceStatus?.lastError || "appliance runtime running";
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
  byId("ndiDrops").textContent = `${fmt(ndi.droppedGpu)} / ${fmt(ndi.droppedCpuPool)} / ${fmt(ndi.droppedWorker)}`;
  byId("ndiPending").textContent = fmt(ndi.pendingWorker);
  byId("ndiTraffic").textContent = `${Number(ndi.rawMegabytesPerSecond || 0).toFixed(1)} MiB/s`;
  byId("ndiError").textContent = ndi.lastError || "";
  byId("ndiLog").textContent = ndi.lastLog || "";

  byId("platformHeading").textContent = platformShare.sinkName;
  byId("platformNodeName").textContent = platformShare.sinkName;
  byId("platformBadge").textContent = platformShare.state;
  byId("platformBadge").className = `badge ${stateClass(platformShare.state)}`;
  byId("platformName").textContent = `${platformShare.platform} · ${platformShare.sinkName}`;
  byId("platformSource").textContent = platformShare.name;
  byId("platformFormat").textContent = `${fmt(platformShare.width)} × ${fmt(platformShare.height)} · ${(platformShare.fpsN / platformShare.fpsD).toFixed(2)} fps · BGRA`;
  byId("platformClients").textContent = platformShare.sinkName === "Syphon"
    ? (platformShare.hasClients ? "connected" : platformShare.onlyWhenClients ? "waiting for receiver" : "not required")
    : platformShare.adapterIndex >= 0 ? `adapter ${platformShare.adapterIndex}` : "automatic adapter";
  byId("platformRequests").textContent = fmt(platformShare.captureRequests);
  byId("platformReadbacks").textContent = fmt(platformShare.readbacksCompleted);
  byId("platformSent").textContent = fmt(platformShare.framesSent);
  byId("platformDrops").textContent = `${fmt(platformShare.droppedGpu)} / ${fmt(platformShare.droppedCpuPool)} / ${fmt(platformShare.droppedWorker)}`;
  byId("platformPending").textContent = fmt(platformShare.pendingWorker);
  byId("platformTraffic").textContent = `${Number(platformShare.rawMegabytesPerSecond || 0).toFixed(1)} MiB/s`;
  byId("platformError").textContent = platformShare.lastError || "";
  byId("platformLog").textContent = platformShare.lastLog || "";

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
    byId("previewDetail").textContent = renderer.previewEnabled
      ? `${fmt(preview.width)} × ${fmt(preview.height)} · active`
      : "hidden; offscreen render continues";
    byId("previewNode").classList.toggle("disabled", !renderer.previewEnabled);
  }
  updateButtons();
}

function updateButtons() {
  if (!snapshot || !profileStatus || !applianceStatus) return;
  const profile = activeProfile();
  const recordingState = String(snapshot.recording.state || "idle").toLowerCase();
  const recordingBusy = recordingState === "recording" || recordingState === "finalizing";
  const anyOutput = recordingBusy || snapshot.ndi.active || snapshot.platformShare.active;
  byId("armButton").disabled = busy || anyOutput;
  byId("startAllButton").disabled = busy || anyOutput || (!profile?.recording.enabled && !profile?.ndi.enabled && !profile?.platformShare.enabled);
  byId("stopAllButton").disabled = busy || !anyOutput;
  byId("startRecordButton").disabled = busy || recordingBusy || !profile?.recording.enabled;
  byId("stopRecordButton").disabled = busy || !recordingBusy;
  byId("startNdiButton").disabled = busy || snapshot.ndi.active || !profile?.ndi.enabled;
  byId("stopNdiButton").disabled = busy || !snapshot.ndi.active;
  byId("startPlatformButton").disabled = busy || snapshot.platformShare.active || !profile?.platformShare.enabled || !snapshot.platformShare.featureEnabled;
  byId("stopPlatformButton").disabled = busy || !snapshot.platformShare.active;
  byId("chooseOutputFolderButton").disabled = busy || recordingBusy;
  byId("resetOutputFolderButton").disabled = busy || recordingBusy;
}

async function refresh() {
  try {
    const [nextSnapshot, nextProfiles, nextAppliance] = await Promise.all([
      invoke("get_runtime_snapshot"),
      invoke("get_profile_status"),
      invoke("get_appliance_status"),
    ]);
    setProfiles(nextProfiles);
    setAppliance(nextAppliance);
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

byId("applyApplianceButton").addEventListener("click", () => action("apply_appliance_config"));
byId("reloadApplianceButton").addEventListener("click", () => action("reload_appliance_config"));
byId("restoreApplianceButton").addEventListener("click", () => action("restore_appliance_config"));
byId("writeStatusButton").addEventListener("click", () => action("write_appliance_status"));
byId("applianceConfigFolderButton").addEventListener("click", () => action("open_appliance_config_folder"));
byId("statusFolderButton").addEventListener("click", () => action("open_appliance_status_folder"));
byId("hideControlsButton").addEventListener("click", () => action("hide_controls_window"));
byId("shutdownButton").addEventListener("click", () => action("shutdown_appliance"));

byId("profileSelect").addEventListener("change", updateProfileView);
byId("armButton").addEventListener("click", () => action("select_io_profile", { profileId: byId("profileSelect").value }));
byId("startAllButton").addEventListener("click", () => action("start_profile_outputs"));
byId("stopAllButton").addEventListener("click", () => action("stop_all_outputs"));
byId("startRecordButton").addEventListener("click", () => action("start_profile_recording"));
byId("stopRecordButton").addEventListener("click", () => action("stop_recording"));
byId("startNdiButton").addEventListener("click", () => action("start_profile_ndi"));
byId("stopNdiButton").addEventListener("click", () => action("stop_ndi"));
byId("startPlatformButton").addEventListener("click", () => action("start_profile_platform_share"));
byId("stopPlatformButton").addEventListener("click", () => action("stop_platform_share"));
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
