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
  const active = Boolean(latestSnapshot?.syphon?.active);
  const featureEnabled = latestSnapshot?.syphon?.featureEnabled !== false;
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
  return {
    name: byId("sourceName").value.trim(),
    onlyWhenClients: byId("onlyWhenClients").checked,
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
  if (normalized === "waiting") return "backpressured";
  if (normalized === "error") return "error";
  if (normalized === "starting") return "backpressured";
  return "disabled";
}

function setSnapshot(snapshot) {
  latestSnapshot = snapshot;
  const { renderer, frame, syphon } = snapshot;
  const healthy = renderer.running && !renderer.lastError && !syphon.lastError;
  byId("statusDot").className = `dot ${healthy ? "good" : "bad"}`;
  byId("statusText").textContent = syphon.lastError || renderer.lastError || (syphon.active ? (syphon.hasClients ? "Syphon source publishing" : "Syphon source waiting for client") : "renderer ready");
  byId("frameCounter").textContent = `frame ${number(renderer.frameCount)}`;

  byId("featureBadge").textContent = syphon.featureEnabled ? "Syphon Metal compiled" : "Syphon unavailable";
  byId("featureBadge").className = `badge ${syphon.featureEnabled ? "running" : "error"}`;
  byId("syphonState").textContent = syphon.state;
  byId("syphonState").className = `badge ${badgeClass(syphon.state)}`;
  byId("clientBadge").textContent = syphon.hasClients ? "client connected" : "no client";
  byId("clientBadge").className = `badge ${syphon.hasClients ? "running" : "disabled"}`;
  byId("rendererState").textContent = renderer.running ? "running" : "stopped";
  byId("rendererState").className = `badge ${renderer.running ? "running" : "error"}`;

  byId("frameDimensions").textContent = `${number(frame.width)} × ${number(frame.height)}`;
  byId("pixelFormat").textContent = pretty(frame.pixelFormat);
  byId("origin").textContent = pretty(frame.origin);
  byId("colorSpace").textContent = pretty(frame.colorSpace);
  byId("nominalFps").textContent = `${frame.nominalFps.numerator}/${frame.nominalFps.denominator}`;
  byId("contractSummary").textContent = snapshot.contractSummary;

  byId("activeName").textContent = syphon.name || "—";
  byId("activeFormat").textContent = `${number(syphon.width)} × ${number(syphon.height)} · ${syphon.fpsN}/${syphon.fpsD} fps`;
  byId("rawBandwidth").textContent = `${Number(syphon.rawMegabytesPerSecond || 0).toFixed(1)} MiB/s`;
  byId("captureRequests").textContent = number(syphon.captureRequests);
  byId("readbacks").textContent = number(syphon.readbacksCompleted);
  byId("framesSent").textContent = number(syphon.framesSent);
  byId("skippedNoClients").textContent = number(syphon.skippedNoClients);
  byId("gpuDrops").textContent = number(syphon.droppedGpu);
  byId("cpuDrops").textContent = number(syphon.droppedCpuPool);
  byId("workerDrops").textContent = number(syphon.droppedWorker);
  byId("pendingWorker").textContent = `${number(syphon.pendingWorker)} / 2`;
  byId("cpuBuffers").textContent = `${number(syphon.cpuBuffersAvailable)} / 3`;
  byId("readbackBusy").textContent = `${number(syphon.readbackSlotsBusy)} / 3`;
  byId("syphonLog").textContent = syphon.lastError || syphon.lastLog || "Syphon sender is idle. Start it and select Junkpile 37 in a Syphon receiver.";
  byId("syphonLog").className = `log-box ${syphon.lastError ? "error-log" : ""}`;

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
    byId("syphonLog").textContent = String(error);
    byId("syphonLog").className = "log-box error-log";
  } finally {
    setBusy(false);
  }
}

byId("startButton").addEventListener("click", () => action("start_syphon", { config: readConfig() }));
byId("stopButton").addEventListener("click", () => action("stop_syphon"));
byId("resetButton").addEventListener("click", () => action("reset_metrics"));
byId("fullscreenButton").addEventListener("click", () => action("toggle_renderer_fullscreen"));

refresh();
setInterval(refresh, 500);
