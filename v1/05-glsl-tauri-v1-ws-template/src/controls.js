// =============================================================================
// controls.js — WebSocket sender + UI wiring + shader hot-swap
// =============================================================================
//
// WHAT'S NEW vs. THE STANDARD WEBGL WS CONTROLS
// ───────────────────────────────────────────────
// This version adds shader hot-swapping on top of the normal param messages.
//
// When the user picks a .frag file in the controls window:
//   1. FileReader reads the file as text (GLSL source)
//   2. A new message type is sent over WebSocket:
//        { "type": "shader", "src": "<full GLSL source string>" }
//   3. canvas.js receives it, calls compileAndRun(msg.src), and hot-swaps
//      the running shader — no app restart needed
//
// The canvas window boots with its own default shader.frag loaded via fetch().
// The controls window can replace it at any time by sending a new shader source.
//
// ALL OTHER BEHAVIOUR IS IDENTICAL TO THE STANDARD CONTROLS
// ───────────────────────────────────────────────────────────
// Param messages, reconnect logic, broadcastAll(), wireControls() — unchanged.
//
// =============================================================================

'use strict';

const WS_URL = 'ws://127.0.0.1:2727';

const PARAMS  = ['hue','saturation','brightness','zoom','speed','distortion','complexity','symmetry','glow'];
const TOGGLES = ['invert','pulse','rotate'];

let ws        = null;
let connected = false;

// ---------------------------------------------------------------------------
// WebSocket connection
// ---------------------------------------------------------------------------

function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    setStatus('connecting…');

    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
        connected = true;
        setStatus('connected', true);
        sendJSON({ type: 'hello', role: 'controls' });
        broadcastAll();
    };

    ws.onclose = (event) => {
        connected = false;
        setStatus(`disconnected (${event.code})`);
        setTimeout(connect, 1500);
    };

    ws.onerror = () => { setStatus('error', false, true); };

    ws.onmessage = (event) => {
        try { console.log('[controls] received:', JSON.parse(event.data)); } catch (_) {}
    };
}

// ---------------------------------------------------------------------------
// Message helpers
// ---------------------------------------------------------------------------

function sendJSON(obj) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(JSON.stringify(obj)); } catch (e) { console.warn('[controls] send failed:', e); }
}

function sendParam(name, value) {
    sendJSON({ type: 'param', name, value });
}

/**
 * sendShader — sends a GLSL source string to the canvas window.
 * The canvas receives { type: 'shader', src: '...' } and calls compileAndRun().
 *
 * @param {string} src  — raw GLSL fragment shader source
 * @param {string} name — filename for display only
 */
function sendShader(src, name) {
    sendJSON({ type: 'shader', src, name });
    console.log(`[controls] sent shader: ${name} (${src.length} chars)`);
}

function broadcastAll() {
    PARAMS.forEach(id => {
        const el = document.getElementById(id);
        if (el) sendParam(id, parseFloat(el.value));
    });
    TOGGLES.forEach(id => {
        const el = document.getElementById(id);
        if (el) sendParam(id, el.checked);
    });
}

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------

function wireControls() {
    PARAMS.forEach(id => {
        const input = document.getElementById(id);
        const valEl = document.getElementById(`${id}-val`);
        if (!input) return;
        input.addEventListener('input', () => {
            const val = parseFloat(input.value);
            if (valEl) valEl.textContent = Number.isInteger(val) ? val.toString() : val.toFixed(2);
            sendParam(id, val);
        });
    });

    TOGGLES.forEach(id => {
        const input = document.getElementById(id);
        if (!input) return;
        input.addEventListener('change', () => { sendParam(id, input.checked); });
    });

    // ── Shader file loader ────────────────────────────────────────────────
    // When a .frag file is selected, read it and send the source over WS.
    const fileInput = document.getElementById('shader-file-input');
    if (fileInput) {
        fileInput.addEventListener('change', function () {
            const file = this.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                const src = e.target.result;
                sendShader(src, file.name);
                const nameEl = document.getElementById('shader-filename');
                if (nameEl) nameEl.textContent = file.name;
            };
            reader.readAsText(file);
            this.value = ''; // reset so same file can be reloaded
        });
    }
}

// ---------------------------------------------------------------------------
// Status display
// ---------------------------------------------------------------------------

function setStatus(text, ok = false, isError = false) {
    const el = document.getElementById('ws-status');
    if (!el) return;
    el.textContent = `WS: ${text}`;
    el.className = ok ? 'connected' : (isError ? 'error' : '');
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
    wireControls();
    connect();
});
