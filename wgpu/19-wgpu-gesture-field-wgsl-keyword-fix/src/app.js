const invoke = window.__TAURI__.core.invoke;
const el = id => document.getElementById(id);
const eventRate = el('eventRate'), historyPoints = el('historyPoints'), fps = el('fps'), backend = el('backend');
const adapter = el('adapter'), driver = el('driver'), surface = el('surface'), renderSize = el('renderSize'), frameTime = el('frameTime');
const receivedEvents = el('receivedEvents'), recordedPoints = el('recordedPoints'), lastError = el('lastError'), recordStatus = el('recordStatus');
const pad = document.querySelector('#pad');
const ctx = pad.getContext('2d');
let tool = 0;
let pointerDown = false;
let last = null;
let pending = null;
let rafQueued = false;
let visualPoints = [];

function normalized(event) {
  const rect = pad.getBoundingClientRect();
  return { x:(event.clientX-rect.left)/rect.width, y:(event.clientY-rect.top)/rect.height };
}

function queuePoint(event, active) {
  const p = normalized(event);
  const now = performance.now();
  const dt = last ? Math.max(1, now-last.time) : 16;
  const vx = last ? (p.x-last.x)*1000/dt : 0;
  const vy = last ? (p.y-last.y)*1000/dt : 0;
  const pressure = event.pointerType === 'mouse' ? (active ? 0.65 : 0.2) : Math.max(0.05,event.pressure || 0.5);
  pending = { x:p.x,y:p.y,velocityX:vx,velocityY:vy,pressure,age:0,tool,active:active?1:0 };
  last = {...p,time:now};
  visualPoints.unshift({...p,pressure,tool}); visualPoints=visualPoints.slice(0,64);
  document.querySelector('#pointerReadout').textContent=`x ${p.x.toFixed(2)} · y ${p.y.toFixed(2)} · velocity ${Math.hypot(vx,vy).toFixed(1)}`;
  document.querySelector('#pressureReadout').textContent=`pressure ${pressure.toFixed(2)}`;
  if (!rafQueued) {
    rafQueued=true;
    requestAnimationFrame(async()=>{ rafQueued=false; if(pending){const point=pending;pending=null; await invoke('push_gesture_point',{point});} });
  }
}

pad.addEventListener('pointerdown', e=>{ pointerDown=true; pad.setPointerCapture(e.pointerId); queuePoint(e,true); });
pad.addEventListener('pointermove', e=>{ if(pointerDown || e.pointerType==='pen') queuePoint(e,true); });
pad.addEventListener('pointerup', e=>{ pointerDown=false; queuePoint(e,false); last=null; });
pad.addEventListener('pointercancel', ()=>{ pointerDown=false; last=null; });
pad.addEventListener('wheel', e=>{ e.preventDefault(); const slider=document.querySelector('#depth'); slider.value=Math.max(0,Math.min(2,Number(slider.value)-e.deltaY*0.001)); slider.dispatchEvent(new Event('input')); },{passive:false});

function drawPad(){
  const w=pad.width,h=pad.height; ctx.fillStyle='#04070c';ctx.fillRect(0,0,w,h);
  ctx.strokeStyle='rgba(70,120,170,.18)';ctx.lineWidth=1;
  for(let x=0;x<=w;x+=w/12){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}
  for(let y=0;y<=h;y+=h/8){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
  visualPoints.forEach((p,i)=>{const a=1-i/visualPoints.length;const r=(8+p.pressure*26)*(1-i/80);ctx.beginPath();ctx.arc(p.x*w,p.y*h,r,0,Math.PI*2);ctx.fillStyle=`hsla(${190+p.tool*55},90%,65%,${a*.5})`;ctx.fill();});
  visualPoints=visualPoints.filter((_,i)=>i<63); requestAnimationFrame(drawPad);
} drawPad();

function wireRange(id,name,digits=2){const input=document.querySelector(`#${id}`),out=document.querySelector(`#${id}Out`); const send=()=>{out.textContent=Number(input.value).toFixed(digits);invoke('set_gesture_parameter',{name,value:Number(input.value)});};input.addEventListener('input',send);send();}
wireRange('brushRadius','brushRadius',3);wireRange('force','force');wireRange('decay','decay',3);wireRange('depth','depth');wireRange('exposure','exposure');
document.querySelector('#mode').addEventListener('change',e=>invoke('set_gesture_parameter',{name:'mode',value:Number(e.target.value)}));
document.querySelector('#tool').addEventListener('change',e=>{tool=Number(e.target.value);});
document.querySelector('#clear').addEventListener('click',()=>{visualPoints=[];invoke('clear_gesture');});
document.querySelector('#fullscreen').addEventListener('click',()=>invoke('toggle_renderer_fullscreen'));
document.querySelector('#record').addEventListener('click',()=>invoke('start_gesture_recording'));
document.querySelector('#stopRecord').addEventListener('click',()=>invoke('stop_gesture_recording'));
document.querySelector('#play').addEventListener('click',()=>invoke('play_gesture_recording'));
document.querySelector('#stopPlay').addEventListener('click',()=>invoke('stop_gesture_playback'));

async function refresh(){
  try { const info=await invoke('get_app_info'); const g=info.gesture,r=info.renderer;
    eventRate.textContent=`${g.eventRate.toFixed(1)} Hz`;historyPoints.textContent=`${g.historyPoints} / 64`;fps.textContent=`${r.fps.toFixed(1)} FPS`;backend.textContent=r.backend;
    adapter.textContent=r.adapter;driver.textContent=r.driver;surface.textContent=r.surfaceFormat;renderSize.textContent=`${r.width} × ${r.height}`;frameTime.textContent=`${r.frameTimeMs.toFixed(2)} ms`;
    receivedEvents.textContent=g.receivedEvents;recordedPoints.textContent=g.recordedPoints;lastError.textContent=r.lastError||g.lastError||'none';
    recordStatus.textContent=`${g.recording?'Recording':g.playing?'Playing loop':'Idle'} · ${g.recordedPoints} recorded points`;
  } catch(error){ lastError.textContent=String(error); }
}
setInterval(refresh,250);refresh();
