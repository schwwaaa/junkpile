const invoke = window.__TAURI__.core.invoke;
const byId = (id) => document.getElementById(id);
let currentSinks = new Map();
let busy = false;

function pretty(value) {
  return String(value ?? "—")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function stateClass(state) {
  return String(state || "").toLowerCase();
}

function number(value) {
  return Number(value || 0).toLocaleString();
}

function setBusy(next) {
  busy = next;
  document.querySelectorAll("button, select").forEach((control) => {
    control.disabled = next;
  });
}

function sinkCard(sink) {
  const card = document.createElement("article");
  card.className = `sink card sink-${sink.id}`;
  const status = stateClass(sink.state);
  card.innerHTML = `
    <header>
      <div><span>${sink.kind}</span><strong>${sink.name}</strong></div>
      <span class="badge ${status}">${pretty(sink.state)}</span>
    </header>
    <p class="dimensions">${number(sink.width)} × ${number(sink.height)}</p>
    <dl>
      <div><dt>Accepts</dt><dd>${sink.accepts}</dd></div>
      <div><dt>Submitted</dt><dd>${number(sink.submitted)}</dd></div>
      <div><dt>Processed</dt><dd>${number(sink.processed)}</dd></div>
      <div><dt>Dropped</dt><dd class="${sink.dropped > 0 ? "drop-count" : ""}">${number(sink.dropped)}</dd></div>
      <div><dt>Pending</dt><dd>${number(sink.pending)}</dd></div>
      <div><dt>Last frame</dt><dd>${number(sink.lastFrame)}</dd></div>
    </dl>
    ${sink.lastError ? `<p class="sink-error">${sink.lastError}</p>` : ""}
  `;
  return card;
}

function updateToggle(id, buttonId, enabledLabel, disabledLabel) {
  const sink = currentSinks.get(id);
  if (!sink) return;
  byId(buttonId).textContent = sink.enabled ? enabledLabel : disabledLabel;
}

function setSnapshot(snapshot) {
  const { renderer, frame, sinks } = snapshot;
  currentSinks = new Map(sinks.map((sink) => [sink.id, sink]));

  byId("statusDot").className = `dot ${renderer.running && !renderer.lastError ? "good" : "bad"}`;
  byId("statusText").textContent = renderer.lastError || (renderer.running ? "contract active" : "renderer stopped");
  byId("frameCounter").textContent = `frame ${number(renderer.frameCount)}`;
  byId("rendererState").textContent = renderer.running ? "running" : "stopped";
  byId("rendererState").className = `badge ${renderer.running ? "running" : "error"}`;

  byId("frameDimensions").textContent = `${number(frame.width)} × ${number(frame.height)}`;
  byId("pixelFormat").textContent = pretty(frame.pixelFormat);
  byId("origin").textContent = pretty(frame.origin);
  byId("colorSpace").textContent = pretty(frame.colorSpace);
  byId("alphaMode").textContent = frame.alpha;
  byId("nominalFps").textContent = `${frame.nominalFps.numerator}/${frame.nominalFps.denominator}`;
  byId("contractSummary").textContent = snapshot.contractSummary;

  const sinkGrid = byId("sinkGrid");
  sinkGrid.replaceChildren(...sinks.map(sinkCard));

  byId("backend").textContent = renderer.backend;
  byId("adapter").textContent = renderer.adapterName;
  byId("surface").textContent = renderer.surfaceFormat;
  byId("windowSize").textContent = `${number(renderer.windowWidth)} × ${number(renderer.windowHeight)}`;
  byId("measuredFps").textContent = Number(renderer.fps || 0).toFixed(1);
  byId("frameTime").textContent = `${Number(renderer.frameTimeMs || 0).toFixed(2)} ms`;

  updateToggle("recording-stage", "recordingToggle", "Disable recording mirror", "Enable recording mirror");
  updateToggle("streaming-stage", "streamingToggle", "Disable streaming mirror", "Enable streaming mirror");
  updateToggle("cpu-worker-probe", "workerToggle", "Disable worker probe", "Enable worker probe");
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
    await new Promise((resolve) => setTimeout(resolve, 120));
    await refresh();
  } catch (error) {
    console.error(command, error);
    byId("statusDot").className = "dot bad";
    byId("statusText").textContent = String(error);
  } finally {
    setBusy(false);
  }
}

function toggleSink(id) {
  const sink = currentSinks.get(id);
  if (!sink) return;
  action("set_sink_enabled", { id, enabled: !sink.enabled });
}

byId("recordingToggle").addEventListener("click", () => toggleSink("recording-stage"));
byId("streamingToggle").addEventListener("click", () => toggleSink("streaming-stage"));
byId("workerToggle").addEventListener("click", () => toggleSink("cpu-worker-probe"));
byId("delaySelect").addEventListener("change", (event) => {
  action("set_worker_delay", { delayMs: Number(event.target.value) });
});
byId("resetButton").addEventListener("click", () => action("reset_metrics"));
byId("fullscreenButton").addEventListener("click", () => action("toggle_renderer_fullscreen"));

refresh();
setInterval(refresh, 500);
