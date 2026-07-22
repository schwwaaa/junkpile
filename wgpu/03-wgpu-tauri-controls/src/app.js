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

const defaults = { speed:1, zoom:1, distortion:.45, hue:205, brightness:1, saturation:.82, glow:.75, complexity:5 };
let paused = false;
let pulse = false;

document.querySelectorAll("[data-param]").forEach((input) => {
  const output = input.nextElementSibling;
  const format = () => {
    if (input.dataset.param === "hue") return `${Math.round(Number(input.value))}°`;
    if (input.dataset.param === "complexity") return String(Math.round(Number(input.value)));
    return Number(input.value).toFixed(2);
  };
  input.addEventListener("input", () => {
    output.value = format();
    call("set_param", { name: input.dataset.param, value: Number(input.value) });
  });
});

byId("pause").addEventListener("click", async () => {
  paused = !paused; await call("set_paused", { paused }); byId("pause").textContent = paused ? "Resume" : "Pause";
});
byId("pulse").addEventListener("click", async () => {
  pulse = !pulse; await call("set_param", { name:"pulse", value:pulse ? 1 : 0 }); byId("pulse").textContent = pulse ? "Pulse on" : "Pulse off";
});
byId("reset").addEventListener("click", async () => {
  await call("reset_params");
  Object.entries(defaults).forEach(([name,value]) => {
    const input = byId(name); input.value = value; input.dispatchEvent(new Event("input"));
  });
  pulse = false; byId("pulse").textContent = "Pulse off";
});
bindButton("fullscreen", "toggle_renderer_fullscreen");
