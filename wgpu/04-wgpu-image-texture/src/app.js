const invoke = window.__TAURI__.core.invoke;
const byId = (id) => document.getElementById(id);
function setStatus(message, error=false){ const n=byId('status'); n.textContent=String(message); n.classList.toggle('error',error); }
async function call(command,args={}){ try{ const result=await invoke(command,args); setStatus('renderer online'); return result; }catch(error){ console.error(command,error); setStatus(error,true); throw error; } }
function updateInfo(info){
  const values={backend:info.backend,adapterName:info.adapterName,surfaceFormat:info.surfaceFormat,resolution:`${info.width} × ${info.height}`,sourceResolution:`${info.sourceWidth} × ${info.sourceHeight}`,filterState:info.filterMode,fitState:info.fitMode,fps:Number(info.fps||0).toFixed(1),frameTime:`${Number(info.frameTimeMs||0).toFixed(2)} ms`,frames:Number(info.frameCount||0).toLocaleString(),lastError:info.lastError||'none'};
  for(const [id,value] of Object.entries(values)){ const n=byId(id); if(n)n.textContent=value; }
}
async function poll(){ try{updateInfo(await call('get_renderer_info'));}catch{} }
poll(); setInterval(poll,750);
const defaults={zoom:1,rotation:0,exposure:1,gamma:1,saturation:1};
document.querySelectorAll('[data-param]').forEach((input)=>{
  const output=input.nextElementSibling;
  const show=()=> input.dataset.param==='rotation' ? `${Number(input.value).toFixed(2)} rad` : Number(input.value).toFixed(2);
  input.addEventListener('input',()=>{ output.value=show(); call('set_param',{name:input.dataset.param,value:Number(input.value)}); });
});
byId('filter').addEventListener('change',()=>call('set_filter_mode',{mode:byId('filter').value}));
byId('fit').addEventListener('change',()=>call('set_fit_mode',{mode:byId('fit').value}));
byId('reset').addEventListener('click',async()=>{
  await call('reset_params');
  for(const [name,value] of Object.entries(defaults)){const input=byId(name); input.value=value; input.dispatchEvent(new Event('input'));}
  byId('filter').value='linear'; await call('set_filter_mode',{mode:'linear'});
  byId('fit').value='contain'; await call('set_fit_mode',{mode:'contain'});
});
byId('fullscreen').addEventListener('click',()=>call('toggle_renderer_fullscreen'));
