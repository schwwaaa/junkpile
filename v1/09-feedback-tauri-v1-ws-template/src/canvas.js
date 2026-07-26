"use strict";

const MODE_NAMES = ["Echo Trail","Fluid Smear","Reaction-Diffusion","Thermal","Mirror Echo","Glitch Memory"];
const DEFAULT_PARAMS = { mode:0, decay:0.97, camMix:0.30, speed:1, scale:1, intensity:1, hue:0, palette:0, brush:0.03, bufferScale:0.5 };
const params = { ...DEFAULT_PARAMS };

const VERT = `
    precision highp float;
    attribute vec2 a_pos;
    varying   vec2 v_uv;
    void main() { v_uv = a_pos*0.5+0.5; gl_Position = vec4(a_pos,0.0,1.0); }
`;

const SIM = `
    precision highp float;

    uniform sampler2D u_prev;    // previous FBO frame — core ping-pong input
    uniform sampler2D u_webcam;  // live camera frame uploaded each tick

    uniform float u_time;
    uniform vec2  u_res;
    uniform int   u_mode;
    uniform float u_decay, u_camMix, u_speed, u_scale, u_intensity;
    uniform vec2  u_mouse;
    uniform float u_mouseDown, u_brushSize, u_clearFlag;
    varying vec2 v_uv;

    float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
    float hash(float n) { return fract(sin(n)*43758.5453); }
    float noise(vec2 p) {
        vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
    }
    vec2 curl(vec2 p, float t) {
        float e=0.01;
        return vec2((noise(p+vec2(0,e)+t*.1)-noise(p-vec2(0,e)+t*.1))/(2.*e),
                   -(noise(p+vec2(e,0)+t*.13)-noise(p-vec2(e,0)+t*.13))/(2.*e));
    }
    float luma(vec3 c) { return dot(c,vec3(0.299,0.587,0.114)); }

    float edges(vec2 uv) {
        vec2 px=1.0/u_res;
        float gx= -luma(texture2D(u_webcam,uv+vec2(-px.x,-px.y)).rgb)
                  +luma(texture2D(u_webcam,uv+vec2( px.x,-px.y)).rgb)
               -2.*luma(texture2D(u_webcam,uv+vec2(-px.x,0)).rgb)
               +2.*luma(texture2D(u_webcam,uv+vec2( px.x,0)).rgb)
                  -luma(texture2D(u_webcam,uv+vec2(-px.x,px.y)).rgb)
                  +luma(texture2D(u_webcam,uv+vec2( px.x,px.y)).rgb);
        float gy= -luma(texture2D(u_webcam,uv+vec2(-px.x,-px.y)).rgb)
               -2.*luma(texture2D(u_webcam,uv+vec2(0,-px.y)).rgb)
                  -luma(texture2D(u_webcam,uv+vec2( px.x,-px.y)).rgb)
                  +luma(texture2D(u_webcam,uv+vec2(-px.x,px.y)).rgb)
               +2.*luma(texture2D(u_webcam,uv+vec2(0, px.y)).rgb)
                  +luma(texture2D(u_webcam,uv+vec2( px.x,px.y)).rgb);
        return clamp(sqrt(gx*gx+gy*gy)*3.0,0.0,1.0);
    }

    // Mode 0: Echo Trail — prev fades, webcam bleeds in each frame
    vec4 modeEcho(vec2 uv) {
        vec3 prev = texture2D(u_prev, uv).rgb * u_decay;
        vec3 cam  = texture2D(u_webcam, vec2(1.0-uv.x, uv.y)).rgb;
        return vec4(prev + cam * u_camMix * u_intensity, 1.0);
    }

    // Mode 1: Fluid Smear — prev advected through curl field, webcam edges modulate flow
    vec4 modeFluid(vec2 uv) {
        float t    = u_time*u_speed*0.3;
        float edge = edges(uv);
        vec2  flow = curl(uv*u_scale*3.0,t)*(0.003+edge*0.006)*u_speed;
        vec3  prev = texture2D(u_prev,uv+flow).rgb*u_decay;
        vec3  cam  = texture2D(u_webcam,vec2(1.0-uv.x,uv.y)).rgb;
        prev += cam*u_camMix*u_intensity;
        prev  = mix(prev,prev.gbr*0.5+prev*0.5,0.008*u_intensity);
        return vec4(prev,1.0);
    }

    // Mode 2: Gray-Scott reaction-diffusion — webcam luma injects V activator
    vec4 modeReactDiff(vec2 uv) {
        vec2 px=1.0/u_res;
        vec4 cur=texture2D(u_prev,uv); float U=cur.r,V=cur.g;
        float lapU=-U,lapV=-V;
        lapU+=0.2*texture2D(u_prev,uv+vec2( px.x,0)).r;
        lapU+=0.2*texture2D(u_prev,uv+vec2(-px.x,0)).r;
        lapU+=0.2*texture2D(u_prev,uv+vec2(0, px.y)).r;
        lapU+=0.2*texture2D(u_prev,uv+vec2(0,-px.y)).r;
        lapV+=0.2*texture2D(u_prev,uv+vec2( px.x,0)).g;
        lapV+=0.2*texture2D(u_prev,uv+vec2(-px.x,0)).g;
        lapV+=0.2*texture2D(u_prev,uv+vec2(0, px.y)).g;
        lapV+=0.2*texture2D(u_prev,uv+vec2(0,-px.y)).g;
        float f=0.0545,k=0.062,Du=0.21,Dv=0.105,dt=u_speed;
        float uvv=U*V*V;
        float newU=clamp(U+dt*(Du*lapU-uvv+f*(1.0-U)),0.0,1.0);
        float newV=clamp(V+dt*(Dv*lapV+uvv-(f+k)*V),0.0,1.0);
        float camLum=luma(texture2D(u_webcam,vec2(1.0-uv.x,uv.y)).rgb);
        newV=max(newV,camLum*u_camMix*0.7);
        newU=max(0.0,newU-camLum*u_camMix*0.3);
        return vec4(newU,newV,cur.b,1.0);
    }

    // Mode 3: Thermal — webcam brightness is a continuous heat source
    vec4 modeThermal(vec2 uv) {
        vec2 px=1.0/u_res; vec3 cur=texture2D(u_prev,uv).rgb;
        vec3 diff=vec3(0.0); float wt=0.0;
        for(int dy=-1;dy<=1;dy++) for(int dx=-1;dx<=1;dx++) {
            float w=(dx==0&&dy==0)?4.0:1.0;
            diff+=w*texture2D(u_prev,uv+vec2(float(dx),float(dy))*px).rgb; wt+=w;
        }
        diff/=wt;
        vec3 state=mix(cur,diff,0.15*u_speed)*u_decay;
        float heat=luma(texture2D(u_webcam,vec2(1.0-uv.x,uv.y)).rgb);
        state+=heat*u_camMix*u_intensity*vec3(0.9,0.5,0.2);
        state+=state*luma(state)*0.04*u_intensity;
        return vec4(state,1.0);
    }

    // Mode 4: Mirror Echo — webcam through 6-fold fold, feedback builds mandala
    vec4 modeMirror(vec2 uv) {
        vec2  c=uv-0.5; float r=length(c);
        float th=atan(c.y,c.x)+u_time*u_speed*0.004;
        float sec=3.14159*2.0/6.0; th=mod(th,sec); if(th>sec*0.5) th=sec-th;
        vec2  camUV=vec2(cos(th),sin(th))*r+0.5;
        vec2  prevUV=vec2(cos(th),sin(th))*r*(1.0-0.002*u_speed)+0.5;
        vec3  cam=texture2D(u_webcam,camUV).rgb;
        vec3  prev=texture2D(u_prev,prevUV).rgb*u_decay;
        return vec4(prev+cam*u_camMix*u_intensity,1.0);
    }

    // Mode 5: Glitch Memory — block-shifted prev + webcam, VHS ghost accumulation
    vec4 modeGlitch(vec2 uv) {
        float t=floor(u_time*u_speed*4.0);
        float bw=1.0/12.0,bh=1.0/8.0;
        vec2  block=floor(uv/vec2(bw,bh));
        float rnd=hash(block+t*0.17),rnd2=hash(block*3.7+t*0.31);
        float isG=step(0.75,rnd);
        float dx=(rnd-0.5)*0.08*isG*u_intensity;
        float dy=(rnd2-0.5)*0.04*isG*u_intensity;
        vec3  prev=vec3(texture2D(u_prev,uv+vec2(dx*1.1,dy)).r,
                        texture2D(u_prev,uv+vec2(dx,    dy)).g,
                        texture2D(u_prev,uv+vec2(dx*0.9,dy)).b)*u_decay;
        vec3  cam=texture2D(u_webcam,vec2(1.0-uv.x+dx*0.5,uv.y)).rgb;
        return vec4(prev+cam*u_camMix*u_intensity,1.0);
    }

    void main() {
        if (u_clearFlag>0.5) { gl_FragColor=(u_mode==2)?vec4(1,0,0,1):vec4(0,0,0,1); return; }
        vec2 uv=v_uv; vec4 state;
        if      (u_mode==0) state=modeEcho(uv);
        else if (u_mode==1) state=modeFluid(uv);
        else if (u_mode==2) state=modeReactDiff(uv);
        else if (u_mode==3) state=modeThermal(uv);
        else if (u_mode==4) state=modeMirror(uv);
        else                state=modeGlitch(uv);

        if (u_mouseDown>0.5) {
            float d=length(uv-u_mouse)/u_brushSize; float g=exp(-d*d*3.0);
            if (u_mode==2) { state.g=max(state.g,g*0.9); state.r=max(0.0,state.r-g*0.5); }
            else { float hc=u_time*0.4; vec3 col=vec3(0.5+0.5*sin(hc),0.5+0.5*sin(hc+2.094),0.5+0.5*sin(hc+4.189)); state.rgb+=col*g*u_intensity; }
        }
        gl_FragColor=clamp(state,0.0,2.0);
    }
`;

const DISPLAY = `
    precision highp float;
    uniform sampler2D u_fbo; uniform int u_mode; uniform float u_hue; uniform int u_palette; uniform float u_time;
    varying vec2 v_uv;
    vec3 pal(float t,vec3 a,vec3 b,vec3 c,vec3 d){return a+b*cos(6.28318*(c*t+d));}
    vec3 applyPalette(float t,int p){
        t=fract(t+0.0001);
        if(p==0)return pal(t,vec3(0.8,0.3,0.1),vec3(0.6,0.4,0.1),vec3(1.0,0.8,0.5),vec3(0.0,0.2,0.4));
        if(p==1)return pal(t,vec3(0.2,0.4,0.8),vec3(0.3,0.3,0.5),vec3(1.0,1.0,1.0),vec3(0.0,0.3,0.6));
        if(p==2)return pal(t,vec3(0.1,0.8,0.2),vec3(0.4,0.6,0.1),vec3(0.8,1.0,0.5),vec3(0.3,0.0,0.5));
        if(p==3)return pal(t,vec3(0.1,0.0,0.3),vec3(0.5,0.2,0.6),vec3(1.0,0.5,1.0),vec3(0.0,0.5,0.2));
                return pal(t,vec3(0.5,0.5,0.5),vec3(0.5,0.5,0.5),vec3(1.0,1.0,1.0),vec3(0.0,0.33,0.67));
    }
    void main(){
        vec4 s=texture2D(u_fbo,v_uv); vec3 col;
        if(u_mode==2){float t=s.g-s.r*0.5;col=applyPalette(t+u_hue,u_palette)*(0.3+s.g*2.0);}
        else{
            float lum=dot(s.rgb,vec3(0.299,0.587,0.114));
            col=applyPalette(lum+u_hue+u_time*0.004,u_palette);
            if(u_mode==0||u_mode==1||u_mode==5) col=mix(col,s.rgb,0.3);
        }
        col=col/(col+0.4); col=pow(col,vec3(0.9));
        gl_FragColor=vec4(clamp(col,0.0,1.0),1.0);
    }
`;



const canvas=document.getElementById("glcanvas");
const stage=document.getElementById("canvasStage");
const video=document.getElementById("webcam-video");
const generated=document.getElementById("generated-source");
const generatedCtx=generated.getContext("2d");
let gl=null,simProgram=null,displayProgram=null,quadBuffer=null,sourceTexture=null;
let framebuffers=[null,null],frameTextures=[null,null],ping=0,fbW=1,fbH=1;
let socket=null,reconnectTimer=0,reconnectDelay=600;
let cameraStream=null,cameraOn=false,activeDeviceId="",sourceWidth=640,sourceHeight=360,lastVideoTime=-1;
let paused=false,clearPending=true,shaderReady=false,diagnostics="Not compiled";
let elapsed=0,lastFrame=performance.now(),fpsFrames=0,fpsWindow=performance.now(),fps=0,sourceFrames=0,sourceWindow=performance.now(),sourceFps=0;
const pointer={x:.5,y:.5,down:false};

function badge(id,text,kind="pending"){const el=document.getElementById(id);if(!el)return;el.textContent=text;el.classList.remove("ok","pending","error");el.classList.add(kind);}
function setError(text=""){const el=document.getElementById("errorPanel");el.textContent=text;el.classList.toggle("hidden",!text);}
function send(message){if(!socket||socket.readyState!==WebSocket.OPEN)return false;socket.send(JSON.stringify(message));return true;}
function compileShader(type,source,label){const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){const info=gl.getShaderInfoLog(shader)||`${label} failed`;gl.deleteShader(shader);throw new Error(`${label}\n${info}`);}return shader;}
function buildProgram(fragment,label){const vs=compileShader(gl.VERTEX_SHADER,VERT,`${label} vertex`);const fs=compileShader(gl.FRAGMENT_SHADER,fragment,`${label} fragment`);const p=gl.createProgram();gl.attachShader(p,vs);gl.attachShader(p,fs);gl.linkProgram(p);gl.deleteShader(vs);gl.deleteShader(fs);if(!gl.getProgramParameter(p,gl.LINK_STATUS)){const info=gl.getProgramInfoLog(p)||`${label} link failed`;gl.deleteProgram(p);throw new Error(`${label} link\n${info}`);}return p;}
function bindQuad(program){gl.useProgram(program);gl.bindBuffer(gl.ARRAY_BUFFER,quadBuffer);const loc=gl.getAttribLocation(program,"a_pos");gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);}
function u1f(p,n,v){const l=gl.getUniformLocation(p,n);if(l!==null)gl.uniform1f(l,v);}
function u1i(p,n,v){const l=gl.getUniformLocation(p,n);if(l!==null)gl.uniform1i(l,v);}
function u2f(p,n,a,b){const l=gl.getUniformLocation(p,n);if(l!==null)gl.uniform2f(l,a,b);}
function createTexture(width=1,height=1,data=null,type=gl.UNSIGNED_BYTE){const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,width,height,0,gl.RGBA,type,data);return t;}
function destroyBuffers(){framebuffers.forEach(f=>f&&gl.deleteFramebuffer(f));frameTextures.forEach(t=>t&&gl.deleteTexture(t));framebuffers=[null,null];frameTextures=[null,null];}
function allocateBuffers(){if(!gl)return;const scale=Math.max(.1,Math.min(1,Number(params.bufferScale)||.5));fbW=Math.max(2,Math.floor(canvas.width*scale));fbH=Math.max(2,Math.floor(canvas.height*scale));destroyBuffers();for(let i=0;i<2;i++){const tex=createTexture(fbW,fbH,null,gl.UNSIGNED_BYTE);const fbo=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error("Feedback framebuffer is incomplete.");frameTextures[i]=tex;framebuffers[i]=fbo;}gl.bindFramebuffer(gl.FRAMEBUFFER,null);ping=0;clearPending=true;document.getElementById("bufferReadout").textContent=`${fbW} × ${fbH} history`;}
function initializeGpu(){gl=canvas.getContext("webgl",{alpha:false,antialias:false,preserveDrawingBuffer:true});if(!gl)throw new Error("WebGL 1 is unavailable.");simProgram=buildProgram(SIM,"Simulation");displayProgram=buildProgram(DISPLAY,"Display");quadBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,quadBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);sourceTexture=createTexture(1,1,new Uint8Array([0,0,0,255]));shaderReady=true;diagnostics="Simulation vertex: OK\nSimulation fragment: OK\nSimulation link: OK\nDisplay vertex: OK\nDisplay fragment: OK\nDisplay link: OK\nFeedback framebuffers: OK";badge("shaderBadge","PIPELINE OK","ok");setError("");resizeCanvas(true);const dbg=gl.getExtension("WEBGL_debug_renderer_info");const renderer=dbg?gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);document.getElementById("rendererReadout").textContent=renderer||"WebGL 1";}
function resizeCanvas(force=false){const dpr=Math.max(1,Math.min(window.devicePixelRatio||1,2));const w=Math.max(2,Math.floor(stage.clientWidth*dpr)),h=Math.max(2,Math.floor(stage.clientHeight*dpr));if(force||canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;document.getElementById("sizeReadout").textContent=`${w} × ${h}`;if(gl)allocateBuffers();}}
function drawGenerated(now){const w=generated.width,h=generated.height,t=now*.001;const g=generatedCtx.createLinearGradient(0,0,w,h);g.addColorStop(0,`hsl(${(t*35)%360} 80% 18%)`);g.addColorStop(.5,`hsl(${(t*55+120)%360} 90% 50%)`);g.addColorStop(1,`hsl(${(t*25+240)%360} 85% 15%)`);generatedCtx.fillStyle=g;generatedCtx.fillRect(0,0,w,h);generatedCtx.strokeStyle="rgba(255,255,255,.32)";generatedCtx.lineWidth=2;for(let x=0;x<w;x+=40){generatedCtx.beginPath();generatedCtx.moveTo(x,0);generatedCtx.lineTo(x,h);generatedCtx.stroke();}for(let y=0;y<h;y+=40){generatedCtx.beginPath();generatedCtx.moveTo(0,y);generatedCtx.lineTo(w,y);generatedCtx.stroke();}generatedCtx.fillStyle="#fff";generatedCtx.font="700 42px system-ui";generatedCtx.textAlign="center";generatedCtx.fillText("JUNKPILE 09",w/2,h/2-10);generatedCtx.font="18px monospace";generatedCtx.fillText("GENERATED FEEDBACK SOURCE",w/2,h/2+30);}
function uploadSource(now){gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,sourceTexture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);try{if(cameraOn&&video.readyState>=HTMLMediaElement.HAVE_CURRENT_DATA){if(video.currentTime!==lastVideoTime){lastVideoTime=video.currentTime;gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,video);sourceFrames++;sourceWidth=video.videoWidth||sourceWidth;sourceHeight=video.videoHeight||sourceHeight;}}else{drawGenerated(now);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,generated);sourceFrames++;sourceWidth=generated.width;sourceHeight=generated.height;}}catch(error){send({type:"cam-status",state:"error",title:"Texture upload failed",message:String(error?.message||error)});}}
function render(now){const dt=Math.min(Math.max((now-lastFrame)/1000,0),.1);lastFrame=now;if(!paused)elapsed+=dt;if(gl&&shaderReady&&!gl.isContextLost()&&framebuffers[0]){resizeCanvas();if(!paused){uploadSource(now);const write=ping,read=1-ping;gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffers[write]);gl.viewport(0,0,fbW,fbH);bindQuad(simProgram);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,frameTextures[read]);u1i(simProgram,"u_prev",0);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,sourceTexture);u1i(simProgram,"u_webcam",1);u1f(simProgram,"u_time",elapsed);u2f(simProgram,"u_res",fbW,fbH);u1i(simProgram,"u_mode",Math.round(params.mode));u1f(simProgram,"u_decay",params.decay);u1f(simProgram,"u_camMix",params.camMix);u1f(simProgram,"u_speed",params.speed);u1f(simProgram,"u_scale",params.scale);u1f(simProgram,"u_intensity",params.intensity);u2f(simProgram,"u_mouse",pointer.x,pointer.y);u1f(simProgram,"u_mouseDown",pointer.down?1:0);u1f(simProgram,"u_brushSize",params.brush);u1f(simProgram,"u_clearFlag",clearPending?1:0);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);clearPending=false;gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,canvas.width,canvas.height);bindQuad(displayProgram);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,frameTextures[write]);u1i(displayProgram,"u_fbo",0);u1i(displayProgram,"u_mode",Math.round(params.mode));u1f(displayProgram,"u_hue",params.hue);u1i(displayProgram,"u_palette",Math.round(params.palette));u1f(displayProgram,"u_time",elapsed);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);ping=read;}else{gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,canvas.width,canvas.height);bindQuad(displayProgram);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,frameTextures[1-ping]||sourceTexture);u1i(displayProgram,"u_fbo",0);u1i(displayProgram,"u_mode",Math.round(params.mode));u1f(displayProgram,"u_hue",params.hue);u1i(displayProgram,"u_palette",Math.round(params.palette));u1f(displayProgram,"u_time",elapsed);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);}}fpsFrames++;if(now-fpsWindow>=600){fps=Math.round(fpsFrames*1000/(now-fpsWindow));fpsFrames=0;fpsWindow=now;document.getElementById("fpsReadout").textContent=String(fps);}if(now-sourceWindow>=1000){sourceFps=Math.round(sourceFrames*1000/(now-sourceWindow));sourceFrames=0;sourceWindow=now;document.getElementById("cameraFpsReadout").textContent=String(sourceFps);}requestAnimationFrame(render);}
function telemetry(){const dbg=gl?.getExtension("WEBGL_debug_renderer_info");const renderer=gl?(dbg?gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)):"WebGL unavailable";send({type:"telemetry",fps,sourceFps,width:canvas.width,height:canvas.height,bufferWidth:fbW,bufferHeight:fbH,renderer,shaderReady,diagnostics,mode:params.mode,camera:{on:cameraOn,width:sourceWidth,height:sourceHeight}});}
function constraints(preset,deviceId){const map={"480":[640,480],"720":[1280,720],"1080":[1920,1080]};const video={};if(deviceId)video.deviceId={exact:deviceId};if(preset==="highest"){video.width={ideal:3840};video.height={ideal:2160};}else{const [w,h]=map[preset]||map["720"];video.width={ideal:w};video.height={ideal:h};}return {video,audio:false};}
async function enumerateCameras(){try{const devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==="videoinput").map(d=>({deviceId:d.deviceId,label:d.label}));send({type:"cam-devices",devices,activeDeviceId});}catch(error){send({type:"cam-status",state:"error",title:"Device refresh failed",message:String(error?.message||error)});}}
function stopCamera(notify=true){if(cameraStream)cameraStream.getTracks().forEach(t=>t.stop());cameraStream=null;video.srcObject=null;cameraOn=false;activeDeviceId="";document.getElementById("sourceName").textContent="Generated calibration source";badge("cameraBadge","GENERATED","pending");if(notify)send({type:"cam-status",state:"stopped",title:"Generated source",message:"Camera stopped; generated source restored."});}
async function startCamera(deviceId="",preset="720"){stopCamera(false);try{cameraStream=await navigator.mediaDevices.getUserMedia(constraints(preset,deviceId));video.srcObject=cameraStream;await video.play();const track=cameraStream.getVideoTracks()[0],settings=track?.getSettings?.()||{};activeDeviceId=settings.deviceId||deviceId||"";cameraOn=true;sourceWidth=video.videoWidth||settings.width||1280;sourceHeight=video.videoHeight||settings.height||720;document.getElementById("sourceName").textContent=track?.label||"Live camera";badge("cameraBadge","CAMERA LIVE","ok");send({type:"cam-status",state:"ok",title:"Camera live",message:`${track?.label||"Camera"} · ${sourceWidth} × ${sourceHeight}`,deviceId:activeDeviceId,width:sourceWidth,height:sourceHeight,label:track?.label||"Camera"});await enumerateCameras();}catch(error){stopCamera(false);badge("cameraBadge","CAMERA ERROR","error");send({type:"cam-status",state:"error",title:"Camera error",message:String(error?.message||error)});}}
function applySnapshot(msg){Object.assign(params,DEFAULT_PARAMS,msg.params||{});paused=Boolean(msg.paused);document.getElementById("pauseBadge").classList.toggle("hidden",!paused);if(msg.clearHistory)clearPending=true;if(msg.resetClock)elapsed=0;if(msg.camera?.on)startCamera(msg.camera.deviceId||"",msg.camera.preset||"720");else if(cameraOn)stopCamera(false);if(framebuffers[0])allocateBuffers();document.getElementById("modeBadge").textContent=MODE_NAMES[Math.round(params.mode)].toUpperCase();}
function handle(msg){if(msg.type==="state_snapshot")applySnapshot(msg);else if(msg.type==="param_batch"){const oldScale=params.bufferScale;Object.assign(params,msg.values||{});if(params.bufferScale!==oldScale)allocateBuffers();document.getElementById("modeBadge").textContent=MODE_NAMES[Math.round(params.mode)].toUpperCase();}else if(msg.type==="action"){if(msg.name==="set_paused"){paused=Boolean(msg.value);document.getElementById("pauseBadge").classList.toggle("hidden",!paused);}if(msg.name==="clear_history")clearPending=true;}else if(msg.type==="cam"){if(msg.action==="start")startCamera(msg.deviceId||"",msg.preset||"720");if(msg.action==="stop")stopCamera();if(msg.action==="enumerate")enumerateCameras();}}
function connect(){if(socket&&(socket.readyState===WebSocket.OPEN||socket.readyState===WebSocket.CONNECTING))return;badge("connectionBadge","CONNECTING","pending");socket=new WebSocket("ws://127.0.0.1:2727");socket.addEventListener("open",()=>{reconnectDelay=600;badge("connectionBadge","CONNECTED","ok");send({type:"hello",role:"canvas"});send({type:"request_state"});enumerateCameras();});socket.addEventListener("message",event=>{if(typeof event.data!=="string")return;try{handle(JSON.parse(event.data));}catch(error){console.warn(error);}});socket.addEventListener("close",()=>{badge("connectionBadge","DISCONNECTED","error");reconnectTimer=setTimeout(connect,reconnectDelay);reconnectDelay=Math.min(4000,Math.round(reconnectDelay*1.5));});socket.addEventListener("error",()=>badge("connectionBadge","RELAY ERROR","error"));}
function pointerUv(event){const r=canvas.getBoundingClientRect();return{x:Math.min(1,Math.max(0,(event.clientX-r.left)/r.width)),y:Math.min(1,Math.max(0,1-(event.clientY-r.top)/r.height))};}
canvas.addEventListener("pointerdown",event=>{const p=pointerUv(event);pointer.x=p.x;pointer.y=p.y;pointer.down=true;canvas.setPointerCapture(event.pointerId);});canvas.addEventListener("pointermove",event=>{if(!pointer.down)return;const p=pointerUv(event);pointer.x=p.x;pointer.y=p.y;});["pointerup","pointercancel"].forEach(name=>canvas.addEventListener(name,event=>{pointer.down=false;if(canvas.hasPointerCapture?.(event.pointerId))canvas.releasePointerCapture(event.pointerId);}));
canvas.addEventListener("webglcontextlost",event=>{event.preventDefault();shaderReady=false;diagnostics="WebGL context lost. Waiting for restoration…";badge("shaderBadge","CONTEXT LOST","error");setError(diagnostics);});canvas.addEventListener("webglcontextrestored",()=>{try{initializeGpu();}catch(error){diagnostics=String(error?.message||error);setError(diagnostics);}});
window.addEventListener("keydown",event=>{if(event.key.toLowerCase()==="f"){const invoke=window.__TAURI__?.invoke||window.__TAURI__?.tauri?.invoke;if(invoke)invoke("toggle_current_fullscreen").catch(console.error);}});
window.addEventListener("beforeunload",()=>stopCamera(false));if(navigator.mediaDevices?.addEventListener)navigator.mediaDevices.addEventListener("devicechange",enumerateCameras);new ResizeObserver(()=>resizeCanvas()).observe(stage);
function start(){try{initializeGpu();}catch(error){shaderReady=false;diagnostics=String(error?.message||error);badge("shaderBadge","PIPELINE ERROR","error");setError(diagnostics);}connect();setInterval(telemetry,650);lastFrame=performance.now();requestAnimationFrame(render);}
document.addEventListener("DOMContentLoaded",start,{once:true});
