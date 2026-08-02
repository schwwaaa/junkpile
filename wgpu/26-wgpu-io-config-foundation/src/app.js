const invoke = window.__TAURI__.core.invoke;
const byId = (id) => document.getElementById(id);
let busy = false;

function boolLabel(value) {
  return value ? "enabled" : "disabled";
}

function dimensions(value) {
  return `${Number(value.width).toLocaleString()} × ${Number(value.height).toLocaleString()}`;
}

function setBusy(next) {
  busy = next;
  document.querySelectorAll("button").forEach((button) => {
    button.disabled = next;
  });
}

function setStatus(status) {
  const hasError = Boolean(status.lastError);
  byId("statusText").textContent = hasError ? "last change rejected" : "configuration active";
  byId("statusDot").className = `dot ${hasError ? "bad" : "good"}`;
  byId("generation").textContent = `generation ${status.generation}`;
  byId("platform").textContent = status.platform;
  byId("basePath").textContent = status.basePath;
  byId("overridePath").textContent = status.overridePath || "none";
  byId("watching").textContent = status.watching ? "active" : "stopped";
  byId("lastEvent").textContent = status.lastEvent || "—";

  const errorPanel = byId("errorPanel");
  errorPanel.classList.toggle("hidden", !hasError);
  byId("errorText").textContent = status.lastError || "";

  const config = status.active;
  byId("renderDimensions").textContent = dimensions(config.render);
  byId("renderFps").textContent = config.render.targetFps;
  byId("previewDimensions").textContent = dimensions(config.preview);
  byId("previewEnabled").textContent = boolLabel(config.preview.enabled);
  byId("previewScaling").textContent = config.preview.scaling;
  byId("recordingDimensions").textContent = dimensions(config.recording);
  byId("recordingEnabled").textContent = boolLabel(config.recording.enabled);
  byId("recordingFps").textContent = config.recording.fps;
  byId("recordingQueue").textContent = `${config.recording.queueCapacity} frames`;
  byId("streamingDimensions").textContent = dimensions(config.streaming);
  byId("streamingEnabled").textContent = boolLabel(config.streaming.enabled);
  byId("streamingFps").textContent = config.streaming.fps;
  byId("streamingQueue").textContent = `${config.streaming.queueCapacity} frames`;
  byId("ndiName").textContent = config.ndi.name;
  byId("ndiEnabled").textContent = boolLabel(config.ndi.enabled);
  byId("ndiQueue").textContent = `${config.ndi.queueCapacity} frames`;
  byId("shareName").textContent = config.sharedTexture.name;
  byId("shareEnabled").textContent = boolLabel(config.sharedTexture.enabled);
  byId("shareBackend").textContent = config.sharedTexture.backend;
  byId("effectiveJson").textContent = JSON.stringify(config, null, 2);
}

function setRenderer(info) {
  byId("backend").textContent = info.backend || "—";
  byId("adapterName").textContent = info.adapterName || "—";
  byId("surfaceFormat").textContent = info.surfaceFormat || "—";
  byId("windowResolution").textContent = `${info.width} × ${info.height}`;
  byId("measuredFps").textContent = Number(info.fps || 0).toFixed(1);
  byId("frameTime").textContent = `${Number(info.frameTimeMs || 0).toFixed(2)} ms`;
}

async function refresh() {
  try {
    const [status, renderer] = await Promise.all([
      invoke("get_config_status"),
      invoke("get_renderer_info")
    ]);
    setStatus(status);
    setRenderer(renderer);
  } catch (error) {
    console.error(error);
    byId("statusText").textContent = String(error);
    byId("statusDot").className = "dot bad";
  }
}

async function action(command, args = {}) {
  if (busy) return;
  setBusy(true);
  try {
    await invoke(command, args);
    await new Promise((resolve) => setTimeout(resolve, 450));
    await refresh();
  } catch (error) {
    console.error(command, error);
    await refresh();
  } finally {
    setBusy(false);
  }
}

byId("reloadButton").addEventListener("click", () => action("reload_config"));
byId("validButton").addEventListener("click", () => action("write_demo_config", { mode: "valid" }));
byId("invalidButton").addEventListener("click", () => action("write_demo_config", { mode: "invalid" }));
byId("restoreButton").addEventListener("click", () => action("restore_default_config"));
byId("openFolderButton").addEventListener("click", () => action("open_config_folder"));
byId("fullscreenButton").addEventListener("click", () => action("toggle_renderer_fullscreen"));

refresh();
setInterval(refresh, 650);
