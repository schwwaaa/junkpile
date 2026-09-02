const invoke = window.__TAURI__.core.invoke;
const byId = (id) => document.getElementById(id);
let busy = false;
let latestSnapshot = null;

const number = (value) => Number(value || 0).toLocaleString();
const pretty = (value) => String(value ?? "—")
  .replace(/([a-z])([A-Z])/g, "$1 $2")
  .replace(/^./, (letter) => letter.toUpperCase());

function updateControlState() {
  const active = Boolean(latestSnapshot?.spout?.active);
  const featureEnabled = latestSnapshot?.spout?.featureEnabled === true;
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
    adapterIndex: Number(byId("adapterIndex").value),
    fpsN,
    fpsD,
    width,
    height,
    vflip: byId("verticalFlip").checked,
  };
}

function badgeClass(state) {
  if (state === "sending") return "running";
  if (state === "error") return "error";
  if (state === "starting") return "backpressured";
  return "disabled";
}

function setSnapshot(snapshot) {
  latestSnapshot = snapshot;
  const { renderer, frame, spout } = snapshot;
  const healthy = renderer.running && !renderer.lastError && !spout.lastError;
  byId("statusDot").className = `dot ${healthy ? "good" : "bad"}`;
  byId("statusText").textContent = spout.lastError || renderer.lastError || (spout.active ? "Spout source active" : "renderer ready");
  byId("frameCounter").textContent = `frame ${number(renderer.frameCount)}`;

  byId("featureBadge").textContent = spout.featureEnabled ? "Windows Spout feature compiled" : "Spout requires Windows";
  byId("featureBadge").className = `badge ${spout.featureEnabled ? "running" : "error"}`;
  byId("spoutState").textContent = spout.state;
  byId("spoutState").className = `badge ${badgeClass(spout.state)}`;
  byId("rendererState").textContent = renderer.running ? "running" : "stopped";
  byId("rendererState").className = `badge ${renderer.running ? "running" : "error"}`;

  byId("frameDimensions").textContent = `${number(frame.width)} × ${number(frame.height)}`;
  byId("pixelFormat").textContent = pretty(frame.pixelFormat);
  byId("origin").textContent = pretty(frame.origin);
  byId("colorSpace").textContent = pretty(frame.colorSpace);
  byId("nominalFps").textContent = `${frame.nominalFps.numerator}/${frame.nominalFps.denominator}`;
  byId("contractSummary").textContent = snapshot.contractSummary;

  byId("activeName").textContent = spout.name || "—";
  byId("activeFormat").textContent = `${number(spout.width)} × ${number(spout.height)} · ${spout.fpsN}/${spout.fpsD} fps`;
  byId("activeAdapter").textContent = spout.adapterIndex < 0 ? "Automatic" : `Adapter ${spout.adapterIndex}`;
  byId("rawBandwidth").textContent = `${Number(spout.rawMegabytesPerSecond || 0).toFixed(1)} MiB/s`;
  byId("captureRequests").textContent = number(spout.captureRequests);
  byId("readbacks").textContent = number(spout.readbacksCompleted);
  byId("framesSent").textContent = number(spout.framesSent);
  byId("gpuDrops").textContent = number(spout.droppedGpu);
  byId("cpuDrops").textContent = number(spout.droppedCpuPool);
  byId("workerDrops").textContent = number(spout.droppedWorker);
  byId("pendingWorker").textContent = `${number(spout.pendingWorker)} / 2`;
  byId("cpuBuffers").textContent = `${number(spout.cpuBuffersAvailable)} / 3`;
  byId("readbackBusy").textContent = `${number(spout.readbackSlotsBusy)} / 3`;
  byId("spoutLog").textContent = spout.lastError || spout.lastLog || "Spout sender is idle. Start it, then select Junkpile 38 in a Spout receiver.";
  byId("spoutLog").className = `log-box ${spout.lastError ? "error-log" : ""}`;

  byId("backend").textContent = renderer.backend;
  byId("adapter").textContent = renderer.adapterName;
  byId("surface").textContent = renderer.surfaceFormat;
  byId("windowSize").textContent = `${number(renderer.windowWidth)} × ${number(renderer.windowHeight)}`;
  byId("measuredFps").textContent = Number(renderer.fps || 0).toFixed(1);
  byId("frameTime").textContent = `${Number(renderer.frameTimeMs || 0).toFixed(2)} ms`;
  updateControlState();
}

async function refresh() {
  try { setSnapshot(await invoke("get_runtime_snapshot")); }
  catch (error) {
    byId("statusDot").className = "dot bad";
    byId("statusText").textContent = String(error);
  }
}

async function action(command, args = {}) {
  if (busy) return;
  busy = true;
  updateControlState();
  try {
    await invoke(command, args);
    await new Promise((resolve) => setTimeout(resolve, 160));
    await refresh();
  } catch (error) {
    byId("statusDot").className = "dot bad";
    byId("statusText").textContent = String(error);
    byId("spoutLog").textContent = String(error);
    byId("spoutLog").className = "log-box error-log";
  } finally {
    busy = false;
    updateControlState();
  }
}

byId("startButton").addEventListener("click", () => action("start_spout", { config: readConfig() }));
byId("stopButton").addEventListener("click", () => action("stop_spout"));
byId("resetButton").addEventListener("click", () => action("reset_metrics"));
byId("fullscreenButton").addEventListener("click", () => action("toggle_renderer_fullscreen"));

refresh();
setInterval(refresh, 500);
