const invoke=window.__TAURI__.core.invoke;const byId=id=>document.getElementById(id);
function status(message,error=false){const n=byId('status');n.textContent=String(message);n.classList.toggle('error',error);}
async function call(command,args={}){try{const r=await invoke(command,args);status('renderer online');return r;}catch(e){console.error(command,e);status(e,true);throw e;}}
function update(i){const v={backend:i.backend,adapterName:i.adapterName,surfaceFormat:i.surfaceFormat,feedbackFormat:i.feedbackFormat,resolution:`${i.width} × ${i.height}`,targetMemory:`${Number(i.targetMegabytes||0).toFixed(1)} MiB`,feedbackMemory:`${Number(i.totalFeedbackMegabytes||0).toFixed(1)} MiB`,fps:Number(i.fps||0).toFixed(1),frameTime:`${Number(i.frameTimeMs||0).toFixed(2)} ms`,frames:Number(i.frameCount||0).toLocaleString(),lastError:i.lastError||'none'};for(const [id,value] of Object.entries(v)){const n=byId(id);if(n)n.textContent=value;}}
async function poll(){try{update(await call('get_renderer_info'));}catch{}}poll();setInterval(poll,750);
const defaults={decay:.965,zoom:1.006,rotation:.003,shift_x:0,shift_y:0,injection:.34,gain:.75,saturation:1,source_scale:2};
document.querySelectorAll('[data-param]').forEach(input=>{const out=input.nextElementSibling;input.addEventListener('input',()=>{out.value=Number(input.value).toFixed(input.step==='0.0001'?4:3);call('set_param',{name:input.dataset.param,value:Number(input.value)});});});
byId('clear').addEventListener('click',()=>call('clear_feedback'));
byId('reset').addEventListener('click',async()=>{await call('reset_params');for(const [name,value] of Object.entries(defaults)){const input=byId(name);input.value=value;input.dispatchEvent(new Event('input'));}});
byId('fullscreen').addEventListener('click',()=>call('toggle_renderer_fullscreen'));
