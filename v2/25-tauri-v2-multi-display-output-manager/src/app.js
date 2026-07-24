const $ = (id) => document.getElementById(id);
const tauriEvent = window.__TAURI__?.event ?? null;
const tauriCore = window.__TAURI__?.core ?? null;
const invoke = tauriCore?.invoke?.bind(tauriCore) ?? null;
const tauriDialog = window.__TAURI__?.dialog ?? null;

const outputLabels = ["output-1", "output-2", "output-3"];
const sourceNames = ["A · Domain field", "B · Orbital grid", "C · Signal ribbons", "D · Calibration pulse"];

function defaultOutput(index) {
  return {
    label: outputLabels[index],
    name: `Output ${index + 1}`,
    online: false,
    visible: index === 0,
    source: index % 4,
    monitor: index,
    speed: 1,
    phase: index * 0.7,
    zoom: 1,
    panX: 0,
    panY: 0,
    rotation: 0,
    brightness: 1,
    saturation: 1,
    gamma: 1,
    feather: 0,
    mirrorX: false,
    mirrorY: false,
    showHud: true,
    showGrid: false,
    blackout: false,
    width: 0,
    height: 0,
    fps: 0,
    message: "Waiting for output window…"
  };
}

const state = {
  outputs: [defaultOutput(0), defaultOutput(1), defaultOutput(2)],
  monitors: [],
  master: { speed: 1, brightness: 1, phase: 0, epochMs: Date.now(), colorA: "#78e8ff", colorB: "#ff6fb5", colorC: "#79ff9f" },
  layouts: loadLayoutStore(),
  emitQueued: false,
  emitAgain: false,
  syncingUi: false
};

function loadLayoutStore() {
  try { return JSON.parse(localStorage.getItem("junkpile-v2-multi-display-layouts") || "[]"); }
  catch { return []; }
}

function persistLayouts() {
  localStorage.setItem("junkpile-v2-multi-display-layouts", JSON.stringify(state.layouts));
  refreshLayoutSelect();
}

function hexToRgb(hex) {
  const clean = String(hex || "#ffffff").replace("#", "");
  const value = Number.parseInt(clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean, 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function publicState() {
  return {
    master: { ...state.master, colorA: hexToRgb(state.master.colorA), colorB: hexToRgb(state.master.colorB), colorC: hexToRgb(state.master.colorC) },
    outputs: state.outputs.map((output) => ({
      label: output.label,
      name: output.name,
      source: output.source,
      speed: output.speed,
      phase: output.phase,
      zoom: output.zoom,
      panX: output.panX,
      panY: output.panY,
      rotation: output.rotation,
      brightness: output.brightness,
      saturation: output.saturation,
      gamma: output.gamma,
      feather: output.feather,
      mirrorX: output.mirrorX,
      mirrorY: output.mirrorY,
      showHud: output.showHud,
      showGrid: output.showGrid,
      blackout: output.blackout
    }))
  };
}

function scheduleStateEmit() {
  if (!tauriEvent) return;
  if (state.emitQueued) { state.emitAgain = true; return; }
  state.emitQueued = true;
  requestAnimationFrame(async () => {
    try { await tauriEvent.emit("multi-display-state", publicState()); }
    catch (error) { setSystemStatus(`State broadcast failed: ${error.message || error}`); }
    finally {
      state.emitQueued = false;
      if (state.emitAgain) { state.emitAgain = false; scheduleStateEmit(); }
    }
  });
}

async function sendCommand(label, command, payload = {}) {
  if (!tauriEvent) return;
  try { await tauriEvent.emit("multi-display-command", { label, command, ...payload }); }
  catch (error) { setSystemStatus(`${label}: ${error.message || error}`); }
}

function setSystemStatus(message) { $("system-status").textContent = message; }

function monitorOptionLabel(monitor, index) {
  return `${index + 1} · ${monitor.name || "Display"} · ${monitor.width}×${monitor.height} · ${monitor.x},${monitor.y}`;
}

function buildOutputCards() {
  const container = $("output-cards");
  container.replaceChildren();
  state.outputs.forEach((output, index) => {
    const card = document.createElement("article");
    card.className = `output-card${output.online ? " online" : ""}`;
    card.dataset.output = String(index);
    card.innerHTML = `
      <div class="output-card-head">
        <div class="output-title"><span class="status-dot"></span><strong>${output.name}</strong></div>
        <span class="output-meta" data-role="meta">${output.width ? `${output.width}×${output.height} · ${output.fps.toFixed(1)} fps` : output.message}</span>
      </div>
      <div class="output-body">
        <div class="route-row">
          <label>Source route<select data-field="source">${sourceNames.map((name, sourceIndex) => `<option value="${sourceIndex}">${name}</option>`).join("")}</select></label>
          <label>Target display<select data-field="monitor"></select></label>
        </div>
        <div class="control-grid">
          ${rangeControl("speed", "Local speed", 0, 3, .01, output.speed, "×")}
          ${rangeControl("phase", "Time offset", -6.283, 6.283, .01, output.phase, "")}
          ${rangeControl("zoom", "Zoom", .25, 4, .01, output.zoom, "×")}
          ${rangeControl("panX", "Pan X", -1, 1, .005, output.panX, "")}
          ${rangeControl("panY", "Pan Y", -1, 1, .005, output.panY, "")}
          ${rangeControl("rotation", "Rotation", -180, 180, .1, output.rotation, "°")}
          ${rangeControl("brightness", "Brightness", 0, 2, .01, output.brightness, "")}
          ${rangeControl("saturation", "Saturation", 0, 2, .01, output.saturation, "")}
          ${rangeControl("gamma", "Gamma", .2, 3, .01, output.gamma, "")}
          ${rangeControl("feather", "Edge feather", 0, .35, .002, output.feather, "")}
        </div>
        <div class="toggle-row">
          ${toggleControl("mirrorX", "Mirror X", output.mirrorX)}
          ${toggleControl("mirrorY", "Mirror Y", output.mirrorY)}
          ${toggleControl("showHud", "HUD", output.showHud)}
          ${toggleControl("showGrid", "Grid", output.showGrid)}
        </div>
        <div class="output-actions">
          <button data-action="move">Move</button>
          <button data-action="fullscreen">Fullscreen</button>
          <button data-action="show" class="ghost">Show</button>
          <button data-action="hide" class="ghost">Hide</button>
          <button data-action="snapshot" class="ghost">Snapshot</button>
        </div>
        <div class="button-grid two">
          <button data-action="blackout" class="${output.blackout ? "danger" : "ghost"}">${output.blackout ? "Restore" : "Blackout"}</button>
          <button data-action="reset" class="ghost">Reset output settings</button>
        </div>
      </div>`;
    container.append(card);
    bindOutputCard(card, index);
  });
  refreshMonitorSelects();
  updateOnlineCount();
}

function rangeControl(field, label, min, max, step, value, suffix) {
  const formatted = field === "rotation" ? Number(value).toFixed(1) : Number(value).toFixed(2);
  return `<label>${label}<output data-output-for="${field}">${formatted}${suffix}</output><input data-field="${field}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-suffix="${suffix}" /></label>`;
}

function toggleControl(field, label, checked) {
  return `<label class="toggle"><input data-field="${field}" type="checkbox" ${checked ? "checked" : ""} />${label}</label>`;
}

function bindOutputCard(card, index) {
  const output = state.outputs[index];
  card.querySelectorAll("[data-field]").forEach((element) => {
    const field = element.dataset.field;
    if (field === "source") element.value = String(output.source);
    if (field === "monitor") element.value = String(output.monitor);
    const handler = () => {
      if (state.syncingUi) return;
      if (element.type === "checkbox") output[field] = element.checked;
      else if (field === "source" || field === "monitor") output[field] = Number(element.value);
      else output[field] = Number(element.value);
      const readout = card.querySelector(`[data-output-for="${field}"]`);
      if (readout) {
        const suffix = element.dataset.suffix || "";
        readout.textContent = `${field === "rotation" ? Number(element.value).toFixed(1) : Number(element.value).toFixed(2)}${suffix}`;
      }
      scheduleStateEmit();
    };
    element.addEventListener("input", handler);
    element.addEventListener("change", handler);
  });
  card.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => handleOutputAction(index, button.dataset.action)));
}

async function handleOutputAction(index, action) {
  const output = state.outputs[index];
  const label = output.label;
  if (action === "move") await moveWindowToMonitor(label, output.monitor, false);
  else if (action === "fullscreen") await moveWindowToMonitor(label, output.monitor, true);
  else if (action === "show") { try { await nativeWindowCommand("show_output", { label }); } catch (error) { setSystemStatus(`${label}: ${error.message || error}`); } }
  else if (action === "hide") { try { await nativeWindowCommand("hide_output", { label }); } catch (error) { setSystemStatus(`${label}: ${error.message || error}`); } }
  else if (action === "snapshot") await sendCommand(label, "snapshot");
  else if (action === "blackout") {
    output.blackout = !output.blackout;
    scheduleStateEmit();
    buildOutputCards();
  } else if (action === "reset") {
    const fresh = defaultOutput(index);
    Object.assign(output, { ...fresh, online: output.online, width: output.width, height: output.height, fps: output.fps, message: output.message, monitor: output.monitor });
    buildOutputCards();
    scheduleStateEmit();
  }
}

async function nativeWindowCommand(command, args = {}) {
  if (!invoke) throw new Error("Tauri command API is unavailable");
  return invoke(command, args);
}

async function moveWindowToMonitor(label, monitorIndex, fullscreen) {
  try {
    const message = await nativeWindowCommand("place_output", { label, index: monitorIndex, fullscreen });
    setSystemStatus(message);
  } catch (error) {
    setSystemStatus(`${label}: ${error.message || error}`);
  }
}

async function refreshMonitors() {
  try {
    state.monitors = invoke ? await invoke("list_monitors") : [];
    state.monitors = (state.monitors || []).map((monitor) => ({
      name: monitor.name || "Display",
      width: Number(monitor.width || 0),
      height: Number(monitor.height || 0),
      x: Number(monitor.x || 0),
      y: Number(monitor.y || 0),
      scaleFactor: Number(monitor.scaleFactor || 1)
    }));
    $("monitor-strip").textContent = state.monitors.length
      ? state.monitors.map(monitorOptionLabel).join("   |   ")
      : "No displays reported by the native Tauri window API.";
    refreshMonitorSelects();
    setSystemStatus(`${state.monitors.length || 0} display(s) detected.`);
  } catch (error) {
    state.monitors = [];
    $("monitor-strip").textContent = `Display enumeration failed: ${error.message || error}`;
  }
}

function refreshMonitorSelects() {
  document.querySelectorAll('[data-field="monitor"]').forEach((select, index) => {
    const current = state.outputs[index]?.monitor || 0;
    select.replaceChildren();
    if (!state.monitors.length) select.add(new Option("Current display", "0"));
    state.monitors.forEach((monitor, monitorIndex) => select.add(new Option(monitorOptionLabel(monitor, monitorIndex), String(monitorIndex))));
    select.value = String(Math.min(current, Math.max(0, state.monitors.length - 1)));
  });
}

function updateOnlineCount() {
  const count = state.outputs.filter((output) => output.online).length;
  $("online-count").textContent = `${count} / 3`;
}

function refreshOutputCardStatus(index) {
  const card = document.querySelector(`[data-output="${index}"]`);
  if (!card) return;
  const output = state.outputs[index];
  card.classList.toggle("online", output.online);
  const meta = card.querySelector('[data-role="meta"]');
  if (meta) meta.textContent = output.width ? `${output.width}×${output.height} · ${output.fps.toFixed(1)} fps` : output.message;
  updateOnlineCount();
}

function syncAllOutputs() {
  const source = state.outputs[0];
  state.outputs.slice(1).forEach((output, index) => {
    const monitor = output.monitor;
    const online = output.online;
    const telemetry = { width: output.width, height: output.height, fps: output.fps, message: output.message };
    Object.assign(output, JSON.parse(JSON.stringify(source)), { label: outputLabels[index + 1], name: `Output ${index + 2}`, monitor, online, ...telemetry });
  });
  buildOutputCards();
  scheduleStateEmit();
  setSystemStatus("Output 1 settings copied to Outputs 2 and 3.");
}

async function applyAllWindowAction(action) {
  for (const output of state.outputs) {
    try {
      if (action === "show") await nativeWindowCommand("show_output", { label: output.label });
      else if (action === "hide") await nativeWindowCommand("hide_output", { label: output.label });
      else if (action === "fullscreen") await moveWindowToMonitor(output.label, output.monitor, true);
      else if (action === "window") await nativeWindowCommand("set_output_fullscreen", { label: output.label, fullscreen: false });
    } catch (error) {
      setSystemStatus(`${output.label}: ${error.message || error}`);
    }
  }
}

function serializeLayout(name = $("layout-name").value.trim() || "Display layout") {
  return {
    version: 2,
    name,
    savedAt: new Date().toISOString(),
    master: { speed: state.master.speed, brightness: state.master.brightness, phase: state.master.phase, colorA: state.master.colorA, colorB: state.master.colorB, colorC: state.master.colorC },
    outputs: state.outputs.map((output) => {
      const copy = { ...output };
      delete copy.online; delete copy.width; delete copy.height; delete copy.fps; delete copy.message;
      return copy;
    })
  };
}

function applyLayout(layout) {
  if (!layout || !Array.isArray(layout.outputs)) throw new Error("This is not a valid multi-display layout.");
  const epochMs = state.master.epochMs;
  Object.assign(state.master, layout.master || {}, { epochMs });
  layout.outputs.slice(0, 3).forEach((saved, index) => {
    const output = state.outputs[index];
    const telemetry = { online: output.online, width: output.width, height: output.height, fps: output.fps, message: output.message };
    Object.assign(output, saved, { label: outputLabels[index], name: `Output ${index + 1}`, ...telemetry });
  });
  syncMasterControls();
  buildOutputCards();
  scheduleStateEmit();
  setSystemStatus(`Loaded layout “${layout.name || "Untitled"}”.`);
}

function refreshLayoutSelect() {
  const select = $("layout-select");
  const selected = select.value;
  select.replaceChildren();
  if (!state.layouts.length) select.add(new Option("No saved layouts", ""));
  state.layouts.forEach((layout, index) => select.add(new Option(layout.name || `Layout ${index + 1}`, String(index))));
  if (selected && Number(selected) < state.layouts.length) select.value = selected;
}

function syncMasterControls() {
  state.syncingUi = true;
  $("master-speed").value = String(state.master.speed);
  $("master-brightness").value = String(state.master.brightness);
  $("global-phase").value = String(state.master.phase);
  $("color-a").value = state.master.colorA;
  $("color-b").value = state.master.colorB;
  $("color-c").value = state.master.colorC;
  $("master-speed-output").textContent = `${Number(state.master.speed).toFixed(2)}×`;
  $("master-brightness-output").textContent = Number(state.master.brightness).toFixed(2);
  $("global-phase-output").textContent = Number(state.master.phase).toFixed(2);
  state.syncingUi = false;
}

async function exportLayout() {
  const layout = serializeLayout();
  const text = JSON.stringify(layout, null, 2);
  const filename = `junkpile-25-${layout.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "layout"}.json`;
  try {
    if (tauriDialog?.save && invoke) {
      const path = await tauriDialog.save({ defaultPath: filename, filters: [{ name: "JSON layout", extensions: ["json"] }] });
      if (!path) return;
      await invoke("write_binary", { path, bytes: Array.from(new TextEncoder().encode(text)) });
      setSystemStatus(`Layout exported to ${path}`);
    } else {
      const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
    }
  } catch (error) { setSystemStatus(`Could not export layout: ${error.message || error}`); }
}

function bindGlobalControls() {
  $("refresh-monitors").addEventListener("click", refreshMonitors);
  $("show-all").addEventListener("click", () => applyAllWindowAction("show"));
  $("hide-all").addEventListener("click", () => applyAllWindowAction("hide"));
  $("fullscreen-all").addEventListener("click", () => applyAllWindowAction("fullscreen"));
  $("window-all").addEventListener("click", () => applyAllWindowAction("window"));
  $("sync-all").addEventListener("click", syncAllOutputs);
  $("blackout-all").addEventListener("click", () => { state.outputs.forEach((output) => { output.blackout = true; }); buildOutputCards(); scheduleStateEmit(); });
  $("restore-all").addEventListener("click", () => { state.outputs.forEach((output) => { output.blackout = false; }); buildOutputCards(); scheduleStateEmit(); });

  [["master-speed", "speed", "master-speed-output", "×"], ["master-brightness", "brightness", "master-brightness-output", ""], ["global-phase", "phase", "global-phase-output", ""]].forEach(([id, key, outputId, suffix]) => {
    $(id).addEventListener("input", () => {
      state.master[key] = Number($(id).value);
      $(outputId).textContent = `${Number($(id).value).toFixed(2)}${suffix}`;
      scheduleStateEmit();
    });
  });
  [["color-a", "colorA"], ["color-b", "colorB"], ["color-c", "colorC"]].forEach(([id, key]) => $(id).addEventListener("input", () => { state.master[key] = $(id).value; scheduleStateEmit(); }));

  $("save-layout").addEventListener("click", () => {
    const layout = serializeLayout();
    const existing = state.layouts.findIndex((item) => item.name === layout.name);
    if (existing >= 0) state.layouts[existing] = layout; else state.layouts.push(layout);
    persistLayouts();
    $("layout-select").value = String(existing >= 0 ? existing : state.layouts.length - 1);
    setSystemStatus(`Saved layout “${layout.name}”.`);
  });
  $("load-layout").addEventListener("click", () => { const layout = state.layouts[Number($("layout-select").value)]; if (layout) applyLayout(layout); });
  $("delete-layout").addEventListener("click", () => { const index = Number($("layout-select").value); if (state.layouts[index]) { state.layouts.splice(index, 1); persistLayouts(); setSystemStatus("Layout deleted."); } });
  $("export-layout").addEventListener("click", exportLayout);
  $("import-layout").addEventListener("change", async () => {
    const file = $("import-layout").files?.[0]; if (!file) return;
    try { const layout = JSON.parse(await file.text()); applyLayout(layout); state.layouts.push(layout); persistLayouts(); }
    catch (error) { setSystemStatus(`Could not import layout: ${error.message || error}`); }
    finally { $("import-layout").value = ""; }
  });
}

async function bindTauriEvents() {
  if (!tauriEvent) { setSystemStatus("Tauri event API unavailable."); return; }
  await tauriEvent.listen("multi-display-ready", (event) => {
    const label = event.payload?.label;
    const index = outputLabels.indexOf(label);
    if (index >= 0) {
      state.outputs[index].online = true;
      state.outputs[index].message = "Connected";
      refreshOutputCardStatus(index);
      scheduleStateEmit();
    }
  });
  await tauriEvent.listen("multi-display-status", (event) => {
    const payload = event.payload || {};
    const index = outputLabels.indexOf(payload.label);
    if (index < 0) return;
    const output = state.outputs[index];
    output.online = true;
    if (payload.width) output.width = payload.width;
    if (payload.height) output.height = payload.height;
    if (Number.isFinite(payload.fps)) output.fps = payload.fps;
    if (payload.message) output.message = payload.message;
    refreshOutputCardStatus(index);
  });
}

async function initialize() {
  buildOutputCards();
  bindGlobalControls();
  syncMasterControls();
  refreshLayoutSelect();
  await bindTauriEvents();
  await refreshMonitors();
  scheduleStateEmit();
  setInterval(() => outputLabels.forEach((label) => sendCommand(label, "ping")), 1800);
  setSystemStatus("Multi-display manager ready.");
}

initialize().catch((error) => { console.error(error); setSystemStatus(error.message || String(error)); });
