'use strict';

// =============================================================================
// canvas.js — WS two-window feedback template
// =============================================================================
// WHY WEBCAM LIVES HERE, NOT IN CONTROLS
// ─────────────────────────────────────────
//   getUserMedia() returns a MediaStream. That stream must be assigned to a
//   <video> element in the SAME WebView as the WebGL context that will call
//   gl.texImage2D(... video ...). You cannot pass a MediaStream across Tauri
//   windows. So the canvas window owns the camera entirely.
//
//   Controls window sends: { type:'cam', action:'start'|'stop'|'enumerate', deviceId? }
//   Canvas replies with:   { type:'cam-status', state:'ok'|'err'|'stopped', w, h }
//                          { type:'cam-devices', devices:[{deviceId,label}], activeDeviceId }
//
// TEXTURE UNITS
//   TEXTURE0 — u_prev    (previous FBO frame — the ping-pong source)
//   TEXTURE1 — u_webcam  (live camera, uploaded every render tick via texImage2D)
// =============================================================================

// ---------------------------------------------------------------------------
// Params  (written by WS param messages)
// ---------------------------------------------------------------------------

const params = {
    mode: 0, decay: 0.97, camMix: 0.3,
    speed: 1.0, scale: 1.0, intensity: 1.0,
    hue: 0.0, palette: 0, brush: 0.03,
};

// ---------------------------------------------------------------------------
// Shaders  (identical to single-window sketch.js)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// WebGL
// ---------------------------------------------------------------------------

const canvas = document.getElementById('glcanvas');
const gl     = canvas.getContext('webgl');
if (!gl) { document.body.style.background='#200'; throw new Error('WebGL unavailable'); }

const floatExt    = gl.getExtension('OES_texture_float');
const floatLinExt = gl.getExtension('OES_texture_float_linear');
const USE_FLOAT   = !!floatExt;

function mkShader(type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
}
function mkProg(vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, mkShader(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, mkShader(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
}

const simProg     = mkProg(VERT, SIM);
const displayProg = mkProg(VERT, DISPLAY);

const qBuf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, qBuf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);

function bindQuad(prog) {
    const l = gl.getAttribLocation(prog, 'a_pos');
    gl.bindBuffer(gl.ARRAY_BUFFER, qBuf);
    gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 2, gl.FLOAT, false, 0, 0);
}
function u1f(p,n,v){const l=gl.getUniformLocation(p,n);if(l!==null)gl.uniform1f(l,v);}
function u1i(p,n,v){const l=gl.getUniformLocation(p,n);if(l!==null)gl.uniform1i(l,v);}
function u2f(p,n,a,b){const l=gl.getUniformLocation(p,n);if(l!==null)gl.uniform2f(l,a,b);}

// ---------------------------------------------------------------------------
// Webcam  (owned entirely by this window — cannot cross WebViews)
// ---------------------------------------------------------------------------

// video element resolved lazily — top-level getElementById fires before DOM is parsed
let video         = null;
let cameraOn      = false;
let activeDeviceId = null;
let webcamTex      = null;

function initWebcamTex() {
    webcamTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, webcamTex);
    // 1×1 black placeholder until camera starts
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0,0,0,255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
}

function uploadFrame() {
    if (!cameraOn || video.readyState < video.HAVE_CURRENT_DATA) return;
    gl.bindTexture(gl.TEXTURE_2D, webcamTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
}

function stopStream() {
    if (video.srcObject) { video.srcObject.getTracks().forEach(t => t.stop()); video.srcObject = null; }
    cameraOn = false; activeDeviceId = null;
}

async function doStartCamera(deviceId) {
    stopStream();
    try {
        const constraints = {
            video: deviceId
                ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
                : { width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false,
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = stream; await video.play();
        const track = stream.getVideoTracks()[0];
        activeDeviceId = track?.getSettings()?.deviceId || deviceId || null;
        cameraOn = true;
        wsSend({ type: 'cam-status', state: 'ok', w: video.videoWidth, h: video.videoHeight });
        await doEnumerate();
    } catch (e) {
        wsSend({ type: 'cam-status', state: 'err', message: e.message });
    }
}

function doStopCamera() {
    stopStream();
    wsSend({ type: 'cam-status', state: 'stopped' });
}

async function doEnumerate() {
    try {
        const all  = await navigator.mediaDevices.enumerateDevices();
        const cams = all.filter(d => d.kind === 'videoinput').map(d => ({ deviceId: d.deviceId, label: d.label }));
        wsSend({ type: 'cam-devices', devices: cams, activeDeviceId });
    } catch (_) {}
}

// ---------------------------------------------------------------------------
// Ping-pong FBOs
// ---------------------------------------------------------------------------

let fbW = 0, fbH = 0, fbos = [null,null], fbTexs = [null,null], ping = 0;
let clearPending = false;

function mkFBOTex(w, h) {
    const type = USE_FLOAT ? gl.FLOAT : gl.UNSIGNED_BYTE;
    const t    = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const f = USE_FLOAT && floatLinExt ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    return t;
}

function initFBOs(w, h) {
    fbW = w; fbH = h;
    for (let i = 0; i < 2; i++) {
        if (fbTexs[i]) gl.deleteTexture(fbTexs[i]);
        if (fbos[i])   gl.deleteFramebuffer(fbos[i]);
        fbTexs[i] = mkFBOTex(w, h);
        fbos[i]   = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbos[i]);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fbTexs[i], 0);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    clearPending = true;
}

// ---------------------------------------------------------------------------
// Mouse (you can draw directly on the canvas window too)
// ---------------------------------------------------------------------------

const mouse = { x: 0.5, y: 0.5, down: false };
function canvasUV(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: 1.0 - (e.clientY - r.top) / r.height };
}
canvas.addEventListener('mousedown',  e => { const uv=canvasUV(e); mouse.x=uv.x; mouse.y=uv.y; mouse.down=true; });
canvas.addEventListener('mousemove',  e => { if(!mouse.down) return; const uv=canvasUV(e); mouse.x=uv.x; mouse.y=uv.y; });
canvas.addEventListener('mouseup',    () => mouse.down = false);
canvas.addEventListener('mouseleave', () => mouse.down = false);

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------

const t0 = performance.now();

function render() {
    const elapsed = (performance.now() - t0) / 1000;
    const pong    = 1 - ping;

    uploadFrame();

    // Sim pass: read pong FBO + webcam → write to ping FBO
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbos[ping]);
    gl.viewport(0, 0, fbW, fbH);
    gl.useProgram(simProg); bindQuad(simProg);

    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fbTexs[pong]); u1i(simProg,'u_prev',0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, webcamTex);    u1i(simProg,'u_webcam',1);

    u1f(simProg,'u_time',      elapsed);
    u2f(simProg,'u_res',       fbW, fbH);
    u1i(simProg,'u_mode',      params.mode);
    u1f(simProg,'u_decay',     params.decay);
    u1f(simProg,'u_camMix',    params.camMix);
    u1f(simProg,'u_speed',     params.speed);
    u1f(simProg,'u_scale',     params.scale);
    u1f(simProg,'u_intensity', params.intensity);
    u1f(simProg,'u_brushSize', params.brush);
    u2f(simProg,'u_mouse',     mouse.x, mouse.y);
    u1f(simProg,'u_mouseDown', mouse.down ? 1.0 : 0.0);
    u1f(simProg,'u_clearFlag', clearPending ? 1.0 : 0.0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    clearPending = false;

    // Display pass: ping FBO → screen with palette
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(displayProg); bindQuad(displayProg);

    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fbTexs[ping]); u1i(displayProg,'u_fbo',0);
    u1i(displayProg,'u_mode',    params.mode);
    u1f(displayProg,'u_hue',     params.hue);
    u1i(displayProg,'u_palette', params.palette);
    u1f(displayProg,'u_time',    elapsed);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    ping = pong;
    requestAnimationFrame(render);
}

// ---------------------------------------------------------------------------
// WS
// ---------------------------------------------------------------------------

let ws = null;

function wsSend(obj) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(JSON.stringify(obj)); } catch (_) {}
}

function connectWS() {
    const dot = document.getElementById('ws-dot');
    ws = new WebSocket('ws://127.0.0.1:2727');

    ws.onopen = () => {
        if (dot) { dot.textContent = 'WS ●'; setTimeout(() => dot.classList.add('hidden'), 2000); }
        ws.send(JSON.stringify({ type: 'hello', role: 'canvas' }));
    };

    ws.onmessage = (event) => {
        let msg; try { msg = JSON.parse(event.data); } catch (_) { return; }

        if (msg.type === 'param' && msg.name !== undefined) {
            params[msg.name] = (msg.name === 'palette') ? Math.round(msg.value) : msg.value;

        } else if (msg.type === 'action') {
            if (msg.action === 'mode')  { params.mode = msg.value; clearPending = true; }
            if (msg.action === 'clear') clearPending = true;

        } else if (msg.type === 'cam') {
            // Camera commands arrive from the controls window
            if      (msg.action === 'start')     doStartCamera(msg.deviceId || null);
            else if (msg.action === 'stop')      doStopCamera();
            else if (msg.action === 'enumerate') doEnumerate();
        }
    };

    ws.onclose = e => {
        if (dot) { dot.textContent = `WS ○ (${e.code})`; dot.classList.remove('hidden'); }
        setTimeout(connectWS, 1500);
    };
    ws.onerror = () => {};
}

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------

function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    initFBOs(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2));
}
new ResizeObserver(resize).observe(document.body);

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
    video = document.getElementById('webcam-video');
    resize();
    initWebcamTex();
    connectWS();
    requestAnimationFrame(render);
});
