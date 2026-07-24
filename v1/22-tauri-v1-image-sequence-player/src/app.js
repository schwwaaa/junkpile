const $ = (id) => document.getElementById(id);
const tauri = window.__TAURI__ || {};
const tauriEvent = tauri.event;
const tauriDialog = tauri.dialog;
const tauriWindow = tauri.window;
const invoke = tauri.tauri?.invoke;

const ui = {
  outputDot: $("output-dot"), outputStatus: $("output-status"), footerStatus: $("footer-status"),
  loadFolder: $("load-folder"), loadFiles: $("load-files"), loadDemo: $("load-demo"), recursiveScan: $("recursive-scan"), dropZone: $("drop-zone"),
  sequenceName: $("sequence-name"), frameCount: $("frame-count"), sourceSize: $("source-size"), cacheStatus: $("cache-status"), firstFile: $("first-file"), lastFile: $("last-file"),
  jumpStart: $("jump-start"), stepBack: $("step-back"), playPause: $("play-pause"), stepForward: $("step-forward"), jumpEnd: $("jump-end"), reverse: $("reverse"), timeline: $("timeline"), currentFrame: $("current-frame"), playDirection: $("play-direction"), timecode: $("timecode"),
  sequenceFps: $("sequence-fps"), sequenceFpsOutput: $("sequence-fps-output"), playbackRate: $("playback-rate"), playbackRateOutput: $("playback-rate-output"), loopMode: $("loop-mode"), frameHandling: $("frame-handling"), inFrame: $("in-frame"), outFrame: $("out-frame"), interpolate: $("interpolate"), startPaused: $("start-paused"), outputFps: $("output-fps"), droppedFrames: $("dropped-frames"), decodeStatus: $("decode-status"),
  cacheStrategy: $("cache-strategy"), cacheRadius: $("cache-radius"), cacheRadiusOutput: $("cache-radius-output"), preloadNow: $("preload-now"), clearCache: $("clear-cache"), retryErrors: $("retry-errors"), cacheDetail: $("cache-detail"), cacheMeterFill: $("cache-meter-fill"),
  fitMode: $("fit-mode"), backgroundColor: $("background-color"), zoom: $("zoom"), zoomOutput: $("zoom-output"), rotation: $("rotation"), rotationOutput: $("rotation-output"), panX: $("pan-x"), panXOutput: $("pan-x-output"), panY: $("pan-y"), panYOutput: $("pan-y-output"), brightness: $("brightness"), brightnessOutput: $("brightness-output"), contrast: $("contrast"), contrastOutput: $("contrast-output"), saturation: $("saturation"), saturationOutput: $("saturation-output"), gamma: $("gamma"), gammaOutput: $("gamma-output"), mirrorX: $("mirror-x"), mirrorY: $("mirror-y"), showGrid: $("show-grid"), resetImage: $("reset-image"),
  displaySelect: $("display-select"), refreshDisplays: $("refresh-displays"), moveDisplay: $("move-display"), fullscreenOutput: $("fullscreen-output"), snapshotOutput: $("snapshot-output"), showOutput: $("show-output"), hideOutput: $("hide-output"), outputSize: $("output-size")
};

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const imageExtensions = /\.(png|jpe?g|webp|bmp|gif|tiff?)$/i;
const basename = (path) => String(path).split(/[\\/]/).pop() || path;
const dirname = (path) => String(path).replace(/[\\/][^\\/]*$/, "") || "Sequence";

const state = {
  count: 180,
  current: 0,
  direction: 1,
  playing: false,
  timelineDragging: false,
  emitQueued: false,
  configInFlight: false,
  pendingConfig: null,
  outputOnline: false,
  monitors: [],
  sequenceName: "Generated demo",
  firstFile: "demo_0001.png",
  lastFile: "demo_0180.png",
  lastSequence: { command: "load-demo", payload: { count: 180, startPaused: false } }
};

function setStatus(message) {
  ui.footerStatus.textContent = message;
  if (message) ui.outputStatus.textContent = message;
}

function setOutputOnline(online, message) {
  state.outputOnline = online;
  ui.outputDot.classList.toggle("online", online);
  if (message) ui.outputStatus.textContent = message;
}

function configurationPayload() {
  const count = Math.max(1, state.count);
  const inFrame = Math.max(0, Math.min(count - 1, Number(ui.inFrame.value || 1) - 1));
  const outFrame = Math.max(inFrame, Math.min(count - 1, Number(ui.outFrame.value || count) - 1));
  return {
    playback: {
      fps: Number(ui.sequenceFps.value),
      rate: Number(ui.playbackRate.value),
      loopMode: ui.loopMode.value,
      handling: ui.frameHandling.value,
      inFrame,
      outFrame,
      interpolate: ui.interpolate.checked
    },
    cache: {
      strategy: ui.cacheStrategy.value,
      radius: Number(ui.cacheRadius.value)
    },
    image: {
      fit: ui.fitMode.value,
      background: ui.backgroundColor.value,
      zoom: Number(ui.zoom.value),
      rotation: Number(ui.rotation.value) * Math.PI / 180,
      panX: Number(ui.panX.value),
      panY: Number(ui.panY.value),
      brightness: Number(ui.brightness.value),
      contrast: Number(ui.contrast.value),
      saturation: Number(ui.saturation.value),
      gamma: Number(ui.gamma.value),
      mirrorX: ui.mirrorX.checked,
      mirrorY: ui.mirrorY.checked,
      showGrid: ui.showGrid.checked
    }
  };
}

function updateReadouts() {
  ui.sequenceFpsOutput.textContent = `${Number(ui.sequenceFps.value).toFixed(0)}`;
  ui.playbackRateOutput.textContent = `${Number(ui.playbackRate.value).toFixed(2)}×`;
  ui.cacheRadiusOutput.textContent = `±${Number(ui.cacheRadius.value).toFixed(0)}`;
  ui.zoomOutput.textContent = `${Number(ui.zoom.value).toFixed(2)}×`;
  ui.rotationOutput.textContent = `${Number(ui.rotation.value).toFixed(1)}°`;
  ui.panXOutput.textContent = Number(ui.panX.value).toFixed(3);
  ui.panYOutput.textContent = Number(ui.panY.value).toFixed(3);
  ui.brightnessOutput.textContent = Number(ui.brightness.value).toFixed(2);
  ui.contrastOutput.textContent = Number(ui.contrast.value).toFixed(2);
  ui.saturationOutput.textContent = Number(ui.saturation.value).toFixed(2);
  ui.gammaOutput.textContent = Number(ui.gamma.value).toFixed(2);
}

function scheduleConfig() {
  updateReadouts();
  state.pendingConfig = configurationPayload();
  if (state.emitQueued) return;
  state.emitQueued = true;
  requestAnimationFrame(flushConfig);
}

async function flushConfig() {
  state.emitQueued = false;
  if (!tauriEvent || state.configInFlight || !state.pendingConfig) {
    if (state.pendingConfig && !state.emitQueued) { state.emitQueued = true; requestAnimationFrame(flushConfig); }
    return;
  }
  const payload = state.pendingConfig;
  state.pendingConfig = null;
  state.configInFlight = true;
  try { await tauriEvent.emit("sequence-config", payload); }
  catch (error) { console.error("Could not send sequence configuration", error); }
  finally {
    state.configInFlight = false;
    if (state.pendingConfig && !state.emitQueued) { state.emitQueued = true; requestAnimationFrame(flushConfig); }
  }
}

async function sendCommand(command, payload = {}) {
  if (!tauriEvent) return;
  try { await tauriEvent.emit("sequence-command", { command, ...payload }); }
  catch (error) { console.error(`Sequence command failed: ${command}`, error); setStatus(error.message || String(error)); }
}

function applySequenceMetadata({ name, paths, count }) {
  state.count = Math.max(1, Number(count) || paths?.length || 1);
  state.current = 0;
  state.sequenceName = name || "Image sequence";
  state.firstFile = paths?.length ? basename(paths[0]) : "demo_0001.png";
  state.lastFile = paths?.length ? basename(paths[paths.length - 1]) : `demo_${String(state.count).padStart(4, "0")}.png`;
  ui.sequenceName.textContent = state.sequenceName;
  ui.frameCount.textContent = String(state.count);
  ui.firstFile.textContent = state.firstFile;
  ui.lastFile.textContent = state.lastFile;
  ui.timeline.min = "0"; ui.timeline.max = String(Math.max(0, state.count - 1)); ui.timeline.value = "0";
  ui.inFrame.min = "1"; ui.inFrame.max = String(state.count); ui.inFrame.value = "1";
  ui.outFrame.min = "1"; ui.outFrame.max = String(state.count); ui.outFrame.value = String(state.count);
  ui.currentFrame.textContent = `Frame 1 / ${state.count}`;
  scheduleConfig();
}

function naturalSortPaths(paths) {
  return [...new Set(paths.filter((path) => imageExtensions.test(path)))].sort((a, b) => collator.compare(basename(a), basename(b)));
}

async function loadSequencePaths(paths, name) {
  const sorted = naturalSortPaths(paths);
  if (!sorted.length) throw new Error("No supported image frames were found. Use PNG, JPEG, WebP, BMP, GIF, TIFF, or TIF files.");
  const sequenceName = name || basename(dirname(sorted[0])) || "Image sequence";
  applySequenceMetadata({ name: sequenceName, paths: sorted, count: sorted.length });
  setStatus(`Loading ${sorted.length} frames…`);
  state.lastSequence = { command: "load-sequence", payload: { paths: sorted, name: sequenceName, startPaused: ui.startPaused.checked } };
  await sendCommand(state.lastSequence.command, state.lastSequence.payload);
}

async function chooseFolder() {
  if (!tauriDialog?.open || !invoke) throw new Error("The Tauri folder dialog or Rust scanner is unavailable.");
  const selected = await tauriDialog.open({ directory: true, multiple: false, title: "Choose an image-sequence folder" });
  if (!selected || Array.isArray(selected)) return;
  setStatus("Scanning folder…");
  const paths = await invoke("scan_sequence_directory", { path: selected, recursive: ui.recursiveScan.checked });
  await loadSequencePaths(paths, basename(selected));
}

async function chooseFiles() {
  if (!tauriDialog?.open) throw new Error("The Tauri file dialog is unavailable.");
  const selected = await tauriDialog.open({
    multiple: true,
    directory: false,
    title: "Choose image-sequence frames",
    filters: [{ name: "Image frames", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif", "tif", "tiff"] }]
  });
  if (!selected) return;
  await loadSequencePaths(Array.isArray(selected) ? selected : [selected], "Selected frames");
}

async function loadDemo() {
  applySequenceMetadata({ name: "Generated demo", count: 180, paths: [] });
  ui.sourceSize.textContent = "1280 × 720";
  ui.cacheStatus.textContent = "procedural";
  ui.cacheDetail.textContent = "no decode needed";
  ui.cacheMeterFill.style.width = "100%";
  state.lastSequence = { command: "load-demo", payload: { count: 180, startPaused: ui.startPaused.checked } };
  await sendCommand(state.lastSequence.command, state.lastSequence.payload);
  setStatus("Generated demo ready");
}

function bindPlayback() {
  ui.playPause.addEventListener("click", () => sendCommand("toggle-play"));
  ui.stepBack.addEventListener("click", () => sendCommand("step", { amount: -1 }));
  ui.stepForward.addEventListener("click", () => sendCommand("step", { amount: 1 }));
  ui.jumpStart.addEventListener("click", () => sendCommand("jump", { target: "in" }));
  ui.jumpEnd.addEventListener("click", () => sendCommand("jump", { target: "out" }));
  ui.reverse.addEventListener("click", () => sendCommand("reverse"));
  ui.timeline.addEventListener("pointerdown", () => { state.timelineDragging = true; });
  ui.timeline.addEventListener("input", () => {
    const frame = Number(ui.timeline.value);
    ui.currentFrame.textContent = `Frame ${Math.floor(frame) + 1} / ${state.count}`;
    sendCommand("seek", { frame });
  });
  const releaseTimeline = () => { state.timelineDragging = false; };
  ui.timeline.addEventListener("pointerup", releaseTimeline); ui.timeline.addEventListener("pointercancel", releaseTimeline); ui.timeline.addEventListener("change", releaseTimeline);
  window.addEventListener("keydown", (event) => {
    if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
    if (event.code === "Space") { event.preventDefault(); sendCommand("toggle-play"); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); sendCommand("step", { amount: event.shiftKey ? -10 : -1 }); }
    else if (event.key === "ArrowRight") { event.preventDefault(); sendCommand("step", { amount: event.shiftKey ? 10 : 1 }); }
    else if (event.key.toLowerCase() === "r") sendCommand("reverse");
  });
}

function resetImageControls() {
  ui.fitMode.value = "contain"; ui.backgroundColor.value = "#05070a"; ui.zoom.value = "1"; ui.rotation.value = "0"; ui.panX.value = "0"; ui.panY.value = "0"; ui.brightness.value = "1"; ui.contrast.value = "1"; ui.saturation.value = "1"; ui.gamma.value = "1"; ui.mirrorX.checked = false; ui.mirrorY.checked = false; ui.showGrid.checked = false; scheduleConfig();
}

function bindControls() {
  ui.loadFolder.addEventListener("click", () => chooseFolder().catch((error) => setStatus(error.message || String(error))));
  ui.loadFiles.addEventListener("click", () => chooseFiles().catch((error) => setStatus(error.message || String(error))));
  ui.loadDemo.addEventListener("click", () => loadDemo().catch((error) => setStatus(error.message || String(error))));
  bindPlayback();
  const liveInputs = [ui.sequenceFps, ui.playbackRate, ui.loopMode, ui.frameHandling, ui.inFrame, ui.outFrame, ui.interpolate, ui.cacheStrategy, ui.cacheRadius, ui.fitMode, ui.backgroundColor, ui.zoom, ui.rotation, ui.panX, ui.panY, ui.brightness, ui.contrast, ui.saturation, ui.gamma, ui.mirrorX, ui.mirrorY, ui.showGrid];
  liveInputs.forEach((input) => { input.addEventListener("input", scheduleConfig); input.addEventListener("change", scheduleConfig); });
  ui.preloadNow.addEventListener("click", () => sendCommand("preload"));
  ui.clearCache.addEventListener("click", () => sendCommand("clear-cache"));
  ui.retryErrors.addEventListener("click", () => sendCommand("retry-errors"));
  ui.resetImage.addEventListener("click", resetImageControls);
  ui.refreshDisplays.addEventListener("click", () => sendCommand("refresh-monitors"));
  ui.moveDisplay.addEventListener("click", () => sendCommand("move-monitor", { index: Number(ui.displaySelect.value) || 0 }));
  ui.fullscreenOutput.addEventListener("click", () => sendCommand("toggle-fullscreen", { index: Number(ui.displaySelect.value) || 0 }));
  ui.snapshotOutput.addEventListener("click", () => sendCommand("snapshot"));
  ui.showOutput.addEventListener("click", () => sendCommand("show-output"));
  ui.hideOutput.addEventListener("click", () => sendCommand("hide-output"));
}

async function bindFileDrop() {
  if (!tauriWindow?.appWindow?.onFileDropEvent) return;
  await tauriWindow.appWindow.onFileDropEvent((event) => {
    const payload = event.payload || {};
    if (payload.type === "hover") ui.dropZone.classList.add("drag");
    else if (payload.type === "cancel") ui.dropZone.classList.remove("drag");
    else if (payload.type === "drop") {
      ui.dropZone.classList.remove("drag");
      loadSequencePaths(payload.paths || [], "Dropped frames").catch((error) => setStatus(error.message || String(error)));
    }
  });
}

async function bindTauriEvents() {
  if (!tauriEvent) { setOutputOnline(false, "Tauri event API unavailable"); return; }
  await tauriEvent.listen("sequence-ready", () => {
    setOutputOnline(true, "Output connected"); scheduleConfig(); sendCommand("refresh-monitors");
    if (state.lastSequence) sendCommand(state.lastSequence.command, state.lastSequence.payload);
  });
  await tauriEvent.listen("sequence-status", (event) => {
    const payload = event.payload || {};
    setOutputOnline(true, payload.message || ui.outputStatus.textContent);
    if (typeof payload.playing === "boolean") {
      state.playing = payload.playing;
      ui.playPause.textContent = payload.buffering ? (payload.requestedPlaying ? "Buffering…" : "Play") : payload.playing ? "Pause" : "Play";
    }
    if (Number.isFinite(payload.frame)) {
      state.current = payload.frame;
      if (!state.timelineDragging) ui.timeline.value = String(payload.frame);
      ui.currentFrame.textContent = `Frame ${Math.floor(payload.frame) + 1} / ${state.count}`;
    }
    if (payload.timecode) ui.timecode.textContent = payload.timecode;
    if (payload.direction) { state.direction = payload.direction; ui.playDirection.textContent = payload.direction < 0 ? "Reverse" : "Forward"; ui.reverse.textContent = payload.direction < 0 ? "Forward" : "Reverse"; }
    if (payload.width && payload.height) { ui.sourceSize.textContent = `${payload.width} × ${payload.height}`; }
    if (payload.outputWidth && payload.outputHeight) ui.outputSize.textContent = `${payload.outputWidth} × ${payload.outputHeight}`;
    if (Number.isFinite(payload.outputFps)) ui.outputFps.textContent = `${payload.outputFps.toFixed(1)} fps`;
    if (Number.isFinite(payload.dropped)) ui.droppedFrames.textContent = String(payload.dropped);
    if (payload.decodeStatus) ui.decodeStatus.textContent = payload.decodeStatus;
    if (Number.isFinite(payload.cacheReady)) {
      const total = Math.max(1, payload.cacheTotal || state.count);
      ui.cacheDetail.textContent = `${payload.cacheReady} ready · ${payload.cacheLoading || 0} loading · ${payload.cacheErrors || 0} errors`;
      ui.cacheStatus.textContent = `${payload.cacheReady}/${total}`;
      ui.cacheMeterFill.style.width = `${Math.min(100, payload.cacheReady / total * 100)}%`;
    }
  });
  await tauriEvent.listen("sequence-monitors", (event) => {
    state.monitors = Array.isArray(event.payload) ? event.payload : [];
    const selected = ui.displaySelect.value;
    ui.displaySelect.replaceChildren();
    if (!state.monitors.length) ui.displaySelect.add(new Option("Current display", "0"));
    state.monitors.forEach((monitor, index) => ui.displaySelect.add(new Option(`${index + 1} · ${monitor.name || "Display"} · ${monitor.width}×${monitor.height}`, String(index))));
    if (selected && Number(selected) < state.monitors.length) ui.displaySelect.value = selected;
  });
}

async function initialize() {
  bindControls(); await bindTauriEvents(); await bindFileDrop(); updateReadouts(); applySequenceMetadata({ name: "Generated demo", count: 180, paths: [] });
  await loadDemo();
  setInterval(() => { if (!state.outputOnline) sendCommand("ping"); }, 1500);
}

initialize().catch((error) => { console.error(error); setStatus(error.message || String(error)); setOutputOnline(false, error.message || String(error)); });
