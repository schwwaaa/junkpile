const invoke = window.__TAURI__.core.invoke;
const byId = (id) => document.getElementById(id);
let latestSnapshot = null;
let configEnvelope = null;
let busy = false;

const formatNumber = (value, digits = 0) =>
  Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

function setMessage(text, kind = "") {
  const element = byId("actionMessage");
  element.textContent = text;
  element.className = `message ${kind}`.trim();
}

function setBusy(value) {
  busy = value;
  document.querySelectorAll("button, input, select").forEach((element) => {
    element.disabled = value;
  });
}

function displayConfig(envelope) {
  configEnvelope = envelope;
  const { config, path } = envelope;
  byId("configPath").textContent = path;
  byId("fitKeys").textContent = config.hotkeys.fit.join(", ");
  byId("fillKeys").textContent = config.hotkeys.fill.join(", ");
  byId("stretchKeys").textContent = config.hotkeys.stretch.join(", ");
  byId("pixelKeys").textContent = config.hotkeys.pixel.join(", ");
  byId("toggleKeys").textContent = config.hotkeys.toggle_preview.join(", ");
  byId("fullscreenKeys").textContent = config.hotkeys.fullscreen.join(", ");
}

function updatePreset(width, height) {
  const value = `${width}x${height}`;
  const hasPreset = [...byId("sourcePreset").options].some((option) => option.value === value);
  if (hasPreset) byId("sourcePreset").value = value;
  byId("customWidth").value = width;
  byId("customHeight").value = height;
}

function displaySnapshot(snapshot) {
  latestSnapshot = snapshot;
  const { renderer, frame, preview } = snapshot;
  const active = preview.enabled;
  byId("healthBadge").textContent = active ? "PREVIEW ACTIVE" : "PREVIEW HIDDEN";
  byId("healthBadge").className = `hero-badge ${active ? "good" : "hidden"}`;
  byId("gpuName").textContent = renderer.adapterName || renderer.backend;
  byId("rendererFps").textContent = `${Number(renderer.fps || 0).toFixed(1)} fps · ${Number(renderer.frameTimeMs || 0).toFixed(2)} ms`;
  byId("sourceSummary").textContent = `${formatNumber(frame.width)} × ${formatNumber(frame.height)}`;
  byId("windowSummary").textContent = `${formatNumber(preview.windowWidth)} × ${formatNumber(preview.windowHeight)}`;
  byId("previewSummary").textContent = active ? preview.modeName.toUpperCase() : "OFFSCREEN ONLY";
  byId("togglePreviewButton").textContent = active ? "Hide preview" : "Show preview";

  document.querySelectorAll(".mode-card").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === preview.modeName);
  });

  const geometry = preview.geometry;
  byId("geometryTitle").textContent = `${preview.modeName[0].toUpperCase()}${preview.modeName.slice(1)} presentation`;
  byId("geometryDescription").textContent = geometry.description;
  byId("displayedImage").textContent = `${formatNumber(geometry.imageWidth, 1)} × ${formatNumber(geometry.imageHeight, 1)} px`;
  byId("offsetSummary").textContent = `${formatNumber(geometry.offsetX, 1)} / ${formatNumber(geometry.offsetY, 1)} px`;
  byId("scaleSummary").textContent = `${formatNumber(geometry.scaleX, 3)}× / ${formatNumber(geometry.scaleY, 3)}×`;
  byId("visiblePercent").textContent = `${formatNumber(geometry.visibleSourcePercent, 1)}%`;
  byId("presentedFrames").textContent = formatNumber(preview.presentedFrames);
  byId("hiddenFrames").textContent = formatNumber(preview.hiddenFrames);
  byId("unavailableFrames").textContent = formatNumber(preview.unavailableFrames);
  byId("authoritativeFrames").textContent = formatNumber(renderer.frameCount);
  byId("flowSource").textContent = `${formatNumber(frame.width)} × ${formatNumber(frame.height)} · unchanged by preview`;
  byId("contractSummary").textContent = snapshot.contractSummary;
  updatePreset(frame.width, frame.height);

  if (renderer.lastError || preview.lastError) {
    setMessage(preview.lastError || renderer.lastError, "error");
  }
}

async function refreshSnapshot() {
  try {
    displaySnapshot(await invoke("get_runtime_snapshot"));
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
    await new Promise((resolve) => setTimeout(resolve, 100));
    await refreshSnapshot();
    setMessage(successMessage, "success");
    return result;
  } catch (error) {
    console.error(command, error);
    setMessage(String(error), "error");
    return null;
  } finally {
    setBusy(false);
  }
}

async function setMode(mode) {
  await runAction("set_preview_mode", { mode }, `Preview mode changed to ${mode}.`);
}

async function togglePreview() {
  const enabled = !latestSnapshot?.preview?.enabled;
  await runAction(
    "set_preview_enabled",
    { enabled },
    enabled
      ? "Preview window restored. The authoritative renderer never stopped."
      : "Preview hidden. Offscreen rendering continues and the frame counter should keep increasing."
  );
}

async function applyResolution(width, height) {
  await runAction(
    "set_source_resolution",
    { width: Number(width), height: Number(height) },
    `Authoritative source changed to ${width} × ${height}; the window size was not changed.`
  );
}

for (const button of document.querySelectorAll(".mode-card")) {
  button.addEventListener("click", () => setMode(button.dataset.mode));
}

byId("togglePreviewButton").addEventListener("click", togglePreview);
byId("fullscreenButton").addEventListener("click", () =>
  runAction("toggle_renderer_fullscreen", {}, "Renderer fullscreen state toggled.")
);
byId("resetMetricsButton").addEventListener("click", () =>
  runAction("reset_metrics", {}, "Preview counters reset.")
);
byId("sourcePreset").addEventListener("change", (event) => {
  const [width, height] = event.target.value.split("x").map(Number);
  byId("customWidth").value = width;
  byId("customHeight").value = height;
  applyResolution(width, height);
});
byId("applyResolutionButton").addEventListener("click", () =>
  applyResolution(byId("customWidth").value, byId("customHeight").value)
);
byId("reloadConfigButton").addEventListener("click", async () => {
  const envelope = await runAction(
    "reload_preview_config",
    {},
    "Configuration reloaded and applied."
  );
  if (envelope) displayConfig(envelope);
});
byId("restoreConfigButton").addEventListener("click", async () => {
  const envelope = await runAction(
    "restore_preview_defaults",
    {},
    "Built-in preview configuration restored."
  );
  if (envelope) displayConfig(envelope);
});

window.addEventListener("keydown", (event) => {
  if (!configEnvelope || event.repeat) return;
  const tag = event.target?.tagName?.toLowerCase();
  if (["input", "select", "textarea"].includes(tag)) return;
  const keys = configEnvelope.config.hotkeys;
  let handled = true;
  if (keys.fit.includes(event.code)) setMode("fit");
  else if (keys.fill.includes(event.code)) setMode("fill");
  else if (keys.stretch.includes(event.code)) setMode("stretch");
  else if (keys.pixel.includes(event.code)) setMode("pixel");
  else if (keys.toggle_preview.includes(event.code)) togglePreview();
  else if (keys.fullscreen.includes(event.code)) {
    runAction("toggle_renderer_fullscreen", {}, "Renderer fullscreen state toggled.");
  } else handled = false;
  if (handled) event.preventDefault();
});

async function initialize() {
  try {
    displayConfig(await invoke("get_preview_config"));
    await refreshSnapshot();
  } catch (error) {
    console.error(error);
    setMessage(String(error), "error");
  }
}

initialize();
setInterval(refreshSnapshot, 400);
