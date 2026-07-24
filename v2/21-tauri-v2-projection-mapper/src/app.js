const $ = (id) => document.getElementById(id);
const tauriEvent = window.__TAURI__?.event;
const tauriCore = window.__TAURI__?.core ?? null;
const invoke = tauriCore?.invoke?.bind(tauriCore) ?? null;
const convertFileSrc = tauriCore?.convertFileSrc?.bind(tauriCore) ?? null;
const tauriDialog = window.__TAURI__?.dialog ?? null;
const tauriWebview = window.__TAURI__?.webview ?? null;

const ui = {
  outputDot: $("output-dot"), outputStatus: $("output-status"), outputSize: $("output-size"), frameRate: $("frame-rate"), sourceStatus: $("source-status"),
  sourceKind: $("source-kind"), patternControls: $("pattern-controls"), patternType: $("pattern-type"), fileControls: $("file-controls"), sourceOpen: $("source-open"), sourceFile: $("source-file"), dropOverlay: $("drop-overlay"), videoPlay: $("video-play"), clearMedia: $("clear-media"), cameraControls: $("camera-controls"), cameraSelect: $("camera-select"), refreshCameras: $("refresh-cameras"), startCamera: $("start-camera"), stopCamera: $("stop-camera"), sourceSpeed: $("source-speed"), sourceSpeedOutput: $("source-speed-output"), sourceFit: $("source-fit"),
  meshSize: $("mesh-size"), meshEditor: $("mesh-editor"), meshSummary: $("mesh-summary"), selectedPointLabel: $("selected-point-label"), selectedPointValue: $("selected-point-value"), pointX: $("point-x"), pointXOutput: $("point-x-output"), pointY: $("point-y"), pointYOutput: $("point-y-output"), resetPoint: $("reset-point"), resetMesh: $("reset-mesh"), centerMesh: $("center-mesh"), lockBoundary: $("lock-boundary"),
  sourceZoom: $("source-zoom"), sourceZoomOutput: $("source-zoom-output"), sourcePanX: $("source-pan-x"), sourcePanXOutput: $("source-pan-x-output"), sourcePanY: $("source-pan-y"), sourcePanYOutput: $("source-pan-y-output"), sourceRotation: $("source-rotation"), sourceRotationOutput: $("source-rotation-output"), mirrorX: $("mirror-x"), mirrorY: $("mirror-y"),
  featherLeft: $("feather-left"), featherLeftOutput: $("feather-left-output"), featherRight: $("feather-right"), featherRightOutput: $("feather-right-output"), featherTop: $("feather-top"), featherTopOutput: $("feather-top-output"), featherBottom: $("feather-bottom"), featherBottomOutput: $("feather-bottom-output"), featherSummary: $("feather-summary"), blackLevel: $("black-level"), blackLevelOutput: $("black-level-output"), brightness: $("brightness"), brightnessOutput: $("brightness-output"), gamma: $("gamma"), gammaOutput: $("gamma-output"),
  showGrid: $("show-grid"), showPoints: $("show-points"), gridOpacity: $("grid-opacity"), gridOpacityOutput: $("grid-opacity-output"), gridDensity: $("grid-density"), calibrationStatus: $("calibration-status"), calibrationMode: $("calibration-mode"), blackout: $("blackout"),
  displaySelect: $("display-select"), refreshDisplays: $("refresh-displays"), moveDisplay: $("move-display"), fullscreenOutput: $("fullscreen-output"), showOutput: $("show-output"), hideOutput: $("hide-output"), snapshotOutput: $("snapshot-output"),
  presetName: $("preset-name"), presetSelect: $("preset-select"), presetCount: $("preset-count"), savePreset: $("save-preset"), loadPreset: $("load-preset"), deletePreset: $("delete-preset"), exportPreset: $("export-preset"), importPreset: $("import-preset")
};

const state = {
  source: { kind: "pattern", pattern: 0, path: "", url: "", name: "Calibration field", speed: 1, fit: "cover", cameraDeviceId: "" },
  mesh: { size: 2, points: regularGrid(2, 0) },
  transform: { zoom: 1, panX: 0, panY: 0, rotation: 0, mirrorX: false, mirrorY: false },
  feather: { left: 0, right: 0, top: 0, bottom: 0, blackLevel: 0, brightness: 1, gamma: 1 },
  calibration: { showGrid: false, showPoints: false, opacity: 0.75, density: 12 },
  blackout: false,
  selectedPoint: 0,
  outputOnline: false,
  currentObjectUrl: "",
  monitors: [],
  presets: loadPresetStore(),
  emitQueued: false,
  dragging: false,
  nativeDropInstalled: false
};

function regularGrid(size, inset = 0) {
  const points = [];
  const range = 1 - inset * 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      points.push({ x: inset + (x / (size - 1)) * range, y: inset + (y / (size - 1)) * range });
    }
  }
  return points;
}

function outputPayload() {
  return {
    source: { ...state.source },
    mesh: { size: state.mesh.size, points: state.mesh.points.map((point) => ({ x: point.x, y: point.y })) },
    transform: { ...state.transform }, feather: { ...state.feather }, calibration: { ...state.calibration }, blackout: state.blackout
  };
}

function scheduleEmit() {
  if (state.emitQueued) return;
  state.emitQueued = true;
  requestAnimationFrame(async () => {
    state.emitQueued = false;
    if (!tauriEvent) return;
    try { await tauriEvent.emit("projection-state", outputPayload()); } catch (error) { console.error("Could not send projection state", error); }
  });
}

async function sendCommand(command, payload = {}) {
  if (!tauriEvent) return;
  try { await tauriEvent.emit("projection-command", { command, ...payload }); } catch (error) { console.error(`Projection command failed: ${command}`, error); }
}

function setOutputOnline(online, message) {
  state.outputOnline = online;
  ui.outputDot.classList.toggle("online", online);
  ui.outputStatus.textContent = message || (online ? "Output connected" : "Waiting for output window…");
}

function mapToCanvas(point) {
  const domainMin = -0.25;
  const domainSize = 1.5;
  return { x: ((point.x - domainMin) / domainSize) * ui.meshEditor.width, y: ((point.y - domainMin) / domainSize) * ui.meshEditor.height };
}

function canvasToMap(x, y) {
  const domainMin = -0.25;
  const domainSize = 1.5;
  return { x: domainMin + (x / ui.meshEditor.width) * domainSize, y: domainMin + (y / ui.meshEditor.height) * domainSize };
}

function pointGridPosition(index) {
  return { column: index % state.mesh.size, row: Math.floor(index / state.mesh.size) };
}

function boundaryPoint(index) {
  const { column, row } = pointGridPosition(index);
  return column === 0 || row === 0 || column === state.mesh.size - 1 || row === state.mesh.size - 1;
}

function clampPoint(index, point) {
  const lockBoundary = Boolean(ui.lockBoundary?.checked);
  const min = lockBoundary && boundaryPoint(index) ? 0 : -0.25;
  const max = lockBoundary && boundaryPoint(index) ? 1 : 1.25;
  return { x: Math.max(min, Math.min(max, point.x)), y: Math.max(min, Math.min(max, point.y)) };
}

function drawMeshEditor() {
  const canvas = ui.meshEditor;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#071018"); gradient.addColorStop(1, "#0b080d");
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(255,255,255,.055)"; ctx.lineWidth = 1;
  for (let i = 0; i <= 12; i += 1) {
    const x = (i / 12) * width; const y = (i / 12) * height;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
  }
  const zero = mapToCanvas({ x: 0, y: 0 });
  const one = mapToCanvas({ x: 1, y: 1 });
  ctx.strokeStyle = "rgba(121,255,159,.22)"; ctx.setLineDash([5, 5]);
  ctx.strokeRect(zero.x, zero.y, one.x - zero.x, one.y - zero.y); ctx.setLineDash([]);

  ctx.strokeStyle = "rgba(120,232,255,.72)"; ctx.lineWidth = 1.5;
  const size = state.mesh.size;
  for (let row = 0; row < size; row += 1) {
    ctx.beginPath();
    for (let col = 0; col < size; col += 1) {
      const pos = mapToCanvas(state.mesh.points[row * size + col]);
      if (col === 0) ctx.moveTo(pos.x, pos.y); else ctx.lineTo(pos.x, pos.y);
    }
    ctx.stroke();
  }
  for (let col = 0; col < size; col += 1) {
    ctx.beginPath();
    for (let row = 0; row < size; row += 1) {
      const pos = mapToCanvas(state.mesh.points[row * size + col]);
      if (row === 0) ctx.moveTo(pos.x, pos.y); else ctx.lineTo(pos.x, pos.y);
    }
    ctx.stroke();
  }

  state.mesh.points.forEach((point, index) => {
    const pos = mapToCanvas(point);
    const selected = index === state.selectedPoint;
    ctx.beginPath(); ctx.arc(pos.x, pos.y, selected ? 7 : 5, 0, Math.PI * 2);
    ctx.fillStyle = selected ? "#79ff9f" : "#071116"; ctx.fill();
    ctx.lineWidth = selected ? 3 : 2; ctx.strokeStyle = selected ? "rgba(121,255,159,.95)" : "#78e8ff"; ctx.stroke();
    if (size <= 3) {
      ctx.fillStyle = selected ? "#061109" : "rgba(235,247,250,.72)"; ctx.font = "9px ui-monospace, monospace"; ctx.fillText(String(index + 1), pos.x + 9, pos.y - 7);
    }
  });
}

function selectPoint(index) {
  state.selectedPoint = Math.max(0, Math.min(state.mesh.points.length - 1, index));
  const point = state.mesh.points[state.selectedPoint];
  const { column, row } = pointGridPosition(state.selectedPoint);
  ui.selectedPointLabel.textContent = `Point ${column + 1},${row + 1}`;
  ui.selectedPointValue.textContent = `${point.x.toFixed(3)}, ${point.y.toFixed(3)}`;
  ui.pointX.value = String(point.x); ui.pointY.value = String(point.y);
  ui.pointXOutput.textContent = point.x.toFixed(3); ui.pointYOutput.textContent = point.y.toFixed(3);
  drawMeshEditor();
}

function updateSelectedPoint(next) {
  state.mesh.points[state.selectedPoint] = clampPoint(state.selectedPoint, next);
  selectPoint(state.selectedPoint);
  scheduleEmit();
}

function nearestPoint(x, y) {
  let bestIndex = -1; let bestDistance = 18;
  state.mesh.points.forEach((point, index) => {
    const pos = mapToCanvas(point);
    const distance = Math.hypot(pos.x - x, pos.y - y);
    if (distance < bestDistance) { bestDistance = distance; bestIndex = index; }
  });
  return bestIndex;
}

function pointerPosition(event) {
  const rect = ui.meshEditor.getBoundingClientRect();
  return { x: ((event.clientX - rect.left) / rect.width) * ui.meshEditor.width, y: ((event.clientY - rect.top) / rect.height) * ui.meshEditor.height };
}

function changeMeshSize(size) {
  state.mesh.size = size;
  state.mesh.points = regularGrid(size, 0);
  state.selectedPoint = 0;
  ui.meshSummary.textContent = `${size} × ${size} · ${size * size} points`;
  selectPoint(0); scheduleEmit();
}

function resetCurrentPoint() {
  const { column, row } = pointGridPosition(state.selectedPoint);
  const denom = state.mesh.size - 1;
  updateSelectedPoint({ x: column / denom, y: row / denom });
}

function updateUiReadouts() {
  ui.sourceSpeedOutput.textContent = `${Number(ui.sourceSpeed.value).toFixed(2)}×`;
  ui.sourceZoomOutput.textContent = `${Number(ui.sourceZoom.value).toFixed(2)}×`;
  ui.sourcePanXOutput.textContent = Number(ui.sourcePanX.value).toFixed(3);
  ui.sourcePanYOutput.textContent = Number(ui.sourcePanY.value).toFixed(3);
  ui.sourceRotationOutput.textContent = `${Number(ui.sourceRotation.value).toFixed(1)}°`;
  ui.featherLeftOutput.textContent = Number(ui.featherLeft.value).toFixed(3);
  ui.featherRightOutput.textContent = Number(ui.featherRight.value).toFixed(3);
  ui.featherTopOutput.textContent = Number(ui.featherTop.value).toFixed(3);
  ui.featherBottomOutput.textContent = Number(ui.featherBottom.value).toFixed(3);
  ui.blackLevelOutput.textContent = Number(ui.blackLevel.value).toFixed(3);
  ui.brightnessOutput.textContent = Number(ui.brightness.value).toFixed(2);
  ui.gammaOutput.textContent = Number(ui.gamma.value).toFixed(2);
  ui.gridOpacityOutput.textContent = Number(ui.gridOpacity.value).toFixed(2);
  const featherTotal = Number(ui.featherLeft.value) + Number(ui.featherRight.value) + Number(ui.featherTop.value) + Number(ui.featherBottom.value);
  ui.featherSummary.textContent = featherTotal > 0.0001 ? "Active" : "Off";
  ui.calibrationStatus.textContent = ui.showGrid.checked ? `Grid ${ui.gridDensity.value}×` : "Grid hidden";
  ui.blackout.textContent = state.blackout ? "Restore output" : "Blackout";
}

function readControlsIntoState() {
  state.source.pattern = Number(ui.patternType.value); state.source.speed = Number(ui.sourceSpeed.value); state.source.fit = ui.sourceFit.value;
  Object.assign(state.transform, { zoom: Number(ui.sourceZoom.value), panX: Number(ui.sourcePanX.value), panY: Number(ui.sourcePanY.value), rotation: Number(ui.sourceRotation.value), mirrorX: ui.mirrorX.checked, mirrorY: ui.mirrorY.checked });
  Object.assign(state.feather, { left: Number(ui.featherLeft.value), right: Number(ui.featherRight.value), top: Number(ui.featherTop.value), bottom: Number(ui.featherBottom.value), blackLevel: Number(ui.blackLevel.value), brightness: Number(ui.brightness.value), gamma: Number(ui.gamma.value) });
  Object.assign(state.calibration, { showGrid: ui.showGrid.checked, showPoints: ui.showPoints.checked, opacity: Number(ui.gridOpacity.value), density: Number(ui.gridDensity.value) });
  updateUiReadouts(); scheduleEmit();
}

function showSourceControls(kind) {
  ui.patternControls.classList.toggle("hidden", kind !== "pattern");
  ui.fileControls.classList.toggle("hidden", kind !== "image" && kind !== "video");
  ui.cameraControls.classList.toggle("hidden", kind !== "camera");
  if (kind === "pattern") {
    state.source.kind = "pattern"; state.source.path = ""; state.source.url = ""; state.source.name = ui.patternType.options[ui.patternType.selectedIndex]?.text || "Pattern";
    ui.sourceStatus.textContent = state.source.name; scheduleEmit();
  } else if (kind === "camera") {
    ui.sourceStatus.textContent = "Camera not started";
  } else if (!state.source.url || state.source.kind !== kind) {
    ui.sourceStatus.textContent = `Choose a ${kind} file`;
  }
}

function revokeCurrentUrl() {
  if (state.currentObjectUrl) URL.revokeObjectURL(state.currentObjectUrl);
  state.currentObjectUrl = "";
}

function extensionOf(name) {
  return String(name || "").split(".").pop()?.toLowerCase() || "";
}

function isImagePath(path) {
  return /\.(png|jpe?g|webp|gif|bmp|tiff?|avif)$/i.test(String(path || ""));
}

function isVideoPath(path) {
  return /\.(mp4|mov|m4v|webm|mkv|avi|ogv|ogg)$/i.test(String(path || ""));
}

async function loadNativeMedia(path, origin = "opened") {
  if (!invoke) throw new Error("Native media loading requires Tauri.");
  if (!isImagePath(path) && !isVideoPath(path)) throw new Error("Choose a supported image or video file.");
  const selected = await invoke("inspect_media_file", { path });
  revokeCurrentUrl();
  await sendCommand("stop-camera");
  state.source.kind = selected.kind;
  state.source.path = selected.path;
  state.source.url = selected.kind === "video" && convertFileSrc ? convertFileSrc(selected.path) : "";
  state.source.name = selected.name;
  ui.sourceKind.value = selected.kind;
  showSourceControls(selected.kind);
  ui.sourceStatus.textContent = `${selected.name} · ${origin}`;
  ui.videoPlay.disabled = selected.kind !== "video";
  ui.videoPlay.textContent = "Pause";
  scheduleEmit();
}

async function openNativeMedia() {
  if (!tauriDialog?.open || !invoke) {
    ui.sourceFile.click();
    return;
  }
  const path = await tauriDialog.open({
    title: "Open projection source",
    multiple: false,
    directory: false,
    filters: [{ name: "Images and videos", extensions: ["png","jpg","jpeg","webp","gif","bmp","tif","tiff","avif","mp4","mov","m4v","webm","mkv","avi","ogv","ogg"] }]
  });
  if (typeof path === "string") await loadNativeMedia(path, "opened");
}

async function loadBrowserMedia(file) {
  if (!file) return;
  const kind = file.type.startsWith("video/") ? "video" : file.type.startsWith("image/") ? "image" : "";
  if (!kind) throw new Error("Choose an image or video supported by the WebView.");
  revokeCurrentUrl();
  state.currentObjectUrl = URL.createObjectURL(file);
  state.source.kind = kind;
  state.source.path = "";
  state.source.url = state.currentObjectUrl;
  state.source.name = file.name;
  ui.sourceKind.value = kind;
  showSourceControls(kind);
  ui.sourceStatus.textContent = `${file.name} · browser fallback`;
  ui.videoPlay.disabled = kind !== "video";
  ui.videoPlay.textContent = "Pause";
  scheduleEmit();
}

function setDropOverlay(active) {
  ui.dropOverlay?.classList.toggle("hidden", !active);
}

async function installNativeDropHandler() {
  if (!tauriWebview?.getCurrentWebview) return;
  try {
    const currentWebview = tauriWebview.getCurrentWebview();
    await currentWebview.onDragDropEvent((event) => {
      const payload = event.payload || {};
      if (payload.type === "over" || payload.type === "enter") {
        setDropOverlay(true);
        return;
      }
      if (payload.type === "drop") {
        setDropOverlay(false);
        const path = Array.from(payload.paths || []).find((value) => isImagePath(value) || isVideoPath(value));
        if (!path) {
          ui.outputStatus.textContent = "No supported image or video in drop";
          return;
        }
        void loadNativeMedia(path, "dropped").catch((error) => {
          console.error(error);
          ui.outputStatus.textContent = `Drop failed: ${error.message || error}`;
        });
        return;
      }
      setDropOverlay(false);
    });
    state.nativeDropInstalled = true;
  } catch (error) {
    console.error("Could not install native drop handler", error);
    ui.outputStatus.textContent = "Native file drop unavailable";
  }
}

function populateDisplays(monitors) {
  state.monitors = Array.isArray(monitors) ? monitors : [];
  const selected = ui.displaySelect.value;
  ui.displaySelect.replaceChildren();
  if (!state.monitors.length) ui.displaySelect.add(new Option("Current display", "0"));
  state.monitors.forEach((monitor, index) => {
    ui.displaySelect.add(new Option(`${index + 1} · ${monitor.name || "Display"} · ${monitor.width}×${monitor.height}`, String(index)));
  });
  if (selected && Number(selected) < state.monitors.length) ui.displaySelect.value = selected;
}

async function refreshDisplays() {
  if (!invoke) return;
  try {
    populateDisplays(await invoke("list_monitors"));
  } catch (error) {
    console.error(error);
    populateDisplays([]);
    ui.outputStatus.textContent = `Display scan failed: ${error.message || error}`;
  }
}

async function runOutputCommand(command, args = {}) {
  if (!invoke) throw new Error("Native output controls require Tauri.");
  const result = await invoke(command, args);
  if (typeof result === "string") ui.outputStatus.textContent = result;
  return result;
}

function serializePreset(name = ui.presetName.value.trim() || "Mapping") {
  return { version: 1, name, createdAt: new Date().toISOString(), mesh: JSON.parse(JSON.stringify(state.mesh)), transform: { ...state.transform }, feather: { ...state.feather }, calibration: { ...state.calibration }, source: { kind: state.source.kind === "pattern" ? "pattern" : "pattern", pattern: state.source.pattern, speed: state.source.speed, fit: state.source.fit }, blackout: false };
}

function loadPresetStore() {
  try { return JSON.parse(localStorage.getItem("junkpile-v2-projection-presets") || "[]"); } catch { return []; }
}

function persistPresets() { localStorage.setItem("junkpile-v2-projection-presets", JSON.stringify(state.presets)); refreshPresetUi(); }

function refreshPresetUi() {
  const previous = ui.presetSelect.value;
  ui.presetSelect.replaceChildren();
  if (!state.presets.length) ui.presetSelect.add(new Option("No presets saved", ""));
  state.presets.forEach((preset, index) => ui.presetSelect.add(new Option(preset.name, String(index))));
  if (previous && Number(previous) < state.presets.length) ui.presetSelect.value = previous;
  ui.presetCount.textContent = `${state.presets.length} saved`;
}

function applyPreset(preset) {
  if (!preset?.mesh?.points?.length) throw new Error("Preset does not contain a valid mesh.");
  state.mesh = { size: Number(preset.mesh.size), points: preset.mesh.points.map((point) => ({ x: Number(point.x), y: Number(point.y) })) };
  state.transform = { ...state.transform, ...preset.transform }; state.feather = { ...state.feather, ...preset.feather }; state.calibration = { ...state.calibration, ...preset.calibration };
  state.source.kind = "pattern"; state.source.path = ""; state.source.url = ""; state.source.pattern = Number(preset.source?.pattern ?? 0); state.source.speed = Number(preset.source?.speed ?? 1); state.source.fit = preset.source?.fit || "cover"; state.blackout = false;
  syncStateToControls(); ui.presetName.value = preset.name || "Imported mapping"; scheduleEmit();
}

function syncStateToControls() {
  ui.meshSize.value = String(state.mesh.size); ui.meshSummary.textContent = `${state.mesh.size} × ${state.mesh.size} · ${state.mesh.points.length} points`;
  ui.sourceKind.value = state.source.kind; ui.patternType.value = String(state.source.pattern); ui.sourceSpeed.value = String(state.source.speed); ui.sourceFit.value = state.source.fit;
  ui.sourceZoom.value = String(state.transform.zoom); ui.sourcePanX.value = String(state.transform.panX); ui.sourcePanY.value = String(state.transform.panY); ui.sourceRotation.value = String(state.transform.rotation); ui.mirrorX.checked = state.transform.mirrorX; ui.mirrorY.checked = state.transform.mirrorY;
  ui.featherLeft.value = String(state.feather.left); ui.featherRight.value = String(state.feather.right); ui.featherTop.value = String(state.feather.top); ui.featherBottom.value = String(state.feather.bottom); ui.blackLevel.value = String(state.feather.blackLevel); ui.brightness.value = String(state.feather.brightness); ui.gamma.value = String(state.feather.gamma);
  ui.showGrid.checked = state.calibration.showGrid; ui.showPoints.checked = state.calibration.showPoints; ui.gridOpacity.value = String(state.calibration.opacity); ui.gridDensity.value = String(state.calibration.density);
  showSourceControls(state.source.kind); selectPoint(0); updateUiReadouts();
}

function exportPreset() {
  const selected = Number(ui.presetSelect.value);
  const preset = Number.isInteger(selected) && state.presets[selected] ? state.presets[selected] : serializePreset();
  const blob = new Blob([JSON.stringify(preset, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
  anchor.href = url; anchor.download = `${(preset.name || "projection-mapping").replace(/[^a-z0-9_-]+/gi, "-").toLowerCase()}.json`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function bindControls() {
  ui.meshEditor.tabIndex = 0;
  ui.meshEditor.addEventListener("pointerdown", (event) => {
    const pos = pointerPosition(event); const index = nearestPoint(pos.x, pos.y);
    if (index < 0) return; selectPoint(index); state.dragging = true; ui.meshEditor.setPointerCapture(event.pointerId); event.preventDefault();
  });
  ui.meshEditor.addEventListener("pointermove", (event) => { if (!state.dragging) return; const pos = pointerPosition(event); updateSelectedPoint(canvasToMap(pos.x, pos.y)); });
  const endDrag = () => { state.dragging = false; };
  ui.meshEditor.addEventListener("pointerup", endDrag); ui.meshEditor.addEventListener("pointercancel", endDrag);
  ui.meshEditor.addEventListener("dblclick", (event) => { const pos = pointerPosition(event); const index = nearestPoint(pos.x, pos.y); if (index >= 0) { selectPoint(index); resetCurrentPoint(); } });
  ui.meshEditor.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 0.02 : 0.002;
    const point = { ...state.mesh.points[state.selectedPoint] };
    if (event.key === "ArrowLeft") point.x -= step; else if (event.key === "ArrowRight") point.x += step; else if (event.key === "ArrowUp") point.y -= step; else if (event.key === "ArrowDown") point.y += step; else return;
    event.preventDefault(); updateSelectedPoint(point);
  });
  ui.pointX.addEventListener("input", () => updateSelectedPoint({ x: Number(ui.pointX.value), y: state.mesh.points[state.selectedPoint].y }));
  ui.pointY.addEventListener("input", () => updateSelectedPoint({ x: state.mesh.points[state.selectedPoint].x, y: Number(ui.pointY.value) }));
  ui.meshSize.addEventListener("change", () => changeMeshSize(Number(ui.meshSize.value)));
  ui.resetPoint.addEventListener("click", resetCurrentPoint);
  ui.resetMesh.addEventListener("click", () => { state.mesh.points = regularGrid(state.mesh.size, 0); selectPoint(0); scheduleEmit(); });
  ui.centerMesh.addEventListener("click", () => { state.mesh.points = regularGrid(state.mesh.size, 0.05); selectPoint(0); scheduleEmit(); });
  ui.lockBoundary.addEventListener("change", () => { if (ui.lockBoundary.checked) { state.mesh.points = state.mesh.points.map((point, index) => clampPoint(index, point)); selectPoint(state.selectedPoint); scheduleEmit(); } });

  ui.sourceKind.addEventListener("change", () => showSourceControls(ui.sourceKind.value));
  ui.patternType.addEventListener("change", () => { state.source.kind = "pattern"; state.source.pattern = Number(ui.patternType.value); state.source.name = ui.patternType.options[ui.patternType.selectedIndex].text; ui.sourceStatus.textContent = state.source.name; scheduleEmit(); });
  ui.sourceOpen.addEventListener("click", () => openNativeMedia().catch((error) => { console.error(error); ui.outputStatus.textContent = error.message || String(error); }));
  ui.sourceFile.addEventListener("change", () => loadBrowserMedia(ui.sourceFile.files?.[0]).catch((error) => window.alert(error.message || error)));
  ui.clearMedia.addEventListener("click", () => { revokeCurrentUrl(); state.source.kind = "pattern"; state.source.path = ""; state.source.url = ""; ui.sourceKind.value = "pattern"; showSourceControls("pattern"); scheduleEmit(); });
  ui.videoPlay.addEventListener("click", () => sendCommand("toggle-video"));
  ui.refreshCameras.addEventListener("click", () => sendCommand("refresh-cameras"));
  ui.startCamera.addEventListener("click", () => { state.source.cameraDeviceId = ui.cameraSelect.value; state.source.kind = "camera"; sendCommand("start-camera", { deviceId: ui.cameraSelect.value }); scheduleEmit(); });
  ui.stopCamera.addEventListener("click", () => sendCommand("stop-camera"));
  ui.cameraSelect.addEventListener("change", () => { state.source.cameraDeviceId = ui.cameraSelect.value; });

  const liveInputs = [ui.sourceSpeed, ui.sourceFit, ui.sourceZoom, ui.sourcePanX, ui.sourcePanY, ui.sourceRotation, ui.mirrorX, ui.mirrorY, ui.featherLeft, ui.featherRight, ui.featherTop, ui.featherBottom, ui.blackLevel, ui.brightness, ui.gamma, ui.showGrid, ui.showPoints, ui.gridOpacity, ui.gridDensity];
  liveInputs.forEach((input) => { input.addEventListener("input", readControlsIntoState); input.addEventListener("change", readControlsIntoState); });
  ui.calibrationMode.addEventListener("click", () => { ui.showGrid.checked = true; ui.showPoints.checked = true; ui.gridOpacity.value = "1"; ui.gridDensity.value = "12"; state.source.kind = "pattern"; state.source.pattern = 0; state.source.path = ""; state.source.url = ""; ui.sourceKind.value = "pattern"; ui.patternType.value = "0"; showSourceControls("pattern"); readControlsIntoState(); });
  ui.blackout.addEventListener("click", () => { state.blackout = !state.blackout; updateUiReadouts(); scheduleEmit(); });

  ui.refreshDisplays.addEventListener("click", () => refreshDisplays());
  ui.moveDisplay.addEventListener("click", () => runOutputCommand("place_output", { index: Number(ui.displaySelect.value) || 0, fullscreen: false }).catch((error) => { ui.outputStatus.textContent = error.message || String(error); }));
  ui.fullscreenOutput.addEventListener("click", () => runOutputCommand("toggle_output_fullscreen", { index: Number(ui.displaySelect.value) || 0 }).catch((error) => { ui.outputStatus.textContent = error.message || String(error); }));
  ui.showOutput.addEventListener("click", () => runOutputCommand("show_output").catch((error) => { ui.outputStatus.textContent = error.message || String(error); }));
  ui.hideOutput.addEventListener("click", () => runOutputCommand("hide_output").catch((error) => { ui.outputStatus.textContent = error.message || String(error); }));
  ui.snapshotOutput.addEventListener("click", () => sendCommand("snapshot"));

  ui.savePreset.addEventListener("click", () => { const preset = serializePreset(); const existing = state.presets.findIndex((item) => item.name === preset.name); if (existing >= 0) state.presets[existing] = preset; else state.presets.push(preset); persistPresets(); ui.presetSelect.value = String(existing >= 0 ? existing : state.presets.length - 1); });
  ui.loadPreset.addEventListener("click", () => { const preset = state.presets[Number(ui.presetSelect.value)]; if (preset) applyPreset(preset); });
  ui.deletePreset.addEventListener("click", () => { const index = Number(ui.presetSelect.value); if (state.presets[index]) { state.presets.splice(index, 1); persistPresets(); } });
  ui.exportPreset.addEventListener("click", exportPreset);
  ui.importPreset.addEventListener("change", async () => { const file = ui.importPreset.files?.[0]; if (!file) return; try { const preset = JSON.parse(await file.text()); applyPreset(preset); state.presets.push({ ...preset, name: preset.name || file.name.replace(/\.json$/i, "") }); persistPresets(); } catch (error) { window.alert(`Could not import preset:\n${error.message || error}`); } finally { ui.importPreset.value = ""; } });
  window.addEventListener("beforeunload", revokeCurrentUrl);
}

async function bindTauriEvents() {
  if (!tauriEvent) { setOutputOnline(false, "Tauri event API unavailable"); return; }
  await tauriEvent.listen("projection-ready", () => { setOutputOnline(true, "Output connected"); scheduleEmit(); refreshDisplays(); sendCommand("refresh-cameras"); });
  await tauriEvent.listen("projection-status", (event) => {
    const payload = event.payload || {};
    if (payload.width && payload.height) ui.outputSize.textContent = `${payload.width} × ${payload.height}`;
    if (payload.fps) ui.frameRate.textContent = `Output ${payload.fps.toFixed(1)} fps`;
    if (payload.message) ui.outputStatus.textContent = payload.message;
    if (payload.source) ui.sourceStatus.textContent = payload.source;
    if (typeof payload.videoPlaying === "boolean") ui.videoPlay.textContent = payload.videoPlaying ? "Pause" : "Play";
    if (typeof payload.cameraActive === "boolean") { ui.startCamera.disabled = payload.cameraActive; ui.stopCamera.disabled = !payload.cameraActive; }
    setOutputOnline(true, ui.outputStatus.textContent);
  });
  await tauriEvent.listen("projection-cameras", (event) => {
    const cameras = Array.isArray(event.payload) ? event.payload : [];
    const selected = ui.cameraSelect.value;
    ui.cameraSelect.replaceChildren(new Option("Default camera", ""));
    cameras.forEach((camera, index) => ui.cameraSelect.add(new Option(camera.label || `Camera ${index + 1}`, camera.deviceId)));
    if ([...ui.cameraSelect.options].some((option) => option.value === selected)) ui.cameraSelect.value = selected;
  });
}

async function initialize() {
  bindControls(); await bindTauriEvents(); await installNativeDropHandler(); await refreshDisplays(); refreshPresetUi(); syncStateToControls(); drawMeshEditor();
  scheduleEmit();
  setInterval(() => { if (!state.outputOnline) sendCommand("ping"); }, 1500);
}

initialize().catch((error) => { console.error(error); setOutputOnline(false, error.message || String(error)); });
