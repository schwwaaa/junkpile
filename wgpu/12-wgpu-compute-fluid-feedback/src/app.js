const invoke = window.__TAURI__.core.invoke;
const byId = (id) => document.getElementById(id);

const DEFAULTS = {
  render_scale: 1,
  velocity_dissipation: 0.994,
  dye_dissipation: 0.998,
  viscosity: 0.08,
  vorticity: 28,
  force: 2.2,
  radius: 0.055,
  dye_amount: 2.6,
  feedback: 0.18,
  simulation_speed: 1,
  emitter_speed: 0.75,
  injector_x: 0.5,
  injector_y: 0.5,
  pressure_iterations: 24,
  substeps: 1,
  exposure: 1.1,
  bloom: 0.55,
  contrast: 1.05,
  vignette: 0.22,
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

function scientific(value) {
  const number = Number(value || 0);
  if (number >= 1e9) return `${(number / 1e9).toFixed(2)} Gcells/s`;
  if (number >= 1e6) return `${(number / 1e6).toFixed(2)} Mcells/s`;
  return `${number.toFixed(0)} cells/s`;
}

function updateInfo(info) {
  const values = {
    backend: info.backend,
    adapter: info.adapter,
    simulationResolution: `${info.simulationSize} × ${info.simulationSize}`,
    performance: `${Number(info.fps || 0).toFixed(1)} FPS · ${Number(info.frameTimeMs || 0).toFixed(2)} ms`,
    emitterName: info.emitterName,
    paletteName: info.paletteName,
    viewName: info.viewName,
    outputResolution: `${info.outputWidth} × ${info.outputHeight}`,
    windowResolution: `${info.windowWidth} × ${info.windowHeight}`,
    workgroups: `${info.workgroupsX} × ${info.workgroupsY}`,
    computePasses: Number(info.computePassesPerFrame || 0).toLocaleString(),
    cellUpdates: scientific(info.cellUpdatesPerSecond),
    fieldMemory: `${info.fieldTextureCount} × RGBA16F · ${Number(info.fieldMemoryMegabytes || 0).toFixed(1)} MiB`,
    outputMemory: `${Number(info.outputMemoryMegabytes || 0).toFixed(1)} MiB`,
    totalMemory: `${Number(info.estimatedTotalMegabytes || 0).toFixed(1)} MiB`,
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

  document.querySelectorAll("[data-simulation-size]").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.simulationSize) === Number(info.simulationSize));
  });
  document.querySelectorAll("[data-resolution]").forEach((button) => {
    button.classList.toggle("active", button.dataset.resolution === info.resolutionPreset);
  });
  document.querySelectorAll("[data-emitter]").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.emitter) === Number(info.emitterMode));
  });
  document.querySelectorAll("[data-palette]").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.palette) === Number(info.palette));
  });
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.view) === Number(info.viewMode));
  });

  paused = Boolean(info.paused);
  byId("paused").textContent = paused ? "Resume" : "Pause";
  byId("paused").classList.toggle("active", paused);
  byId("burst").classList.toggle("active", Boolean(info.burstActive));

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

document.querySelectorAll("[data-simulation-size]").forEach((button) => {
  button.addEventListener("click", () => call("set_simulation_size", {
    size: Number(button.dataset.simulationSize),
  }));
});

document.querySelectorAll("[data-resolution]").forEach((button) => {
  button.addEventListener("click", () => call("set_resolution_preset", {
    preset: button.dataset.resolution,
  }));
});

document.querySelectorAll("[data-emitter]").forEach((button) => {
  button.addEventListener("click", () => call("set_emitter_mode", {
    mode: Number(button.dataset.emitter),
  }));
});

document.querySelectorAll("[data-palette]").forEach((button) => {
  button.addEventListener("click", () => call("set_palette", {
    palette: Number(button.dataset.palette),
  }));
});

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => call("set_view_mode", {
    mode: Number(button.dataset.view),
  }));
});

byId("burst").addEventListener("click", () => call("trigger_burst"));

byId("paused").addEventListener("click", async () => {
  paused = !paused;
  await call("set_paused", { paused });
  byId("paused").textContent = paused ? "Resume" : "Pause";
});

byId("resetFluid").addEventListener("click", () => call("reset_fluid"));

byId("resetParams").addEventListener("click", async () => {
  await call("reset_params");
  for (const [id, value] of Object.entries(DEFAULTS)) {
    const input = byId(id);
    input.value = value;
    input.nextElementSibling.value = formatControl(input);
  }
  paused = false;
  byId("paused").textContent = "Pause";
});

byId("fullscreen").addEventListener("click", () => call("toggle_renderer_fullscreen"));

poll();
setInterval(poll, 750);
