const invoke = window.__TAURI__.core.invoke;

const sliders = [
  ["zoom", "Zoom", 0.2, 4, 0.01, 1],
  ["exposure", "Exposure", 0, 3, 0.01, 1],
  ["contrast", "Contrast", 0, 2.5, 0.01, 1],
  ["saturation", "Saturation", 0, 2.5, 0.01, 1],
  ["effectStrength", "Effect strength", 0, 3, 0.01, 1],
  ["chroma", "RGB separation", 0, 0.05, 0.0005, 0.008],
  ["blockSize", "Block size", 1, 96, 1, 12],
  ["posterize", "Posterize levels", 2, 24, 1, 6]
];
const sliderRoot = document.querySelector("#sliders");
for (const [name, label, min, max, step, value] of sliders) {
  const wrapper = document.createElement("label");
  wrapper.className = "slider";
  wrapper.innerHTML = `<span>${label}</span><output id="${name}-value">${value}</output><input id="${name}" type="range" min="${min}" max="${max}" step="${step}" value="${value}">`;
  sliderRoot.append(wrapper);
  const input = wrapper.querySelector("input");
  const output = wrapper.querySelector("output");
  input.addEventListener("input", () => {
    output.value = input.value;
    invoke("set_param", { name, value: Number(input.value) }).catch(showError);
  });
}

const $ = (selector) => document.querySelector(selector);
let deviceSignature = "";

function showError(error) {
  $("#error").textContent = String(error ?? "Unknown error");
}

async function updateDevices() {
  const devices = await invoke("list_cameras");
  const signature = JSON.stringify(devices);
  if (signature === deviceSignature) return;
  deviceSignature = signature;
  const select = $("#camera-select");
  const previous = select.value;
  select.replaceChildren();
  if (!devices.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No camera devices available";
    select.append(option);
  } else {
    for (const device of devices) {
      const option = document.createElement("option");
      option.value = String(device.slot);
      option.textContent = `${device.name} · ${device.index}`;
      select.append(option);
    }
    if ([...select.options].some((option) => option.value === previous)) select.value = previous;
  }
  $("#camera-count").textContent = `${devices.length} device${devices.length === 1 ? "" : "s"}`;
}

async function poll() {
  try {
    const [camera, renderer] = await Promise.all([
      invoke("get_camera_status"),
      invoke("get_renderer_info")
    ]);
    await updateDevices();
    $("#permission").textContent = camera.permission;
    $("#camera-state").textContent = camera.streaming ? "streaming" : "stopped";
    $("#capture-format").textContent = camera.width ? `${camera.width}×${camera.height} @ ${camera.requestedFps}` : "—";
    $("#gpu").textContent = renderer.backend;
    $("#capture-fps").textContent = camera.captureFps.toFixed(1);
    $("#render-fps").textContent = renderer.fps.toFixed(1);
    $("#native-backend").textContent = camera.backend;
    $("#selected-camera").textContent = camera.selectedName || "—";
    $("#source-format").textContent = camera.sourceFormat || "—";
    $("#capture-wait").textContent = `${camera.captureWaitMs.toFixed(1)} ms`;
    $("#decode-time").textContent = `${camera.decodeMs.toFixed(1)} ms`;
    $("#format-candidates").textContent = camera.formatCandidates.toLocaleString();
    $("#recycled-buffers").textContent = camera.recycledBuffers.toLocaleString();
    $("#decoded-frames").textContent = camera.decodedFrames.toLocaleString();
    $("#decode-errors").textContent = camera.decodeErrors.toLocaleString();
    $("#capture-drops").textContent = Number(camera.droppedByCapture ?? 0).toLocaleString();
    $("#uploaded-frames").textContent = renderer.uploadedFrames.toLocaleString();
    $("#dropped-frames").textContent = renderer.droppedBeforeUpload.toLocaleString();
    $("#frame-age").textContent = `${renderer.cameraFrameAgeMs.toFixed(1)} ms`;
    $("#render-target").textContent = `${renderer.width}×${renderer.height} ← ${renderer.sourceWidth}×${renderer.sourceHeight}`;
    $("#surface-format").textContent = `${renderer.surfaceFormat} · ${renderer.adapterName}`;
    $("#error").textContent = camera.lastError || renderer.lastError || "";
  } catch (error) {
    showError(error);
  }
}

$("#refresh").addEventListener("click", () => invoke("refresh_cameras").catch(showError));
$("#start").addEventListener("click", () => {
  const slot = Number($("#camera-select").value);
  if (!Number.isInteger(slot)) return showError("Select a camera first.");
  invoke("start_camera", { slot, profile: $("#profile").value }).catch(showError);
});
$("#stop").addEventListener("click", () => invoke("stop_camera").catch(showError));
$("#fullscreen").addEventListener("click", () => invoke("toggle_renderer_fullscreen").catch(showError));
$("#mode").addEventListener("change", (event) => invoke("set_mode", { mode: event.target.value }).catch(showError));
$("#fit").addEventListener("change", (event) => invoke("set_fit_mode", { mode: event.target.value }).catch(showError));
$("#filter").addEventListener("change", (event) => invoke("set_filter_mode", { mode: event.target.value }).catch(showError));
$("#rotation").addEventListener("change", (event) => invoke("set_rotation", { rotation: Number(event.target.value) }).catch(showError));
$("#mirror").addEventListener("change", (event) => invoke("set_mirror", { mirrored: event.target.checked }).catch(showError));
$("#reset").addEventListener("click", async () => {
  await invoke("reset_params");
  for (const [name, , , , , value] of sliders) {
    $("#" + name).value = value;
    $("#" + name + "-value").value = value;
  }
  $("#mode").value = "clean";
  $("#fit").value = "cover";
  $("#filter").value = "linear";
  $("#rotation").value = "0";
  $("#mirror").checked = true;
});

poll();
setInterval(poll, 500);
