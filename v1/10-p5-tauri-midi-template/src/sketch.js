// =============================================================================
// sketch.js — MIDI → Tauri bridge → params → GLSL shader
// =============================================================================
// FLOW: invoke('connect_midi_port') → Rust opens port → emits 'midi-event'
//       → listen('midi-event') → CC_MAP scales value → params[key] → draw()
//
// CC_MAP: maps CC numbers to param keys + output ranges. Change to match your hardware.
// Notes  → noteFlash (velocity-scaled brightness impulse, decays per frame)
// PBend  → pitchBend (0.0–1.0, centre 0.5, rotates the field in shader)
// =============================================================================
'use strict';

// Tauri v1 injects window.__TAURI__ automatically — no CDN script needed.
// invoke() calls a #[command] fn in main.rs.
// tauriEvent.listen() subscribes to window.emit() events from Rust.
const invoke     = window.__TAURI__.invoke;
const tauriEvent = window.__TAURI__.event;

// ── CC mapping ───────────────────────────────────────────────────────────────
// { cc_number: { param: 'key', min: number, max: number } }
const CC_MAP = {
    1:  { param: 'hue',        min: 0,   max: 360 },
    2:  { param: 'zoom',       min: 0.5, max: 4.0 },
    3:  { param: 'speed',      min: 0,   max: 2.0 },
    7:  { param: 'brightness', min: 0,   max: 2.0 },
    10: { param: 'distortion', min: 0,   max: 1.0 },
    74: { param: 'complexity', min: 1,   max: 8.0 },
};

// ── Shared params ─────────────────────────────────────────────────────────────
const params = {
    hue: 180, zoom: 1.5, speed: 0.5, brightness: 1.0,
    distortion: 0.3, complexity: 4.0, saturation: 0.8, glow: 0.4,
    noteFlash: 0.0,   // decays per frame after note_on
    pitchBend: 0.5,   // 0.0–1.0 centre 0.5
};
const NOTE_FLASH_DECAY = 0.85;

// ── MIDI log ──────────────────────────────────────────────────────────────────
let logLines = [];
function logMidi(cls, text) {
    logLines.unshift(`<span class="log-line ${cls}">${text}</span>`);
    if (logLines.length > 20) logLines.pop();
    const el = document.getElementById('midi-log');
    if (el) el.innerHTML = logLines.join('<br>');
}
function updateCCDisplay(ccNum, rawValue) {
    const fillEl = document.getElementById(`cc-fill-${ccNum}`);
    const valEl  = document.getElementById(`cc-val-${ccNum}`);
    if (fillEl) fillEl.style.width = (rawValue / 127 * 100).toFixed(1) + '%';
    if (valEl)  valEl.textContent  = rawValue;
}

// ── MIDI event handler ────────────────────────────────────────────────────────
function handleMidiEvent({ kind, channel, data1, data2, value }) {
    if (kind === 'cc') {
        const m = CC_MAP[data1];
        if (m) {
            const scaled = m.min + value * (m.max - m.min);
            params[m.param] = scaled;
            const sl = document.getElementById(m.param);
            if (sl) {
                sl.value = scaled;
                const ve = document.getElementById(`${m.param}-val`);
                if (ve) ve.textContent = Number.isInteger(scaled) ? scaled : scaled.toFixed(2);
            }
        }
        updateCCDisplay(data1, data2);
        logMidi('log-cc', `CC${String(data1).padStart(3)} ch${channel} \u2192 ${data2}`);
    } else if (kind === 'note_on') {
        params.noteFlash = value;
        logMidi('log-note', `NOTE ON  ch${channel} n${String(data1).padStart(3)} v${data2}`);
    } else if (kind === 'note_off') {
        logMidi('log-note', `NOTE OFF ch${channel} n${String(data1).padStart(3)}`);
    } else if (kind === 'pitch_bend') {
        params.pitchBend = value;
        logMidi('log-pb', `PITCH BEND ch${channel} \u2192 ${data2}`);
    }
}

// ── Device controls ───────────────────────────────────────────────────────────
async function refreshPorts() {
    const ports = await invoke('list_midi_ports');
    const sel   = document.getElementById('port-select');
    sel.innerHTML = ports.length === 0
        ? '<option value="">— no MIDI ports found —</option>'
        : ports.map(n => `<option value="${n}">${n}</option>`).join('');
}

async function connectPort() {
    const sel  = document.getElementById('port-select');
    const name = sel.value;
    if (!name) return;
    try {
        // Connect by name — survives port list changes between refresh and connect
        await invoke('connect_midi_port_by_name', { portName: name });
        document.getElementById('connect-btn').classList.add('active');
        document.getElementById('no-midi-overlay').classList.add('hidden');
        logMidi('log-cc', `connected \u2192 ${name}`);
    } catch (err) { alert('Connect failed: ' + err); }
}

async function disconnectPort() {
    await invoke('disconnect_midi');
    document.getElementById('connect-btn').classList.remove('active');
    document.getElementById('no-midi-overlay').classList.remove('hidden');
    logMidi('log-cc', 'disconnected');
}

async function debugPorts() {
    const result = await invoke('debug_midi_ports');
    logMidi('log-cc', result);
    console.log('[midi debug]', result);
    alert(result);
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
    uniform float u_noteFlash; // velocity-scaled impulse, decays per frame
    uniform float u_pitchBend; // 0.0-1.0, centre 0.5, rotates field
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
    mat2 rot(float a){ return mat2(cos(a),-sin(a),sin(a),cos(a)); }
    void main(){
        vec2 uv=(vTexCoord-0.5)*vec2(u_resolution.x/u_resolution.y,1.0)*u_zoom;
        uv=rot(u_time*0.1+(u_pitchBend-0.5)*1.5)*uv;
        float wt=u_time*0.35;
        vec2 w=uv+u_distortion*2.0*vec2(fbm(uv+vec2(wt,0.0))-0.5,fbm(uv+vec2(0.0,wt))-0.5);
        float t=u_time*0.5;
        float p=fbm(w*2.0+vec2(t,t*0.7))*0.5+fbm(w*3.0+vec2(-t*0.8,t))*0.3+fbm(w*1.5+vec2(t*0.3,-t))*0.2;
        p*=1.0+u_glow*(1.0-smoothstep(0.0,0.8,length(w)));
        float hue=mod((u_hue/360.0)+p*0.4+u_time*0.04,1.0);
        vec3 col=hsb2rgb(hue,u_saturation,clamp(p*(u_brightness+u_noteFlash*0.8),0.0,1.5));
        gl_FragColor=vec4(col,1.0);
    }
`;

// ── p5 sketch ─────────────────────────────────────────────────────────────────
let shd;
function setup() {
    const c = document.getElementById('canvas-container');
    const cnv = createCanvas(c.clientWidth, c.clientHeight, WEBGL);
    cnv.parent('canvas-container');
    pixelDensity(1);
    shd = createShader(VERT_SHADER, FRAG_SHADER);
    noStroke();
}
function draw() {
    params.noteFlash *= NOTE_FLASH_DECAY;
    shader(shd);
    shd.setUniform('u_time',        (millis()/1000.0)*params.speed);
    shd.setUniform('u_resolution',  [width, height]);
    shd.setUniform('u_hue',         params.hue);
    shd.setUniform('u_zoom',        params.zoom);
    shd.setUniform('u_brightness',  params.brightness);
    shd.setUniform('u_saturation',  params.saturation);
    shd.setUniform('u_distortion',  params.distortion);
    shd.setUniform('u_complexity',  params.complexity);
    shd.setUniform('u_glow',        params.glow);
    shd.setUniform('u_noteFlash',   params.noteFlash);
    shd.setUniform('u_pitchBend',   params.pitchBend);
    rect(-width/2,-height/2,width,height);
}
function windowResized() {
    const c = document.getElementById('canvas-container');
    resizeCanvas(c.clientWidth, c.clientHeight);
}

// ── UI wiring ─────────────────────────────────────────────────────────────────
function wireControls() {
    ['hue','zoom','speed','brightness'].forEach(id => {
        const input = document.getElementById(id);
        const valEl = document.getElementById(`${id}-val`);
        if (!input) return;
        input.addEventListener('input', () => {
            const val = parseFloat(input.value);
            params[id] = val;
            if (valEl) valEl.textContent = Number.isInteger(val) ? val : val.toFixed(2);
        });
    });
    document.getElementById('refresh-btn')   ?.addEventListener('click', refreshPorts);
    document.getElementById('connect-btn')   ?.addEventListener('click', connectPort);
    document.getElementById('disconnect-btn')?.addEventListener('click', disconnectPort);
    document.getElementById('debug-btn')     ?.addEventListener('click', debugPorts);
}

document.addEventListener('DOMContentLoaded', async () => {
    wireControls();
    await tauriEvent.listen('midi-event', (e) => handleMidiEvent(e.payload));
    await refreshPorts();
});
