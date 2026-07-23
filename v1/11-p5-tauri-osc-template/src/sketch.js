// =============================================================================
// sketch.js — OSC → Tauri events → params → GLSL shader
// =============================================================================
//
// Rust receives OSC messages over UDP and emits them as "osc-message" events.
// ADDRESS_MAP below routes OSC addresses to visual params.
//
// OSC VALUE CONVENTION
// ─────────────────────
// Most OSC controllers send floats in the range 0.0–1.0.
// Each address mapping scales that range to the param's natural range.
// If your controller sends 0–127, set the mapping's `inputMax` to 127.
//
// TO ADD AN ADDRESS
//   1. Add an entry to ADDRESS_MAP below
//   2. Add the param default to params{}
//   3. Add uniform to FRAG_SHADER + setUniform() in draw()
//   4. Add the address to the info box in index.html
// =============================================================================
'use strict';

const invoke     = window.__TAURI__.invoke;
const tauriEvent = window.__TAURI__.event;

// ── OSC address → param mapping ───────────────────────────────────────────────
// inputMin/inputMax: expected range from the OSC sender (usually 0.0–1.0)
// min/max: output range written to params
const ADDRESS_MAP = {
    '/hue':        { param: 'hue',        inputMin: 0, inputMax: 1, min: 0,   max: 360 },
    '/zoom':       { param: 'zoom',       inputMin: 0, inputMax: 1, min: 0.5, max: 4.0 },
    '/speed':      { param: 'speed',      inputMin: 0, inputMax: 1, min: 0,   max: 2.0 },
    '/brightness': { param: 'brightness', inputMin: 0, inputMax: 1, min: 0,   max: 2.0 },
    '/distortion': { param: 'distortion', inputMin: 0, inputMax: 1, min: 0,   max: 1.0 },
    '/complexity': { param: 'complexity', inputMin: 0, inputMax: 1, min: 1,   max: 8.0 },
    '/invert':     { param: 'invert',     inputMin: 0, inputMax: 1, min: 0,   max: 1.0 },
    '/pulse':      { param: 'pulse',      inputMin: 0, inputMax: 1, min: 0,   max: 1.0 },
};

// ── Shared params ─────────────────────────────────────────────────────────────
const params = {
    hue: 180, zoom: 1.5, speed: 0.5, brightness: 1.0,
    distortion: 0.3, complexity: 4.0, saturation: 0.8, glow: 0.4,
    invert: 0.0, pulse: 1.0,
};

// ── OSC log (panel monitor) ───────────────────────────────────────────────────
let logLines = [];
function logOsc(cls, text) {
    logLines.unshift(`<span class="log-line ${cls}">${text}</span>`);
    if (logLines.length > 25) logLines.pop();
    const el = document.getElementById('osc-log');
    if (el) el.innerHTML = logLines.join('<br>');
}

// ── OSC event handler ─────────────────────────────────────────────────────────
function handleOscMessage({ addr, value, args }) {
    const m = ADDRESS_MAP[addr];
    if (m) {
        // Scale input range to output range
        const t      = (value - m.inputMin) / (m.inputMax - m.inputMin);
        const scaled = m.min + Math.max(0, Math.min(1, t)) * (m.max - m.min);
        params[m.param] = scaled;

        // Sync manual slider if present
        const sl = document.getElementById(m.param);
        if (sl) {
            sl.value = scaled;
            const ve = document.getElementById(`${m.param}-val`);
            if (ve) ve.textContent = Number.isInteger(scaled) ? scaled : scaled.toFixed(2);
        }
        logOsc('log-hit', `${addr.padEnd(14)} ${value.toFixed(3)} \u2192 ${m.param}=${scaled.toFixed(2)}`);
    } else {
        // Unmapped address — show in log but ignore
        logOsc('log-unk', `${addr} [${args.join(', ')}]`);
    }
}

// ── GLSL ──────────────────────────────────────────────────────────────────────
const VERT_SHADER = `
    precision highp float;
    attribute vec3 aPosition; attribute vec2 aTexCoord; varying vec2 vTexCoord;
    void main(){ vTexCoord=aTexCoord; vec4 p=vec4(aPosition,1.0); p.xy=p.xy*2.0-1.0; gl_Position=p; }
`;
const FRAG_SHADER = `
    precision highp float;
    uniform float u_time; uniform vec2 u_resolution;
    uniform float u_hue,u_zoom,u_brightness,u_saturation,u_distortion,u_complexity,u_glow;
    uniform float u_invert,u_pulse;
    varying vec2 vTexCoord;
    vec3 hsb2rgb(float h,float s,float b){
        vec3 rgb=clamp(abs(mod(h*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0,0.0,1.0);
        return b*mix(vec3(1.0),rgb,s);
    }
    float hash(vec2 p){ p=fract(p*vec2(127.1,311.7)); p+=dot(p,p+19.19); return fract(p.x*p.y); }
    float vnoise(vec2 p){
        vec2 i=floor(p),f=fract(p),u=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x),u.y);
    }
    float fbm(vec2 p){
        float v=0.0,a=0.5,fr=1.0,fi=0.0;
        for(int i=0;i<8;i++){ if(fi>=u_complexity) break; v+=a*vnoise(p*fr); fr*=2.0; a*=0.5; fi+=1.0; }
        return v;
    }
    void main(){
        vec2 uv=(vTexCoord-0.5)*vec2(u_resolution.x/u_resolution.y,1.0)*u_zoom;
        float wt=u_time*0.35;
        vec2 w=uv+u_distortion*2.0*vec2(fbm(uv+vec2(wt,0.0))-0.5,fbm(uv+vec2(0.0,wt))-0.5);
        float t=u_time*0.5;
        float p=fbm(w*2.0+vec2(t,t*0.7))*0.5+fbm(w*3.0+vec2(-t*0.8,t))*0.3+fbm(w*1.5+vec2(t*0.3,-t))*0.2;
        p*=1.0+u_glow*(1.0-smoothstep(0.0,0.8,length(w)));
        float pulseVal=1.0+0.15*sin(u_time*2.5); p*=mix(1.0,pulseVal,u_pulse);
        float hue=mod((u_hue/360.0)+p*0.4+u_time*0.04,1.0);
        vec3 col=hsb2rgb(hue,u_saturation,clamp(p*u_brightness,0.0,1.5));
        col=mix(col,1.0-col,u_invert);
        gl_FragColor=vec4(col,1.0);
    }
`;

// ── p5 sketch ─────────────────────────────────────────────────────────────────
let shd;
function setup(){
    const c=document.getElementById('canvas-container');
    const cnv=createCanvas(c.clientWidth,c.clientHeight,WEBGL);
    cnv.parent('canvas-container'); pixelDensity(1);
    shd=createShader(VERT_SHADER,FRAG_SHADER); noStroke();
}
function draw(){
    shader(shd);
    shd.setUniform('u_time',(millis()/1000.0)*params.speed);
    shd.setUniform('u_resolution',[width,height]);
    shd.setUniform('u_hue',params.hue);
    shd.setUniform('u_zoom',params.zoom);
    shd.setUniform('u_brightness',params.brightness);
    shd.setUniform('u_saturation',params.saturation);
    shd.setUniform('u_distortion',params.distortion);
    shd.setUniform('u_complexity',params.complexity);
    shd.setUniform('u_glow',params.glow);
    shd.setUniform('u_invert',params.invert);
    shd.setUniform('u_pulse',params.pulse);
    rect(-width/2,-height/2,width,height);
}
function windowResized(){ const c=document.getElementById('canvas-container'); resizeCanvas(c.clientWidth,c.clientHeight); }

// ── UI wiring ─────────────────────────────────────────────────────────────────
const MANUAL_PARAMS  = ['hue','zoom','speed','brightness','distortion'];
const MANUAL_TOGGLES = ['invert','pulse'];

function wireControls(){
    MANUAL_PARAMS.forEach(id=>{
        const input=document.getElementById(id), valEl=document.getElementById(`${id}-val`);
        if(!input) return;
        input.addEventListener('input',()=>{
            const val=parseFloat(input.value); params[id]=val;
            if(valEl) valEl.textContent=Number.isInteger(val)?val:val.toFixed(2);
        });
    });
    MANUAL_TOGGLES.forEach(id=>{
        const input=document.getElementById(id);
        if(!input) return;
        input.addEventListener('change',()=>{ params[id]=input.checked?1.0:0.0; });
    });
}

document.addEventListener('DOMContentLoaded', async ()=>{
    wireControls();

    // Show the actual OSC port from Rust
    try {
        const port = await invoke('get_osc_port');
        const addrEl = document.getElementById('osc-addr');
        if (addrEl) addrEl.textContent = `127.0.0.1:${port}`;
    } catch(e) {}

    // Listen for OSC messages forwarded from Rust
    await tauriEvent.listen('osc-message', (e) => handleOscMessage(e.payload));

    // Also listen for the port announcement emitted at startup
    await tauriEvent.listen('osc-port', (e) => {
        const addrEl = document.getElementById('osc-addr');
        if (addrEl) addrEl.textContent = `127.0.0.1:${e.payload}`;
    });
});
