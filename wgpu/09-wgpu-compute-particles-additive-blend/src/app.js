const invoke = window.__TAURI__.core.invoke;
const byId = (id) => document.getElementById(id);
let paused = false;
let maxParticles = 1_000_000;

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
    setStatus(String(error || "command failed"), true);
    throw error;
  }
}

function setText(id, value, fallback = "—") {
  const node = byId(id);
  if (node) node.textContent = value === undefined || value === null || value === "" ? fallback : String(value);
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value >= 1073741824) return `${(value / 1073741824).toFixed(2)} GiB`;
  return `${(value / 1048576).toFixed(1)} MiB`;
}

function formatRate(value) {
  const number = Number(value || 0);
  if (number >= 1_000_000_000) return `${(number / 1_000_000_000).toFixed(2)} billion/s`;
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(1)} million/s`;
  return `${Math.round(number).toLocaleString()}/s`;
}

function updatePresetAvailability() {
  document.querySelectorAll("[data-count]").forEach((button) => {
    const count = Number(button.dataset.count);
    button.disabled = count > maxParticles;
    button.title = button.disabled ? `GPU capacity is ${maxParticles.toLocaleString()} particles` : "";
  });
}

function markActivePreset(count) {
  document.querySelectorAll("[data-count]").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.count) === Number(count));
  });
}

function updateInfo(info) {
  setText("backend", info.backend);
  setText("adapter", info.adapter);
  setText("deviceType", info.deviceType);
  setText("driver", info.driver);
  setText("surfaceFormat", info.surfaceFormat);
  setText("resolution", `${info.width} × ${info.height}`);
  setText("activeParticles", Number(info.activeParticles || 0).toLocaleString());
  setText("maxParticles", Number(info.maxParticles || 0).toLocaleString());
  setText("bufferSize", formatBytes(info.particleBufferBytes));
  setText("dispatch", `${Number(info.dispatchWorkgroups || 0).toLocaleString()} × ${info.workgroupSize}`);
  setText("fps", Number(info.fps || 0).toFixed(1));
  setText("frameTime", `${Number(info.frameTimeMs || 0).toFixed(2)} ms`);
  setText("updatesPerSecond", formatRate(info.particleUpdatesPerSecond));
  setText("frameCount", Number(info.frameCount || 0).toLocaleString());
  setText("storageLimit", formatBytes(info.maxStorageBufferBindingSize));
  setText("maxBuffer", formatBytes(info.maxBufferSize));
  setText("workgroupSize", info.workgroupSize);
  setText("workgroupLimit", Number(info.maxComputeWorkgroupsPerDimension || 0).toLocaleString());
  setText("lastError", info.lastError || "");

  maxParticles = Number(info.maxParticles || 1);
  updatePresetAvailability();
  markActivePreset(info.activeParticles);

  paused = Boolean(info.paused);
  setText("pause", paused ? "Resume" : "Pause");
}

async function pollInfo() {
  try {
    updateInfo(await call("get_renderer_info"));
  } catch (_) {}
}

function bindRange(id, commandName, formatter) {
  const input = byId(id);
  const output = byId(`${id}Value`);
  if (!input || !output) return;

  const updateOutput = () => {
    output.textContent = formatter(Number(input.value));
  };
  updateOutput();

  input.addEventListener("input", () => {
    updateOutput();
    call("set_param", { name: commandName, value: Number(input.value) }).catch(() => {});
  });
}

bindRange("fieldStrength", "field_strength", (value) => value.toFixed(2));
bindRange("turbulence", "turbulence", (value) => value.toFixed(2));
bindRange("drag", "drag", (value) => value.toFixed(4));
bindRange("speed", "speed", (value) => value.toFixed(2));
bindRange("substeps", "substeps", (value) => value.toFixed(0));
bindRange("particleSize", "particle_size", (value) => value.toFixed(2));
bindRange("exposure", "exposure", (value) => value.toFixed(2));

document.querySelectorAll("[data-count]").forEach((button) => {
  button.addEventListener("click", () => {
    const count = Math.min(Number(button.dataset.count), maxParticles);
    call("set_particle_count", { count }).catch(() => {});
  });
});

byId("pause")?.addEventListener("click", () => {
  call("set_paused", { paused: !paused }).catch(() => {});
});

byId("reseed")?.addEventListener("click", () => {
  call("reset_particles").catch(() => {});
});

byId("reset")?.addEventListener("click", async () => {
  await call("reset_params");
  const defaults = {
    fieldStrength: [1.15, 2],
    turbulence: [0.72, 2],
    drag: [0.965, 4],
    speed: [1, 2],
    substeps: [2, 0],
    particleSize: [1.8, 2],
    exposure: [1.15, 2]
  };
  Object.entries(defaults).forEach(([id, [value, digits]]) => {
    const input = byId(id);
    const output = byId(`${id}Value`);
    if (input) input.value = String(value);
    if (output) output.textContent = Number(value).toFixed(digits);
  });
});

byId("fullscreen")?.addEventListener("click", () => {
  call("toggle_renderer_fullscreen").catch(() => {});
});

pollInfo();
setInterval(pollInfo, 700);
