// =============================================================================
// sketch.js — raw WebGL + external GLSL shader file
// =============================================================================
//
// KEY DIFFERENCE FROM THE INLINE WEBGL TEMPLATE
// ───────────────────────────────────────────────
// The fragment shader no longer lives as a JS string in this file.
// Instead it is loaded at runtime via fetch():
//
//   fetch('shader.frag')          ← loads src/shader.frag
//     .then(r => r.text())
//     .then(src => init(src))     ← compiles and starts render loop
//
// This means:
//   • You can edit shader.frag without touching any JS
//   • The shader is a real GLSL file — syntax-highlighted in any editor
//   • Swapping shaders = replacing one file
//
// The vertex shader stays inline (it's pure boilerplate, never changes).
// All params, uniforms, controls wiring, and resize logic are identical
// to the inline WebGL single-window template.
//
// HOW TO USE YOUR OWN SHADER
// ───────────────────────────
// 1. Edit src/shader.frag — or replace it with your own .frag file
// 2. Keep the same uniform names (u_time, u_resolution, u_hue, etc.)
//    OR remove/add uniforms and update the setUniform calls in render()
// 3. npm run dev — changes to shader.frag are picked up on next app launch
//
// HOW TO ADD A NEW PARAMETER
// ───────────────────────────
//   [ ] 1. Add <input> in index.html
//   [ ] 2. Add id to PARAMS or TOGGLES below
//   [ ] 3. Add default to params{}
//   [ ] 4. Add `uniform float u_myParam;` in shader.frag
//   [ ] 5. Add setUniform(program, 'u_myParam', params.myParam) in render()
//
// =============================================================================

'use strict';

// ---------------------------------------------------------------------------
// 1. Params
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

const PARAMS  = ['hue','saturation','brightness','zoom','speed','distortion','complexity','symmetry','glow'];
const TOGGLES = ['invert','pulse','rotate'];

// ---------------------------------------------------------------------------
// 2. Vertex shader (inline — this never changes)
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
// 3. WebGL context
// ---------------------------------------------------------------------------

const canvas = document.getElementById('glcanvas');
const gl     = canvas.getContext('webgl');

if (!gl) {
    document.body.innerHTML = '<p style="color:#f88;padding:2rem">WebGL not supported.</p>';
    throw new Error('WebGL not available');
}

// Full-screen quad buffer — set up once, used by every shader
const quadBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

// ---------------------------------------------------------------------------
// 4. Shader compile helpers
// ---------------------------------------------------------------------------

function compileShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const info = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error('Shader compile error:\n' + info);
    }
    return shader;
}

function createProgram(vertSrc, fragSrc) {
    const prog = gl.createProgram();
    gl.attachShader(prog, compileShader(gl.VERTEX_SHADER,   vertSrc));
    gl.attachShader(prog, compileShader(gl.FRAGMENT_SHADER, fragSrc));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        const info = gl.getProgramInfoLog(prog);
        gl.deleteProgram(prog);
        throw new Error('Program link error:\n' + info);
    }
    return prog;
}

function setUniform(prog, name, value) {
    const loc = gl.getUniformLocation(prog, name);
    if (loc === null) return;
    if (Array.isArray(value)) {
        if (value.length === 2) gl.uniform2f(loc, value[0], value[1]);
    } else {
        gl.uniform1f(loc, value);
    }
}

// ---------------------------------------------------------------------------
// 5. loadShader() — fetch the .frag file and (re)compile
// ---------------------------------------------------------------------------

/**
 * Fetches shader.frag, compiles it, and starts (or restarts) the render loop.
 *
 * This is the core new feature vs. the inline template.
 * Because the shader source is just a string, you can call this function
 * with any GLSL source — from a file, a textarea, a WebSocket message, etc.
 *
 * @param {string} [url='shader.frag'] — path relative to src/
 */
let program     = null;
let rafId       = null;
const startTime = performance.now();

async function loadShader(url = 'shader.frag') {
    let fragSrc;
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        fragSrc = await res.text();
    } catch (e) {
        console.error('[sketch] failed to load shader:', e);
        showError(`Could not load ${url}:\n${e.message}`);
        return;
    }
    compileAndRun(fragSrc);
}

/**
 * Compile a fragment shader source string and start rendering with it.
 * Safe to call multiple times — cleans up the previous program first.
 *
 * @param {string} fragSrc — raw GLSL source
 */
function compileAndRun(fragSrc) {
    // Stop the current render loop before swapping programs
    if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
    }

    let newProgram;
    try {
        newProgram = createProgram(VERT_SHADER, fragSrc);
    } catch (e) {
        console.error('[sketch] shader compile failed:', e);
        showError(e.message);
        return;
    }

    // Clean up old program
    if (program !== null) gl.deleteProgram(program);
    program = newProgram;

    // Re-bind the quad buffer to the new program's attribute
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    const aPos = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    hideError();
    console.log('[sketch] shader compiled OK');
    rafId = requestAnimationFrame(render);
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
    const container = document.getElementById('canvas-container');
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (canvas.width !== w || canvas.height !== h) {
        canvas.width  = w;
        canvas.height = h;
    }
}

new ResizeObserver(() => resize()).observe(document.getElementById('canvas-container'));
resize();

// ---------------------------------------------------------------------------
// 8. Controls wiring
// ---------------------------------------------------------------------------

function wireControls() {
    PARAMS.forEach(id => {
        const input = document.getElementById(id);
        const valEl = document.getElementById(`${id}-val`);
        if (!input) return;
        input.addEventListener('input', () => {
            const val = parseFloat(input.value);
            params[id] = val;
            if (valEl) valEl.textContent = Number.isInteger(val) ? val.toString() : val.toFixed(2);
        });
    });
    TOGGLES.forEach(id => {
        const input = document.getElementById(id);
        if (!input) return;
        input.addEventListener('change', () => { params[id] = input.checked ? 1.0 : 0.0; });
    });
}

// ---------------------------------------------------------------------------
// 9. Error display
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

document.addEventListener('DOMContentLoaded', () => {
    wireControls();
    loadShader('shader.frag'); // fetch → compile → start render loop
});
