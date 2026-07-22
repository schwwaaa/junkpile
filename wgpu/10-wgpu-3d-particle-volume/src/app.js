const invoke = window.__TAURI__.core.invoke;
const byId = (id) => document.getElementById(id);
let paused = false;
let depthOcclusion = false;
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
  setText("resolution", `${info.width} × ${info.height}`);
  setText("surfaceFormat", info.surfaceFormat);
  setText("depthFormat", info.depthFormat);
  setText("activeParticles", Number(info.activeParticles || 0).toLocaleString());
  setText("maxParticles", Number(info.maxParticles || 0).toLocaleString());
  setText("particleStride", `${info.particleStrideBytes} bytes`);
  setText("bufferSize", formatBytes(info.particleBufferBytes));
  setText("dispatch", `${Number(info.dispatchWorkgroups || 0).toLocaleString()} × ${info.workgroupSize}`);
  setText("fps", Number(info.fps || 0).toFixed(1));
  setText("frameTime", `${Number(info.frameTimeMs || 0).toFixed(2)} ms`);
  setText("updatesPerSecond", formatRate(info.particleUpdatesPerSecond));
  setText("frameCount", Number(info.frameCount || 0).toLocaleString());
  setText("deviceType", info.deviceType);
  setText("driver", info.driver);
  setText("storageLimit", formatBytes(info.maxStorageBufferBindingSize));
  setText("maxBuffer", formatBytes(info.maxBufferSize));
  setText("workgroupLimit", Number(info.maxComputeWorkgroupsPerDimension || 0).toLocaleString());
  setText("cameraReadout", `${Number(info.cameraYawDegrees || 0).toFixed(0)}° yaw · ${Number(info.cameraPitchDegrees || 0).toFixed(0)}° pitch · ${Number(info.cameraDistance || 0).toFixed(2)} distance`);
  setText("volumeReadout", `${Number(info.depthScale || 0).toFixed(2)}× Z depth · ${Number(info.zForce || 0).toFixed(2)} Z force`);
  setText("lastError", info.lastError || "");

  maxParticles = Number(info.maxParticles || 1);
  updatePresetAvailability();
  markActivePreset(info.activeParticles);

  paused = Boolean(info.paused);
  setText("pause", paused ? "Resume" : "Pause");

  depthOcclusion = Boolean(info.depthOcclusion);
  const depthToggle = byId("depthOcclusion");
  if (depthToggle) depthToggle.checked = depthOcclusion;
  setText("depthMode", depthOcclusion ? "Depth-tested" : "Additive volume");
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
bindRange("zForce", "z_force", (value) => value.toFixed(2));
bindRange("depthScale", "depth_scale", (value) => value.toFixed(2));
bindRange("particleSize", "particle_size", (value) => value.toFixed(4));
bindRange("exposure", "exposure", (value) => value.toFixed(2));
bindRange("fogDensity", "fog_density", (value) => value.toFixed(2));
bindRange("cameraYaw", "camera_yaw", (value) => `${value.toFixed(0)}°`);
bindRange("cameraPitch", "camera_pitch", (value) => `${value.toFixed(0)}°`);
bindRange("cameraDistance", "camera_distance", (value) => value.toFixed(2));
bindRange("cameraFov", "camera_fov", (value) => `${value.toFixed(0)}°`);
bindRange("autoOrbit", "auto_orbit", (value) => `${value.toFixed(1)}°/s`);

function setRangeValue(id, value, formatter) {
  const input = byId(id);
  const output = byId(`${id}Value`);
  if (input) input.value = String(value);
  if (output) output.textContent = formatter(value);
}

async function applyParams(params) {
  await Promise.all(Object.entries(params).map(([name, value]) => call("set_param", { name, value })));
}

document.querySelectorAll("[data-count]").forEach((button) => {
  button.addEventListener("click", () => {
    const count = Math.min(Number(button.dataset.count), maxParticles);
    call("set_particle_count", { count }).catch(() => {});
  });
});

document.querySelectorAll("[data-volume-preset]").forEach((button) => {
  button.addEventListener("click", async () => {
    const preset = button.dataset.volumePreset;
    const values = {
      flat: { depth_scale: 0.0, z_force: 0.0, fog_density: 0.0 },
      shallow: { depth_scale: 0.32, z_force: 0.22, fog_density: 0.05 },
      sphere: { depth_scale: 1.0, z_force: 0.58, fog_density: 0.14 },
      deep: { depth_scale: 2.15, z_force: 1.25, fog_density: 0.22 }
    }[preset];
    if (!values) return;
    await applyParams(values);
    setRangeValue("depthScale", values.depth_scale, (value) => value.toFixed(2));
    setRangeValue("zForce", values.z_force, (value) => value.toFixed(2));
    setRangeValue("fogDensity", values.fog_density, (value) => value.toFixed(2));
    document.querySelectorAll("[data-volume-preset]").forEach((item) => item.classList.toggle("active", item === button));
  });
});

document.querySelectorAll("[data-camera-preset]").forEach((button) => {
  button.addEventListener("click", async () => {
    const preset = button.dataset.cameraPreset;
    const values = {
      front: { camera_yaw: 0, camera_pitch: 0, camera_distance: 3.2 },
      threeQuarter: { camera_yaw: 38, camera_pitch: 20, camera_distance: 3.15 },
      top: { camera_yaw: 0, camera_pitch: 78, camera_distance: 3.6 },
      close: { camera_yaw: 24, camera_pitch: 12, camera_distance: 1.75 }
    }[preset];
    if (!values) return;
    await applyParams(values);
    setRangeValue("cameraYaw", values.camera_yaw, (value) => `${value.toFixed(0)}°`);
    setRangeValue("cameraPitch", values.camera_pitch, (value) => `${value.toFixed(0)}°`);
    setRangeValue("cameraDistance", values.camera_distance, (value) => value.toFixed(2));
  });
});

byId("depthOcclusion")?.addEventListener("change", (event) => {
  call("set_depth_occlusion", { enabled: Boolean(event.target.checked) }).catch(() => {});
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
    fieldStrength: [0.82, (value) => value.toFixed(2)],
    turbulence: [0.48, (value) => value.toFixed(2)],
    drag: [0.972, (value) => value.toFixed(4)],
    speed: [1, (value) => value.toFixed(2)],
    substeps: [2, (value) => value.toFixed(0)],
    zForce: [0.58, (value) => value.toFixed(2)],
    depthScale: [1, (value) => value.toFixed(2)],
    particleSize: [0.0065, (value) => value.toFixed(4)],
    exposure: [0.92, (value) => value.toFixed(2)],
    fogDensity: [0.14, (value) => value.toFixed(2)],
    cameraYaw: [22, (value) => `${value.toFixed(0)}°`],
    cameraPitch: [14, (value) => `${value.toFixed(0)}°`],
    cameraDistance: [3.2, (value) => value.toFixed(2)],
    cameraFov: [55, (value) => `${value.toFixed(0)}°`],
    autoOrbit: [7, (value) => `${value.toFixed(1)}°/s`]
  };
  Object.entries(defaults).forEach(([id, [value, formatter]]) => setRangeValue(id, value, formatter));
  document.querySelectorAll("[data-volume-preset]").forEach((item) => item.classList.toggle("active", item.dataset.volumePreset === "sphere"));
});

byId("fullscreen")?.addEventListener("click", () => {
  call("toggle_renderer_fullscreen").catch(() => {});
});

pollInfo();
setInterval(pollInfo, 700);
