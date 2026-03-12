// =============================================================================
// sketch.js — raw WebGL port of the p5.js fBm template
// =============================================================================
//
// WHAT CHANGED vs. THE p5 VERSION
// ─────────────────────────────────
// p5 version:                          This version (raw WebGL):
// ─────────────────────────────────    ──────────────────────────────────────
// createCanvas(w, h, WEBGL)            canvas.getContext('webgl')
// canvas.parent('canvas-container')    <canvas> already in HTML, sized via CSS
// createShader(vert, frag)             compileShader() + linkProgram() manually
// shader(shd) + shd.setUniform(...)    gl.useProgram() + gl.uniform1f(...)
// rect(-w/2, -h/2, w, h)              gl.drawArrays(GL_TRIANGLE_STRIP, 0, 4)
// function draw() { ... }              requestAnimationFrame(render)
// function windowResized() { ... }     ResizeObserver on #canvas-container
// pixelDensity(1)                      canvas.width/height set from container px
//
// WHAT DID NOT CHANGE
// ───────────────────
// • The params{} object — identical keys, identical defaults
// • PARAMS / TOGGLES arrays — identical
// • VERT_SHADER / FRAG_SHADER strings — identical GLSL, not a single line changed
// • wireControls() — identical logic, same DOM ids
// • The 4-step workflow to add a new parameter — identical
//
// STRUCTURE OF THIS FILE
// ──────────────────────
//   1. params{}           — live parameter state, read by render() every frame
//   2. PARAMS / TOGGLES  — input id lists for auto-wiring
//   3. VERT_SHADER        — GLSL vertex shader (full-screen quad)
//   4. FRAG_SHADER        — GLSL fragment shader (fBm fractal noise)
//   5. WebGL bootstrap    — context, shader compile, buffer setup
//   6. render()           — uniform upload + drawArrays, called via rAF
//   7. resize()           — syncs canvas pixel size to CSS layout size
//   8. wireControls()     — connects DOM inputs to params
//
// HOW TO ADD A NEW PARAMETER — COMPLETE CHECKLIST
// ─────────────────────────────────────────────────
//   [ ] 1. Add <input type="range" id="myParam"> in index.html
//   [ ] 2. Add 'myParam' to the PARAMS array below
//   [ ] 3. Add myParam: <default> to the params object below
//   [ ] 4. Add `uniform float u_myParam;` in FRAG_SHADER
//   [ ] 5. Add setUniform(program, 'u_myParam', params.myParam) in render()
//   [ ] 6. Use u_myParam in your GLSL code
//
// =============================================================================

'use strict';

// ---------------------------------------------------------------------------
// 1. Shared parameter state
// ---------------------------------------------------------------------------

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

    // Toggles (0.0 / 1.0 for GLSL uniform compatibility)
    invert:     0.0,
    pulse:      1.0,
    rotate:     0.0,
};

// ---------------------------------------------------------------------------
// 2. Input id lists
// ---------------------------------------------------------------------------

const PARAMS = [
    'hue', 'saturation', 'brightness',
    'zoom', 'speed', 'distortion',
    'complexity', 'symmetry', 'glow',
];

const TOGGLES = ['invert', 'pulse', 'rotate'];

// ---------------------------------------------------------------------------
// 3. GLSL vertex shader  (identical to p5 version)
// ---------------------------------------------------------------------------

const VERT_SHADER = `
    precision highp float;

    attribute vec2 a_position;  // quad corners in clip space (-1..1)

    varying vec2 vTexCoord;

    void main() {
        // Map clip-space (-1..1) to UV (0..1) for the fragment shader
        vTexCoord   = a_position * 0.5 + 0.5;
        gl_Position = vec4(a_position, 0.0, 1.0);
    }
`;

// ---------------------------------------------------------------------------
// 4. GLSL fragment shader  (identical to p5 version)
// ---------------------------------------------------------------------------
//
// GLSL ES 1.0 CONSTRAINTS (WebGL1 — same in raw WebGL and p5 WEBGL mode):
//   • Uniform types must be float/vec/mat — no int or bool uniforms
//   • Loop bounds must be compile-time constant integers
//     Use a float counter + break for dynamic iteration counts (see fbm)
//   • No dynamic array indexing

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
            mix(hash(i),                hash(i + vec2(1.0, 0.0)), u.x),
            mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0, 1.0)), u.x),
            u.y
        );
    }

    // ── Fractal Brownian Motion ───────────────────────────────────────────
    float fbm(vec2 p) {
        float value     = 0.0;
        float amplitude = 0.5;
        float freq      = 1.0;
        float fi        = 0.0;
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
        // 1. Centre UV, correct aspect ratio, apply zoom
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

        // 9. Optional inversion
        col = mix(col, 1.0 - col, u_invert);

        gl_FragColor = vec4(col, 1.0);
    }
`;

// ---------------------------------------------------------------------------
// 5. WebGL bootstrap
// ---------------------------------------------------------------------------

const canvas = document.getElementById('glcanvas');
const gl     = canvas.getContext('webgl');

if (!gl) {
    document.body.innerHTML = '<p style="color:#f88;padding:2rem">WebGL not supported.</p>';
    throw new Error('WebGL not available');
}

/**
 * compileShader — compile a single GLSL shader stage.
 * In p5, createShader() did this internally. Here we do it explicitly.
 */
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

/**
 * createProgram — link vert + frag into a program.
 * Equivalent to p5's createShader() return value.
 */
function createProgram(vertSrc, fragSrc) {
    const program = gl.createProgram();
    gl.attachShader(program, compileShader(gl.VERTEX_SHADER,   vertSrc));
    gl.attachShader(program, compileShader(gl.FRAGMENT_SHADER, fragSrc));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const info = gl.getProgramInfoLog(program);
        gl.deleteProgram(program);
        throw new Error('Program link error:\n' + info);
    }
    return program;
}

// Compile shaders and link program
const program = createProgram(VERT_SHADER, FRAG_SHADER);

/**
 * Full-screen quad: two triangles covering clip space (-1,-1) → (1,1).
 * In p5, rect(-w/2, -h/2, w, h) did this. Here we set it up once in a buffer.
 *
 * TRIANGLE_STRIP with 4 verts: BL, BR, TL, TR
 */
const quadBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1,   // bottom-left
     1, -1,   // bottom-right
    -1,  1,   // top-left
     1,  1,   // top-right
]), gl.STATIC_DRAW);

// Point the a_position attribute at the buffer
const aPosition = gl.getAttribLocation(program, 'a_position');
gl.enableVertexAttribArray(aPosition);
gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

/**
 * setUniform — convenience wrapper for gl.uniform1f / uniform2f.
 * Replaces p5's shd.setUniform(name, value).
 */
function setUniform(prog, name, value) {
    const loc = gl.getUniformLocation(prog, name);
    if (loc === null) return; // uniform optimised away by GLSL compiler — safe to ignore
    if (Array.isArray(value)) {
        if (value.length === 2) gl.uniform2f(loc, value[0], value[1]);
        else if (value.length === 3) gl.uniform3f(loc, value[0], value[1], value[2]);
    } else {
        gl.uniform1f(loc, value);
    }
}

// ---------------------------------------------------------------------------
// 6. render() — called every frame via requestAnimationFrame
// ---------------------------------------------------------------------------

/**
 * The equivalent of p5's draw() function.
 *
 * p5 draw():                           render():
 *   shader(shd)                          gl.useProgram(program)
 *   shd.setUniform('u_time', ...)        setUniform(program, 'u_time', ...)
 *   rect(...)                            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
 */
let startTime = performance.now();

function render() {
    const elapsed = (performance.now() - startTime) / 1000.0 * params.speed;

    gl.useProgram(program);

    // Sync canvas pixel dimensions to its CSS layout size (handles resize)
    // This is what p5's windowResized() + resizeCanvas() did automatically.
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

    // Draw full-screen quad — the fragment shader covers every pixel
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    requestAnimationFrame(render);
}

// ---------------------------------------------------------------------------
// 7. resize() — syncs canvas pixel size to its CSS layout size
// ---------------------------------------------------------------------------

/**
 * p5 handled this automatically via windowResized() + resizeCanvas().
 * In raw WebGL we use a ResizeObserver on the container div, then set
 * canvas.width / canvas.height to match the container's pixel size.
 *
 * We do NOT use canvas.style.width/height for this — those are set to
 * 100%/100% in CSS and just stretch the element. canvas.width/height
 * control the actual WebGL drawing buffer resolution.
 */
function resize(container) {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (canvas.width !== w || canvas.height !== h) {
        canvas.width  = w;
        canvas.height = h;
    }
}

const container = document.getElementById('canvas-container');
new ResizeObserver(() => resize(container)).observe(container);
resize(container); // initial size before first frame

// ---------------------------------------------------------------------------
// 8. wireControls() — identical logic to the p5 version
// ---------------------------------------------------------------------------

function wireControls() {
    PARAMS.forEach(id => {
        const input = document.getElementById(id);
        const valEl = document.getElementById(`${id}-val`);
        if (!input) { console.warn(`[sketch] missing param input: "${id}"`); return; }

        input.addEventListener('input', () => {
            const val = parseFloat(input.value);
            params[id] = val;
            if (valEl) {
                valEl.textContent = Number.isInteger(val) ? val.toString() : val.toFixed(2);
            }
        });
    });

    TOGGLES.forEach(id => {
        const input = document.getElementById(id);
        if (!input) { console.warn(`[sketch] missing toggle input: "${id}"`); return; }

        input.addEventListener('change', () => {
            params[id] = input.checked ? 1.0 : 0.0;
        });
    });
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
    wireControls();
    requestAnimationFrame(render); // kick off the render loop
});
