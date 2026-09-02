const invoke = window.__TAURI__.core.invoke;
const byId = (id) => document.getElementById(id);
let busy = false;
let latestSnapshot = null;
const defaults = {
  udpMpegTs: "udp://127.0.0.1:23000?pkt_size=1316&buffer_size=1048576",
  rtsp: "rtsp://127.0.0.1:8554/junkpile40",
  rtmp: "rtmp://127.0.0.1:1935/junkpile40",
};
const number = (value) => Number(value || 0).toLocaleString();
const pretty = (value) => String(value ?? "—").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (x) => x.toUpperCase());
function setBusy(next) { busy = next; updateControlState(); }
function updateControlState() {
  const active = Boolean(latestSnapshot?.network?.active);
  byId("startButton").disabled = busy || active;
  byId("stopButton").disabled = busy || !active;
  byId("preflightButton").disabled = busy || active;
  byId("vlcButton").disabled = busy;
  byId("resetButton").disabled = busy;
  byId("fullscreenButton").disabled = busy;
  document.querySelectorAll("input, select").forEach((control) => { control.disabled = busy || active; });
}
function receiverUrl(config) {
  if (config.protocol !== "udpMpegTs") return config.url;
  const match = config.url.match(/^udp:\/\/[^:/?#]+:(\d+)/i);
  return `udp://@:${match?.[1] || "23000"}`;
}
function readConfig() {
  const [width, height] = byId("resolution").value.split("x").map(Number);
  return { protocol: byId("protocol").value, url: byId("destination").value.trim(), ffmpegPath: byId("ffmpegPath").value.trim(), fps: Number(byId("frameRate").value), width, height, bitrateKbps: Number(byId("bitrate").value), gop: Number(byId("gop").value), vflip: byId("verticalFlip").checked, startupProbeMs: 700 };
}
function updateEndpointPreview() {
  const config = readConfig();
  byId("publisherUrl").textContent = config.url;
  byId("receiverUrl").textContent = receiverUrl(config);
  byId("serverRequirement").textContent = config.protocol === "udpMpegTs" ? "No server · direct receiver" : "Running ingest server required";
  byId("protocolBadge").textContent = config.protocol === "udpMpegTs" ? "UDP / MPEG-TS" : config.protocol.toUpperCase();
}
function badgeClass(state) { const value = String(state || "idle").toLowerCase(); if (["sending","success","running"].includes(value)) return "running"; if (["error","failed"].includes(value)) return "error"; if (["starting","testing"].includes(value)) return "backpressured"; return "disabled"; }
function setSnapshot(snapshot) {
  latestSnapshot = snapshot;
  const { renderer, frame, network } = snapshot;
  const healthy = renderer.running && !renderer.lastError && !network.lastError;
  byId("statusDot").className = `dot ${healthy ? "good" : "bad"}`;
  byId("statusText").textContent = network.lastError || renderer.lastError || (network.active ? "network output active" : "renderer ready");
  byId("frameCounter").textContent = `frame ${number(renderer.frameCount)}`;
  byId("networkState").textContent = network.state;
  byId("networkState").className = `badge ${badgeClass(network.state)}`;
  byId("rendererState").textContent = renderer.running ? "running" : "stopped";
  byId("rendererState").className = `badge ${renderer.running ? "running" : "error"}`;
  byId("frameDimensions").textContent = `${number(frame.width)} × ${number(frame.height)}`;
  byId("pixelFormat").textContent = pretty(frame.pixelFormat);
  byId("origin").textContent = pretty(frame.origin);
  byId("colorSpace").textContent = pretty(frame.colorSpace);
  byId("nominalFps").textContent = `${frame.nominalFps.numerator}/${frame.nominalFps.denominator}`;
  byId("contractSummary").textContent = snapshot.contractSummary;
  byId("activeProtocol").textContent = network.protocol;
  byId("activeFormat").textContent = `${number(network.width)} × ${number(network.height)} · ${network.fps} fps · ${(network.bitrateKbps / 1000).toFixed(1)} Mbps`;
  byId("rawBandwidth").textContent = `${network.rawMegabytesPerSecond.toFixed(1)} MiB/s`;
  byId("ffmpegPid").textContent = network.ffmpegPid >= 0 ? network.ffmpegPid : "—";
  byId("captureRequests").textContent = number(network.captureRequests);
  byId("readbacks").textContent = number(network.readbacksCompleted);
  byId("framesWritten").textContent = number(network.framesWritten);
  byId("rawWritten").textContent = `${network.encodedMegabytesWritten.toFixed(1)} MiB`;
  byId("gpuDrops").textContent = number(network.droppedGpu);
  byId("cpuDrops").textContent = number(network.droppedCpuPool);
  byId("workerDrops").textContent = number(network.droppedWorker);
  byId("pendingWorker").textContent = `${network.pendingWorker} / 2`;
  byId("cpuBuffers").textContent = `${network.cpuBuffersAvailable} / 3`;
  byId("readbackBusy").textContent = `${network.readbackSlotsBusy} / 3`;
  byId("exitCode").textContent = network.ffmpegExitCode >= 0 ? network.ffmpegExitCode : "—";
  byId("networkLog").textContent = network.lastError || network.diagnostics || "Network output has not started.";
  byId("networkLog").className = `log-box ${network.lastError ? "error-log" : ""}`;
  byId("backend").textContent = renderer.backend;
  byId("adapter").textContent = renderer.adapterName;
  byId("surface").textContent = renderer.surfaceFormat;
  byId("windowSize").textContent = `${renderer.windowWidth} × ${renderer.windowHeight}`;
  byId("measuredFps").textContent = renderer.fps.toFixed(1);
  byId("frameTime").textContent = `${renderer.frameTimeMs.toFixed(2)} ms`;
  updateControlState();
}
async function refresh() { try { setSnapshot(await invoke("get_runtime_snapshot")); } catch (error) { byId("statusText").textContent = String(error); } }
async function action(command, args = {}) {
  if (busy) return;
  setBusy(true);
  try { const result = await invoke(command, args); await new Promise((r) => setTimeout(r, 140)); await refresh(); return result; }
  catch (error) { byId("statusDot").className = "dot bad"; byId("statusText").textContent = String(error); byId("networkLog").textContent = String(error); byId("networkLog").className = "log-box error-log"; throw error; }
  finally { setBusy(false); }
}
byId("protocol").addEventListener("change", () => { byId("destination").value = defaults[byId("protocol").value]; const fps = Number(byId("frameRate").value); byId("gop").value = fps * 2; updateEndpointPreview(); });
["destination","resolution","frameRate","bitrate","gop","ffmpegPath","verticalFlip"].forEach((id) => byId(id).addEventListener("input", updateEndpointPreview));
byId("preflightButton").addEventListener("click", async () => { setBusy(true); byId("preflightState").textContent = "testing"; byId("preflightState").className = "badge backpressured"; try { const report = await invoke("preflight_network", { config: readConfig() }); byId("preflightState").textContent = report.success ? "success" : "failed"; byId("preflightState").className = `badge ${report.success ? "running" : "error"}`; byId("preflightLog").textContent = `${report.message}\n\n${report.ffmpegVersion}\nPublisher: ${report.publisherUrl}\nReceiver: ${report.receiverUrl}${report.diagnostics ? `\n\n${report.diagnostics}` : ""}`; byId("preflightLog").className = `log-box ${report.success ? "" : "error-log"}`; } catch (error) { byId("preflightState").textContent = "error"; byId("preflightState").className = "badge error"; byId("preflightLog").textContent = String(error); } finally { setBusy(false); } });
byId("startButton").addEventListener("click", () => action("start_network", { config: readConfig() }).catch(() => {}));
byId("stopButton").addEventListener("click", () => action("stop_network").catch(() => {}));
byId("vlcButton").addEventListener("click", async () => { try { const url = await action("launch_vlc", { config: readConfig() }); byId("statusText").textContent = `VLC opened ${url}`; } catch {} });
byId("resetButton").addEventListener("click", () => action("reset_metrics").catch(() => {}));
byId("fullscreenButton").addEventListener("click", () => action("toggle_renderer_fullscreen").catch(() => {}));
updateEndpointPreview(); refresh(); setInterval(refresh, 500);
