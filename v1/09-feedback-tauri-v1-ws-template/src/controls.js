"use strict";

const WS_URL = "ws://127.0.0.1:2727";
const MODE_NAMES = ["Echo Trail", "Fluid Smear", "Reaction-Diffusion", "Thermal", "Mirror Echo", "Glitch Memory"];
const MODE_DESCS = [
  "The previous frame decays while the source is reinjected, leaving luminous motion trails.",
  "Source edges stir a curl field that advects the persistent image like liquid.",
  "Source luminance injects activator into a Gray-Scott reaction-diffusion state.",
  "Source brightness becomes a continuous heat field that diffuses and blooms.",
  "The source is folded into six-way symmetry while feedback builds a live mandala.",
  "Block-shifted history and RGB offsets accumulate into unstable VHS-like memory."
];
const DEFAULT_PARAMS = Object.freeze({
  mode:0, decay:0.97, camMix:0.30, speed:1, scale:1, intensity:1,
  hue:0, palette:0, brush:0.03, bufferScale:0.5
});
const PRESETS = Object.freeze({
  echo:{ mode:0, decay:0.982, camMix:0.24, speed:0.75, scale:1, intensity:1.05, hue:0, palette:4, brush:0.035 },
  fluid:{ mode:1, decay:0.991, camMix:0.08, speed:1.25, scale:1.7, intensity:1.15, hue:-0.08, palette:1, brush:0.045 },
  reaction:{ mode:2, decay:0.999, camMix:0.34, speed:0.75, scale:1, intensity:1, hue:0.12, palette:2, brush:0.028 },
  thermal:{ mode:3, decay:0.976, camMix:0.18, speed:1.2, scale:1, intensity:1.45, hue:-0.03, palette:0, brush:0.05 },
  mirror:{ mode:4, decay:0.976, camMix:0.25, speed:0.9, scale:1, intensity:1.1, hue:0.04, palette:4, brush:0.035 },
  glitch:{ mode:5, decay:0.955, camMix:0.36, speed:1.45, scale:1, intensity:1.25, hue:0.08, palette:3, brush:0.025 }
});
const SLIDERS = ["decay","camMix","speed","scale","intensity","hue","brush"];
const state = {
  params:{...DEFAULT_PARAMS}, paused:false,
  camera:{ on:false, deviceId:"", preset:"720" }
};
let socket=null, reconnectTimer=0, reconnectDelay=600, flushScheduled=false, outputFullscreen=false;
const pendingParams=new Map();

function invoke(name,args={}) {
  const fn=window.__TAURI__?.invoke || window.__TAURI__?.tauri?.invoke;
  return fn ? fn(name,args) : Promise.reject(new Error("Tauri API unavailable"));
}
function setStatus(id,text,kind="pending") {
  const el=document.getElementById(id); if(!el) return;
  el.textContent=text; el.classList.remove("ok","pending","error"); el.classList.add(kind);
}
function setDot(id,tone){const el=document.getElementById(id);if(el)el.className=`status-dot ${tone}`;}
function send(message){if(!socket||socket.readyState!==WebSocket.OPEN)return false;socket.send(JSON.stringify(message));return true;}
function fmt(id,v){if(id==="decay"||id==="hue"||id==="brush")return v.toFixed(3);if(id==="speed")return `${v.toFixed(2)}×`;return v.toFixed(2);}
function setMode(mode){state.params.mode=Number(mode);document.querySelectorAll(".mode-btn").forEach(b=>b.classList.toggle("active",Number(b.dataset.mode)===state.params.mode));document.getElementById("modeName").textContent=MODE_NAMES[state.params.mode];document.getElementById("modeReadout").textContent=MODE_NAMES[state.params.mode];document.getElementById("mode-desc").textContent=MODE_DESCS[state.params.mode];}
function updateControls(){
  SLIDERS.forEach(id=>{const input=document.getElementById(id);input.value=String(state.params[id]);document.getElementById(`${id}-val`).textContent=fmt(id,Number(state.params[id]));});
  document.getElementById("palette").value=String(state.params.palette);
  document.getElementById("bufferScale").value=String(state.params.bufferScale);
  document.getElementById("capturePreset").value=state.camera.preset;
  document.getElementById("cam-btn").textContent=state.camera.on?"Stop camera":"Start camera";
  document.getElementById("pauseBtn").textContent=state.paused?"Resume render":"Pause render";
  setMode(state.params.mode);
}
function scheduleFlush(name,value){
  pendingParams.set(name,value); if(flushScheduled)return; flushScheduled=true;
  requestAnimationFrame(()=>{flushScheduled=false;if(!pendingParams.size)return;const values=Object.fromEntries(pendingParams);pendingParams.clear();send({type:"param_batch",values});});
}
function sendSnapshot(options={}){send({type:"state_snapshot",params:{...state.params},paused:state.paused,camera:{...state.camera},clearHistory:Boolean(options.clearHistory),resetClock:Boolean(options.resetClock)});}
function populateDevices(msg){
  const select=document.getElementById("cam-select"), devices=Array.isArray(msg.devices)?msg.devices:[];
  select.innerHTML='<option value="">Default camera</option>';
  devices.forEach((device,index)=>{const option=document.createElement("option");option.value=device.deviceId||"";option.textContent=device.label||`Camera ${index+1}`;select.appendChild(option);});
  const preferred=state.camera.deviceId||msg.activeDeviceId||""; if([...select.options].some(o=>o.value===preferred))select.value=preferred;
  if(!state.camera.on){document.getElementById("cameraStatus").textContent=devices.length?"Ready to request":"Permission not granted";document.getElementById("cameraMessage").textContent=devices.length?`${devices.length} camera input${devices.length===1?"":"s"} reported by the output WebView.`:"Start the camera once to reveal device labels.";setDot("cameraDot","warning");}
}
function updateCamera(msg){
  const tone=msg.state==="ok"?"ok":msg.state==="error"?"error":"warning";setDot("cameraDot",tone);
  document.getElementById("cameraStatus").textContent=msg.title||(msg.state==="ok"?"Camera live":msg.state==="error"?"Camera error":"Generated source");
  document.getElementById("cameraMessage").textContent=msg.message||"Camera state updated by the output window.";
  if(msg.state==="ok"){state.camera.on=true;if(msg.deviceId)state.camera.deviceId=msg.deviceId;document.getElementById("cam-btn").textContent="Stop camera";}
  else if(msg.state==="stopped"||msg.state==="error"){state.camera.on=false;document.getElementById("cam-btn").textContent="Start camera";}
}
function handleTelemetry(msg){
  document.getElementById("fpsReadout").textContent=String(msg.fps||0);document.getElementById("cameraFpsReadout").textContent=String(msg.sourceFps||0);
  document.getElementById("sizeReadout").textContent=`${msg.width||0} × ${msg.height||0}`;document.getElementById("bufferReadout").textContent=`${msg.bufferWidth||0} × ${msg.bufferHeight||0}`;
  document.getElementById("rendererReadout").textContent=msg.renderer||"WebGL 1";setStatus("shaderStatus",msg.shaderReady?"Pipeline linked":"Pipeline error",msg.shaderReady?"ok":"error");setDot("shaderDot",msg.shaderReady?"ok":"error");document.getElementById("diagnostics").textContent=msg.diagnostics||"No diagnostics received.";
  if(Number.isFinite(msg.mode))setMode(msg.mode);
}
function handleMessage(msg){
  if(msg.type==="presence"){const c=Number(msg.controls||0),o=Number(msg.canvas||0);document.getElementById("presenceReadout").textContent=`${c} control${c===1?"":"s"} · ${o} output${o===1?"":"s"}`;setStatus("canvasStatus",o?"Connected":"Waiting…",o?"ok":"pending");}
  else if(msg.type==="request_state"){sendSnapshot();send({type:"cam",action:"enumerate"});}
  else if(msg.type==="telemetry")handleTelemetry(msg);
  else if(msg.type==="cam-devices")populateDevices(msg);
  else if(msg.type==="cam-status")updateCamera(msg);
}
function connect(){
  clearTimeout(reconnectTimer);if(socket&&(socket.readyState===WebSocket.OPEN||socket.readyState===WebSocket.CONNECTING))return;
  setStatus("relayStatus","Connecting…","pending");socket=new WebSocket(WS_URL);
  socket.addEventListener("open",()=>{reconnectDelay=600;setStatus("relayStatus","Connected","ok");send({type:"hello",role:"controls"});sendSnapshot();send({type:"cam",action:"enumerate"});});
  socket.addEventListener("message",event=>{if(typeof event.data!=="string")return;try{handleMessage(JSON.parse(event.data));}catch(error){console.warn("[junkpile 09] malformed relay message",error);}});
  socket.addEventListener("close",()=>{setStatus("relayStatus","Disconnected","error");setStatus("canvasStatus","Waiting…","pending");reconnectTimer=setTimeout(connect,reconnectDelay);reconnectDelay=Math.min(4000,Math.round(reconnectDelay*1.5));});
  socket.addEventListener("error",()=>setStatus("relayStatus","Relay error","error"));
}
function applyPreset(name){state.params={...DEFAULT_PARAMS,...(PRESETS[name]||PRESETS.echo),bufferScale:state.params.bufferScale};updateControls();sendSnapshot({clearHistory:true});}
function resetExample(){state.params={...DEFAULT_PARAMS};state.paused=false;updateControls();sendSnapshot({clearHistory:true,resetClock:true});}
function toggleCamera(){if(state.camera.on){state.camera.on=false;send({type:"cam",action:"stop"});updateCamera({state:"stopped",title:"Generated source",message:"Camera stopped; generated calibration source restored."});}else{state.camera.on=true;state.camera.deviceId=document.getElementById("cam-select").value||"";state.camera.preset=document.getElementById("capturePreset").value;document.getElementById("cam-btn").textContent="Requesting…";send({type:"cam",action:"start",deviceId:state.camera.deviceId,preset:state.camera.preset});}}
function wire(){
  SLIDERS.forEach(id=>document.getElementById(id).addEventListener("input",event=>{state.params[id]=Number(event.target.value);document.getElementById(`${id}-val`).textContent=fmt(id,state.params[id]);scheduleFlush(id,state.params[id]);}));
  document.getElementById("palette").addEventListener("change",event=>{state.params.palette=Number(event.target.value);scheduleFlush("palette",state.params.palette);});
  document.getElementById("bufferScale").addEventListener("change",event=>{state.params.bufferScale=Number(event.target.value);scheduleFlush("bufferScale",state.params.bufferScale);send({type:"action",name:"clear_history"});});
  document.querySelectorAll(".mode-btn").forEach(button=>button.addEventListener("click",()=>{setMode(button.dataset.mode);scheduleFlush("mode",state.params.mode);send({type:"action",name:"clear_history"});}));
  document.querySelectorAll("[data-preset]").forEach(button=>button.addEventListener("click",()=>applyPreset(button.dataset.preset)));
  document.getElementById("cam-btn").addEventListener("click",toggleCamera);document.getElementById("cam-refresh").addEventListener("click",()=>send({type:"cam",action:"enumerate"}));
  document.getElementById("cam-select").addEventListener("change",event=>{state.camera.deviceId=event.target.value||"";if(state.camera.on)send({type:"cam",action:"start",deviceId:state.camera.deviceId,preset:state.camera.preset});});
  document.getElementById("capturePreset").addEventListener("change",event=>{state.camera.preset=event.target.value;if(state.camera.on)send({type:"cam",action:"start",deviceId:state.camera.deviceId,preset:state.camera.preset});});
  document.getElementById("pauseBtn").addEventListener("click",()=>{state.paused=!state.paused;updateControls();send({type:"action",name:"set_paused",value:state.paused});});
  document.getElementById("clearBtn").addEventListener("click",()=>send({type:"action",name:"clear_history"}));document.getElementById("resetBtn").addEventListener("click",resetExample);document.getElementById("syncBtn").addEventListener("click",()=>{sendSnapshot();send({type:"cam",action:"enumerate"});});
  document.getElementById("showOutputBtn").addEventListener("click",()=>invoke("show_canvas").catch(console.error));document.getElementById("focusOutputBtn").addEventListener("click",()=>invoke("focus_canvas").catch(console.error));
  document.getElementById("fullscreenOutputBtn").addEventListener("click",async()=>{try{outputFullscreen=await invoke("toggle_canvas_fullscreen");document.getElementById("fullscreenOutputBtn").textContent=outputFullscreen?"Exit fullscreen":"Output fullscreen";}catch(error){console.error(error);}});
  window.addEventListener("keydown",event=>{if(["INPUT","SELECT","TEXTAREA"].includes(document.activeElement?.tagName))return;if(event.code==="Space"){event.preventDefault();document.getElementById("pauseBtn").click();}if(event.key.toLowerCase()==="r")resetExample();if(event.key.toLowerCase()==="x")document.getElementById("clearBtn").click();if(event.key.toLowerCase()==="s")document.getElementById("syncBtn").click();if(event.key.toLowerCase()==="f")document.getElementById("fullscreenOutputBtn").click();});
}
document.addEventListener("DOMContentLoaded",()=>{wire();updateControls();setDot("cameraDot","warning");setDot("shaderDot","warning");connect();},{once:true});
