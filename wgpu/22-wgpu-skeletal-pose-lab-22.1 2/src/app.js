const invoke = window.__TAURI__?.core?.invoke;
const byId = (id) => document.getElementById(id);
const text = (id, value) => { const node = byId(id); if (node) node.textContent = value; };
const call = (command, args = {}) => {
  if (!invoke) return Promise.reject(new Error("Tauri bridge unavailable"));
  return invoke(command, args);
};

let latestInfo = null;
let sceneSignature = "";
let yaw = 28;
let pitch = 12;
let distance = 4.8;
let timelineDragging = false;
let jointDragging = false;

function setStatus(message, error = false) {
  const node = byId("status");
  node.textContent = message;
  node.classList.toggle("error", error);
}

function formatNumber(value) {
  return Number.isFinite(value) ? new Intl.NumberFormat().format(value) : "—";
}

function formatBounds(minimum, maximum) {
  if (!Array.isArray(minimum) || !Array.isArray(maximum)) return "—";
  const fmt = (values) => values.map((value) => Number(value).toFixed(2)).join(", ");
  return `[${fmt(minimum)}] → [${fmt(maximum)}]`;
}

function formatTime(value) {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

function updateOrbitCursor() {
  const cursor = byId("orbitCursor");
  const x = 50 + (yaw / 180) * 38;
  const y = 50 - (pitch / 85) * 38;
  cursor.style.left = `${Math.max(8, Math.min(92, x))}%`;
  cursor.style.top = `${Math.max(8, Math.min(92, y))}%`;
  text("cameraReadout", `yaw ${yaw.toFixed(0)}° · pitch ${pitch.toFixed(0)}° · distance ${distance.toFixed(2)}`);
}

function rebuildAnimations(info) {
  const select = byId("animationSelect");
  select.innerHTML = "";
  if (!info.animations?.length) {
    const option = document.createElement("option");
    option.textContent = "No animation clips";
    option.value = "0";
    select.append(option);
    select.disabled = true;
    return;
  }
  select.disabled = false;
  info.animations.forEach((animation) => {
    const option = document.createElement("option");
    option.value = String(animation.index);
    option.textContent = `${animation.name} · ${animation.duration.toFixed(2)} s`;
    select.append(option);
  });
  select.value = String(info.activeAnimationIndex ?? 0);
}

function rebuildJoints(info) {
  const select = byId("jointSelect");
  select.innerHTML = "";
  if (!info.joints?.length) {
    const option = document.createElement("option");
    option.textContent = "No joints in scene";
    option.value = "0";
    select.append(option);
    select.disabled = true;
    return;
  }
  select.disabled = false;
  info.joints.forEach((joint) => {
    const option = document.createElement("option");
    option.value = String(joint.listIndex);
    option.textContent = `${joint.skinJointIndex}: ${joint.name}`;
    select.append(option);
  });
  select.value = String(info.selectedJointIndex ?? 0);
}

function updateJointMeta(info) {
  const joint = info.joints?.[info.selectedJointIndex];
  if (!joint) {
    text("jointNode", "—"); text("jointParent", "—"); text("jointSlot", "—");
    return;
  }
  text("jointNode", `${joint.nodeIndex} · ${joint.name}`);
  text("jointParent", joint.parentName || "scene root");
  text("jointSlot", `${joint.skinIndex}:${joint.skinJointIndex}`);
  byId("jointSelect").value = String(info.selectedJointIndex);
  if (!jointDragging) {
    const rotation = info.selectedJointRotation || [0, 0, 0];
    ["jointX", "jointY", "jointZ"].forEach((id, index) => {
      byId(id).value = String(rotation[index] || 0);
      text(`${id}Value`, `${Number(rotation[index] || 0).toFixed(0)}°`);
    });
  }
}

function renderInfo(info) {
  latestInfo = info;
  const signature = `${info.sourcePath}|${info.nodeCount}|${info.jointCount}|${info.animationCount}`;
  if (signature !== sceneSignature) {
    sceneSignature = signature;
    rebuildAnimations(info);
    rebuildJoints(info);
  }

  text("sceneName", info.sceneName || "Unnamed scene");
  text("sourcePath", info.sourcePath || "—");
  text("nodeCount", formatNumber(info.nodeCount));
  text("meshCount", formatNumber(info.meshCount));
  text("skinCount", formatNumber(info.skinCount));
  text("jointCount", formatNumber(info.jointCount));
  text("animationCount", formatNumber(info.animationCount));
  text("channelCount", formatNumber(info.animations?.[info.activeAnimationIndex]?.channelCount || 0));
  text("vertexCount", formatNumber(info.vertexCount));
  text("weightedVertexCount", formatNumber(info.weightedVertexCount));
  text("triangleCount", formatNumber(info.triangleCount));
  text("boneSegmentCount", formatNumber(info.boneSegmentCount));
  text("bounds", formatBounds(info.boundsMin, info.boundsMax));
  text("loading", info.loading ? "loading" : "ready");

  text("backend", info.backend || "—");
  text("adapter", info.adapter || "—");
  text("resolution", `${info.width || 0} × ${info.height || 0}`);
  text("surfaceFormat", info.surfaceFormat || "—");
  text("depthFormat", info.depthFormat || "—");
  text("fps", Number(info.fps || 0).toFixed(1));
  text("frameTime", `${Number(info.frameTimeMs || 0).toFixed(2)} ms`);
  text("frameCount", formatNumber(info.frameCount));
  text("lastError", info.lastError || "none");

  const duration = Number(info.animationDuration || 0);
  const current = Number(info.animationTime || 0);
  if (!timelineDragging) {
    byId("animationTime").max = String(Math.max(duration, 0));
    byId("animationTime").value = String(Math.min(current, duration));
  }
  text("animationTimeValue", `${formatTime(current)} / ${formatTime(duration)} s`);
  text("animationState", info.animationPlaying ? "playing" : "paused");
  byId("animationState").classList.toggle("paused", !info.animationPlaying);
  byId("playPause").textContent = info.animationPlaying ? "Pause" : "Play";
  byId("animationLoop").checked = Boolean(info.animationLoop);
  byId("animationSelect").value = String(info.activeAnimationIndex || 0);
  byId("animationSpeed").value = String(info.animationSpeed ?? 1);
  text("animationSpeedValue", `${Number(info.animationSpeed ?? 1).toFixed(2)}×`);
  byId("animationBlend").value = String(info.animationBlend ?? 1);
  text("animationBlendValue", `${Math.round(Number(info.animationBlend ?? 1) * 100)}%`);

  yaw = Number(info.cameraYawDegrees ?? yaw);
  pitch = Number(info.cameraPitchDegrees ?? pitch);
  distance = Number(info.cameraDistance ?? distance);
  updateOrbitCursor();
  updateJointMeta(info);
  setStatus(info.lastError ? "renderer warning" : "renderer running", Boolean(info.lastError));
}

async function pollInfo() {
  try {
    renderInfo(await call("get_renderer_info"));
  } catch (error) {
    setStatus(String(error), true);
    text("lastError", String(error));
  }
}

function bindRange(id, commandName, outputFormatter) {
  const input = byId(id);
  input.addEventListener("input", () => {
    const value = Number(input.value);
    text(`${id}Value`, outputFormatter(value));
    call("set_param", { name: commandName, value }).catch((error) => text("lastError", String(error)));
  });
}

bindRange("cameraYaw", "camera_yaw", (value) => `${value.toFixed(0)}°`);
bindRange("cameraPitch", "camera_pitch", (value) => `${value.toFixed(0)}°`);
bindRange("cameraDistance", "camera_distance", (value) => value.toFixed(2));
bindRange("cameraFov", "camera_fov", (value) => `${value.toFixed(0)}°`);
bindRange("autoOrbit", "auto_orbit", (value) => `${value.toFixed(1)}°/s`);
bindRange("lightAzimuth", "light_azimuth", (value) => `${value.toFixed(0)}°`);
bindRange("lightElevation", "light_elevation", (value) => `${value.toFixed(0)}°`);
bindRange("lightIntensity", "light_intensity", (value) => value.toFixed(2));
bindRange("exposure", "exposure", (value) => value.toFixed(2));
bindRange("background", "background", (value) => value.toFixed(3));

byId("openScene").addEventListener("click", async () => {
  try {
    setStatus("choosing character…");
    await call("open_gltf_file");
  } catch (error) { setStatus(String(error), true); }
});
byId("sampleScene").addEventListener("click", () => call("load_sample_scene").catch((error) => setStatus(String(error), true)));
byId("fullscreen").addEventListener("click", () => call("toggle_renderer_fullscreen").catch((error) => setStatus(String(error), true)));
byId("resetCamera").addEventListener("click", () => call("reset_camera").catch(() => {}));

byId("animationSelect").addEventListener("change", (event) => {
  call("set_animation", { index: Number(event.target.value) }).catch((error) => text("lastError", String(error)));
});
byId("playPause").addEventListener("click", () => {
  call("set_animation_playing", { playing: !latestInfo?.animationPlaying }).catch((error) => text("lastError", String(error)));
});
byId("restartAnimation").addEventListener("click", () => call("set_animation_time", { time: 0 }).catch(() => {}));
byId("animationLoop").addEventListener("change", (event) => call("set_animation_loop", { looping: event.target.checked }).catch(() => {}));
const timeline = byId("animationTime");
timeline.addEventListener("pointerdown", () => { timelineDragging = true; });
timeline.addEventListener("pointerup", () => { timelineDragging = false; });
timeline.addEventListener("input", () => {
  const time = Number(timeline.value);
  text("animationTimeValue", `${formatTime(time)} / ${formatTime(Number(timeline.max))} s`);
  call("set_animation_time", { time }).catch(() => {});
});
byId("animationSpeed").addEventListener("input", (event) => {
  const speed = Number(event.target.value);
  text("animationSpeedValue", `${speed.toFixed(2)}×`);
  call("set_animation_speed", { speed }).catch(() => {});
});
byId("animationBlend").addEventListener("input", (event) => {
  const blend = Number(event.target.value);
  text("animationBlendValue", `${Math.round(blend * 100)}%`);
  call("set_animation_blend", { blend }).catch(() => {});
});

byId("jointSelect").addEventListener("change", (event) => {
  call("select_joint", { index: Number(event.target.value) }).catch((error) => text("lastError", String(error)));
});
function sendJointRotation() {
  const x = Number(byId("jointX").value);
  const y = Number(byId("jointY").value);
  const z = Number(byId("jointZ").value);
  call("set_joint_rotation", { x, y, z }).catch((error) => text("lastError", String(error)));
}
["jointX", "jointY", "jointZ"].forEach((id) => {
  const slider = byId(id);
  slider.addEventListener("pointerdown", () => { jointDragging = true; });
  slider.addEventListener("pointerup", () => { jointDragging = false; });
  slider.addEventListener("input", () => {
    text(`${id}Value`, `${Number(slider.value).toFixed(0)}°`);
    sendJointRotation();
  });
});
byId("resetJoint").addEventListener("click", () => call("reset_selected_joint").catch(() => {}));
byId("resetPose").addEventListener("click", () => call("reset_pose").catch(() => {}));
document.querySelectorAll("[data-pose]").forEach((button) => {
  button.addEventListener("click", () => call("apply_pose_preset", { name: button.dataset.pose }).catch(() => {}));
});

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-view]").forEach((item) => item.classList.toggle("active", item === button));
    call("set_view_mode", { mode: button.dataset.view }).catch(() => {});
  });
});
byId("showSkeleton").addEventListener("change", (event) => call("set_show_skeleton", { enabled: event.target.checked }).catch(() => {}));
byId("backfaceCulling").addEventListener("change", (event) => call("set_backface_culling", { enabled: event.target.checked }).catch(() => {}));

const orbitPad = byId("orbitPad");
let dragging = false;
let lastX = 0;
let lastY = 0;
orbitPad.addEventListener("pointerdown", (event) => {
  dragging = true; lastX = event.clientX; lastY = event.clientY; orbitPad.setPointerCapture(event.pointerId);
});
orbitPad.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  const dx = event.clientX - lastX; const dy = event.clientY - lastY;
  lastX = event.clientX; lastY = event.clientY;
  yaw = Math.max(-180, Math.min(180, yaw + dx * 0.45));
  pitch = Math.max(-85, Math.min(85, pitch - dy * 0.38));
  byId("cameraYaw").value = String(yaw); byId("cameraPitch").value = String(pitch);
  text("cameraYawValue", `${yaw.toFixed(0)}°`); text("cameraPitchValue", `${pitch.toFixed(0)}°`);
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
  distance = Math.max(1.25, Math.min(16, distance + Math.sign(event.deltaY) * 0.22));
  byId("cameraDistance").value = String(distance); text("cameraDistanceValue", distance.toFixed(2));
  updateOrbitCursor();
  call("set_param", { name: "camera_distance", value: distance }).catch(() => {});
}, { passive: false });

if (!invoke) setStatus("Tauri bridge unavailable", true);
updateOrbitCursor();
pollInfo();
setInterval(pollInfo, 500);
