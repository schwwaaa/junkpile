const byId = (id) => document.getElementById(id);
const bridge = window.__TAURI__?.core;
const invoke = bridge?.invoke;
let latestInfo = null;
let yaw = 28;
let pitch = 18;
let distance = 4.2;

function setStatus(message, error = false) {
  const node = byId("status");
  node.textContent = message;
  node.classList.toggle("error", error);
}

async function call(command, args = {}) {
  if (!invoke) {
    const message = "Tauri bridge unavailable: withGlobalTauri did not initialize";
    setStatus(message, true);
    throw new Error(message);
  }
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

function text(id, value, fallback = "—") {
  const node = byId(id);
  if (!node) return;
  node.textContent = value === undefined || value === null || value === "" ? fallback : String(value);
}

function number(value) {
  return Number(value || 0).toLocaleString();
}

function vector(values) {
  if (!Array.isArray(values)) return "—";
  return `[${values.map((value) => Number(value).toFixed(3)).join(", ")}]`;
}

function updateOrbitCursor() {
  const cursor = byId("orbitCursor");
  const x = 50 + Math.sin((yaw * Math.PI) / 180) * 34;
  const y = 50 - (pitch / 90) * 38;
  cursor.style.left = `${x}%`;
  cursor.style.top = `${y}%`;
  text("cameraReadout", `${yaw.toFixed(0)}° yaw · ${pitch.toFixed(0)}° pitch · ${distance.toFixed(2)} distance`);
}

function setRange(id, value) {
  const input = byId(id);
  if (input) input.value = String(value);
  input?.dispatchEvent(new Event("input", { bubbles: false }));
}

function updateInfo(info) {
  latestInfo = info;
  text("sceneName", info.sceneName);
  text("sourcePath", info.sourcePath);
  text("nodeCount", number(info.nodeCount));
  text("meshCount", number(info.meshCount));
  text("primitiveCount", number(info.primitiveCount));
  text("materialCount", number(info.materialCount));
  text("textureCount", number(info.textureCount));
  text("cameraCount", number(info.cameraCount));
  text("animationCount", number(info.animationCount));
  text("skinCount", number(info.skinCount));
  text("vertexCount", number(info.vertexCount));
  text("triangleCount", number(info.triangleCount));
  text("bounds", `${vector(info.boundsMin)} → ${vector(info.boundsMax)}`);
  text("loading", info.loading ? "loading…" : "ready");

  text("backend", info.backend);
  text("adapter", info.adapter);
  text("resolution", `${info.width} × ${info.height}`);
  text("surfaceFormat", info.surfaceFormat);
  text("depthFormat", info.depthFormat);
  text("fps", Number(info.fps || 0).toFixed(1));
  text("frameTime", `${Number(info.frameTimeMs || 0).toFixed(2)} ms`);
  text("frameCount", number(info.frameCount));
  text("lastError", info.lastError || "none");

  yaw = Number(info.cameraYawDegrees ?? yaw);
  pitch = Number(info.cameraPitchDegrees ?? pitch);
  distance = Number(info.cameraDistance ?? distance);
  updateOrbitCursor();
}

async function pollInfo() {
  try { updateInfo(await call("get_renderer_info")); } catch (_) {}
}

function bindRange(id, commandName, formatter, onValue) {
  const input = byId(id);
  const output = byId(`${id}Value`);
  const update = () => {
    const value = Number(input.value);
    output.textContent = formatter(value);
    onValue?.(value);
    return value;
  };
  update();
  input.addEventListener("input", () => {
    const value = update();
    call("set_param", { name: commandName, value }).catch(() => {});
  });
}

bindRange("cameraYaw", "camera_yaw", (value) => `${value.toFixed(0)}°`, (value) => { yaw = value; updateOrbitCursor(); });
bindRange("cameraPitch", "camera_pitch", (value) => `${value.toFixed(0)}°`, (value) => { pitch = value; updateOrbitCursor(); });
bindRange("cameraDistance", "camera_distance", (value) => value.toFixed(2), (value) => { distance = value; updateOrbitCursor(); });
bindRange("cameraFov", "camera_fov", (value) => `${value.toFixed(0)}°`);
bindRange("autoOrbit", "auto_orbit", (value) => `${value.toFixed(1)}°/s`);
bindRange("exposure", "exposure", (value) => value.toFixed(2));
bindRange("lightAzimuth", "light_azimuth", (value) => `${value.toFixed(0)}°`);
bindRange("lightElevation", "light_elevation", (value) => `${value.toFixed(0)}°`);
bindRange("lightIntensity", "light_intensity", (value) => value.toFixed(2));
bindRange("background", "background", (value) => value.toFixed(3));

byId("openScene").addEventListener("click", async () => {
  const selected = await call("open_gltf_file");
  if (selected) text("sourcePath", selected);
});
byId("sampleScene").addEventListener("click", () => call("load_sample_scene").catch(() => {}));
byId("fullscreen").addEventListener("click", () => call("toggle_renderer_fullscreen").catch(() => {}));
byId("backfaceCulling").addEventListener("change", (event) => call("set_backface_culling", { enabled: Boolean(event.target.checked) }).catch(() => {}));
byId("resetCamera").addEventListener("click", async () => {
  await call("reset_camera");
  setRange("cameraYaw", 28);
  setRange("cameraPitch", 18);
  setRange("cameraDistance", 4.2);
  setRange("cameraFov", 52);
  setRange("autoOrbit", 4);
});

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-view]").forEach((item) => item.classList.toggle("active", item === button));
    call("set_view_mode", { mode: button.dataset.view }).catch(() => {});
  });
});

const orbitPad = byId("orbitPad");
let dragging = false;
let lastX = 0;
let lastY = 0;
orbitPad.addEventListener("pointerdown", (event) => {
  dragging = true;
  lastX = event.clientX;
  lastY = event.clientY;
  orbitPad.setPointerCapture(event.pointerId);
});
orbitPad.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  const dx = event.clientX - lastX;
  const dy = event.clientY - lastY;
  lastX = event.clientX;
  lastY = event.clientY;
  yaw = Math.max(-180, Math.min(180, yaw + dx * 0.45));
  pitch = Math.max(-85, Math.min(85, pitch - dy * 0.38));
  byId("cameraYaw").value = String(yaw);
  byId("cameraPitch").value = String(pitch);
  text("cameraYawValue", `${yaw.toFixed(0)}°`);
  text("cameraPitchValue", `${pitch.toFixed(0)}°`);
  updateOrbitCursor();
  call("set_param", { name: "camera_yaw", value: yaw }).catch(() => {});
  call("set_param", { name: "camera_pitch", value: pitch }).catch(() => {});
});
const endDrag = (event) => {
  dragging = false;
  if (orbitPad.hasPointerCapture(event.pointerId)) orbitPad.releasePointerCapture(event.pointerId);
};
orbitPad.addEventListener("pointerup", endDrag);
orbitPad.addEventListener("pointercancel", endDrag);
orbitPad.addEventListener("wheel", (event) => {
  event.preventDefault();
  distance = Math.max(1.25, Math.min(12, distance + Math.sign(event.deltaY) * 0.22));
  byId("cameraDistance").value = String(distance);
  text("cameraDistanceValue", distance.toFixed(2));
  updateOrbitCursor();
  call("set_param", { name: "camera_distance", value: distance }).catch(() => {});
}, { passive: false });

if (!invoke) setStatus("Tauri bridge unavailable", true);
updateOrbitCursor();
pollInfo();
setInterval(pollInfo, 650);
