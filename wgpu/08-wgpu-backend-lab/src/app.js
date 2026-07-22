const invoke = window.__TAURI__.core.invoke;
const byId = (id) => document.getElementById(id);
let paused = false;
let adaptersRendered = false;

function safeText(value, fallback = "—") {
  return value === undefined || value === null || value === "" ? fallback : String(value);
}

function setStatus(message, isError = false) {
  const node = byId("status");
  if (!node) return;
  node.textContent = message;
  node.classList.toggle("error", isError);
}

async function call(command, args = {}) {
  try {
    const result = await invoke(command, args);
    setStatus("renderer online");
    return result;
  } catch (error) {
    console.error(command, error);
    setStatus(safeText(error, "command failed"), true);
    throw error;
  }
}

function setText(id, value) {
  const node = byId(id);
  if (node) node.textContent = safeText(value);
}

function yesNo(value) {
  return value ? "yes" : "no";
}

function renderAdapters(adapters) {
  const list = byId("adapterList");
  if (!list) return;
  list.replaceChildren();

  adapters.forEach((adapter) => {
    const article = document.createElement("article");
    article.className = `adapter${adapter.selected ? " selected" : ""}`;

    const header = document.createElement("div");
    header.className = "adapter-header";
    header.innerHTML = `
      <div>
        <p class="adapter-kicker">adapter ${adapter.index} · ${safeText(adapter.backend)}</p>
        <h3>${safeText(adapter.name)}</h3>
      </div>
      <span class="badge ${adapter.selected ? "active" : ""}">${adapter.selected ? "active" : adapter.surfaceSupported ? "presentable" : "not presentable"}</span>
    `;

    const overview = document.createElement("div");
    overview.className = "adapter-overview";
    overview.innerHTML = `
      <div><span>Device type</span><strong>${safeText(adapter.deviceType)}</strong></div>
      <div><span>Driver</span><strong>${safeText(adapter.driver)}</strong></div>
      <div><span>Driver info</span><strong>${safeText(adapter.driverInfo)}</strong></div>
      <div><span>Vendor / device</span><strong>${safeText(adapter.vendorId)} / ${safeText(adapter.deviceId)}</strong></div>
      <div><span>PCI bus</span><strong>${safeText(adapter.pciBusId)}</strong></div>
      <div><span>Surface support</span><strong>${yesNo(adapter.surfaceSupported)}</strong></div>
    `;

    const limits = document.createElement("div");
    limits.className = "limit-grid";
    limits.innerHTML = `
      <div><span>Max 2D texture</span><strong>${Number(adapter.maxTextureDimension2d).toLocaleString()} px</strong></div>
      <div><span>Max 3D texture</span><strong>${Number(adapter.maxTextureDimension3d).toLocaleString()} px</strong></div>
      <div><span>Max buffer</span><strong>${(Number(adapter.maxBufferSize) / 1073741824).toFixed(2)} GiB</strong></div>
      <div><span>Storage binding</span><strong>${(Number(adapter.maxStorageBufferBindingSize) / 1048576).toFixed(1)} MiB</strong></div>
      <div><span>Bind groups</span><strong>${adapter.maxBindGroups}</strong></div>
      <div><span>Compute invocations</span><strong>${adapter.maxComputeInvocationsPerWorkgroup}</strong></div>
      <div><span>Workgroup size</span><strong>${adapter.maxComputeWorkgroupSizeX} × ${adapter.maxComputeWorkgroupSizeY} × ${adapter.maxComputeWorkgroupSizeZ}</strong></div>
      <div><span>Workgroups / dimension</span><strong>${Number(adapter.maxComputeWorkgroupsPerDimension).toLocaleString()}</strong></div>
    `;

    const features = document.createElement("div");
    features.className = "feature-row";
    const featureValues = [
      ["timestamps", adapter.timestampQuery],
      ["encoder timestamps", adapter.timestampInsideEncoders],
      ["subgroups", adapter.subgroup],
      ["shader f16", adapter.shaderF16],
      ["BC", adapter.compressionBc],
      ["ETC2", adapter.compressionEtc2],
      ["ASTC", adapter.compressionAstc]
    ];
    featureValues.forEach(([name, supported]) => {
      const chip = document.createElement("span");
      chip.className = supported ? "feature supported" : "feature";
      chip.textContent = `${name}: ${supported ? "yes" : "no"}`;
      features.appendChild(chip);
    });

    const details = document.createElement("details");
    details.innerHTML = `<summary>Raw feature and downlevel report</summary><pre>${safeText(adapter.features)}\n\n${safeText(adapter.downlevelCapabilities)}</pre>`;

    article.append(header, overview, limits, features, details);
    list.appendChild(article);
  });
}

function updateInfo(info) {
  setText("activeBackend", info.activeBackend);
  setText("activeAdapter", info.activeAdapter);
  setText("surfaceFormat", info.surfaceFormat);
  setText("resolution", `${info.width} × ${info.height}`);
  setText("backendEnvironment", info.backendEnvironment);
  setText("adapterEnvironment", info.adapterEnvironment);
  setText("requestedBackends", info.requestedBackends);
  setText("compiledBackends", info.compiledBackends);
  setText("fps", Number(info.fps || 0).toFixed(1));
  setText("frameTime", `${Number(info.frameTimeMs || 0).toFixed(2)} ms`);
  setText("frameCount", Number(info.frameCount || 0).toLocaleString());
  setText("lastError", info.lastError || "none");
  setText("surfaceFormats", (info.surfaceFormats || []).join(", "));
  setText("presentModes", (info.presentModes || []).join(", "));
  setText("alphaModes", (info.alphaModes || []).join(", "));
  setText("adapterCount", (info.adapters || []).length);

  paused = Boolean(info.paused);
  setText("pause", paused ? "Resume" : "Pause");

  if (!adaptersRendered && Array.isArray(info.adapters)) {
    renderAdapters(info.adapters);
    adaptersRendered = true;
  }
}

async function pollInfo() {
  try {
    updateInfo(await call("get_renderer_info"));
  } catch (_) {}
}

function bindRange(id, commandName, formatter = (value) => value) {
  const input = byId(id);
  const output = byId(`${id}Value`);
  if (!input || !output) return;

  const updateOutput = () => {
    output.textContent = formatter(Number(input.value));
  };
  updateOutput();

  input.addEventListener("input", () => {
    updateOutput();
    call("set_param", { name: commandName, value: Number(input.value) }).catch(() => {});
  });
}

bindRange("complexity", "complexity", (value) => value.toFixed(0));
bindRange("layers", "layers", (value) => value.toFixed(0));
bindRange("speed", "speed", (value) => value.toFixed(2));
bindRange("exposure", "exposure", (value) => value.toFixed(2));

byId("pause")?.addEventListener("click", () => {
  call("set_paused", { paused: !paused }).catch(() => {});
});

byId("reset")?.addEventListener("click", async () => {
  await call("reset_params");
  const defaults = { complexity: 6, layers: 4, speed: 1, exposure: 1.35 };
  Object.entries(defaults).forEach(([id, value]) => {
    const input = byId(id);
    const output = byId(`${id}Value`);
    if (input) input.value = String(value);
    if (output) output.textContent = Number.isInteger(value) ? String(value) : value.toFixed(2);
  });
});

byId("fullscreen")?.addEventListener("click", () => {
  call("toggle_renderer_fullscreen").catch(() => {});
});

pollInfo();
setInterval(pollInfo, 750);
