const invoke = window.__TAURI__.core.invoke;
const byId = (id) => document.getElementById(id);
let latestSnapshot = null;
let latestInfrastructure = null;
let busy = false;
const pendingParameters = new Map();

const PARAMETER_PRESENTATION = {
  u_gain: { label: "Gain", unit: "output intensity", digits: 2, step: 0.001 },
  u_zoom: { label: "Zoom", unit: "spatial scale", digits: 2, step: 0.001 },
  u_spin: { label: "Spin speed", unit: "radians / second · 0 stops rotation", digits: 3, step: 0.001 },
  u_complexity: { label: "Complexity", unit: "iteration / sample pressure", digits: 1, step: 0.1 },
};

const fileName = (path) => String(path || "").split(/[\\/]/).pop() || "—";
const formatNumber = (value, digits = 0) => Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
const parameterPresentation = (name) => PARAMETER_PRESENTATION[name] || { label: name, unit: "runtime parameter", digits: 2, step: 0.001 };

function formatTime(timestamp) {
  const value = Number(timestamp || 0);
  return value > 0 ? new Date(value).toLocaleTimeString() : "Never";
}

function setMessage(text, kind = "") {
  const element = byId("actionMessage");
  element.textContent = text;
  element.className = `message ${kind}`.trim();
}

function setBusy(value) {
  busy = value;
  document.querySelectorAll("button").forEach((element) => {
    element.disabled = value;
  });
}

function createParameterControl(parameter) {
  const presentation = parameterPresentation(parameter.name);
  const digits = presentation.digits;
  const card = document.createElement("article");
  card.className = "parameter-card";
  card.dataset.parameter = parameter.name;
  card.innerHTML = `
    <div class="parameter-heading">
      <div><strong>${presentation.label}</strong><small>${presentation.unit}</small></div>
      <div class="parameter-value"><span class="current">${parameter.current.toFixed(digits)}</span><small>target <b class="target">${parameter.target.toFixed(digits)}</b></small></div>
    </div>
    <input class="parameter-slider" type="range" min="${parameter.min}" max="${parameter.max}" step="${presentation.step}" value="${parameter.target}" aria-label="${presentation.label}">
    <div class="parameter-meta"><span>${parameter.name}</span><span>${parameter.min.toFixed(digits)} → ${parameter.max.toFixed(digits)}</span><span>smoothing ${parameter.smoothing.toFixed(3)}</span></div>
  `;
  const slider = card.querySelector(".parameter-slider");
  slider.addEventListener("input", () => {
    card.querySelector(".target").textContent = Number(slider.value).toFixed(digits);
    scheduleParameter(parameter.name, Number(slider.value));
  });
  return card;
}

function renderParameters(parameters) {
  const container = byId("parameterControls");
  const existing = [...container.children].map((child) => child.dataset.parameter).join("|");
  const incoming = parameters.map((parameter) => parameter.name).join("|");
  if (existing !== incoming) container.replaceChildren(...parameters.map(createParameterControl));
  for (const parameter of parameters) {
    const card = container.querySelector(`[data-parameter="${parameter.name}"]`);
    if (!card) continue;
    const digits = parameterPresentation(parameter.name).digits;
    card.querySelector(".current").textContent = Number(parameter.current).toFixed(digits);
    card.querySelector(".target").textContent = Number(parameter.target).toFixed(digits);
    const slider = card.querySelector(".parameter-slider");
    if (document.activeElement !== slider) slider.value = parameter.target;
  }
}

function scheduleParameter(name, value) {
  pendingParameters.set(name, value);
  if (scheduleParameter.pending) return;
  scheduleParameter.pending = true;
  requestAnimationFrame(async () => {
    scheduleParameter.pending = false;
    const updates = [...pendingParameters.entries()];
    pendingParameters.clear();
    for (const [parameterName, parameterValue] of updates) {
      try {
        await invoke("set_parameter", { name: parameterName, value: parameterValue });
      } catch (error) {
        setMessage(String(error), "error");
      }
    }
  });
}

function displayRuntimeSnapshot(snapshot) {
  latestSnapshot = snapshot;
  const { renderer, shader, parameters } = snapshot;
  const healthy = !shader.lastReloadError && !renderer.lastError;
  byId("healthBadge").textContent = healthy ? "RUNNING" : "ATTENTION";
  byId("healthBadge").className = `hero-badge ${healthy ? "good" : "bad"}`;
  byId("gpuName").textContent = renderer.adapterName || renderer.backend;
  byId("rendererFps").textContent = `${Number(renderer.fps || 0).toFixed(1)} fps · ${Number(renderer.frameTimeMs || 0).toFixed(2)} ms`;
  byId("activeShaderShort").textContent = fileName(shader.activeShader);
  byId("activeProfile").textContent = shader.activeProfile;
  byId("activeShader").textContent = shader.activeShader;
  byId("profileTitle").textContent = shader.activeProfile;
  byId("stateSelectionSummary").textContent = `${fileName(shader.activeShader)} · ${shader.activeProfile}`;

  byId("shaderVariantList").replaceChildren(...shader.shaderVariants.map((variant) => {
    const chip = document.createElement("span");
    chip.className = `chip ${variant === shader.activeShader ? "active" : ""}`;
    chip.textContent = fileName(variant);
    return chip;
  }));
  byId("profileList").replaceChildren(...shader.profileNames.map((profile) => {
    const chip = document.createElement("span");
    chip.className = `chip ${profile === shader.activeProfile ? "active" : ""}`;
    chip.textContent = profile;
    return chip;
  }));

  renderParameters(parameters);
  byId("successfulReloads").textContent = formatNumber(shader.successfulReloads);
  byId("failedReloads").textContent = formatNumber(shader.failedReloads);
  byId("lastReloadReason").textContent = shader.lastReloadReason || "—";
  byId("lastReloadError").textContent = shader.lastReloadError || renderer.lastError || "None";
}

function renderLogs(entries) {
  byId("logCount").textContent = `${entries.length} event${entries.length === 1 ? "" : "s"}`;
  const container = byId("logEntries");
  if (!entries.length) {
    container.innerHTML = '<p class="empty">No events in the in-memory ring.</p>';
    return;
  }
  container.replaceChildren(...entries.slice(-60).reverse().map((entry) => {
    const row = document.createElement("article");
    row.className = `log-entry ${entry.level}`;
    const fields = entry.fields && Object.keys(entry.fields).length ? JSON.stringify(entry.fields) : "";
    row.innerHTML = `
      <time>${formatTime(entry.timestampUnixMs)}</time>
      <span class="log-level">${entry.level}</span>
      <strong>${entry.subsystem} · ${entry.event}</strong>
      <p>${entry.message}</p>
      ${fields ? `<code>${fields}</code>` : ""}
    `;
    return row;
  }));
}

function displayInfrastructure(snapshot) {
  latestInfrastructure = snapshot;
  const { paths, config, persistence, recentLogs } = snapshot;
  byId("assetSourceSummary").textContent = paths.assetSource;
  byId("activeAssetSummary").textContent = paths.activeAssetRoot;
  byId("activeAssetRoot").textContent = paths.activeAssetRoot;
  byId("nextAssetRoot").textContent = paths.nextLaunchAssetRoot;
  byId("assetSource").textContent = paths.assetSource;
  byId("platformLabel").textContent = config.platform_label;
  byId("baseRuntimeConfig").textContent = paths.baseRuntimeConfig;
  byId("platformRuntimeConfig").textContent = paths.platformRuntimeConfig;
  byId("authorityChain").replaceChildren(...snapshot.authorityChain.map((item) => {
    const entry = document.createElement("li");
    entry.textContent = item;
    return entry;
  }));

  byId("stateFile").textContent = paths.stateFile;
  byId("autosaveInterval").textContent = `${config.autosave_interval_ms} ms`;
  byId("saveCount").textContent = formatNumber(persistence.saveCount);
  byId("lastSave").textContent = formatTime(persistence.lastSaveUnixMs);
  byId("persistenceError").textContent = persistence.lastError || "None";
  byId("autosaveBadge").textContent = persistence.autosaveRunning ? "AUTOSAVE ACTIVE" : "AUTOSAVE STOPPED";
  byId("autosaveBadge").className = `status-pill ${persistence.autosaveRunning ? "good" : "bad"}`;
  byId("startupRestore").textContent = persistence.restoredOnStartup
    ? `${fileName(persistence.restoredShader)} · ${persistence.restoredProfile}`
    : "No state restored";
  byId("stateSummary").textContent = persistence.autosaveRunning ? "Autosave active" : "Autosave stopped";

  byId("logFile").textContent = paths.logFile;
  byId("logPathSummary").textContent = paths.logFile;
  byId("logSource").textContent = paths.logSource;
  byId("logLevelBadge").textContent = config.log_level.toUpperCase();
  byId("logSummary").textContent = `${config.log_level.toUpperCase()} · ${recentLogs.length} buffered`;
  byId("logCapacity").textContent = `${recentLogs.length} / ${config.max_log_entries}`;
  byId("logFileError").textContent = snapshot.logFileError || "None";
  renderLogs(recentLogs);
}

async function refreshAll() {
  try {
    const [runtimeSnapshot, infrastructure] = await Promise.all([
      invoke("get_runtime_snapshot"),
      invoke("get_runtime_infrastructure"),
    ]);
    displayRuntimeSnapshot(runtimeSnapshot);
    displayInfrastructure(infrastructure);
  } catch (error) {
    console.error(error);
    setMessage(String(error), "error");
  }
}

async function runAction(command, args = {}, successMessage = "Updated.") {
  if (busy) return null;
  setBusy(true);
  try {
    const result = await invoke(command, args);
    await new Promise((resolve) => setTimeout(resolve, 220));
    await refreshAll();
    setMessage(typeof result === "string" ? result : successMessage, "success");
    return result;
  } catch (error) {
    console.error(command, error);
    setMessage(String(error), "error");
    return null;
  } finally {
    setBusy(false);
  }
}

byId("previousShaderButton").addEventListener("click", () => runAction("cycle_shader", { direction: -1 }, "Previous shader selected and queued for persistence."));
byId("nextShaderButton").addEventListener("click", () => runAction("cycle_shader", { direction: 1 }, "Next shader selected and queued for persistence."));
byId("previousProfileButton").addEventListener("click", () => runAction("cycle_profile", { direction: -1 }, "Previous profile selected."));
byId("nextProfileButton").addEventListener("click", () => runAction("cycle_profile", { direction: 1 }, "Next profile selected."));
byId("validEditButton").addEventListener("click", () => runAction("toggle_valid_shader_edit", {}, "Valid edit written."));
byId("invalidEditButton").addEventListener("click", () => runAction("write_invalid_shader", {}, "Invalid edit written; last-known-good should remain active."));
byId("restoreShaderButton").addEventListener("click", () => runAction("restore_active_shader", {}, "Active built-in shader restored."));
byId("manualReloadButton").addEventListener("click", () => runAction("reload_assets", {}, "Assets manually reloaded."));
byId("restoreAllButton").addEventListener("click", () => runAction("restore_all_assets", {}, "All built-in assets restored. Runtime config changes require restart."));
byId("openAssetsButton").addEventListener("click", () => runAction("open_assets_folder", {}, "Active asset root opened."));
byId("fullscreenButton").addEventListener("click", () => runAction("toggle_renderer_fullscreen", {}, "Renderer fullscreen toggled."));
byId("resetMetricsButton").addEventListener("click", () => runAction("reset_metrics", {}, "Reload counters reset."));
byId("saveStateButton").addEventListener("click", () => runAction("force_save_runtime_state", {}, "Runtime state saved atomically."));
byId("clearStateButton").addEventListener("click", () => runAction("clear_runtime_state", {}, "State file removed and autosave paused. Use Save state now to resume persistence."));
byId("openStateFolderButton").addEventListener("click", () => runAction("open_state_folder", {}, "Runtime state folder opened."));
byId("openLogButton").addEventListener("click", () => runAction("open_log_file", {}, "Structured log opened."));
byId("clearLogButton").addEventListener("click", () => runAction("clear_log_view", {}, "In-memory log view cleared; the JSONL file is preserved."));
byId("useDefaultAssetRootButton").addEventListener("click", () => runAction("use_default_asset_root_next_launch", {}, "Platform default asset root selected for next launch."));
byId("cloneAssetRootButton").addEventListener("click", () => {
  const path = byId("customAssetRootInput").value.trim();
  if (!path) {
    setMessage("Enter an absolute custom asset path first.", "error");
    return;
  }
  runAction("prepare_custom_asset_root", { path, cloneCurrentAssets: true }, "Active assets cloned and selected for the next launch.");
});

document.querySelectorAll(".log-test").forEach((button) => {
  button.addEventListener("click", () => runAction("emit_runtime_log", { level: button.dataset.level }, `${button.dataset.level} event emitted.`));
});

window.addEventListener("keydown", (event) => {
  if (!latestSnapshot || event.repeat) return;
  const tag = event.target?.tagName?.toLowerCase();
  if (["input", "select", "textarea"].includes(tag)) return;
  const shaderKeys = latestSnapshot.renderConfig.frag_hotkeys;
  const profileKeys = latestSnapshot.paramsConfig.profile_hotkeys;
  if (shaderKeys.next.includes(event.code)) runAction("cycle_shader", { direction: 1 }, "Next shader selected.");
  else if (shaderKeys.prev.includes(event.code)) runAction("cycle_shader", { direction: -1 }, "Previous shader selected.");
  else if (profileKeys.next.includes(event.code)) runAction("cycle_profile", { direction: 1 }, "Next profile selected.");
  else if (profileKeys.prev.includes(event.code)) runAction("cycle_profile", { direction: -1 }, "Previous profile selected.");
  else return;
  event.preventDefault();
});

refreshAll();
setInterval(refreshAll, 500);
