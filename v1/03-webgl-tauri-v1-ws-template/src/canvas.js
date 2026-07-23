// =============================================================================
// canvas.js — raw WebGL renderer + WebSocket receiver
// =============================================================================
//
// WHAT CHANGED vs. THE p5 VERSION
// ─────────────────────────────────
// p5 version:                          This version (raw WebGL):
// ─────────────────────────────────    ──────────────────────────────────────
// <script src="p5.min.js">             No external dependencies
// createCanvas(w, h, WEBGL)            canvas.getContext('webgl')
// createShader(vert, frag)             compileShader() + gl.createProgram()
// shader(shd) + shd.setUniform(...)    gl.useProgram() + gl.uniform1f(...)
// rect(-w/2, -h/2, w, h)              gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
// function setup() / draw()            init() + requestAnimationFrame(render)
// function windowResized()             ResizeObserver on document.body
//
// WHAT DID NOT CHANGE
// ───────────────────
// • WebSocket connection logic  — identical (connectWS, onmessage, reconnect)
// • params{} object             — identical keys and defaults
// • VERT_SHADER / FRAG_SHADER   — identical GLSL, not a single line changed
//
// STRUCTURE OF THIS FILE
// ──────────────────────
//   1. WebSocket config + params{}  — same as p5 version
//   2. VERT_SHADER / FRAG_SHADER    — same GLSL as p5 version
//   3. WebSocket receiver           — same as p5 version
//   4. WebGL bootstrap              — replaces p5 setup()
//   5. render()                     — replaces p5 draw()
//   6. resize()                     — replaces p5 windowResized()
//
// HOW TO ADD A NEW PARAMETER
// ──────────────────────────
//   [ ] 1. Add <input> in controls.html, id to PARAMS/TOGGLES in controls.js
//   [ ] 2. Add default to params{} below
//   [ ] 3. Add `uniform float u_myParam;` in FRAG_SHADER
//   [ ] 4. Add setUniform(program, 'u_myParam', params.myParam) in render()
//   [ ] 5. Use u_myParam in your GLSL
//
// =============================================================================

'use strict';

// ---------------------------------------------------------------------------
// 1. WebSocket configuration
// ---------------------------------------------------------------------------

/** Must match PORT in main.rs and WS_URL in controls.js */
const WS_URL = 'ws://127.0.0.1:2727';

// ---------------------------------------------------------------------------
// 2. Shared parameter state
// ---------------------------------------------------------------------------

/**
 * `params` is populated by incoming WebSocket messages from the controls window.
 * Default values are what renders before any slider is touched.
 * render() reads from this object every frame — no further sync needed.
 */
const params = {
    // Color
    hue:        180.0,
    saturation: 0.8,
    brightness: 1.0,

    // Shape
    zoom:       1.5,
    speed:      0.5,
    distortion: 0.3,

    // Pattern
    complexity: 4.0,
    symmetry:   3.0,
    glow:       0.4,

    // Toggles (booleans from controls arrive as 1.0 / 0.0 for GLSL)
    invert:     0.0,
    pulse:      1.0,
    rotate:     0.0,
};

// ---------------------------------------------------------------------------
// 3. GLSL shaders  (identical to p5 version)
// ---------------------------------------------------------------------------

/**
 * VERTEX SHADER
 * Full-screen quad. Maps clip-space corners to UV (0..1) for the frag shader.
 * In p5 this used aPosition/aTexCoord attributes set by p5 internally.
 * Here we use a_position and compute UV ourselves — same result.
 */
const VERT_SHADER = `
    precision highp float;

    attribute vec2 a_position;

    varying vec2 vTexCoord;

    void main() {
        vTexCoord   = a_position * 0.5 + 0.5;
        gl_Position = vec4(a_position, 0.0, 1.0);
    }
`;

/**
 * FRAGMENT SHADER  (byte-for-byte identical to the p5 ws version)
 *
 * GLSL ES 1.0 / WKWebView rules applied:
 *   • All uniforms are float — no int or bool uniform types
 *   • Loop bound is a compile-time constant (8)
 *   • fi is declared BEFORE the for loop — WebKit rejects declarations
 *     inside a loop body when an int counter (i) is already in scope
 */
const FRAG_SHADER = `
    precision highp float;

    uniform float u_time;
    uniform vec2  u_resolution;

    uniform float u_hue;
    uniform float u_saturation;
    uniform float u_brightness;

    uniform float u_zoom;
    uniform float u_distortion;
    uniform float u_rotate;

    uniform float u_complexity;
    uniform float u_symmetry;
    uniform float u_glow;

    uniform float u_invert;
    uniform float u_pulse;

    varying vec2 vTexCoord;

    // ── HSB → RGB ─────────────────────────────────────────────────────────
    vec3 hsb2rgb(float h, float s, float b) {
        vec3 rgb = clamp(
            abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0,
            0.0, 1.0
        );
        return b * mix(vec3(1.0), rgb, s);
    }

    // ── Pseudo-random hash ────────────────────────────────────────────────
    float hash(vec2 p) {
        p  = fract(p * vec2(127.1, 311.7));
        p += dot(p, p + 19.19);
        return fract(p.x * p.y);
    }

    // ── Smooth value noise ────────────────────────────────────────────────
    float vnoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(
            mix(hash(i),                 hash(i + vec2(1.0, 0.0)), u.x),
            mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
            u.y
        );
    }

    // ── Fractal Brownian Motion ───────────────────────────────────────────
    // fi is declared before the for loop — required by WebKit's strict
    // GLSL ES 1.0 parser (WKWebView / Tauri on macOS). Declaring fi inside
    // the loop body causes "Unexpected identifier 'fi'" on Safari/WKWebView.
    float fbm(vec2 p) {
        float value     = 0.0;
        float amplitude = 0.5;
        float freq      = 1.0;
        float fi        = 0.0;  // hoisted — must be before the for loop
        for (int i = 0; i < 8; i++) {
            if (fi >= u_complexity) break;
            value     += amplitude * vnoise(p * freq);
            freq      *= 2.0;
            amplitude *= 0.5;
            fi        += 1.0;
        }
        return value;
    }

    // ── 2D rotation matrix ────────────────────────────────────────────────
    mat2 rotate2D(float a) {
        return mat2(cos(a), -sin(a), sin(a), cos(a));
    }

    void main() {
        // 1. Centre UV, correct aspect, apply zoom
        vec2 uv = vTexCoord - 0.5;
        uv.x   *= u_resolution.x / u_resolution.y;
        uv     *= u_zoom;

        // 2. Optional rotation
        uv = rotate2D(u_time * 0.15 * u_rotate) * uv;

        // 3. Domain warp
        float wt = u_time * 0.3;
        vec2 warpUV = uv + u_distortion * 2.0 * vec2(
            fbm(uv + vec2(wt,  0.0)) - 0.5,
            fbm(uv + vec2(0.0, wt )) - 0.5
        );

        // 4. Rotational symmetry
        float ang    = atan(warpUV.y, warpUV.x);
        float radius = length(warpUV);
        float sector = 6.28318 / u_symmetry;
        ang          = mod(ang + 3.14159, sector) - sector * 0.5;
        vec2 symUV   = vec2(cos(ang), sin(ang)) * radius;

        // 5. Layered fBm pattern
        float t = u_time * 0.5;
        float pattern =
            fbm(symUV * 2.0 + vec2( t,        t * 0.7)) * 0.5 +
            fbm(symUV * 3.0 + vec2(-t * 0.8,  t      )) * 0.3 +
            fbm(symUV * 1.5 + vec2( t * 0.3, -t      )) * 0.2;

        // 6. Radial glow
        pattern *= 1.0 + u_glow * (1.0 - smoothstep(0.0, 0.8, radius));

        // 7. Brightness pulse
        float pulseVal = 1.0 + 0.15 * sin(u_time * 2.5);
        pattern       *= mix(1.0, pulseVal, u_pulse);

        // 8. HSB colour mapping
        float hue = mod(
            (u_hue / 360.0) + pattern * 0.5 + u_time * 0.05,
            1.0
        );
        vec3 col = hsb2rgb(hue, u_saturation, clamp(pattern * u_brightness, 0.0, 1.5));

        // 9. Optional colour inversion
        col = mix(col, 1.0 - col, u_invert);

        gl_FragColor = vec4(col, 1.0);
    }
`;

// ---------------------------------------------------------------------------
// 4. WebSocket receiver  (identical logic to p5 version)
// ---------------------------------------------------------------------------

/**
 * Connects to the relay, sends hello as role="canvas", and listens for
 * parameter messages. Updates params{} on every message — render() picks
 * up the new values on the next frame automatically.
 */
function connectWS() {
    const overlay = document.getElementById('overlay');

    const ws = new WebSocket(WS_URL);

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
        try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'param' && msg.name !== undefined) {
                // Booleans from checkboxes arrive as true/false — store as 1.0/0.0
                params[msg.name] = (typeof msg.value === 'boolean')
                    ? (msg.value ? 1.0 : 0.0)
                    : msg.value;
            }
        } catch (_) {}
    };

    ws.onclose = (event) => {
        if (overlay) {
            overlay.textContent = `WS: disconnected (${event.code})`;
            overlay.classList.remove('hidden');
        }
        console.log('[canvas] WebSocket closed, retrying in 1.5s…');
        setTimeout(connectWS, 1500);
    };

    ws.onerror = () => {};
}

// ---------------------------------------------------------------------------
// 5. WebGL bootstrap  (replaces p5 setup())
// ---------------------------------------------------------------------------

const canvas = document.getElementById('glcanvas');
const gl     = canvas.getContext('webgl');

if (!gl) {
    document.body.innerHTML = '<p style="color:#f88;padding:2rem">WebGL not supported.</p>';
    throw new Error('WebGL not available');
}

/** Compile a single GLSL shader stage. Throws on error with the info log. */
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

/** Link vert + frag into a program. Throws on error. */
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

// Compile and link
const program = createProgram(VERT_SHADER, FRAG_SHADER);

// Full-screen quad: two triangles covering clip-space (-1,-1)→(1,1)
// BL, BR, TL, TR — drawn as TRIANGLE_STRIP
const quadBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1,
     1, -1,
    -1,  1,
     1,  1,
]), gl.STATIC_DRAW);

const aPosition = gl.getAttribLocation(program, 'a_position');
gl.enableVertexAttribArray(aPosition);
gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

/**
 * setUniform — convenience wrapper for gl.uniform1f / uniform2f.
 * Replaces p5's shd.setUniform(name, value).
 * Silently ignores uniforms optimised away by the GLSL compiler.
 */
function setUniform(prog, name, value) {
    const loc = gl.getUniformLocation(prog, name);
    if (loc === null) return;
    if (Array.isArray(value)) {
        if (value.length === 2) gl.uniform2f(loc, value[0], value[1]);
        else if (value.length === 3) gl.uniform3f(loc, value[0], value[1], value[2]);
    } else {
        gl.uniform1f(loc, value);
    }
}

// ---------------------------------------------------------------------------
// 6. render()  (replaces p5 draw())
// ---------------------------------------------------------------------------

const startTime = performance.now();

function render() {
    const elapsed = (performance.now() - startTime) / 1000.0 * params.speed;

    gl.useProgram(program);
    gl.viewport(0, 0, canvas.width, canvas.height);

    // Time & resolution
    setUniform(program, 'u_time',       elapsed);
    setUniform(program, 'u_resolution', [canvas.width, canvas.height]);

    // Color
    setUniform(program, 'u_hue',        params.hue);
    setUniform(program, 'u_saturation', params.saturation);
    setUniform(program, 'u_brightness', params.brightness);

    // Shape
    setUniform(program, 'u_zoom',       params.zoom);
    setUniform(program, 'u_distortion', params.distortion);
    setUniform(program, 'u_rotate',     params.rotate);

    // Pattern
    setUniform(program, 'u_complexity', params.complexity);
    setUniform(program, 'u_symmetry',   params.symmetry);
    setUniform(program, 'u_glow',       params.glow);

    // Toggles
    setUniform(program, 'u_invert',     params.invert);
    setUniform(program, 'u_pulse',      params.pulse);

    // Draw full-screen quad — fragment shader covers every pixel
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    requestAnimationFrame(render);
}

// ---------------------------------------------------------------------------
// 7. resize()  (replaces p5 windowResized())
// ---------------------------------------------------------------------------

/**
 * Syncs canvas.width/height (the WebGL drawing buffer) to its CSS layout size.
 * Uses ResizeObserver on document.body — fires whenever the OS window resizes.
 *
 * canvas.style.width/height are set to 100vw/100vh in CSS and handle stretching.
 * canvas.width/height control the actual pixel resolution of the framebuffer.
 */
function resize() {
    const w = document.body.clientWidth;
    const h = document.body.clientHeight;
    if (canvas.width !== w || canvas.height !== h) {
        canvas.width  = w;
        canvas.height = h;
    }
}

new ResizeObserver(resize).observe(document.body);
resize(); // set size before first frame

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

connectWS();                        // begin WebSocket connection immediately
requestAnimationFrame(render);      // kick off the render loop
