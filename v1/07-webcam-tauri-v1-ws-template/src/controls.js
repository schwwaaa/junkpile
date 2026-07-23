// =============================================================================
// controls.js — controls window
// =============================================================================
//
// MESSAGES SENT (controls → relay → canvas)
// ───────────────────────────────────────────
//   { type: 'param',  name, value }
//   { type: 'cam',    action: 'start', deviceId }
//   { type: 'cam',    action: 'stop'  }
//   { type: 'cam',    action: 'enumerate' }
//
// MESSAGES RECEIVED (canvas → relay → controls)
// ───────────────────────────────────────────────
//   { type: 'cam-status',  state: 'ok'|'err'|'stopped', label, w, h, message }
//   { type: 'cam-devices', devices: [{deviceId, label}], activeDeviceId }
//
// WHY CAMERA RUNS IN CANVAS WINDOW
// ──────────────────────────────────
//   getUserMedia() must run in the same WebView as the WebGL context consuming
//   the video frames. A MediaStream cannot be transferred across windows.
//   Controls just sends commands; canvas owns and executes them.
//
// =============================================================================

'use strict';

const WS_URL = 'ws://127.0.0.1:2727';

const PARAMS  = ['effect','distortion','feedback','zoom','speed','hue','saturation','brightness','contrast'];
const TOGGLES = ['mirror','invert','greyscale'];
const EFFECT_NAMES = ['Pass','Wave','Radial','Kaleido','Edges','Glitch'];

let ws = null;
let cameraOn = false;

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------

function connect() {
    if (ws && ws.readyState <= WebSocket.OPEN) return;
    setWsStatus('connecting…');
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
        setWsStatus('connected', true);
        ws.send(JSON.stringify({ type: 'hello', role: 'controls' }));
        broadcastAllParams();
        send({ type: 'cam', action: 'enumerate' });
    };
    ws.onclose = (e) => { setWsStatus(`off (${e.code})`); setTimeout(connect, 1500); };
    ws.onerror = () => setWsStatus('error', false, true);
    ws.onmessage = (event) => {
        if (typeof event.data !== 'string') return;
        let msg; try { msg = JSON.parse(event.data); } catch (_) { return; }
        if (msg.type === 'cam-status')  handleCamStatus(msg);
        if (msg.type === 'cam-devices') populateDeviceList(msg.devices, msg.activeDeviceId);
    };
}

function send(obj) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(JSON.stringify(obj)); } catch (_) {}
}

function sendParam(name, value) { send({ type: 'param', name, value }); }

function broadcastAllParams() {
    PARAMS.forEach(id => { const el = document.getElementById(id); if (el) sendParam(id, parseFloat(el.value)); });
    TOGGLES.forEach(id => { const el = document.getElementById(id); if (el) sendParam(id, el.checked); });
}

// ---------------------------------------------------------------------------
// Camera UI
// ---------------------------------------------------------------------------

function enableCameraControls(enabled) {
    document.getElementById('cam-select').disabled  = !enabled;
    document.getElementById('cam-refresh').disabled = !enabled;
    document.getElementById('cam-refresh').style.opacity = enabled ? '1' : '0.35';
    document.getElementById('cam-refresh').style.cursor  = enabled ? 'pointer' : 'not-allowed';
}

function handleCamStatus(msg) {
    const stat = document.getElementById('cam-status');
    const btn  = document.getElementById('cam-btn');
    if (msg.state === 'ok') {
        cameraOn = true;
        stat.textContent = (msg.w && msg.h) ? `${msg.w}×${msg.h}` : (msg.label || 'running');
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
        stat.textContent = `Error: ${msg.message || 'unknown'}`;
        stat.className   = 'err';
        btn.textContent  = '▶ Start';
    }
}

function populateDeviceList(devices, activeDeviceId) {
    const sel  = document.getElementById('cam-select');
    const prev = activeDeviceId || sel.value;
    sel.innerHTML = '';
    if (!devices || devices.length === 0) {
        sel.innerHTML = '<option value="">No cameras found</option>'; return;
    }
    devices.forEach((d, i) => {
        const o = document.createElement('option');
        o.value = d.deviceId;
        o.textContent = d.label || `Camera ${i + 1}`;
        sel.appendChild(o);
    });
    if (prev && sel.querySelector(`option[value="${prev}"]`)) sel.value = prev;
}

function requestStart() {
    const did = document.getElementById('cam-select').value || undefined;
    document.getElementById('cam-status').textContent = 'requesting…';
    document.getElementById('cam-status').className   = '';
    send({ type: 'cam', action: 'start', deviceId: did });
}

function requestStop() { send({ type: 'cam', action: 'stop' }); }

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
            if (valEl) valEl.textContent = id === 'effect'
                ? (EFFECT_NAMES[Math.round(val)] || val)
                : (Number.isInteger(val) ? val.toString() : val.toFixed(2));
            sendParam(id, val);
        });
    });
    TOGGLES.forEach(id => {
        const input = document.getElementById(id);
        if (!input) return;
        input.addEventListener('change', () => sendParam(id, input.checked));
    });
    document.getElementById('cam-btn').addEventListener('click', () => {
        if (cameraOn) requestStop(); else requestStart();
    });
    document.getElementById('cam-select').addEventListener('change', requestStart);
    document.getElementById('cam-refresh').addEventListener('click', () => {
        send({ type: 'cam', action: 'enumerate' });
    });
}

function setWsStatus(text, ok = false, isError = false) {
    const el = document.getElementById('ws-status');
    if (!el) return;
    el.textContent = `WS: ${text}`;
    el.className = ok ? 'connected' : (isError ? 'error' : '');
}

document.addEventListener('DOMContentLoaded', () => { wireControls(); connect(); });
