const invoke = window.__TAURI__.core.invoke;
const byId = (id) => document.getElementById(id);

const state = {
  snapshot: null,
  document: { path: "", label: "untitled.wgsl", source: "", isPreset: false },
  dirty: false,
  compiling: false,
  autoTimer: null,
  lastFailedCount: 0,
  lastSuccessCount: 0,
};

const friendlyNames = {
  "01-kaleido-reactor.wgsl": "Kaleido Reactor",
  "02-plasma-warp.wgsl": "Plasma Warp",
  "03-infinite-tunnel.wgsl": "Infinite Tunnel",
  "04-voronoi-storm.wgsl": "Voronoi Storm",
  "05-fractal-nebula.wgsl": "Fractal Nebula",
  "06-mandelbrot-reactor.wgsl": "Mandelbrot Reactor",
  "07-raymarch-lattice.wgsl": "Raymarch Lattice",
  "08-caustic-engine.wgsl": "Caustic Engine",
  "09-hyperbolic-grid.wgsl": "Hyperbolic Grid",
  "10-interference-array.wgsl": "Interference Array",
  "11-volumetric-storm.wgsl": "Volumetric Storm",
  "12-recursive-glyph-field.wgsl": "Recursive Glyph Field",
};

const parameterNames = {
  u_gain: "Gain",
  u_zoom: "Zoom",
  u_spin: "Spin speed",
  u_complexity: "Complexity",
};

function basename(path) {
  return String(path || "").split(/[\\/]/).pop() || "untitled.wgsl";
}

function shortPreset(path) {
  const base = basename(path);
  return friendlyNames[base] || base.replace(/\.wgsl$/i, "").replace(/^\d+-/, "").replaceAll("-", " ");
}

function setMessage(message) {
  byId("actionMessage").textContent = message;
}

function setCompileBadge(kind, text) {
  const badge = byId("compileBadge");
  badge.className = `badge ${kind}`;
  badge.textContent = text;
}

function writeConsole(text, kind = "neutral", title = "Compiler output") {
  const consoleEl = byId("compilerConsole");
  consoleEl.textContent = text || "No diagnostics.";
  consoleEl.className = kind === "neutral" ? "" : kind;
  byId("consoleTitle").textContent = title;
}

function setBusy(isBusy) {
  state.compiling = isBusy;
  document.querySelectorAll("button").forEach((button) => {
    if (button.id !== "clearConsoleButton" && button.id !== "copyDiagnosticsButton") {
      button.disabled = isBusy;
    }
  });
  if (isBusy) setCompileBadge("busy", "COMPILING");
}

function updateDocumentChrome() {
  byId("documentLabel").textContent = state.document.label || basename(state.document.path);
  byId("documentPath").textContent = state.document.path || "Unsaved document";
  byId("documentMode").textContent = state.document.isPreset ? "PRESET" : "EXTERNAL";
  byId("dirtyDot").classList.toggle("active", state.dirty);
  document.title = `${state.dirty ? "● " : ""}${state.document.label} · Junkpile WGSL Playground`;
}

function updateSourceStats() {
  const editor = byId("shaderEditor");
  const source = editor.value;
  const lines = source.split("\n");
  byId("lineNumbers").textContent = lines.map((_, index) => index + 1).join("\n");
  byId("sourceStats").textContent = `${lines.length.toLocaleString()} lines · ${new Blob([source]).size.toLocaleString()} bytes`;
  updateCursorPosition();
}

function updateCursorPosition() {
  const editor = byId("shaderEditor");
  const before = editor.value.slice(0, editor.selectionStart);
  const line = before.split("\n").length;
  const lastBreak = before.lastIndexOf("\n");
  const column = editor.selectionStart - lastBreak;
  byId("cursorPosition").textContent = `Ln ${line}, Col ${column}`;
}

function applyDocument(documentState, { dirty = false, preservePreset = false } = {}) {
  if (!documentState) return;
  const wasPreset = state.document.isPreset;
  state.document = {
    path: documentState.path || "",
    label: documentState.label || basename(documentState.path),
    source: documentState.source || "",
    isPreset: preservePreset ? wasPreset : Boolean(documentState.isPreset),
  };
  state.dirty = dirty;
  const editor = byId("shaderEditor");
  editor.value = state.document.source;
  editor.scrollTop = 0;
  byId("lineNumbers").scrollTop = 0;
  updateDocumentChrome();
  updateSourceStats();
}

function markDirty() {
  state.dirty = true;
  updateDocumentChrome();
  if (byId("autoCompile").checked) scheduleAutoCompile();
}

function scheduleAutoCompile() {
  clearTimeout(state.autoTimer);
  state.autoTimer = setTimeout(() => compileEditor("automatic compile"), 650);
}

async function compileEditor(reason = "manual compile") {
  if (state.compiling) return false;
  clearTimeout(state.autoTimer);
  setBusy(true);
  const source = byId("shaderEditor").value;
  const label = state.document.label || "editor.wgsl";
  const started = performance.now();
  try {
    const result = await invoke("compile_shader_source", { source, label });
    const duration = performance.now() - started;
    writeConsole(`${result}\n\nPipeline replacement accepted. The editor document is ${state.dirty ? "compiled but not saved" : "compiled and saved"}.`, "good", "Compile successful");
    setCompileBadge("good", "COMPILED");
    setMessage(`${reason}: native pipeline updated in ${duration.toFixed(2)} ms.`);
    return true;
  } catch (error) {
    const diagnostics = String(error);
    writeConsole(`${diagnostics}\n\nThe previous native GPU pipeline remains active.`, "bad", "Compile rejected · last-known-good retained");
    setCompileBadge("bad", "REJECTED");
    setMessage(`${reason} failed. The running shader was not replaced.`);
    return false;
  } finally {
    setBusy(false);
  }
}

async function loadPreset(shader) {
  if (state.dirty && !window.confirm("Discard unsaved editor changes and load this preset?")) return;
  setBusy(true);
  try {
    const documentState = await invoke("load_preset", { shader });
    applyDocument(documentState);
    writeConsole(`Loaded and compiled ${shortPreset(shader)}.`, "good", "Preset loaded");
    setCompileBadge("good", "COMPILED");
    setMessage(`Preset loaded: ${shortPreset(shader)}.`);
    await refreshSnapshot();
  } catch (error) {
    writeConsole(String(error), "bad", "Preset load failed");
    setCompileBadge("bad", "REJECTED");
  } finally {
    setBusy(false);
  }
}

async function openShader() {
  if (state.dirty && !window.confirm("Discard unsaved editor changes and open another file?")) return;
  setBusy(true);
  try {
    const documentState = await invoke("open_shader_file");
    if (!documentState) {
      setMessage("Open cancelled.");
      return;
    }
    applyDocument(documentState);
    writeConsole(`Opened and compiled ${documentState.path}.`, "good", "External shader loaded");
    setCompileBadge("good", "COMPILED");
    setMessage(`Opened ${documentState.label}.`);
  } catch (error) {
    writeConsole(String(error), "bad", "Open failed");
    setCompileBadge("bad", "REJECTED");
  } finally {
    setBusy(false);
  }
}

async function saveShader() {
  setBusy(true);
  const preservePreset = state.document.isPreset;
  try {
    const documentState = await invoke("save_shader_file", {
      path: state.document.path || "",
      source: byId("shaderEditor").value,
    });
    applyDocument(documentState, { preservePreset });
    setMessage(`Saved ${documentState.path}. Active preset was not changed.`);
    writeConsole(`Saved ${documentState.path}.\n\nSaving does not select a different shader. Compile is controlled separately.`, "good", "Document saved");
  } catch (error) {
    if (String(error).includes("save cancelled")) setMessage("Save cancelled.");
    else writeConsole(String(error), "bad", "Save failed");
  } finally {
    setBusy(false);
  }
}

async function saveShaderAs() {
  setBusy(true);
  try {
    const documentState = await invoke("save_shader_as", { source: byId("shaderEditor").value });
    if (!documentState) {
      setMessage("Save As cancelled.");
      return;
    }
    applyDocument(documentState);
    setMessage(`Saved new WGSL document to ${documentState.path}.`);
    writeConsole(`Saved As ${documentState.path}.\n\nThe active GPU shader did not switch.`, "good", "Document saved as");
  } catch (error) {
    writeConsole(String(error), "bad", "Save As failed");
  } finally {
    setBusy(false);
  }
}

async function restorePreset() {
  if (!window.confirm("Restore the built-in source for the active preset?")) return;
  setBusy(true);
  try {
    const documentState = await invoke("restore_current_preset");
    applyDocument(documentState);
    writeConsole(`Restored ${documentState.label} from the built-in source.`, "good", "Preset restored");
    setCompileBadge("good", "COMPILED");
  } catch (error) {
    writeConsole(String(error), "bad", "Restore failed");
  } finally {
    setBusy(false);
  }
}

function renderPresets(snapshot) {
  const container = byId("presetList");
  const shaders = snapshot.shader.shaderVariants || [];
  const active = snapshot.shader.activeShader;
  container.replaceChildren();
  shaders.forEach((shader, index) => {
    const button = document.createElement("button");
    button.className = `preset-button${shader === active ? " active" : ""}`;
    button.innerHTML = `<span class="index">${String(index + 1).padStart(2, "0")}</span><span class="name">${shortPreset(shader)}</span>`;
    button.title = shader;
    button.addEventListener("click", () => loadPreset(shader));
    container.appendChild(button);
  });
}

function renderProfiles(snapshot) {
  byId("activeProfile").textContent = snapshot.shader.activeProfile || "—";
  const container = byId("profileList");
  container.replaceChildren();
  (snapshot.shader.profileNames || []).forEach((profile) => {
    const chip = document.createElement("span");
    chip.className = `profile-chip${profile === snapshot.shader.activeProfile ? " active" : ""}`;
    chip.textContent = profile;
    container.appendChild(chip);
  });
}

function renderParameters(snapshot) {
  const container = byId("parameterControls");
  const existing = new Map([...container.querySelectorAll("[data-param]")].map((element) => [element.dataset.param, element]));
  snapshot.parameters.forEach((parameter) => {
    let row = existing.get(parameter.name);
    if (!row) {
      row = document.createElement("div");
      row.className = "parameter-control";
      row.dataset.param = parameter.name;
      row.innerHTML = `
        <div class="parameter-label"><span></span><b></b></div>
        <input type="range">
        <div class="parameter-meta"><span class="minimum"></span><span class="target"></span><span class="maximum"></span></div>`;
      const input = row.querySelector("input");
      input.addEventListener("input", async () => {
        const value = Number(input.value);
        row.querySelector(".target").textContent = `target ${formatParameter(parameter.name, value)}`;
        try { await invoke("set_parameter", { name: parameter.name, value }); }
        catch (error) { writeConsole(String(error), "bad", "Parameter update failed"); }
      });
      container.appendChild(row);
    }
    const input = row.querySelector("input");
    input.min = parameter.min;
    input.max = parameter.max;
    input.step = parameter.name === "u_complexity" ? "1" : "0.01";
    if (document.activeElement !== input) input.value = parameter.target;
    row.querySelector(".parameter-label span").textContent = parameterNames[parameter.name] || parameter.name;
    row.querySelector(".parameter-label b").textContent = formatParameter(parameter.name, parameter.current);
    row.querySelector(".minimum").textContent = formatParameter(parameter.name, parameter.min);
    row.querySelector(".target").textContent = `target ${formatParameter(parameter.name, parameter.target)}`;
    row.querySelector(".maximum").textContent = formatParameter(parameter.name, parameter.max);
  });
}

function formatParameter(name, value) {
  if (name === "u_spin") return `${Number(value).toFixed(2)} rad/s`;
  if (name === "u_complexity") return Number(value).toFixed(0);
  return Number(value).toFixed(2);
}

function renderSnapshot(snapshot) {
  state.snapshot = snapshot;
  byId("gpuName").textContent = snapshot.renderer.adapterName || "Unknown GPU";
  byId("rendererFps").textContent = `${Number(snapshot.renderer.fps).toFixed(1)} FPS`;
  byId("frameTime").textContent = `${Number(snapshot.renderer.frameTimeMs).toFixed(2)} ms`;
  byId("activePreset").textContent = shortPreset(snapshot.shader.activeShader);
  byId("pipelineGeneration").textContent = snapshot.shader.pipelineGeneration.toLocaleString();
  byId("successfulReloads").textContent = snapshot.shader.successfulReloads.toLocaleString();
  byId("failedReloads").textContent = snapshot.shader.failedReloads.toLocaleString();
  byId("shaderTime").textContent = `${Number(snapshot.renderer.shaderTimeSeconds).toFixed(2)} s`;
  byId("timeState").textContent = snapshot.renderer.timePaused ? "PAUSED" : "RUNNING";
  byId("pauseButton").textContent = snapshot.renderer.timePaused ? "Resume time" : "Pause time";
  byId("surfaceSize").textContent = `${snapshot.renderer.windowWidth} × ${snapshot.renderer.windowHeight}`;
  renderPresets(snapshot);
  renderProfiles(snapshot);
  renderParameters(snapshot);

  if (snapshot.shader.failedReloads > state.lastFailedCount && snapshot.shader.lastReloadError) {
    writeConsole(`${snapshot.shader.lastReloadError}\n\nThe previous native GPU pipeline remains active.`, "bad", "External reload rejected");
    setCompileBadge("bad", "REJECTED");
  }
  state.lastFailedCount = snapshot.shader.failedReloads;
  state.lastSuccessCount = snapshot.shader.successfulReloads;
}

async function refreshSnapshot() {
  try {
    renderSnapshot(await invoke("get_runtime_snapshot"));
  } catch (error) {
    setMessage(`Snapshot unavailable: ${error}`);
  }
}

async function cycleProfile(direction) {
  try {
    await invoke("cycle_profile", { direction });
    await refreshSnapshot();
    setMessage("Profile targets applied. The editor document was not changed.");
  } catch (error) {
    writeConsole(String(error), "bad", "Profile selection failed");
  }
}

async function togglePause() {
  try {
    const paused = await invoke("toggle_time_pause");
    setMessage(paused ? "Shader time paused." : "Shader time resumed.");
    await refreshSnapshot();
  } catch (error) { writeConsole(String(error), "bad", "Time control failed"); }
}

async function resetTime() {
  try {
    await invoke("reset_shader_time");
    setMessage("Shader time reset to zero.");
    await refreshSnapshot();
  } catch (error) { writeConsole(String(error), "bad", "Time reset failed"); }
}

function exportDimensions() {
  const preset = byId("exportPreset").value;
  if (preset === "custom") return [Number(byId("exportWidth").value), Number(byId("exportHeight").value)];
  return preset.split("x").map(Number);
}

async function exportPng() {
  const [width, height] = exportDimensions();
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    writeConsole("Export width and height must be positive integers.", "bad", "Export rejected");
    return;
  }
  setBusy(true);
  setCompileBadge("busy", "EXPORTING");
  try {
    const path = await invoke("export_png", { width, height });
    if (!path) {
      setMessage("PNG export cancelled.");
      setCompileBadge("neutral", "READY");
      return;
    }
    writeConsole(`PNG export complete:\n${path}\n\nResolution: ${width} × ${height}`, "good", "Still exported");
    setCompileBadge("good", "EXPORTED");
    setMessage(`Exported ${width} × ${height} PNG.`);
  } catch (error) {
    writeConsole(String(error), "bad", "PNG export failed");
    setCompileBadge("bad", "EXPORT FAILED");
  } finally {
    setBusy(false);
  }
}

function handleEditorKeydown(event) {
  const editor = byId("shaderEditor");
  if (event.key === "Tab") {
    event.preventDefault();
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    editor.setRangeText("  ", start, end, "end");
    markDirty();
    updateSourceStats();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    compileEditor("keyboard compile");
  }
}

function handleGlobalShortcut(event) {
  if (!(event.metaKey || event.ctrlKey)) return;
  const key = event.key.toLowerCase();
  if (key === "o") { event.preventDefault(); openShader(); }
  else if (key === "s" && event.shiftKey) { event.preventDefault(); saveShaderAs(); }
  else if (key === "s") { event.preventDefault(); saveShader(); }
}

async function initialize() {
  try {
    const paths = await invoke("get_asset_paths");
    byId("assetRoot").textContent = paths.root;
    const documentState = await invoke("get_initial_document");
    applyDocument(documentState);
    await refreshSnapshot();
    setCompileBadge("good", "COMPILED");
    writeConsole("Built-in shader loaded. Edit WGSL directly, then compile. Invalid code cannot replace the running pipeline.", "good", "Playground ready");
    setMessage("Ready. Twelve presets, native compilation, file I/O, and high-resolution PNG export are available.");
  } catch (error) {
    writeConsole(String(error), "bad", "Initialization failed");
    setCompileBadge("bad", "FAILED");
  }
}

byId("shaderEditor").addEventListener("input", () => { markDirty(); updateSourceStats(); });
byId("shaderEditor").addEventListener("keydown", handleEditorKeydown);
byId("shaderEditor").addEventListener("click", updateCursorPosition);
byId("shaderEditor").addEventListener("keyup", updateCursorPosition);
byId("shaderEditor").addEventListener("scroll", () => { byId("lineNumbers").scrollTop = byId("shaderEditor").scrollTop; });
byId("openButton").addEventListener("click", openShader);
byId("saveButton").addEventListener("click", saveShader);
byId("saveAsButton").addEventListener("click", saveShaderAs);
byId("restorePresetButton").addEventListener("click", restorePreset);
byId("compileButton").addEventListener("click", () => compileEditor("manual compile"));
byId("pauseButton").addEventListener("click", togglePause);
byId("resetTimeButton").addEventListener("click", resetTime);
byId("fullscreenButton").addEventListener("click", () => invoke("toggle_renderer_fullscreen").catch((error) => writeConsole(String(error), "bad", "Fullscreen failed")));
byId("previousProfileButton").addEventListener("click", () => cycleProfile(-1));
byId("nextProfileButton").addEventListener("click", () => cycleProfile(1));
byId("openAssetsButton").addEventListener("click", () => invoke("open_assets_folder").catch((error) => writeConsole(String(error), "bad", "Could not open assets")));
byId("resetMetricsButton").addEventListener("click", () => invoke("reset_metrics").then(refreshSnapshot));
byId("exportButton").addEventListener("click", exportPng);
byId("exportPreset").addEventListener("change", () => byId("customResolution").classList.toggle("hidden", byId("exportPreset").value !== "custom"));
byId("autoCompile").addEventListener("change", () => {
  byId("autoCompileState").textContent = byId("autoCompile").checked ? "Auto compile on" : "Auto compile off";
  if (byId("autoCompile").checked && state.dirty) scheduleAutoCompile();
  else clearTimeout(state.autoTimer);
});
byId("copyDiagnosticsButton").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(byId("compilerConsole").textContent); setMessage("Compiler diagnostics copied."); }
  catch { setMessage("Clipboard access was unavailable."); }
});
byId("clearConsoleButton").addEventListener("click", () => writeConsole("Console cleared.", "neutral", "Compiler output"));
byId("documentMode").addEventListener("dblclick", restorePreset);
window.addEventListener("keydown", handleGlobalShortcut);
window.addEventListener("beforeunload", (event) => { if (state.dirty) { event.preventDefault(); event.returnValue = ""; } });

initialize();
setInterval(refreshSnapshot, 350);
