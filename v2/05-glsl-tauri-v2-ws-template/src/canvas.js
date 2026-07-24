// =============================================================================
// canvas.js — WebSocket receiver + raw WebGL renderer + shader hot-swap
// =============================================================================
//
// ARCHITECTURE
// ─────────────
//   controls window  ──WS──▶  { type: 'param',  name, value }   → params{}
//                    ──WS──▶  { type: 'shader', src, name }     → compileAndRun()
//
// STARTUP SEQUENCE
// ─────────────────
//   1. Page loads → fetch('shader.frag') → compileAndRun(src) → render loop starts
//   2. WS connects → hello handshake as role='canvas'
//   3. Param messages → update params{}, picked up next frame
//   4. Shader message → compileAndRun(msg.src) → shader hot-swapped instantly
//
// The canvas always has a working shader — either the default or the last
// one sent by the controls window. Shader swaps are non-destructive: the
// render loop continues uninterrupted (just with the new program).
//
// =============================================================================

'use strict';

// ---------------------------------------------------------------------------
// 1. WebSocket config
// ---------------------------------------------------------------------------

const WS_URL = 'ws://127.0.0.1:2727';

// ---------------------------------------------------------------------------
// 2. Params (defaults — overwritten by WS messages from controls)
// ---------------------------------------------------------------------------

const params = {
    hue:        180.0,
    saturation: 0.8,
    brightness: 1.0,
    zoom:       1.5,
    speed:      0.5,
    distortion: 0.3,
    complexity: 4.0,
    symmetry:   3.0,
    glow:       0.4,
    invert:     0.0,
    pulse:      1.0,
    rotate:     0.0,
};

// ---------------------------------------------------------------------------
// 3. Vertex shader (inline — never changes)
// ---------------------------------------------------------------------------

const VERT_SHADER = `
    precision highp float;
    attribute vec2 a_position;
    varying vec2 vTexCoord;
    void main() {
        vTexCoord   = a_position * 0.5 + 0.5;
        gl_Position = vec4(a_position, 0.0, 1.0);
    }
`;

// ---------------------------------------------------------------------------
// 4. WebGL setup
// ---------------------------------------------------------------------------

const canvas = document.getElementById('glcanvas');
const gl     = canvas.getContext('webgl');

if (!gl) {
    document.body.innerHTML = '<p style="color:#f88;padding:2rem">WebGL not supported.</p>';
    throw new Error('WebGL not available');
}

// Full-screen quad — BL, BR, TL, TR
const quadBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

function compileShader(type, source) {
    const s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const info = gl.getShaderInfoLog(s);
        gl.deleteShader(s);
        throw new Error(info);
    }
    return s;
}

function createProgram(vertSrc, fragSrc) {
    const p = gl.createProgram();
    gl.attachShader(p, compileShader(gl.VERTEX_SHADER,   vertSrc));
    gl.attachShader(p, compileShader(gl.FRAGMENT_SHADER, fragSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        const info = gl.getProgramInfoLog(p);
        gl.deleteProgram(p);
        throw new Error(info);
    }
    return p;
}

function setUniform(prog, name, value) {
    const loc = gl.getUniformLocation(prog, name);
    if (loc === null) return;
    if (Array.isArray(value)) gl.uniform2f(loc, value[0], value[1]);
    else                      gl.uniform1f(loc, value);
}

// ---------------------------------------------------------------------------
// 5. compileAndRun() — compile a frag source string and hot-swap the shader
// ---------------------------------------------------------------------------

let program     = null;
let rafId       = null;
const startTime = performance.now();

/**
 * Compile a fragment shader source string and start rendering with it.
 * Safe to call at any time — stops the current loop, swaps program, restarts.
 * Called both at startup (from loadDefaultShader) and on WS shader messages.
 */
function compileAndRun(fragSrc) {
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }

    let newProg;
    try {
        newProg = createProgram(VERT_SHADER, fragSrc);
    } catch (e) {
        console.error('[canvas] shader error:', e.message);
        showError(e.message);
        // Keep the old program running if there was one
        if (program) rafId = requestAnimationFrame(render);
        return;
    }

    if (program) gl.deleteProgram(program);
    program = newProg;

    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    const aPos = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    hideError();
    console.log('[canvas] shader compiled OK');
    rafId = requestAnimationFrame(render);
}

/**
 * Fetch and compile the default shader at startup.
 */
async function loadDefaultShader() {
    try {
        const res = await fetch('shader.frag');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        compileAndRun(await res.text());
    } catch (e) {
        console.error('[canvas] failed to load shader.frag:', e);
        showError(`Could not load shader.frag:\n${e.message}`);
    }
}

// ---------------------------------------------------------------------------
// 6. render()
// ---------------------------------------------------------------------------

function render() {
    if (!program) return;
    const elapsed = (performance.now() - startTime) / 1000.0 * params.speed;

    gl.useProgram(program);
    gl.viewport(0, 0, canvas.width, canvas.height);

    setUniform(program, 'u_time',       elapsed);
    setUniform(program, 'u_resolution', [canvas.width, canvas.height]);
    setUniform(program, 'u_hue',        params.hue);
    setUniform(program, 'u_saturation', params.saturation);
    setUniform(program, 'u_brightness', params.brightness);
    setUniform(program, 'u_zoom',       params.zoom);
    setUniform(program, 'u_distortion', params.distortion);
    setUniform(program, 'u_rotate',     params.rotate);
    setUniform(program, 'u_complexity', params.complexity);
    setUniform(program, 'u_symmetry',   params.symmetry);
    setUniform(program, 'u_glow',       params.glow);
    setUniform(program, 'u_invert',     params.invert);
    setUniform(program, 'u_pulse',      params.pulse);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    rafId = requestAnimationFrame(render);
}

// ---------------------------------------------------------------------------
// 7. Resize
// ---------------------------------------------------------------------------

function resize() {
    const w = document.body.clientWidth;
    const h = document.body.clientHeight;
    if (canvas.width !== w || canvas.height !== h) {
        canvas.width  = w;
        canvas.height = h;
    }
}

new ResizeObserver(resize).observe(document.body);
resize();

// ---------------------------------------------------------------------------
// 8. WebSocket receiver
// ---------------------------------------------------------------------------

function connectWS() {
    const overlay = document.getElementById('overlay');
    const ws      = new WebSocket(WS_URL);

    ws.onopen = () => {
        if (overlay) {
            overlay.textContent = 'WS: connected';
            setTimeout(() => overlay.classList.add('hidden'), 2000);
        }
        console.log('[canvas] WebSocket connected');
        ws.send(JSON.stringify({ type: 'hello', role: 'canvas' }));
    };

    ws.onmessage = (event) => {
        if (typeof event.data !== 'string') return;
        let msg;
        try { msg = JSON.parse(event.data); } catch (_) { return; }

        if (msg.type === 'param' && msg.name !== undefined) {
            // Standard param update — store as float for GLSL
            params[msg.name] = (typeof msg.value === 'boolean')
                ? (msg.value ? 1.0 : 0.0)
                : msg.value;

        } else if (msg.type === 'shader' && typeof msg.src === 'string') {
            // Shader hot-swap — compile the new source immediately
            console.log(`[canvas] received shader: ${msg.name || 'unnamed'} (${msg.src.length} chars)`);
            compileAndRun(msg.src);
        }
    };

    ws.onclose = (event) => {
        if (overlay) {
            overlay.textContent = `WS: disconnected (${event.code})`;
            overlay.classList.remove('hidden');
        }
        setTimeout(connectWS, 1500);
    };

    ws.onerror = () => {};
}

// ---------------------------------------------------------------------------
// 9. Error overlay
// ---------------------------------------------------------------------------

function showError(msg) {
    let el = document.getElementById('shader-error');
    if (!el) {
        el = document.createElement('pre');
        el.id = 'shader-error';
        el.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#1a0000;color:#ff8080;' +
            'font-size:11px;padding:8px 12px;margin:0;white-space:pre-wrap;z-index:100;max-height:40vh;overflow:auto;';
        document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.display = 'block';
}

function hideError() {
    const el = document.getElementById('shader-error');
    if (el) el.style.display = 'none';
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

loadDefaultShader(); // fetch shader.frag → compile → start render loop
connectWS();         // connect to relay in parallel
