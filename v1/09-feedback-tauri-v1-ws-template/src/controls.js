'use strict';

// =============================================================================
// controls.js — WS two-window feedback template
// =============================================================================
// Camera lives in the CANVAS window (getUserMedia must share the WebGL context).
// Controls sends { type:'cam', action:'start'|'stop'|'enumerate', deviceId? }
// Canvas replies  { type:'cam-status', state:'ok'|'err'|'stopped', w, h, msg? }
//                 { type:'cam-devices', devices:[{deviceId,label}], activeDeviceId }
// =============================================================================

const WS_URL = 'ws://127.0.0.1:2727';

const PALETTE_NAMES = ['Fire', 'Ice', 'Acid', 'Void', 'Rainbow'];

const MODE_DESCS = [
    'Your webcam frame decays and accumulates — movement leaves glowing trails.',
    'Webcam edges seed a curl-noise flow field. You become liquid.',
    'Webcam luminance injects V chemical each frame — your silhouette grows coral.',
    'Webcam brightness is a continuous heat source. You radiate and erode.',
    'Webcam folded into 6-way symmetry — you become a live mandala.',
    'Webcam + glitched accumulated memory. VHS ghost of everything you did.',
];

const PARAMS = ['decay', 'camMix', 'speed', 'scale', 'intensity', 'hue', 'palette', 'brush'];

const FMT = {
    decay:     v => v.toFixed(3),
    camMix:    v => v.toFixed(2),
    speed:     v => v.toFixed(2),
    scale:     v => v.toFixed(2),
    intensity: v => v.toFixed(2),
    hue:       v => v.toFixed(3),
    palette:   v => PALETTE_NAMES[Math.round(v)],
    brush:     v => v.toFixed(3),
};

let ws = null;
let cameraOn = false;

// ---------------------------------------------------------------------------
// WS
// ---------------------------------------------------------------------------

function send(obj) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(JSON.stringify(obj)); } catch (_) {}
}

function setWsStatus(text, ok = false, err = false) {
    const el = document.getElementById('ws-status');
    if (!el) return;
    el.textContent = `WS: ${text}`;
    el.className = ok ? 'connected' : (err ? 'error' : '');
}

function connect() {
    if (ws && ws.readyState <= WebSocket.OPEN) return;
    setWsStatus('connecting…');
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
        setWsStatus('connected', true);
        ws.send(JSON.stringify({ type: 'hello', role: 'controls' }));
        broadcastAll();
    };

    ws.onmessage = (event) => {
        let msg; try { msg = JSON.parse(event.data); } catch (_) { return; }
        if (msg.type === 'cam-status')  handleCamStatus(msg);
        if (msg.type === 'cam-devices') populateDeviceList(msg.devices, msg.activeDeviceId);
    };

    ws.onclose = e => { setWsStatus(`off (${e.code})`); setTimeout(connect, 1500); };
    ws.onerror = ()  => setWsStatus('error', false, true);
}

function broadcastAll() {
    PARAMS.forEach(id => {
        const el = document.getElementById(id);
        if (el) send({ type: 'param', name: id, value: parseFloat(el.value) });
    });
}

// ---------------------------------------------------------------------------
// Camera status (camera runs in canvas window — we just reflect state here)
// ---------------------------------------------------------------------------

function handleCamStatus(msg) {
    const stat = document.getElementById('cam-status');
    const btn  = document.getElementById('cam-btn');
    if (msg.state === 'ok') {
        cameraOn = true;
        stat.textContent = msg.w && msg.h ? `${msg.w}×${msg.h}` : 'running';
        stat.className   = 'ok';
        btn.textContent  = '■ Stop';
        enableCameraControls(true);
        send({ type: 'cam', action: 'enumerate' });
    } else if (msg.state === 'stopped') {
        cameraOn = false;
        stat.textContent = 'stopped'; stat.className = '';
        btn.textContent  = '▶ Start';
        enableCameraControls(false);
    } else if (msg.state === 'err') {
        cameraOn = false;
        stat.textContent = msg.message || 'error'; stat.className = 'err';
        btn.textContent  = '▶ Start';
    }
}

function populateDeviceList(devices, activeDeviceId) {
    const sel = document.getElementById('cam-select');
    sel.innerHTML = '';
    if (!devices || devices.length === 0) {
        sel.innerHTML = '<option value="">No cameras found</option>'; return;
    }
    devices.forEach((d, i) => {
        const o = document.createElement('option');
        o.value = d.deviceId; o.textContent = d.label || `Camera ${i + 1}`;
        sel.appendChild(o);
    });
    if (activeDeviceId && sel.querySelector(`option[value="${activeDeviceId}"]`))
        sel.value = activeDeviceId;
}

function enableCameraControls(enabled) {
    document.getElementById('cam-select').disabled  = !enabled;
    document.getElementById('cam-refresh').disabled = !enabled;
    const r = document.getElementById('cam-refresh');
    r.style.opacity = enabled ? '1' : '0.4';
    r.style.cursor  = enabled ? 'pointer' : 'not-allowed';
}

// ---------------------------------------------------------------------------
// Controls wiring
// ---------------------------------------------------------------------------

function wireControls() {
    PARAMS.forEach(id => {
        const input = document.getElementById(id);
        const valEl = document.getElementById(`${id}-val`);
        if (!input) return;
        input.addEventListener('input', () => {
            const val = parseFloat(input.value);
            if (valEl) valEl.textContent = FMT[id](val);
            send({ type: 'param', name: id, value: val });
        });
    });

    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const m = parseInt(btn.dataset.mode);
            document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('mode-desc').textContent = MODE_DESCS[m];
            send({ type: 'action', action: 'mode', value: m });
        });
    });

    // Camera commands — forwarded to canvas window which owns getUserMedia
    document.getElementById('cam-btn').addEventListener('click', () => {
        if (cameraOn) {
            send({ type: 'cam', action: 'stop' });
        } else {
            const did = document.getElementById('cam-select').value || null;
            send({ type: 'cam', action: 'start', deviceId: did });
        }
    });

    document.getElementById('cam-select').addEventListener('change', () => {
        if (!cameraOn) return;
        const did = document.getElementById('cam-select').value || null;
        send({ type: 'cam', action: 'start', deviceId: did });
    });

    document.getElementById('cam-refresh').addEventListener('click', () => {
        send({ type: 'cam', action: 'enumerate' });
    });

    document.getElementById('clear-btn').addEventListener('click', () => {
        send({ type: 'action', action: 'clear' });
    });
}

document.addEventListener('DOMContentLoaded', () => { wireControls(); connect(); });
