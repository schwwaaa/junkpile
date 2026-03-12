// =============================================================================
// controls.js — WebSocket sender + UI wiring for the controls window
// =============================================================================
//
// This file does two things:
//   1. Connects to the WebSocket relay and identifies as role="controls"
//   2. Wires every slider/checkbox to send a parameter message on change
//
// MESSAGE FORMAT
// ──────────────
// All messages are plain JSON strings sent over the WebSocket:
//
//   Handshake (sent once on connect):
//     { "type": "hello", "role": "controls" }
//
//   Parameter update (sent on every slider/checkbox change):
//     { "type": "param", "name": "speed", "value": 0.75 }
//     { "type": "param", "name": "invert", "value": true }
//
// The relay in main.rs receives these and broadcasts them to all other
// connected clients (i.e., the canvas window).
//
// HOW TO ADD A NEW PARAMETER
// ──────────────────────────
//   1. Add the input element in controls.html with a unique id.
//   2. Add the id string to the PARAMS or TOGGLES array below.
//   3. The rest is automatic — the wiring loop handles everything.
//   4. In canvas.js, read `params.<yourId>` in the draw() loop.
//
// =============================================================================

'use strict';

// ---------------------------------------------------------------------------
// WebSocket configuration
// ---------------------------------------------------------------------------

/**
 * The WebSocket URL to connect to.
 * This must match PORT in src-tauri/src/main.rs.
 *
 * We try 127.0.0.1 first (IPv4). On some platforms the WebView connects via
 * IPv6 (::1) instead — the Rust relay binds both, so either works.
 */
const WS_URL = 'ws://127.0.0.1:2727';

// ---------------------------------------------------------------------------
// Parameter lists
// ---------------------------------------------------------------------------

/**
 * PARAMS: IDs of all <input type="range"> sliders.
 * Each id corresponds to a DOM element in controls.html.
 * The id is also the "name" field in the WebSocket message.
 *
 * To add a slider parameter:
 *   1. Add <input type="range" id="myParam"> in controls.html
 *   2. Add 'myParam' here
 *   3. Read params.myParam in canvas.js
 */
const PARAMS = [
    'hue',
    'saturation',
    'brightness',
    'zoom',
    'speed',
    'distortion',
    'complexity',
    'symmetry',
    'glow',
];

/**
 * TOGGLES: IDs of all <input type="checkbox"> controls.
 * Values are sent as booleans (true/false) rather than numbers.
 */
const TOGGLES = [
    'invert',
    'pulse',
    'rotate',
];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Live reference to the WebSocket connection */
let ws = null;

/** Whether we currently have an active connection to the relay */
let connected = false;

// ---------------------------------------------------------------------------
// WebSocket connection management
// ---------------------------------------------------------------------------

/**
 * Establishes a WebSocket connection to the relay.
 * On success, sends the hello handshake and broadcasts all current values.
 * On failure, schedules a retry after 1.5 seconds.
 *
 * This auto-reconnect loop is important because:
 *   - The Rust relay starts asynchronously — it may not be ready when the
 *     HTML window first loads (a few ms delay after app launch).
 *   - If the connection drops for any reason, we want to recover automatically.
 */
function connect() {
    // Don't open a second connection if one is already open/connecting
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        return;
    }

    setStatus('connecting…');

    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
        connected = true;
        setStatus('connected', true);
        console.log('[controls] WebSocket connected');

        // ── Hello handshake ────────────────────────────────────────────────
        // Identify this window to the relay as role="controls".
        // The relay records this and uses it for routing (e.g., binary
        // frames are only forwarded to "canvas" role clients).
        sendJSON({ type: 'hello', role: 'controls' });

        // ── Broadcast current values ───────────────────────────────────────
        // When the canvas window starts AFTER the controls window, it won't
        // have received the initial param values. We re-broadcast everything
        // on each reconnect so the canvas is always in sync.
        broadcastAll();
    };

    ws.onclose = (event) => {
        connected = false;
        setStatus(`disconnected (${event.code})`);
        console.log('[controls] WebSocket closed, retrying in 1.5s…');
        // Schedule reconnect
        setTimeout(connect, 1500);
    };

    ws.onerror = () => {
        // onerror is always followed by onclose, which handles the retry
        setStatus('error', false, true);
    };

    // The controls window doesn't normally receive messages, but we handle
    // them here for debugging purposes (e.g., echo back from the relay).
    ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            console.log('[controls] received:', msg);
        } catch {
            // Non-JSON message — ignore
        }
    };
}

// ---------------------------------------------------------------------------
// Message sending helpers
// ---------------------------------------------------------------------------

/**
 * Sends a JavaScript object as a JSON string over the WebSocket.
 * Silently drops the message if the connection is not open.
 *
 * @param {object} obj - Any JSON-serialisable object
 */
function sendJSON(obj) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
        ws.send(JSON.stringify(obj));
    } catch (e) {
        console.warn('[controls] send failed:', e);
    }
}

/**
 * Sends a parameter update message.
 * This is the primary message type — sent every time a slider or checkbox
 * changes value.
 *
 * @param {string} name  - The parameter id (e.g. 'speed', 'invert')
 * @param {number|boolean} value - The current value
 */
function sendParam(name, value) {
    sendJSON({ type: 'param', name, value });
}

/**
 * Broadcasts all current parameter values.
 * Called on reconnect to synchronise the canvas window.
 */
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

/**
 * Wires all parameter inputs to send WebSocket messages and update their
 * value display spans on change.
 *
 * For sliders: listens to 'input' event (fires on every drag movement)
 * For checkboxes: listens to 'change' event
 */
function wireControls() {
    // ── Sliders ─────────────────────────────────────────────────────────────
    PARAMS.forEach(id => {
        const input = document.getElementById(id);
        const valEl = document.getElementById(`${id}-val`);
        if (!input) {
            console.warn(`[controls] no element found for param id: "${id}"`);
            return;
        }

        // Update display and send on every drag movement
        input.addEventListener('input', () => {
            const val = parseFloat(input.value);

            // Update the value display span
            if (valEl) {
                // Format: show 0 decimal places for whole numbers, else 2
                valEl.textContent = Number.isInteger(val)
                    ? val.toString()
                    : val.toFixed(2);
            }

            // Send the parameter update over WebSocket
            sendParam(id, val);
        });
    });

    // ── Checkboxes ───────────────────────────────────────────────────────────
    TOGGLES.forEach(id => {
        const input = document.getElementById(id);
        if (!input) {
            console.warn(`[controls] no element found for toggle id: "${id}"`);
            return;
        }

        input.addEventListener('change', () => {
            sendParam(id, input.checked);
        });
    });
}

// ---------------------------------------------------------------------------
// Status display
// ---------------------------------------------------------------------------

/**
 * Updates the WS status pill in the header.
 * @param {string}  text       - Display text
 * @param {boolean} [ok]       - If true, apply 'connected' styling
 * @param {boolean} [isError]  - If true, apply 'error' styling
 */
function setStatus(text, ok = false, isError = false) {
    const el = document.getElementById('ws-status');
    if (!el) return;
    el.textContent = `WS: ${text}`;
    el.className = ok ? 'connected' : (isError ? 'error' : '');
}

// ---------------------------------------------------------------------------
// Initialise
// ---------------------------------------------------------------------------

/**
 * Entry point — called when the DOM is ready.
 */
document.addEventListener('DOMContentLoaded', () => {
    wireControls(); // Wire all inputs
    connect();      // Start WebSocket connection
});
