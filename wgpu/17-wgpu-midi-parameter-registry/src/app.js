const invoke = window.__TAURI__.core.invoke;
const byId = (id) => document.getElementById(id);
const SAVED_MAPPING_KEY = "junkpile-midi-parameter-registry-v1";

let knownPorts = [];
let knownMappingSignature = "";
let latestMappings = [];
const parameterNodes = new Map();

function number(value, digits = 2) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "—";
}

function integer(value) {
  return Number.isFinite(Number(value)) ? Math.round(Number(value)).toLocaleString() : "—";
}

function updatePortOptions(ports, connectedPort) {
  const select = byId("midiPort");
  if (JSON.stringify(ports) !== JSON.stringify(knownPorts)) {
    knownPorts = [...ports];
    select.replaceChildren();
    if (ports.length === 0) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No MIDI input ports found";
      select.append(option);
    } else {
      for (const name of ports) {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        select.append(option);
      }
    }
  }
  if (connectedPort && [...select.options].some((option) => option.value === connectedPort)) {
    select.value = connectedPort;
  }
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
    input.setAttribute("aria-label", `${parameter.label} normalized value`);

    const output = document.createElement("output");
    output.textContent = number(parameter.value, 3);

    const mappingBadge = document.createElement("span");
    mappingBadge.className = "mapping-badge";
    mappingBadge.textContent = parameter.mapped ? "MAPPED" : "MANUAL";

    const learn = document.createElement("button");
    learn.type = "button";
    learn.className = "learn-button";
    learn.textContent = "Learn";
    learn.addEventListener("click", () => invoke("arm_midi_learn", { target: parameter.name }));

    let timer = null;
    input.addEventListener("input", () => {
      output.textContent = number(input.value, 3);
      clearTimeout(timer);
      timer = setTimeout(() => {
        invoke("set_manual_parameter", {
          target: parameter.name,
          value: Number(input.value),
        }).catch((error) => {
          byId("midiError").textContent = String(error);
        });
      }, 18);
    });

    row.append(title, input, output, mappingBadge, learn);
    root.append(row);
    parameterNodes.set(parameter.name, { row, input, output, mappingBadge, learn });
  }
}

function updateParameters(parameters, learnTarget) {
  if (parameterNodes.size === 0) {
    createParameterRegistry(parameters);
  }
  for (const parameter of parameters) {
    const nodes = parameterNodes.get(parameter.name);
    if (!nodes) continue;
    if (document.activeElement !== nodes.input) {
      nodes.input.value = String(parameter.value);
      nodes.output.textContent = number(parameter.value, 3);
    }
    nodes.mappingBadge.textContent = parameter.mapped ? "MAPPED" : "MANUAL";
    nodes.mappingBadge.classList.toggle("mapped", parameter.mapped);
    const learning = learnTarget === parameter.name;
    nodes.learn.classList.toggle("active", learning);
    nodes.learn.textContent = learning ? "Move control…" : "Learn";
    nodes.row.classList.toggle("learning", learning);
  }
}

function sourceLabel(mapping) {
  const channel = mapping.channel === 0 ? "all ch" : `ch ${mapping.channel}`;
  switch (mapping.sourceKind) {
    case "cc": return `CC ${mapping.number} · ${channel}`;
    case "note_on": return `Note ${mapping.number} · ${channel}`;
    case "pitch_bend": return `Pitch bend · ${channel}`;
    case "channel_pressure": return `Pressure · ${channel}`;
    case "poly_aftertouch": return `Aftertouch ${mapping.number} · ${channel}`;
    default: return `${mapping.sourceKind} ${mapping.number} · ${channel}`;
  }
}

function makeNumberInput(value, min, max, step, label) {
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
  if (signature === knownMappingSignature) return;
  knownMappingSignature = signature;
  latestMappings = mappings.map((mapping) => ({ ...mapping }));
  const root = byId("mappingList");
  root.replaceChildren();

  if (mappings.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No mappings yet. Click Learn beside a parameter, then move a MIDI control.";
    root.append(empty);
    return;
  }

  for (const mapping of mappings) {
    const row = document.createElement("div");
    row.className = "mapping-row";

    const target = document.createElement("strong");
    target.textContent = mapping.target.replaceAll("_", " ");
    const source = document.createElement("span");
    source.className = "source-pill";
    source.textContent = sourceLabel(mapping);

    const min = makeNumberInput(mapping.min, 0, 1, 0.01, "Minimum mapped value");
    const max = makeNumberInput(mapping.max, 0, 1, 0.01, "Maximum mapped value");
    const smoothing = makeNumberInput(mapping.smoothing, 0, 0.98, 0.01, "Mapping smoothing");

    const invertLabel = document.createElement("label");
    invertLabel.className = "check-label";
    const invert = document.createElement("input");
    invert.type = "checkbox";
    invert.checked = Boolean(mapping.invert);
    invertLabel.append(invert, document.createTextNode(" invert"));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger-button";
    remove.textContent = "Remove";

    const commit = () => {
      const updated = {
        ...mapping,
        min: Number(min.value),
        max: Number(max.value),
        smoothing: Number(smoothing.value),
        invert: invert.checked,
      };
      invoke("update_midi_mapping", { mapping: updated }).catch((error) => {
        byId("mappingStatus").textContent = String(error);
      });
    };
    min.addEventListener("change", commit);
    max.addEventListener("change", commit);
    smoothing.addEventListener("change", commit);
    invert.addEventListener("change", commit);
    remove.addEventListener("click", () => invoke("delete_midi_mapping", { id: mapping.id }));

    row.append(target, source, min, max, smoothing, invertLabel, remove);
    root.append(row);
  }
}

function renderHistory(history) {
  const root = byId("messageMonitor");
  root.replaceChildren();
  if (history.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Connect a MIDI source and move a control or play a note.";
    root.append(empty);
    return;
  }
  for (const event of history) {
    const row = document.createElement("div");
    row.className = "monitor-row";
    const kind = document.createElement("strong");
    kind.textContent = event.kind.replaceAll("_", " ");
    const channel = document.createElement("span");
    channel.textContent = String(event.channel);
    const data = document.createElement("span");
    data.textContent = `${event.data1} / ${event.data2}`;
    const value = document.createElement("span");
    value.textContent = number(event.value, 3);
    const raw = document.createElement("code");
    raw.textContent = (event.raw || []).map((byte) => Number(byte).toString(16).padStart(2, "0")).join(" ");
    row.append(kind, channel, data, value, raw);
    root.append(row);
  }
}

function setContinuousMeters(info) {
  const pitchNormalized = Math.max(0, Math.min(1, (Number(info.pitchBend) + 1) * 0.5));
  byId("pitchBar").style.width = `${pitchNormalized * 100}%`;
  byId("pitchValue").textContent = number(info.pitchBend, 3);
  const pressure = Math.max(0, Math.min(1, Number(info.channelPressure) || 0));
  byId("pressureBar").style.width = `${pressure * 100}%`;
  byId("pressureValue").textContent = number(pressure, 3);
}

async function pollMidi() {
  try {
    const info = await invoke("get_midi_info");
    updatePortOptions(info.ports || [], info.connectedPort || "");
    updateParameters(info.parameters || [], info.learnTarget || "");
    renderMappings(info.mappings || []);
    renderHistory(info.history || []);
    setContinuousMeters(info);

    byId("runtimeMidi").textContent = info.connected ? info.connectedPort : "Disconnected";
    byId("runtimeLearn").textContent = info.learnTarget ? `Waiting: ${info.learnTarget}` : "Idle";
    byId("connectionChip").textContent = info.connected ? "CONNECTED" : "OFFLINE";
    byId("connectionChip").classList.toggle("connected", Boolean(info.connected));
    byId("messageRate").textContent = number(info.messagesPerSecond, 1);
    byId("totalMessages").textContent = integer(info.totalMessages);
    byId("activeNotes").textContent = integer(info.activeNotes);
    byId("mappingCount").textContent = integer((info.mappings || []).length);
    byId("midiError").textContent = info.lastError || "";
  } catch (error) {
    byId("midiError").textContent = String(error);
  }
}

async function pollRenderer() {
  try {
    const info = await invoke("get_renderer_info");
    byId("runtimeBackend").textContent = info.backend || "—";
    byId("runtimeRenderer").textContent = `${info.width}×${info.height} · ${number(info.fps, 1)} FPS`;
    byId("renderFps").textContent = number(info.fps, 1);
    byId("frameTime").textContent = `${number(info.frameTimeMs, 2)} ms`;
    byId("gpuSurface").textContent = `${info.surfaceFormat || "—"} · ${info.adapter || "—"}`;
    byId("midiSequence").textContent = integer(info.midiSequence);
  } catch (error) {
    byId("runtimeRenderer").textContent = String(error);
  }
}

byId("refreshPorts").addEventListener("click", () => invoke("refresh_midi_ports"));
byId("connectMidi").addEventListener("click", () => {
  const name = byId("midiPort").value;
  if (name) invoke("connect_midi_port", { name });
});
byId("disconnectMidi").addEventListener("click", () => invoke("disconnect_midi"));
byId("cancelLearn").addEventListener("click", () => invoke("cancel_midi_learn"));
byId("resetParameters").addEventListener("click", () => invoke("reset_midi_parameters"));
byId("rendererFullscreen").addEventListener("click", () => invoke("toggle_renderer_fullscreen"));
byId("starterMappings").addEventListener("click", () => invoke("load_starter_mappings"));
byId("clearMappings").addEventListener("click", () => invoke("clear_midi_mappings"));

byId("saveMappings").addEventListener("click", () => {
  localStorage.setItem(SAVED_MAPPING_KEY, JSON.stringify(latestMappings));
  byId("mappingStatus").textContent = `Saved ${latestMappings.length} mapping(s) in this controls WebView.`;
});

byId("loadMappings").addEventListener("click", async () => {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED_MAPPING_KEY) || "[]");
    if (!Array.isArray(saved)) throw new Error("saved mapping data is not an array");
    await invoke("replace_midi_mappings", { mappings: saved });
    byId("mappingStatus").textContent = `Loaded ${saved.length} saved mapping(s).`;
  } catch (error) {
    byId("mappingStatus").textContent = `Could not load mappings: ${error}`;
  }
});

await pollMidi();
await pollRenderer();
setInterval(pollMidi, 100);
setInterval(pollRenderer, 220);
