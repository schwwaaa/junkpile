const invoke = window.__TAURI__.core.invoke;
const byId = (id) => document.getElementById(id);

const DEFAULTS = {
  render_scale: 1,
  max_steps: 128,
  max_distance: 12,
  epsilon: 0.0015,
  shadow_softness: 18,
  shape_scale: 1,
  twist: 0.75,
  repetition: 1.1,
  morph: 0.55,
  fog_density: 0.055,
  glow: 0.7,
  ao_strength: 1,
  exposure: 1.05,
  speed: 1,
  auto_orbit: 5,
  camera_yaw: 28,
  camera_pitch: 12,
  camera_distance: 3.4,
  camera_fov: 52,
  bloom: 0.38,
  chromatic: 0.35,
  vignette: 0.32,
};

let paused = false;

function status(message, isError = false) {
  const node = byId("status");
  node.textContent = String(message);
  node.classList.toggle("error", isError);
}

async function call(command, args = {}) {
  try {
    const result = await invoke(command, args);
    status("renderer online");
    return result;
  } catch (error) {
    console.error(command, error);
    status(error, true);
    throw error;
  }
}

function formatControl(input) {
  const value = Number(input.value);
  if (input.dataset.format === "percent") {
    return `${Math.round(value * 100)}%`;
  }
  const decimals = Number(input.dataset.decimals ?? 2);
  const suffix = input.dataset.suffix ?? "";
  return `${value.toFixed(decimals)}${suffix}`;
}

function updateInfo(info) {
  const values = {
    backend: info.backend,
    adapter: info.adapter,
    internalResolution: `${info.internalWidth} × ${info.internalHeight}`,
    performance: `${Number(info.fps || 0).toFixed(1)} FPS · ${Number(info.frameTimeMs || 0).toFixed(2)} ms`,
    sceneName: info.sceneName,
    windowResolution: `${info.windowWidth} × ${info.windowHeight}`,
    megapixels: `${Number(info.megapixels || 0).toFixed(2)} MP`,
    targetMemory: `${Number(info.targetMegabytes || 0).toFixed(1)} MiB`,
    pixelRate: `${Number(info.pixelRateGigapixels || 0).toFixed(2)} Gpix/s`,
    sdfBudget: `${Number(info.maximumSdfBudgetGiga || 0).toFixed(2)} Gsteps/s`,
    fps: Number(info.fps || 0).toFixed(1),
    frameTime: `${Number(info.frameTimeMs || 0).toFixed(2)} ms`,
    maxDimension: Number(info.maxTextureDimension2d || 0).toLocaleString(),
    deviceType: info.deviceType,
    driver: info.driver || "—",
    surfaceFormat: info.surfaceFormat,
    lastError: info.lastError || "",
  };

  for (const [id, value] of Object.entries(values)) {
    const node = byId(id);
    if (node) node.textContent = value;
  }

  document.querySelectorAll("[data-scene]").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.scene) === Number(info.scene));
  });
  document.querySelectorAll("[data-resolution]").forEach((button) => {
    button.classList.toggle("active", button.dataset.resolution === info.resolutionPreset);
  });

  paused = Boolean(info.paused);
  byId("paused").textContent = paused ? "Resume" : "Pause";
  byId("paused").classList.toggle("active", paused);
  byId("shadows").checked = Boolean(info.shadows);
  byId("ambient_occlusion").checked = Boolean(info.ambientOcclusion);

  if (info.lastError) status(info.lastError, true);
}

async function poll() {
  try {
    updateInfo(await call("get_renderer_info"));
  } catch {
    // The visible status already contains the error.
  }
}

for (const input of document.querySelectorAll("[data-param]")) {
  const output = input.nextElementSibling;
  output.value = formatControl(input);
  input.addEventListener("input", () => {
    output.value = formatControl(input);
    call("set_param", {
      name: input.dataset.param,
      value: Number(input.value),
    });
  });
}

document.querySelectorAll("[data-scene]").forEach((button) => {
  button.addEventListener("click", () => call("set_scene", { scene: Number(button.dataset.scene) }));
});

document.querySelectorAll("[data-resolution]").forEach((button) => {
  button.addEventListener("click", () => call("set_resolution_preset", { preset: button.dataset.resolution }));
});

byId("shadows").addEventListener("change", (event) => {
  call("set_shadows", { enabled: event.target.checked });
});

byId("ambient_occlusion").addEventListener("change", (event) => {
  call("set_ambient_occlusion", { enabled: event.target.checked });
});

byId("paused").addEventListener("click", async () => {
  paused = !paused;
  await call("set_paused", { paused });
  byId("paused").textContent = paused ? "Resume" : "Pause";
});

byId("reset").addEventListener("click", async () => {
  await call("reset_params");
  for (const [id, value] of Object.entries(DEFAULTS)) {
    const input = byId(id);
    input.value = value;
    input.nextElementSibling.value = formatControl(input);
  }
  byId("shadows").checked = true;
  byId("ambient_occlusion").checked = true;
  paused = false;
  byId("paused").textContent = "Pause";
});

byId("fullscreen").addEventListener("click", () => call("toggle_renderer_fullscreen"));

poll();
setInterval(poll, 750);
