(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const ui = Object.fromEntries([
    "compile","auto-compile","format","reset","shader-title","cursor-pos","line-numbers","shader-editor","compile-state","diagnostics","terminal-summary","clear-terminal","file-state","native-open","file-input","drop-zone","save-source","copy-source","fullscreen","preset","load-preset","runtime-state","speed","speed-out","scale","scale-out","pause","mouse-on","reset-time","p0","p0-out","p1","p1-out","p2","p2-out","p3","p3-out","color-a","color-a-out","color-b","color-b-out","capture-state","snapshot","fps","size","program","stage","canvas","drop-overlay","hud-name","hud-mouse","unsupported"
  ].map((id) => [id.replace(/-([a-z])/g, (_, c) => c.toUpperCase()), $(id)]));
  const tauriCore = window.__TAURI__?.core ?? null;
  const invoke = tauriCore?.invoke?.bind(tauriCore) ?? null;
  const tauriDialog = window.__TAURI__?.dialog ?? null;
  const tauriWebview = window.__TAURI__?.webview ?? null;

  const vertexSource = `attribute vec2 a_position; varying vec2 v_uv; void main(){v_uv=a_position*0.5+0.5;gl_Position=vec4(a_position,0.0,1.0);}`;
  const header = `precision highp float;
varying vec2 v_uv;
uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;
uniform vec3 u_color_a;
uniform vec3 u_color_b;
uniform float u_param0;
uniform float u_param1;
uniform float u_param2;
uniform float u_param3;`;

  const presets = {
    domain: { name: "Domain warp", values:[.58,.42,.68,.24], colors:["#19d3ff","#ff4f9a"], source:`${header}
float hash21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);} 
float noise2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);float a=hash21(i),b=hash21(i+vec2(1,0)),c=hash21(i+vec2(0,1)),d=hash21(i+vec2(1,1));return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);} 
float fbm(vec2 p){float v=0.0,a=.5;for(int i=0;i<6;i++){v+=a*noise2(p);p=mat2(1.6,1.2,-1.2,1.6)*p;a*=.5;}return v;}
void main(){vec2 uv=(gl_FragCoord.xy*2.0-u_resolution.xy)/max(u_resolution.y,1.0);vec2 p=uv*mix(1.4,4.8,u_param0)+(u_mouse-.5)*.8;float t=u_time*mix(.08,.8,u_param1);vec2 q=vec2(fbm(p+vec2(t,0)),fbm(p+vec2(3.1,-t)));vec2 r=vec2(fbm(p+u_param2*1.6*q+vec2(1.7,9.2)),fbm(p+u_param2*1.6*q+vec2(8.3,2.8)));float f=fbm(p+u_param2*1.6*r);float ridge=1.0-abs(2.0*f-1.0);vec3 c=mix(u_color_a,u_color_b,smoothstep(.12,.92,f));c+=.36*ridge*vec3(.35,.62,1.0);c+=(hash21(gl_FragCoord.xy+u_time)-.5)*u_param3*.16;gl_FragColor=vec4(c,1);}` },
    rings: { name:"Orbital rings", values:[.54,.38,.66,.32], colors:["#76f7d4","#ff6b55"], source:`${header}
#define PI 3.141592653589793
mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);} 
void main(){vec2 uv=(gl_FragCoord.xy*2.0-u_resolution.xy)/max(u_resolution.y,1.0);uv-=(u_mouse-.5)*.35;uv=rot(u_time*mix(.03,.3,u_param1))*uv;float r=length(uv),a=atan(uv.y,uv.x);float count=mix(5.0,36.0,u_param0);float wob=sin(a*mix(2.0,12.0,u_param2)+u_time*1.4)*mix(.01,.16,u_param3);float ring=.5+.5*cos((r+wob)*count*PI-u_time*2.0);float glow=.025/max(abs(fract((r+wob)*count*.5)-.5),.015);vec3 c=mix(u_color_a,u_color_b,smoothstep(.32,.96,ring));c+=glow*.025*mix(u_color_b,vec3(1),.45);c*=smoothstep(1.35,.05,r);gl_FragColor=vec4(c,1);}` },
    cells: { name:"Cellular field", values:[.48,.36,.52,.28], colors:["#8eff7a","#794cff"], source:`${header}
float h(vec2 p){p=fract(p*vec2(443.8975,397.2973));p+=dot(p,p.yx+19.19);return fract(p.x*p.y);}vec2 h2(vec2 p){float n=h(p);return vec2(n,h(p+n+17.17));}
void main(){vec2 uv=gl_FragCoord.xy/max(u_resolution.xy,vec2(1));uv.x*=u_resolution.x/max(u_resolution.y,1.0);vec2 p=uv*mix(5.0,28.0,u_param0),cell=floor(p),local=fract(p);float n=8.0,s=8.0,t=u_time*mix(.05,.8,u_param1);for(int y=-1;y<=1;y++){for(int x=-1;x<=1;x++){vec2 o=vec2(float(x),float(y));vec2 q=.5+.46*sin(t+6.2831*h2(cell+o));float d=length(o+q-local);if(d<n){s=n;n=d;}else if(d<s){s=d;}}}float edge=1.0-smoothstep(.015,mix(.04,.22,u_param2),s-n);vec3 c=mix(u_color_a,u_color_b,h(cell))*(.18+.9*smoothstep(.9,.06,n));c=mix(c,vec3(.98),edge*mix(.2,1.0,u_param3));gl_FragColor=vec4(c,1);}` },
    plasma: { name:"Spectral plasma", values:[.62,.54,.46,.30], colors:["#ffe55f","#00a8ff"], source:`${header}
void main(){vec2 uv=(gl_FragCoord.xy*2.0-u_resolution.xy)/max(u_resolution.y,1.0);vec2 m=(u_mouse-.5)*2.0;float sc=mix(1.0,7.0,u_param0),t=u_time*mix(.1,2.0,u_param1);float a=sin((uv.x+m.x*.2)*sc+t),b=sin((uv.y-m.y*.2)*sc*1.27-t*1.31),c=sin(length(uv+vec2(sin(t*.33),cos(t*.29)))*sc*2.0-t*1.7),d=sin((uv.x+uv.y)*sc*.72+t*.61);float v=.5+.5*(a+b+c+d)*.25;vec3 col=mix(u_color_a,u_color_b,smoothstep(.08,.92,v));vec3 rainbow=.5+.5*cos(6.2831*(v+vec3(0,.33,.67)));col=mix(col,rainbow,u_param2);col+=pow(max(v,0.0),5.0)*u_param3;gl_FragColor=vec4(col,1);}` },
    minimal: { name:"Minimal gradient", values:[.5,.5,.5,.5], colors:["#20c9ff","#ff4385"], source:`${header}
void main(){vec2 uv=v_uv;float wave=.5+.5*sin((uv.x+uv.y)*8.0+u_time);float m=mix(uv.x,wave,u_param0);vec3 c=mix(u_color_a,u_color_b,m);c*=.65+.35*uv.y;gl_FragColor=vec4(c,1.0);}` }
  };

  const state={gl:null,buffer:null,program:null,attr:-1,uniforms:{},preset:"domain",time:0,last:performance.now(),frames:0,fpsAt:performance.now(),mouse:[.5,.5],compileTimer:0,compileCount:0,resize:true,terminalCount:0,nativeDropInstalled:false};
  const status=(text,kind="")=>{ui.compileState.textContent=text;ui.compileState.className=`pill ${kind}`.trim();};
  const clock=()=>new Date().toLocaleTimeString([], {hour12:false,hour:"2-digit",minute:"2-digit",second:"2-digit"});
  function clearTerminal(message="Terminal cleared. Compile or paste a shader to inspect it."){
    ui.diagnostics.replaceChildren();
    state.terminalCount=0;
    ui.terminalSummary.textContent="WebGL 1 · idle";
    if(message)terminal("info",message);
  }
  function terminal(level,message,line=null){
    const row=document.createElement("div");
    row.className=`terminal-line ${level}`;
    if(Number.isFinite(line)&&line>0){row.dataset.line=String(line);row.title=`Select source line ${line}`;row.addEventListener("click",()=>selectLine(line));}
    const time=document.createElement("span"),tag=document.createElement("span"),body=document.createElement("span");
    time.className="terminal-time";tag.className="terminal-level";body.className="terminal-message";
    time.textContent=clock();tag.textContent=level;body.textContent=message;
    row.append(time,tag,body);ui.diagnostics.appendChild(row);ui.diagnostics.scrollTop=ui.diagnostics.scrollHeight;
    state.terminalCount++;ui.terminalSummary.textContent=`WebGL 1 · ${state.terminalCount} message${state.terminalCount===1?"":"s"}`;
  }
  function parseLog(raw){
    return String(raw||"").split(/\r?\n/).filter(Boolean).map(text=>{
      let match=text.match(/(?:ERROR|WARNING):\s*\d+:(\d+):\s*(.*)/i);
      if(!match)match=text.match(/^\s*\d+:(\d+)\((?:\d+)\):\s*(?:error|warning):?\s*(.*)/i);
      return match?{line:+match[1],message:match[2]||text}:{line:null,message:text};
    });
  }
  function inspectSource(source){
    const notes=[];
    const add=(level,message,line=null)=>notes.push({level,message,line});
    const lines=source.split(/\r?\n/);
    const lineOf=(pattern)=>{const i=lines.findIndex(line=>pattern.test(line));return i<0?null:i+1;};
    if(/^\s*#version\s+300\s+es/m.test(source))add("error","GLSL ES 3.00 / WebGL 2 shader detected. This playground currently compiles WebGL 1 / GLSL ES 1.00. Remove '#version 300 es', replace fragment output variables with gl_FragColor, and replace texture() with texture2D().",lineOf(/^\s*#version\s+300\s+es/));
    if(/\blayout\s*\(/.test(source))add("error","layout(...) qualifiers require WebGL 2 and are not available in this WebGL 1 playground.",lineOf(/\blayout\s*\(/));
    if(/^\s*out\s+vec4\s+\w+/m.test(source))add("warning","A WebGL 2 fragment output was found. WebGL 1 writes the final color with gl_FragColor.",lineOf(/^\s*out\s+vec4\s+\w+/));
    if(/\btexture\s*\(/.test(source)&&!/\btexture2D\s*\(/.test(source))add("warning","texture(...) is normally WebGL 2 syntax. For sampler2D in WebGL 1 use texture2D(...).",lineOf(/\btexture\s*\(/));
    if(/\bmainImage\s*\(/.test(source)&&!/\bvoid\s+main\s*\(/.test(source))add("warning","ShaderToy mainImage(...) detected, but WebGL requires void main(). Add a wrapper that calls mainImage(color, gl_FragCoord.xy), then assign gl_FragColor.",lineOf(/\bmainImage\s*\(/));
    if(/\biTime\b/.test(source))add("warning","ShaderToy uniform iTime is not supplied. Rename it to u_time or declare a mapping such as '#define iTime u_time'.",lineOf(/\biTime\b/));
    if(/\biResolution\b/.test(source))add("warning","ShaderToy iResolution is not supplied. This playground provides vec2 u_resolution.",lineOf(/\biResolution\b/));
    if(/\biMouse\b/.test(source))add("warning","ShaderToy iMouse is not supplied. This playground provides normalized vec2 u_mouse.",lineOf(/\biMouse\b/));
    if(/^\s*#include\b/m.test(source))add("warning","#include is not expanded by WebGL. Paste the included GLSL functions into this source before compiling.",lineOf(/^\s*#include\b/));
    if(!/\bvoid\s+main\s*\(/.test(source))add("error","No 'void main()' entry point was found. A fragment shader must define main().");
    if(!/\bprecision\s+(?:lowp|mediump|highp)\s+float\s*;/.test(source))add("warning","No default float precision declaration was found. Fragment shaders commonly need 'precision highp float;' near the top.");
    return notes;
  }
  function compileShader(type,source,label){const gl=state.gl,s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){const log=gl.getShaderInfoLog(s)||`Unknown ${label} shader error`;gl.deleteShader(s);const error=new Error(log);error.stage=label;throw error;}return s;}
  function compileCurrent(quiet=false){
    clearTimeout(state.compileTimer);status("Compiling","busy");const gl=state.gl,source=ui.shaderEditor.value;
    terminal("info",`Compile requested · ${source.split(/\r?\n/).length} lines · ${new Blob([source]).size} bytes`);
    const notes=inspectSource(source);notes.forEach(note=>terminal(note.level,note.message,note.line));
    try{
      const vs=compileShader(gl.VERTEX_SHADER,vertexSource,"vertex");terminal("success","Vertex shader compiled.");
      const fs=compileShader(gl.FRAGMENT_SHADER,source,"fragment");terminal("success","Fragment shader compiled.");
      const p=gl.createProgram();gl.attachShader(p,vs);gl.attachShader(p,fs);gl.bindAttribLocation(p,0,"a_position");gl.linkProgram(p);gl.deleteShader(vs);gl.deleteShader(fs);
      if(!gl.getProgramParameter(p,gl.LINK_STATUS)){const log=gl.getProgramInfoLog(p)||"Unknown program link error";gl.deleteProgram(p);const error=new Error(log);error.stage="link";throw error;}
      const old=state.program;state.program=p;state.attr=gl.getAttribLocation(p,"a_position");state.uniforms={time:gl.getUniformLocation(p,"u_time"),resolution:gl.getUniformLocation(p,"u_resolution"),mouse:gl.getUniformLocation(p,"u_mouse"),a:gl.getUniformLocation(p,"u_color_a"),b:gl.getUniformLocation(p,"u_color_b"),p0:gl.getUniformLocation(p,"u_param0"),p1:gl.getUniformLocation(p,"u_param1"),p2:gl.getUniformLocation(p,"u_param2"),p3:gl.getUniformLocation(p,"u_param3")};if(old)gl.deleteProgram(old);
      state.compileCount++;status("Compiled");terminal("success",`Program ${state.compileCount} linked and is now rendering${notes.length?` (${notes.length} compatibility notice${notes.length===1?"":"s"})`:""}.`);ui.program.textContent=`Program ${state.compileCount}`;return true;
    }catch(error){
      const raw=error.message||String(error),entries=parseLog(raw),stage=error.stage||"shader";
      if(entries.length)entries.forEach(entry=>terminal("error",`${stage}: ${entry.message}`,entry.line));else terminal("error",`${stage}: ${raw}`);
      terminal("info",state.program?`Program ${state.compileCount} remains active; the failed shader did not replace it.`:"No valid shader program is available yet.");
      status("Error","error");ui.program.textContent=state.program?`Program ${state.compileCount} retained`:"No valid program";
      const first=entries.find(entry=>entry.line);if(!quiet&&first)selectLine(first.line);return false;
    }
  }
  function schedule(){clearTimeout(state.compileTimer);if(!ui.autoCompile.checked){status("Modified","busy");return;}status("Waiting","busy");state.compileTimer=setTimeout(()=>compileCurrent(true),650);}
  function lineNumbers(){const n=Math.max(1,ui.shaderEditor.value.split("\n").length);ui.lineNumbers.textContent=Array.from({length:n},(_,i)=>i+1).join("\n");ui.lineNumbers.scrollTop=ui.shaderEditor.scrollTop;}
  function cursor(){const before=ui.shaderEditor.value.slice(0,ui.shaderEditor.selectionStart).split("\n");ui.cursorPos.textContent=`Ln ${before.length} · Col ${before[before.length-1].length+1}`;}
  function selectLine(n){const lines=ui.shaderEditor.value.split("\n");n=Math.min(Math.max(n,1),lines.length);let start=0;for(let i=1;i<n;i++)start+=lines[i-1].length+1;ui.shaderEditor.focus();ui.shaderEditor.setSelectionRange(start,start+lines[n-1].length);ui.shaderEditor.scrollTop=Math.max(0,(n-4)*19);lineNumbers();cursor();}
  function formatSource(){let depth=0;ui.shaderEditor.value=ui.shaderEditor.value.split(/\r?\n/).map(raw=>{const t=raw.trim();if(!t)return"";if(t.startsWith("}"))depth=Math.max(0,depth-1);const out=`${"  ".repeat(depth)}${t}`;const opens=(t.match(/\{/g)||[]).length,closes=(t.match(/\}/g)||[]).length;depth=Math.max(0,depth+opens-closes+(t.startsWith("}")?1:0));return out;}).join("\n");lineNumbers();schedule();}
  function output(){ui.speedOut.textContent=`${(+ui.speed.value).toFixed(2)}×`;ui.scaleOut.textContent=`${(+ui.scale.value).toFixed(2)}×`;for(let i=0;i<4;i++)ui[`p${i}Out`].textContent=(+ui[`p${i}`].value).toFixed(3);ui.colorAOut.textContent=ui.colorA.value.toUpperCase();ui.colorBOut.textContent=ui.colorB.value.toUpperCase();ui.runtimeState.textContent=ui.pause.checked?"Paused":"Playing";}
  function loadPreset(key,compile=true){const p=presets[key]||presets.domain;state.preset=key in presets?key:"domain";ui.preset.value=state.preset;ui.shaderEditor.value=p.source;ui.shaderTitle.textContent=p.name;ui.hudName.textContent=p.name;ui.fileState.textContent="Preset";[ui.p0,ui.p1,ui.p2,ui.p3].forEach((el,i)=>el.value=p.values[i]);ui.colorA.value=p.colors[0];ui.colorB.value=p.colors[1];lineNumbers();cursor();output();if(compile)compileCurrent(true);}
  function rgb(hex){const h=hex.slice(1);return[parseInt(h.slice(0,2),16)/255,parseInt(h.slice(2,4),16)/255,parseInt(h.slice(4,6),16)/255];}
  function resize(){const gl=state.gl,r=ui.stage.getBoundingClientRect(),ratio=Math.min(devicePixelRatio||1,2)*(+ui.scale.value);let w=Math.max(2,Math.round(r.width*ratio)),h=Math.max(2,Math.round(r.height*ratio));const max=gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)||4096;if(Math.max(w,h)>max){const k=max/Math.max(w,h);w=Math.floor(w*k);h=Math.floor(h*k);}if(ui.canvas.width!==w||ui.canvas.height!==h){ui.canvas.width=w;ui.canvas.height=h;gl.viewport(0,0,w,h);ui.size.textContent=`${w} × ${h}`;}}
  function uniform1(loc,v){if(loc!==null)state.gl.uniform1f(loc,v)}function uniform2(loc,a,b){if(loc!==null)state.gl.uniform2f(loc,a,b)}function uniform3(loc,v){if(loc!==null)state.gl.uniform3fv(loc,v)}
  function frame(now){requestAnimationFrame(frame);const gl=state.gl,dt=Math.min(.1,(now-state.last)/1000);state.last=now;if(!ui.pause.checked)state.time+=dt*(+ui.speed.value);resize();gl.clearColor(.01,.015,.025,1);gl.clear(gl.COLOR_BUFFER_BIT);if(state.program){gl.useProgram(state.program);gl.bindBuffer(gl.ARRAY_BUFFER,state.buffer);gl.enableVertexAttribArray(state.attr);gl.vertexAttribPointer(state.attr,2,gl.FLOAT,false,0,0);const u=state.uniforms;uniform1(u.time,state.time);uniform2(u.resolution,ui.canvas.width,ui.canvas.height);uniform2(u.mouse,...state.mouse);uniform3(u.a,rgb(ui.colorA.value));uniform3(u.b,rgb(ui.colorB.value));for(let i=0;i<4;i++)uniform1(u[`p${i}`],+ui[`p${i}`].value);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);}state.frames++;if(now-state.fpsAt>500){ui.fps.textContent=`${Math.round(state.frames*1000/(now-state.fpsAt))} fps`;state.frames=0;state.fpsAt=now;}}
  function initGl(){const gl=ui.canvas.getContext("webgl",{alpha:false,antialias:false,preserveDrawingBuffer:true,powerPreference:"high-performance"});if(!gl){ui.unsupported.classList.remove("hidden");return false;}state.gl=gl;state.buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,state.buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);return true;}
  function stem(name){return(name||"shader").replace(/\.[^.]+$/,"").replace(/[^a-z0-9-_]+/gi,"-").replace(/^-+|-+$/g,"")||"shader";}
  function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  async function saveSource(){
    const name=`${stem(ui.shaderTitle.textContent)}.frag`,source=ui.shaderEditor.value;
    try{
      if(invoke&&tauriDialog?.save){
        const path=await tauriDialog.save({defaultPath:name,filters:[{name:"GLSL shader",extensions:["frag","glsl","fs","txt"]}]});
        if(!path){ui.fileState.textContent="Cancelled";return;}
        await invoke("write_binary",{path,bytes:Array.from(new TextEncoder().encode(source))});
        ui.fileState.textContent="Saved";terminal("success",`Saved shader source to ${path}`);return;
      }
    }catch(error){console.error(error);terminal("error",`Native shader save failed: ${error.message||error}`);}
    download(new Blob([source],{type:"text/plain"}),name);ui.fileState.textContent="Downloaded";terminal("info",`Downloaded ${name} through the browser fallback.`);
  }
  async function snapshot(){
    ui.snapshot.disabled=true;ui.captureState.textContent="Encoding";
    try{
      const blob=await new Promise((res,rej)=>ui.canvas.toBlob(b=>b?res(b):rej(new Error("PNG encoding failed")),"image/png"));
      const name=`${stem(ui.shaderTitle.textContent)}-${ui.canvas.width}x${ui.canvas.height}.png`;
      if(invoke&&tauriDialog?.save){
        const path=await tauriDialog.save({defaultPath:name,filters:[{name:"PNG",extensions:["png"]}]});
        if(!path){ui.captureState.textContent="Cancelled";return;}
        await invoke("write_binary",{path,bytes:Array.from(new Uint8Array(await blob.arrayBuffer()))});
        ui.captureState.textContent="Saved";terminal("success",`Saved PNG snapshot to ${path}`);
      }else{download(blob,name);ui.captureState.textContent="Downloaded";terminal("info",`Downloaded ${name} through the browser fallback.`);}
    }catch(error){console.error(error);ui.captureState.textContent="Failed";terminal("error",`Snapshot failed: ${error.message||error}`);}
    finally{ui.snapshot.disabled=false;setTimeout(()=>ui.captureState.textContent="Ready",1600);}
  }
  function applySource(source,name,size=0,origin="file"){
    ui.shaderEditor.value=String(source||"").replace(/^\uFEFF/,"");
    ui.shaderTitle.textContent=stem(name);ui.hudName.textContent=name;ui.fileState.textContent=name;
    lineNumbers();cursor();terminal("info",`Loaded ${name}${size?` · ${size} bytes`:""} through ${origin}.`);schedule();
  }
  function loadFile(file){
    if(!file)return;
    const r=new FileReader();
    r.onload=()=>applySource(r.result,file.name,file.size,"browser file API");
    r.onerror=()=>terminal("error",`Could not read ${file.name}.`);
    r.readAsText(file);
  }
  function isShaderPath(path){return /\.(?:frag|glsl|fs|txt)$/i.test(String(path||""));}
  async function loadNativePath(path,origin="native file"){
    if(!invoke)throw new Error("Native shader loading requires Tauri.");
    const result=await invoke("read_shader_file",{path});
    applySource(result.source,result.name,result.sizeBytes,origin);
  }
  async function openNativeShader(){
    if(!invoke||!tauriDialog?.open){ui.fileInput.click();return;}
    ui.fileState.textContent="Opening…";
    try{
      const path=await tauriDialog.open({multiple:false,directory:false,filters:[{name:"GLSL shader",extensions:["frag","glsl","fs","txt"]}]});
      if(!path){ui.fileState.textContent="Cancelled";return;}
      await loadNativePath(path,"native dialog");
    }catch(error){console.error(error);ui.fileState.textContent="Open failed";terminal("error",`Native shader open failed: ${error.message||error}`);}
  }
  function setDragState(active){ui.dropZone.classList.toggle("dragging",active);ui.dropOverlay.classList.toggle("hidden",!active);}
  function drop(event){event.preventDefault();event.stopPropagation();setDragState(false);if(state.nativeDropInstalled)return;const file=Array.from(event.dataTransfer?.files||[]).find(file=>/\.(?:frag|glsl|fs|txt)$/i.test(file.name));if(file)loadFile(file);else terminal("warning","No supported shader source was found in the browser drop.");}
  async function installNativeDropHandler(){
    if(!tauriWebview?.getCurrentWebview)return;
    try{
      const current=tauriWebview.getCurrentWebview();
      await current.onDragDropEvent(event=>{
        const payload=event.payload||{};
        if(payload.type==="over"||payload.type==="enter"){setDragState(true);return;}
        if(payload.type==="drop"){
          setDragState(false);
          const path=Array.from(payload.paths||[]).find(isShaderPath);
          if(!path){terminal("warning","No .frag, .glsl, .fs, or .txt file was found in the native drop.");return;}
          void loadNativePath(path,"native drag/drop").catch(error=>{console.error(error);ui.fileState.textContent="Drop failed";terminal("error",`Dropped shader could not be read: ${error.message||error}`);});
          return;
        }
        setDragState(false);
      });
      state.nativeDropInstalled=true;terminal("info","Native Tauri file-drop listener installed.");
    }catch(error){console.error(error);terminal("warning",`Native file drop is unavailable; browser drop remains active. ${error.message||error}`);}
  }

  function bind(){
    ui.compile.addEventListener("click",()=>compileCurrent());ui.clearTerminal.addEventListener("click",()=>clearTerminal());ui.autoCompile.addEventListener("change",()=>ui.autoCompile.checked?schedule():status("Manual","busy"));ui.format.addEventListener("click",formatSource);ui.reset.addEventListener("click",()=>loadPreset(state.preset));ui.loadPreset.addEventListener("click",()=>loadPreset(ui.preset.value));
    ui.nativeOpen.addEventListener("click",openNativeShader);ui.saveSource.addEventListener("click",saveSource);ui.copySource.addEventListener("click",async()=>{try{await navigator.clipboard.writeText(ui.shaderEditor.value)}catch{ui.shaderEditor.select();document.execCommand("copy")}ui.fileState.textContent="Copied";terminal("info","Shader source copied to the clipboard.");});ui.snapshot.addEventListener("click",snapshot);
    ui.fullscreen.addEventListener("click",async()=>{try{if(invoke){const enabled=await invoke("toggle_fullscreen");ui.fullscreen.textContent=enabled?"Exit fullscreen":"Fullscreen preview";}else if(!document.fullscreenElement){await ui.stage.requestFullscreen();}else{await document.exitFullscreen();}}catch(error){terminal("error",`Fullscreen failed: ${error.message||error}`);}});
    ui.resetTime.addEventListener("click",()=>state.time=0);ui.fileInput.addEventListener("change",()=>{loadFile(ui.fileInput.files?.[0]);ui.fileInput.value=""});ui.shaderEditor.addEventListener("input",()=>{lineNumbers();cursor();ui.fileState.textContent="Modified";schedule();});ui.shaderEditor.addEventListener("paste",event=>{const length=event.clipboardData?.getData("text")?.length||0;setTimeout(()=>terminal("info",`Pasted ${length} characters; ${ui.autoCompile.checked?"automatic compile queued":"press Compile to test"}.`),0);});ui.shaderEditor.addEventListener("scroll",()=>ui.lineNumbers.scrollTop=ui.shaderEditor.scrollTop);["click","keyup"].forEach(ev=>ui.shaderEditor.addEventListener(ev,cursor));ui.shaderEditor.addEventListener("keydown",e=>{if(e.key==="Tab"){e.preventDefault();ui.shaderEditor.setRangeText("  ",ui.shaderEditor.selectionStart,ui.shaderEditor.selectionEnd,"end");lineNumbers();schedule();}else if(e.key==="Enter"&&(e.metaKey||e.ctrlKey)){e.preventDefault();compileCurrent();}});
    [ui.speed,ui.p0,ui.p1,ui.p2,ui.p3,ui.colorA,ui.colorB].forEach(el=>el.addEventListener("input",output));ui.scale.addEventListener("input",output);[ui.pause,ui.mouseOn].forEach(el=>el.addEventListener("change",output));ui.stage.addEventListener("pointermove",e=>{if(!ui.mouseOn.checked)return;const r=ui.stage.getBoundingClientRect();state.mouse=[Math.min(1,Math.max(0,(e.clientX-r.left)/r.width)),Math.min(1,Math.max(0,1-(e.clientY-r.top)/r.height))];ui.hudMouse.textContent=`Mouse ${state.mouse[0].toFixed(2)} · ${state.mouse[1].toFixed(2)}`;});
    [ui.dropZone,ui.stage].forEach(el=>{el.addEventListener("dragover",e=>{e.preventDefault();if(!state.nativeDropInstalled)setDragState(true)});el.addEventListener("dragleave",()=>{if(!state.nativeDropInstalled)setDragState(false)});el.addEventListener("drop",drop)});window.addEventListener("resize",resize);window.addEventListener("error",event=>terminal("runtime",`${event.message}${event.lineno?` · line ${event.lineno}`:""}`));window.addEventListener("unhandledrejection",event=>terminal("runtime",`Unhandled promise rejection: ${event.reason?.message||event.reason||"Unknown error"}`));
  }
  bind();void installNativeDropHandler();output();loadPreset("domain",false);clearTerminal("Shader terminal ready. This Tauri v2 renderer targets WebGL 1 / GLSL ES 1.00.");if(initGl()){terminal("info",`WebGL initialized · ${state.gl.getParameter(state.gl.RENDERER)||"renderer unavailable"}`);compileCurrent(true);requestAnimationFrame(frame);}
})();
