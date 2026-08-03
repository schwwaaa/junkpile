const invoke = window.__TAURI__.core.invoke;
const byId = (id) => document.getElementById(id);
let latestSnapshot = null;
let assetPaths = null;
let busy = false;
const pendingParameters = new Map();

const PARAMETER_PRESENTATION = {
  u_gain: { label: "Gain", unit: "output intensity", digits: 2, step: 0.001 },
  u_zoom: { label: "Zoom", unit: "spatial scale", digits: 2, step: 0.001 },
  u_spin: { label: "Spin speed", unit: "radians / second · 0 stops rotation", digits: 3, step: 0.001 },
  u_complexity: { label: "Complexity", unit: "iteration / sample pressure", digits: 1, step: 0.1 },
};

function parameterPresentation(name) {
  return PARAMETER_PRESENTATION[name] || { label: name, unit: "runtime parameter", digits: 2, step: 0.001 };
}

function fileName(path) {
  return String(path || "").split(/[\\/]/).pop() || "—";
}

function setMessage(text, kind = "") {
  const element = byId("actionMessage");
  element.textContent = text;
  element.className = `message ${kind}`.trim();
}

function setBusy(value) {
  busy = value;
  document.querySelectorAll("button").forEach((element) => {
    element.disabled = value;
  });
}

function formatNumber(value, digits = 0) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function displayPaths(paths) {
  assetPaths = paths;
  byId("assetRoot").textContent = paths.root;
  byId("renderPath").textContent = paths.renderJson;
  byId("paramsPath").textContent = paths.paramsJson;
}

function createParameterControl(parameter) {
  const card = document.createElement("article");
  card.className = "parameter-card";
  card.dataset.parameter = parameter.name;
  const presentation = parameterPresentation(parameter.name);
  const digits = presentation.digits;
  card.innerHTML = `
    <div class="parameter-heading">
      <div><strong>${presentation.label}</strong><small>${presentation.unit}</small><small>${parameter.min.toFixed(digits)} → ${parameter.max.toFixed(digits)}</small></div>
      <div class="parameter-value"><span class="current">${parameter.current.toFixed(digits)}</span><small>target <b class="target">${parameter.target.toFixed(digits)}</b></small></div>
    </div>
    <input class="parameter-slider" type="range" min="${parameter.min}" max="${parameter.max}" step="${presentation.step}" value="${parameter.target}" aria-label="${presentation.label}">
    <div class="parameter-meta"><span>uniform ${parameter.name}</span><span>default ${parameter.default.toFixed(digits)}</span><span>smoothing ${parameter.smoothing.toFixed(3)}</span></div>
  `;
  const slider = card.querySelector(".parameter-slider");
  slider.addEventListener("input", () => {
    card.querySelector(".target").textContent = Number(slider.value).toFixed(digits);
    scheduleParameter(parameter.name, Number(slider.value));
  });
  return card;
}

function renderParameters(parameters) {
  const container = byId("parameterControls");
  const existingNames = [...container.children].map((child) => child.dataset.parameter);
  const nextNames = parameters.map((parameter) => parameter.name);
  if (existingNames.join("|") !== nextNames.join("|")) {
    container.replaceChildren(...parameters.map(createParameterControl));
  }
  for (const parameter of parameters) {
    const card = container.querySelector(`[data-parameter="${parameter.name}"]`);
    if (!card) continue;
    const digits = parameterPresentation(parameter.name).digits;
    card.querySelector(".current").textContent = Number(parameter.current).toFixed(digits);
    card.querySelector(".target").textContent = Number(parameter.target).toFixed(digits);
    const slider = card.querySelector(".parameter-slider");
    if (document.activeElement !== slider) slider.value = parameter.target;
  }
}

function scheduleParameter(name, value) {
  pendingParameters.set(name, value);
  if (scheduleParameter.pending) return;
  scheduleParameter.pending = true;
  requestAnimationFrame(async () => {
    scheduleParameter.pending = false;
    const updates = [...pendingParameters.entries()];
    pendingParameters.clear();
    for (const [parameterName, parameterValue] of updates) {
      try {
        await invoke("set_parameter", { name: parameterName, value: parameterValue });
      } catch (error) {
        setMessage(String(error), "error");
      }
    }
  });
}

function displaySnapshot(snapshot) {
  latestSnapshot = snapshot;
  const { renderer, shader, parameters, renderConfig, paramsConfig } = snapshot;
  const healthy = !shader.lastReloadError;
  byId("healthBadge").textContent = healthy ? "LAST GOOD ACTIVE" : "RELOAD REJECTED";
  byId("healthBadge").className = `hero-badge ${healthy ? "good" : "bad"}`;
  byId("gpuName").textContent = renderer.adapterName || renderer.backend;
  byId("rendererFps").textContent = `${Number(renderer.fps || 0).toFixed(1)} fps · ${Number(renderer.frameTimeMs || 0).toFixed(2)} ms`;
  byId("pipelineGeneration").textContent = `generation ${formatNumber(shader.pipelineGeneration)}`;
  byId("activeShaderShort").textContent = fileName(shader.activeShader);
  byId("activeProfile").textContent = shader.activeProfile;
  byId("activeShader").textContent = shader.activeShader;
  byId("profileTitle").textContent = shader.activeProfile;

  byId("shaderVariantList").replaceChildren(...shader.shaderVariants.map((variant) => {
    const chip = document.createElement("span");
    chip.className = `chip ${variant === shader.activeShader ? "active" : ""}`;
    chip.textContent = fileName(variant);
    return chip;
  }));
  byId("profileList").replaceChildren(...shader.profileNames.map((profile) => {
    const chip = document.createElement("span");
    chip.className = `chip ${profile === shader.activeProfile ? "active" : ""}`;
    chip.textContent = profile;
    return chip;
  }));

  renderParameters(parameters);
  byId("successfulReloads").textContent = formatNumber(shader.successfulReloads);
  byId("failedReloads").textContent = formatNumber(shader.failedReloads);
  byId("lastReloadReason").textContent = shader.lastReloadReason || "—";
  byId("lastReloadTime").textContent = `${Number(shader.lastReloadSeconds || 0).toFixed(2)} s after launch`;
  byId("lastReloadError").textContent = shader.lastReloadError || "None";
  byId("shaderNextKeys").textContent = renderConfig.frag_hotkeys.next.join(", ");
  byId("shaderPreviousKeys").textContent = renderConfig.frag_hotkeys.prev.join(", ");
  byId("profileNextKeys").textContent = paramsConfig.profile_hotkeys.next.join(", ");
  byId("profilePreviousKeys").textContent = paramsConfig.profile_hotkeys.prev.join(", ");
  byId("contractSummary").textContent = snapshot.contractSummary;

  if (shader.lastReloadError) setMessage("Reload rejected. The previous pipeline is still rendering.", "error");
}

async function refreshSnapshot() {
  try {
    displaySnapshot(await invoke("get_runtime_snapshot"));
  } catch (error) {
    console.error(error);
    setMessage(String(error), "error");
  }
}

async function runAction(command, args = {}, successMessage = "Updated.") {
  if (busy) return null;
  setBusy(true);
  try {
    const result = await invoke(command, args);
    await new Promise((resolve) => setTimeout(resolve, 260));
    await refreshSnapshot();
    setMessage(typeof result === "string" ? result : successMessage, "success");
    return result;
  } catch (error) {
    console.error(command, error);
    setMessage(String(error), "error");
    return null;
  } finally {
    setBusy(false);
  }
}

byId("previousShaderButton").addEventListener("click", () => runAction("cycle_shader", { direction: -1 }, "Previous shader activated."));
byId("nextShaderButton").addEventListener("click", () => runAction("cycle_shader", { direction: 1 }, "Next shader activated."));
byId("previousProfileButton").addEventListener("click", () => runAction("cycle_profile", { direction: -1 }, "Previous profile targets applied."));
byId("nextProfileButton").addEventListener("click", () => runAction("cycle_profile", { direction: 1 }, "Next profile targets applied."));
byId("validEditButton").addEventListener("click", () => runAction("toggle_valid_shader_edit", {}, "Valid shader edit written; watcher will reload it."));
byId("invalidEditButton").addEventListener("click", () => runAction("write_invalid_shader", {}, "Invalid shader written; output should keep using the previous pipeline."));
byId("restoreShaderButton").addEventListener("click", () => runAction("restore_active_shader", {}, "Active built-in shader restored; watcher will reload it."));
byId("manualReloadButton").addEventListener("click", () => runAction("reload_assets", {}, "Assets manually reloaded."));
byId("restoreAllButton").addEventListener("click", () => runAction("restore_all_assets", {}, "All built-in assets restored; watcher will reload them."));
byId("openAssetsButton").addEventListener("click", () => runAction("open_assets_folder", {}, "Runtime asset folder opened."));
byId("fullscreenButton").addEventListener("click", () => runAction("toggle_renderer_fullscreen", {}, "Renderer fullscreen toggled."));
byId("resetMetricsButton").addEventListener("click", () => runAction("reset_metrics", {}, "Reload counters reset."));

window.addEventListener("keydown", (event) => {
  if (!latestSnapshot || event.repeat) return;
  const tag = event.target?.tagName?.toLowerCase();
  if (["input", "select", "textarea"].includes(tag)) return;
  const shaderKeys = latestSnapshot.renderConfig.frag_hotkeys;
  const profileKeys = latestSnapshot.paramsConfig.profile_hotkeys;
  let handled = true;
  if (shaderKeys.next.includes(event.code)) runAction("cycle_shader", { direction: 1 }, "Next shader activated.");
  else if (shaderKeys.prev.includes(event.code)) runAction("cycle_shader", { direction: -1 }, "Previous shader activated.");
  else if (profileKeys.next.includes(event.code)) runAction("cycle_profile", { direction: 1 }, "Next profile applied.");
  else if (profileKeys.prev.includes(event.code)) runAction("cycle_profile", { direction: -1 }, "Previous profile applied.");
  else handled = false;
  if (handled) event.preventDefault();
});

async function initialize() {
  try {
    displayPaths(await invoke("get_asset_paths"));
    await refreshSnapshot();
  } catch (error) {
    console.error(error);
    setMessage(String(error), "error");
  }
}

initialize();
setInterval(refreshSnapshot, 300);
