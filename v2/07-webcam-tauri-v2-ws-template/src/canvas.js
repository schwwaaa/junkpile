// =============================================================================
// canvas.js — pure output window
// =============================================================================
//
// This window owns the camera stream and WebGL context.
// It has NO camera UI — all controls live in controls.html.
//
// MESSAGES RECEIVED FROM CONTROLS
// ─────────────────────────────────
//   { type: 'param',  name, value }           → write into params{}
//   { type: 'cam',    action: 'start', deviceId? } → getUserMedia + reply
//   { type: 'cam',    action: 'stop'  }        → stop tracks + reply
//   { type: 'cam',    action: 'enumerate' }    → enumerateDevices + reply
//
// MESSAGES SENT BACK TO CONTROLS
// ─────────────────────────────────
//   { type: 'cam-status',  state: 'ok'|'err'|'stopped', w, h, message? }
//   { type: 'cam-devices', devices: [{deviceId, label}], activeDeviceId }
//
// =============================================================================

'use strict';

// ---------------------------------------------------------------------------
// 1. Params
// ---------------------------------------------------------------------------

const params = {
    effect:0.0, distortion:0.0, feedback:0.0, zoom:1.0, speed:0.3,
    hue:0.0, saturation:1.0, brightness:1.0, contrast:1.0,
    mirror:0.0, invert:0.0, greyscale:0.0,
};

// ---------------------------------------------------------------------------
// 2. Shaders
// ---------------------------------------------------------------------------

const VERT = `
    precision highp float;
    attribute vec2 a_position;
    varying vec2 vTexCoord;
    void main() { vTexCoord = a_position*0.5+0.5; gl_Position = vec4(a_position,0.0,1.0); }
`;

const FRAG = `
    precision highp float;
    uniform sampler2D u_webcam;
    uniform sampler2D u_prevFrame;
    uniform float u_time; uniform vec2 u_resolution;
    uniform float u_effect, u_distortion, u_feedback, u_zoom, u_speed;
    uniform float u_hue, u_saturation, u_brightness, u_contrast;
    uniform float u_mirror, u_invert, u_greyscale;
    varying vec2 vTexCoord;

    float luma(vec3 c){ return dot(c,vec3(0.2126,0.7152,0.0722)); }

    vec3 rotateHue(vec3 col, float deg){
        float a=deg*3.14159/180.0; float c=cos(a); float s=sin(a);
        float k=1.0/3.0; float sq=sqrt(k);
        mat3 m=mat3(c+(1.0-c)*k,(1.0-c)*k-sq*s,(1.0-c)*k+sq*s,
                    (1.0-c)*k+sq*s,c+(1.0-c)*k,(1.0-c)*k-sq*s,
                    (1.0-c)*k-sq*s,(1.0-c)*k+sq*s,c+(1.0-c)*k);
        return clamp(m*col,0.0,1.0);
    }

    float sobel(vec2 uv){
        vec2 px=1.0/u_resolution;
        float gx=-luma(texture2D(u_webcam,uv+vec2(-px.x,-px.y)).rgb)+luma(texture2D(u_webcam,uv+vec2(px.x,-px.y)).rgb)
                 -2.0*luma(texture2D(u_webcam,uv+vec2(-px.x,0.0)).rgb)+2.0*luma(texture2D(u_webcam,uv+vec2(px.x,0.0)).rgb)
                 -luma(texture2D(u_webcam,uv+vec2(-px.x,px.y)).rgb)+luma(texture2D(u_webcam,uv+vec2(px.x,px.y)).rgb);
        float gy=-luma(texture2D(u_webcam,uv+vec2(-px.x,-px.y)).rgb)-2.0*luma(texture2D(u_webcam,uv+vec2(0.0,-px.y)).rgb)
                 -luma(texture2D(u_webcam,uv+vec2(px.x,-px.y)).rgb)+luma(texture2D(u_webcam,uv+vec2(-px.x,px.y)).rgb)
                 +2.0*luma(texture2D(u_webcam,uv+vec2(0.0,px.y)).rgb)+luma(texture2D(u_webcam,uv+vec2(px.x,px.y)).rgb);
        return clamp(sqrt(gx*gx+gy*gy)*4.0,0.0,1.0);
    }

    vec3 applyEffect(vec2 uv){
        float t=u_time*u_speed;
        if(u_effect<0.5) return texture2D(u_webcam,uv).rgb;
        else if(u_effect<1.5){
            vec2 w=uv+u_distortion*vec2(sin(uv.y*10.0+t)*0.05,cos(uv.x*10.0+t)*0.05);
            return texture2D(u_webcam,w).rgb;
        } else if(u_effect<2.5){
            vec2 c=uv-0.5; float r=length(c); float th=atan(c.y,c.x);
            return texture2D(u_webcam,vec2(cos(th),sin(th))*(r+u_distortion*0.3*sin(r*8.0-t))+0.5).rgb;
        } else if(u_effect<3.5){
            vec2 c=uv-0.5; float r=length(c); float th=atan(c.y,c.x);
            float sec=3.14159*2.0/6.0; th=mod(th,sec); if(th>sec*0.5) th=sec-th; th+=t*u_distortion*0.5;
            return texture2D(u_webcam,vec2(cos(th),sin(th))*r+0.5).rgb;
        } else if(u_effect<4.5){
            return mix(vec3(0.0),texture2D(u_webcam,uv).rgb,sobel(uv));
        } else {
            float band=floor(uv.y*20.0)/20.0;
            float rnd=fract(sin(band*127.1+floor(t*8.0)*31.7)*43758.5);
            float sh=(rnd-0.5)*u_distortion*0.3;
            return vec3(texture2D(u_webcam,vec2(uv.x+sh+(fract(rnd*3.7)-0.5)*u_distortion*0.05,uv.y)).r,
                        texture2D(u_webcam,vec2(uv.x+sh,uv.y)).g,
                        texture2D(u_webcam,vec2(uv.x+sh-(fract(rnd*5.3)-0.5)*u_distortion*0.05,uv.y)).b);
        }
    }

    void main(){
        vec2 uv=vTexCoord;
        if(u_mirror>0.5) uv.x=1.0-uv.x;
        uv=(uv-0.5)/u_zoom+0.5;
        vec3 col=applyEffect(uv);
        if(u_feedback>0.001) col=mix(col,texture2D(u_prevFrame,vTexCoord).rgb,u_feedback);
        if(u_hue>0.5||u_hue<-0.5) col=rotateHue(col,u_hue);
        if(u_greyscale>0.5) col=vec3(luma(col));
        else if(abs(u_saturation-1.0)>0.01) col=mix(vec3(luma(col)),col,u_saturation);
        col*=u_brightness; col=(col-0.5)*u_contrast+0.5;
        if(u_invert>0.5) col=1.0-col;
        gl_FragColor=vec4(clamp(col,0.0,1.0),1.0);
    }
`;

// ---------------------------------------------------------------------------
// 3. WebGL
// ---------------------------------------------------------------------------

const canvas = document.getElementById('glcanvas');
const gl     = canvas.getContext('webgl');
if (!gl) { document.body.style.background='#200'; throw new Error('WebGL unavailable'); }

function mkShader(type, src) {
    const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s);
    if (!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
}
const program = (() => {
    const p=gl.createProgram();
    gl.attachShader(p,mkShader(gl.VERTEX_SHADER,VERT));
    gl.attachShader(p,mkShader(gl.FRAGMENT_SHADER,FRAG));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
})();
gl.useProgram(program);

const qbuf=gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER,qbuf);
gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
const aPos=gl.getAttribLocation(program,'a_position');
gl.enableVertexAttribArray(aPos);
gl.vertexAttribPointer(aPos,2,gl.FLOAT,false,0,0);

function u1f(n,v){const l=gl.getUniformLocation(program,n);if(l)gl.uniform1f(l,v);}
function u2f(n,a,b){const l=gl.getUniformLocation(program,n);if(l)gl.uniform2f(l,a,b);}
function u1i(n,v){const l=gl.getUniformLocation(program,n);if(l)gl.uniform1i(l,v);}

// ---------------------------------------------------------------------------
// 4. Webcam texture
// ---------------------------------------------------------------------------

const video = document.getElementById('webcam-video');
let cameraOn = false;
let webcamTex = null;
let activeDeviceId = null;

function mkTex() {
    const t=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,t);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    return t;
}

function uploadFrame() {
    if (!cameraOn || video.readyState < video.HAVE_CURRENT_DATA) return;
    gl.bindTexture(gl.TEXTURE_2D,webcamTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,video);
}

// ---------------------------------------------------------------------------
// 5. Ping-pong FBOs
// ---------------------------------------------------------------------------

let fbos=[null,null], fbTexs=[null,null], ping=0;

function mkFBO(w,h) {
    const tex=mkTex(); gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    const fb=gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null); gl.bindTexture(gl.TEXTURE_2D,null);
    return {fb,tex};
}
function initFBOs(w,h) { for(let i=0;i<2;i++){const{fb,tex}=mkFBO(w,h);fbos[i]=fb;fbTexs[i]=tex;} }
function resizeFBOs(w,h) {
    for(let i=0;i<2;i++){
        gl.bindTexture(gl.TEXTURE_2D,fbTexs[i]);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    }
    gl.bindTexture(gl.TEXTURE_2D,null);
}

// ---------------------------------------------------------------------------
// 6. render()
// ---------------------------------------------------------------------------

const t0 = performance.now();

function render() {
    const elapsed = (performance.now()-t0)/1000;
    const pong = 1-ping;
    uploadFrame();

    gl.bindFramebuffer(gl.FRAMEBUFFER,fbos[ping]);
    gl.viewport(0,0,canvas.width,canvas.height);
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,webcamTex);    u1i('u_webcam',0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,fbTexs[pong]); u1i('u_prevFrame',1);
    u1f('u_time',elapsed); u2f('u_resolution',canvas.width,canvas.height);
    u1f('u_effect',params.effect); u1f('u_distortion',params.distortion);
    u1f('u_feedback',params.feedback); u1f('u_zoom',params.zoom); u1f('u_speed',params.speed);
    u1f('u_hue',params.hue); u1f('u_saturation',params.saturation);
    u1f('u_brightness',params.brightness); u1f('u_contrast',params.contrast);
    u1f('u_mirror',params.mirror); u1f('u_invert',params.invert); u1f('u_greyscale',params.greyscale);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);

    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    gl.viewport(0,0,canvas.width,canvas.height);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,fbTexs[ping]); u1i('u_webcam',0);
    u1f('u_feedback',0.0); u1f('u_effect',0.0);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    u1f('u_feedback',params.feedback); u1f('u_effect',params.effect);

    ping=pong;
    requestAnimationFrame(render);
}

// ---------------------------------------------------------------------------
// 7. Camera management — driven by WS commands from controls window
// ---------------------------------------------------------------------------

function stopStream() {
    if (video.srcObject) { video.srcObject.getTracks().forEach(t=>t.stop()); video.srcObject=null; }
    cameraOn=false; activeDeviceId=null;
}

async function startCamera(deviceId) {
    stopStream();
    const did = deviceId || undefined;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: did
                ? { deviceId: { exact: did }, width: { ideal: 1280 }, height: { ideal: 720 } }
                : { width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false,
        });
        video.srcObject = stream;
        await video.play();
        const track = stream.getVideoTracks()[0];
        activeDeviceId = track?.getSettings()?.deviceId || did || null;
        cameraOn = true;
        // Reply to controls
        wsSend({ type: 'cam-status', state: 'ok', w: video.videoWidth, h: video.videoHeight });
    } catch (e) {
        wsSend({ type: 'cam-status', state: 'err', message: e.message });
    }
}

async function enumerateAndReply() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cams    = devices.filter(d => d.kind === 'videoinput');
        wsSend({
            type: 'cam-devices',
            devices: cams.map(d => ({ deviceId: d.deviceId, label: d.label })),
            activeDeviceId,
        });
    } catch (e) {
        wsSend({ type: 'cam-devices', devices: [], activeDeviceId: null });
    }
}

// ---------------------------------------------------------------------------
// 8. WebSocket — receives commands, sends back status
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
        if (typeof event.data !== 'string') return;
        let msg; try { msg = JSON.parse(event.data); } catch (_) { return; }

        if (msg.type === 'param' && msg.name !== undefined) {
            params[msg.name] = (typeof msg.value === 'boolean') ? (msg.value ? 1.0 : 0.0) : msg.value;

        } else if (msg.type === 'cam') {
            if (msg.action === 'start') {
                startCamera(msg.deviceId);
            } else if (msg.action === 'stop') {
                stopStream();
                wsSend({ type: 'cam-status', state: 'stopped' });
            } else if (msg.action === 'enumerate') {
                enumerateAndReply();
            }
        }
    };

    ws.onclose = (e) => {
        if (dot) { dot.textContent = `WS ○ (${e.code})`; dot.classList.remove('hidden'); }
        setTimeout(connectWS, 1500);
    };
    ws.onerror = () => {};
}

// ---------------------------------------------------------------------------
// 9. Resize
// ---------------------------------------------------------------------------

function resize() {
    const w = document.body.clientWidth, h = document.body.clientHeight;
    if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w; canvas.height = h;
        if (fbTexs[0]) resizeFBOs(w, h);
    }
}
new ResizeObserver(resize).observe(document.body);

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
    resize();
    webcamTex = mkTex();
    gl.bindTexture(gl.TEXTURE_2D, webcamTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0,0,0,255]));
    initFBOs(canvas.width, canvas.height);
    connectWS();
    requestAnimationFrame(render);
});
