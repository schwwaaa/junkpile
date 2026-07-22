const invoke = window.__TAURI__.core.invoke;
const byId = (id) => document.getElementById(id);

function safeText(value, fallback = "—") {
  return value === undefined || value === null || value === "" ? fallback : String(value);
}

function setStatus(message, isError = false) {
  const node = byId("status");
  if (!node) return;
  node.textContent = message;
  node.classList.toggle("error", isError);
}

async function call(command, args = {}) {
  try {
    const result = await invoke(command, args);
    setStatus("renderer online");
    return result;
  } catch (error) {
    console.error(command, error);
    setStatus(safeText(error, "command failed"), true);
    throw error;
  }
}

function bindButton(id, command, argsFactory = () => ({})) {
  const button = byId(id);
  if (!button) return;
  button.addEventListener("click", () => call(command, argsFactory()));
}

function updateInfo(info) {
  const values = {
    backend: info.backend,
    adapterName: info.adapterName,
    deviceType: info.deviceType,
    driver: info.driver,
    driverInfo: info.driverInfo,
    surfaceFormat: info.surfaceFormat,
    resolution: `${info.width} × ${info.height}`,
    fps: Number(info.fps || 0).toFixed(1),
    frameTime: `${Number(info.frameTimeMs || 0).toFixed(2)} ms`,
    frameCount: Number(info.frameCount || 0).toLocaleString(),
    lastError: info.lastError || "none"
  };
  Object.entries(values).forEach(([id, value]) => {
    const node = byId(id);
    if (node) node.textContent = safeText(value);
  });
}

async function pollInfo() {
  try {
    updateInfo(await call("get_renderer_info"));
  } catch (_) {}
}

pollInfo();
setInterval(pollInfo, 750);

bindButton("fullscreen", "toggle_renderer_fullscreen");
document.querySelectorAll("[data-size]").forEach((button) => {
  button.addEventListener("click", () => {
    const [width, height] = button.dataset.size.split("x").map(Number);
    call("set_renderer_size", { width, height });
  });
});
