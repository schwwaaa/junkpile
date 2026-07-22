const invoke = window.__TAURI__.core.invoke;
const byId = (id) => document.getElementById(id);
const SAVED_MAPPING_KEY = "junkpile-osc-network-control-v1";

const parameterNodes = new Map();
let mappingSignature = "";
let latestMappings = [];

function fixed(value, digits = 2) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(digits) : "—";
}

function integer(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric).toLocaleString() : "—";
}

function createParameterRegistry(parameters) {
  const root = byId("parameterRegistry");
  root.replaceChildren();
  parameterNodes.clear();

  for (const parameter of parameters) {
    const row = document.createElement("div");
    row.className = "parameter-row";

    const title = document.createElement("div");
    title.className = "parameter-title";
    const label = document.createElement("strong");
    label.textContent = parameter.label;
    const key = document.createElement("small");
    key.textContent = parameter.name;
    title.append(label, key);

    const input = document.createElement("input");
    input.type = "range";
    input.min = "0";
    input.max = "1";
    input.step = "0.001";
    input.value = String(parameter.value);

    const output = document.createElement("output");
    output.textContent = fixed(parameter.value, 3);

    const badge = document.createElement("span");
    badge.className = "mapping-badge";

    const learn = document.createElement("button");
    learn.type = "button";
    learn.className = "learn-button";
    learn.textContent = "Learn";
    learn.addEventListener("click", () => invoke("arm_osc_learn", { target: parameter.name }));

    let timer = null;
    input.addEventListener("input", () => {
      output.textContent = fixed(input.value, 3);
      clearTimeout(timer);
      timer = setTimeout(() => {
        invoke("set_manual_parameter", {
          target: parameter.name,
          value: Number(input.value),
        }).catch((error) => { byId("oscError").textContent = String(error); });
      }, 18);
    });

    row.append(title, input, output, badge, learn);
    root.append(row);
    parameterNodes.set(parameter.name, { row, input, output, badge, learn });
  }
}

function updateParameters(parameters, learnTarget) {
  if (parameterNodes.size === 0) createParameterRegistry(parameters);
  for (const parameter of parameters) {
    const nodes = parameterNodes.get(parameter.name);
    if (!nodes) continue;
    if (document.activeElement !== nodes.input) {
      nodes.input.value = String(parameter.value);
      nodes.output.textContent = fixed(parameter.value, 3);
    }
    nodes.badge.textContent = parameter.mapped ? "MAPPED" : "MANUAL";
    nodes.badge.classList.toggle("mapped", Boolean(parameter.mapped));
    const learning = learnTarget === parameter.name;
    nodes.learn.classList.toggle("active", learning);
    nodes.learn.textContent = learning ? "Send OSC…" : "Learn";
    nodes.row.classList.toggle("learning", learning);
  }
}

function numericInput(value, min, max, step, label) {
  const input = document.createElement("input");
  input.type = "number";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.setAttribute("aria-label", label);
  return input;
}

function renderMappings(mappings) {
  const signature = JSON.stringify(mappings);
  if (signature === mappingSignature) return;
  mappingSignature = signature;
  latestMappings = mappings.map((mapping) => ({ ...mapping }));
  const root = byId("mappingList");
  root.replaceChildren();

  if (mappings.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No mappings yet. Load the starter map or click Learn beside a parameter and send OSC.";
    root.append(empty);
    return;
  }

  for (const mapping of mappings) {
    const row = document.createElement("div");
    row.className = "mapping-row osc-mapping-grid";

    const target = document.createElement("strong");
    target.textContent = mapping.target.replaceAll("_", " ");
    const address = document.createElement("input");
    address.value = mapping.address;
    address.setAttribute("aria-label", "OSC address");
    const argIndex = numericInput(mapping.argumentIndex, 0, 31, 1, "Argument index");
    const inputMin = numericInput(mapping.inputMin, -1000000, 1000000, 0.01, "Input minimum");
    const inputMax = numericInput(mapping.inputMax, -1000000, 1000000, 0.01, "Input maximum");
    const outputMin = numericInput(mapping.outputMin, 0, 1, 0.01, "Output minimum");
    const outputMax = numericInput(mapping.outputMax, 0, 1, 0.01, "Output maximum");
    const smoothing = numericInput(mapping.smoothing, 0, 0.98, 0.01, "Smoothing");

    const invertLabel = document.createElement("label");
    invertLabel.className = "check-label";
    const invert = document.createElement("input");
    invert.type = "checkbox";
    invert.checked = Boolean(mapping.invert);
    invertLabel.append(invert, document.createTextNode(" yes"));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger-button";
    remove.textContent = "Remove";

    const commit = () => {
      const updated = {
        ...mapping,
        address: address.value.trim(),
        argumentIndex: Math.max(0, Math.round(Number(argIndex.value))),
        inputMin: Number(inputMin.value),
        inputMax: Number(inputMax.value),
        outputMin: Number(outputMin.value),
        outputMax: Number(outputMax.value),
        smoothing: Number(smoothing.value),
        invert: invert.checked,
      };
      invoke("update_osc_mapping", { mapping: updated }).catch((error) => {
        byId("mappingStatus").textContent = String(error);
      });
    };
    for (const node of [address, argIndex, inputMin, inputMax, outputMin, outputMax, smoothing, invert]) {
      node.addEventListener("change", commit);
    }
    remove.addEventListener("click", () => invoke("delete_osc_mapping", { id: mapping.id }));

    row.append(target, address, argIndex, inputMin, inputMax, outputMin, outputMax, smoothing, invertLabel, remove);
    root.append(row);
  }
}

function renderHistory(history) {
  const root = byId("messageMonitor");
  root.replaceChildren();
  if (history.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Listening for OSC messages…";
    root.append(empty);
    return;
  }
  for (const event of history) {
    const row = document.createElement("div");
    row.className = "monitor-row osc-monitor-grid";
    const address = document.createElement("strong");
    address.textContent = event.address;
    const types = document.createElement("code");
    types.textContent = (event.argumentTypes || []).join(", ") || "—";
    const args = document.createElement("span");
    args.textContent = (event.arguments || []).join(" · ") || "—";
    const sender = document.createElement("span");
    sender.textContent = event.sender || "—";
    const depth = document.createElement("span");
    depth.textContent = String(event.bundleDepth || 0);
    row.append(address, types, args, sender, depth);
    root.append(row);
  }
}

async function pollOsc() {
  try {
    const info = await invoke("get_osc_info");
    updateParameters(info.parameters || [], info.learnTarget || "");
    renderMappings(info.mappings || []);
    renderHistory(info.history || []);

    if (document.activeElement !== byId("bindHost")) byId("bindHost").value = info.bindHost || "0.0.0.0";
    if (document.activeElement !== byId("bindPort")) byId("bindPort").value = String(info.port || 9000);
    byId("runtimeListener").textContent = info.listening ? info.localAddress : "Stopped";
    byId("runtimeSender").textContent = info.lastSender || "—";
    byId("runtimeLearn").textContent = info.learnTarget ? `Waiting: ${info.learnTarget}` : "Idle";
    byId("connectionChip").textContent = info.listening ? "LISTENING" : "OFFLINE";
    byId("connectionChip").classList.toggle("connected", Boolean(info.listening));
    byId("messageRate").textContent = fixed(info.messagesPerSecond, 1);
    byId("totalMessages").textContent = integer(info.totalMessages);
    byId("bundleCount").textContent = integer(info.totalBundles);
    byId("decodeErrors").textContent = integer(info.decodeErrors);
    byId("oscError").textContent = info.lastError || "";
  } catch (error) {
    byId("oscError").textContent = String(error);
  }
}

async function pollRenderer() {
  try {
    const info = await invoke("get_renderer_info");
    byId("runtimeGpu").textContent = `${info.backend} · ${info.adapter}`;
    byId("rendererFps").textContent = fixed(info.fps, 1);
    byId("rendererFrameTime").textContent = `${fixed(info.frameTimeMs, 2)} ms`;
    byId("rendererSize").textContent = `${integer(info.width)} × ${integer(info.height)}`;
    byId("activeSignals").textContent = integer(info.activeSignals);
    byId("rendererAdapter").textContent = `${info.backend} · ${info.adapter} · ${info.surfaceFormat}`;
    byId("rendererError").textContent = info.lastError || "";
  } catch (error) {
    byId("rendererError").textContent = String(error);
  }
}

byId("bindButton").addEventListener("click", () => {
  invoke("bind_osc_listener", {
    host: byId("bindHost").value,
    port: Number(byId("bindPort").value),
  }).catch((error) => { byId("oscError").textContent = String(error); });
});
byId("stopButton").addEventListener("click", () => invoke("stop_osc_listener"));
byId("cancelLearn").addEventListener("click", () => invoke("cancel_osc_learn"));
byId("resetParameters").addEventListener("click", () => invoke("reset_osc_parameters"));
byId("starterMappings").addEventListener("click", () => invoke("load_starter_mappings"));
byId("clearMappings").addEventListener("click", () => invoke("clear_osc_mappings"));
byId("clearHistory").addEventListener("click", () => invoke("clear_osc_history"));
byId("fullscreenButton").addEventListener("click", () => invoke("toggle_renderer_fullscreen"));
byId("sendTest").addEventListener("click", () => {
  invoke("send_osc_test", {
    host: "127.0.0.1",
    port: Number(byId("bindPort").value),
    address: byId("testAddress").value,
    value: Number(byId("testValue").value),
  }).catch((error) => { byId("oscError").textContent = String(error); });
});

byId("saveMappings").addEventListener("click", () => {
  localStorage.setItem(SAVED_MAPPING_KEY, JSON.stringify(latestMappings));
  byId("mappingStatus").textContent = `Saved ${latestMappings.length} mapping(s) in this controls window.`;
});
byId("loadMappings").addEventListener("click", () => {
  try {
    const mappings = JSON.parse(localStorage.getItem(SAVED_MAPPING_KEY) || "[]");
    if (!Array.isArray(mappings)) throw new Error("saved value is not a mapping list");
    invoke("replace_osc_mappings", { mappings });
    byId("mappingStatus").textContent = `Loaded ${mappings.length} mapping(s).`;
  } catch (error) {
    byId("mappingStatus").textContent = String(error);
  }
});

pollOsc();
pollRenderer();
setInterval(pollOsc, 100);
setInterval(pollRenderer, 250);
