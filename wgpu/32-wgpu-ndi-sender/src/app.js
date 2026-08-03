const invoke = window.__TAURI__.core.invoke;
const byId = (id) => document.getElementById(id);
let busy = false;
let latestSnapshot = null;

function number(value) {
  return Number(value || 0).toLocaleString();
}

function pretty(value) {
  return String(value ?? "—")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function setBusy(next) {
  busy = next;
  updateControlState();
}

function updateControlState() {
  const active = Boolean(latestSnapshot?.ndi?.active);
  const featureEnabled = latestSnapshot?.ndi?.featureEnabled !== false;
  byId("startButton").disabled = busy || active || !featureEnabled;
  byId("stopButton").disabled = busy || !active;
  byId("resetButton").disabled = busy;
  byId("fullscreenButton").disabled = busy;
  document.querySelectorAll("input, select").forEach((control) => {
    control.disabled = busy || active;
  });
}

function readConfig() {
  const [width, height] = byId("resolution").value.split("x").map(Number);
  const [fpsN, fpsD] = byId("frameRate").value.split("/").map(Number);
  const groups = byId("groups").value.trim();
  return {
    name: byId("sourceName").value.trim(),
    groups: groups || null,
    clockVideo: byId("clockVideo").checked,
    fpsN,
    fpsD,
    width,
    height,
    vflip: byId("verticalFlip").checked,
  };
}

function badgeClass(state) {
  const normalized = String(state || "idle").toLowerCase();
  if (normalized === "sending") return "running";
  if (normalized === "error") return "error";
  if (normalized === "starting") return "backpressured";
  return "disabled";
}

function setSnapshot(snapshot) {
  latestSnapshot = snapshot;
  const { renderer, frame, ndi } = snapshot;
  const healthy = renderer.running && !renderer.lastError && !ndi.lastError;
  byId("statusDot").className = `dot ${healthy ? "good" : "bad"}`;
  byId("statusText").textContent = ndi.lastError || renderer.lastError || (ndi.active ? "NDI source active" : "renderer ready");
  byId("frameCounter").textContent = `frame ${number(renderer.frameCount)}`;

  byId("featureBadge").textContent = ndi.featureEnabled ? "NDI feature compiled" : "NDI feature disabled";
  byId("featureBadge").className = `badge ${ndi.featureEnabled ? "running" : "error"}`;
  byId("ndiState").textContent = ndi.state;
  byId("ndiState").className = `badge ${badgeClass(ndi.state)}`;
  byId("rendererState").textContent = renderer.running ? "running" : "stopped";
  byId("rendererState").className = `badge ${renderer.running ? "running" : "error"}`;

  byId("frameDimensions").textContent = `${number(frame.width)} × ${number(frame.height)}`;
  byId("pixelFormat").textContent = pretty(frame.pixelFormat);
  byId("origin").textContent = pretty(frame.origin);
  byId("colorSpace").textContent = pretty(frame.colorSpace);
  byId("nominalFps").textContent = `${frame.nominalFps.numerator}/${frame.nominalFps.denominator}`;
  byId("contractSummary").textContent = snapshot.contractSummary;

  byId("activeName").textContent = ndi.name || "—";
  byId("activeFormat").textContent = `${number(ndi.width)} × ${number(ndi.height)} · ${ndi.fpsN}/${ndi.fpsD} fps`;
  byId("rawBandwidth").textContent = `${Number(ndi.rawMegabytesPerSecond || 0).toFixed(1)} MiB/s`;
  byId("captureRequests").textContent = number(ndi.captureRequests);
  byId("readbacks").textContent = number(ndi.readbacksCompleted);
  byId("framesSent").textContent = number(ndi.framesSent);
  byId("gpuDrops").textContent = number(ndi.droppedGpu);
  byId("cpuDrops").textContent = number(ndi.droppedCpuPool);
  byId("workerDrops").textContent = number(ndi.droppedWorker);
  byId("pendingWorker").textContent = `${number(ndi.pendingWorker)} / 2`;
  byId("cpuBuffers").textContent = `${number(ndi.cpuBuffersAvailable)} / 3`;
  byId("readbackBusy").textContent = `${number(ndi.readbackSlotsBusy)} / 3`;
  byId("ndiLog").textContent = ndi.lastError || ndi.lastLog || "NDI sender is idle. Start it and select the source in the official NDI monitor.";
  byId("ndiLog").className = `log-box ${ndi.lastError ? "error-log" : ""}`;

  byId("backend").textContent = renderer.backend;
  byId("adapter").textContent = renderer.adapterName;
  byId("surface").textContent = renderer.surfaceFormat;
  byId("windowSize").textContent = `${number(renderer.windowWidth)} × ${number(renderer.windowHeight)}`;
  byId("measuredFps").textContent = Number(renderer.fps || 0).toFixed(1);
  byId("frameTime").textContent = `${Number(renderer.frameTimeMs || 0).toFixed(2)} ms`;
  updateControlState();
}

async function refresh() {
  try {
    setSnapshot(await invoke("get_runtime_snapshot"));
  } catch (error) {
    console.error(error);
    byId("statusDot").className = "dot bad";
    byId("statusText").textContent = String(error);
  }
}

async function action(command, args = {}) {
  if (busy) return;
  setBusy(true);
  try {
    await invoke(command, args);
    await new Promise((resolve) => setTimeout(resolve, 160));
    await refresh();
  } catch (error) {
    console.error(command, error);
    byId("statusDot").className = "dot bad";
    byId("statusText").textContent = String(error);
    byId("ndiLog").textContent = String(error);
    byId("ndiLog").className = "log-box error-log";
  } finally {
    setBusy(false);
  }
}

byId("startButton").addEventListener("click", () => action("start_ndi", { config: readConfig() }));
byId("stopButton").addEventListener("click", () => action("stop_ndi"));
byId("resetButton").addEventListener("click", () => action("reset_metrics"));
byId("fullscreenButton").addEventListener("click", () => action("toggle_renderer_fullscreen"));

refresh();
setInterval(refresh, 500);
