// =============================================================================
// sketch.js — params object · GLSL shaders · p5 setup/draw · UI wiring
// =============================================================================
//
// HOW THIS DIFFERS FROM THE TWO-WINDOW TEMPLATE
// ──────────────────────────────────────────────
// Two-window:    slider → WebSocket → Rust relay → WebSocket → params → draw()
// Single-window: slider → params → draw()
//
// Because the controls panel and the p5 canvas share the same JavaScript
// context (the same HTML page), a slider's input handler can write directly
// into the `params` object. The draw() loop reads it on the next frame.
// No network, no relay, no async messaging required.
//
// STRUCTURE OF THIS FILE
// ──────────────────────
//   1. params{}        — live parameter state, read by draw() every frame
//   2. PARAMS / TOGGLES — lists of input ids for auto-wiring
//   3. VERT_SHADER     — GLSL vertex shader (boilerplate, rarely changed)
//   4. FRAG_SHADER     — GLSL fragment shader (this is where your art lives)
//   5. p5 sketch       — setup() and draw()
//   6. wireControls()  — connects DOM inputs to params
//
// HOW TO ADD A NEW PARAMETER — COMPLETE CHECKLIST
// ─────────────────────────────────────────────────
//   [ ] 1. Add <input type="range" id="myParam"> in index.html
//   [ ] 2. Add 'myParam' to the PARAMS array below
//   [ ] 3. Add myParam: <default> to the params object below
//   [ ] 4. Add `uniform float u_myParam;` in FRAG_SHADER
//   [ ] 5. Add shd.setUniform('u_myParam', params.myParam) in draw()
//   [ ] 6. Use u_myParam in your GLSL code
//
// =============================================================================

'use strict';

// ---------------------------------------------------------------------------
// 1. Shared parameter state
// ---------------------------------------------------------------------------

/**
 * `params` is the single source of truth for all visual parameters.
 *
 * The controls panel writes into this object on every slider move.
 * The draw() loop reads from it on every frame.
 * No synchronisation is needed because everything runs on the same JS thread.
 *
 * Default values here are what's shown before the user touches any slider.
 * They should match the `value` attributes on the HTML inputs.
 */
const params = {
    // Color
    hue:        180.0,  // Hue rotation in degrees (0–360)
    saturation: 0.8,    // Colour saturation (0 = grey, 1 = vivid)
    brightness: 1.0,    // Overall brightness multiplier

    // Shape
    zoom:       1.5,    // Coordinate zoom (larger = zoomed out)
    speed:      0.5,    // Animation speed multiplier
    distortion: 0.3,    // UV warp amount

    // Pattern
    complexity: 4.0,    // fBm octave count (1–8)
    symmetry:   3.0,    // Rotational mirror folds (1–8)
    glow:       0.4,    // Radial glow intensity

    // Toggles stored as 0.0/1.0 for direct GLSL uniform use
    invert:     0.0,    // 1.0 = invert colour palette
    pulse:      1.0,    // 1.0 = enable brightness pulsation
    rotate:     0.0,    // 1.0 = enable slow global rotation
};

// ---------------------------------------------------------------------------
// 2. Input id lists (used by wireControls)
// ---------------------------------------------------------------------------

/**
 * PARAMS: ids of all <input type="range"> sliders.
 * Values are read as parseFloat and written directly to params[id].
 *
 * To add a slider: add the id here AND add the default to params{} above.
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
 * TOGGLES: ids of all <input type="checkbox"> controls.
 * Values are written as 1.0 (checked) or 0.0 (unchecked) for GLSL compatibility.
 */
const TOGGLES = [
    'invert',
    'pulse',
    'rotate',
];

// ---------------------------------------------------------------------------
// 3. GLSL vertex shader
// ---------------------------------------------------------------------------

/**
 * Standard full-screen quad vertex shader.
 * Passes UV coordinates to the fragment shader.
 * You will almost never need to modify this.
 *
 * p5.js WEBGL provides:
 *   aPosition  — vertex position (3D)
 *   aTexCoord  — UV coordinate for this vertex (0.0–1.0)
 *
 * We output:
 *   vTexCoord  — interpolated UV per pixel (received in frag shader)
 */
const VERT_SHADER = `
    precision highp float;

    attribute vec3 aPosition;
    attribute vec2 aTexCoord;

    varying vec2 vTexCoord;

    void main() {
        vTexCoord = aTexCoord;
        vec4 pos  = vec4(aPosition, 1.0);
        pos.xy    = pos.xy * 2.0 - 1.0;
        gl_Position = pos;
    }
`;

// ---------------------------------------------------------------------------
// 4. GLSL fragment shader
// ---------------------------------------------------------------------------

/**
 * The fragment shader runs once per pixel, every frame.
 *
 * Input:  vTexCoord — UV position of this pixel (0.0 = bottom-left, 1.0 = top-right)
 * Output: gl_FragColor — the RGBA colour of this pixel
 *
 * GLSL ES 1.0 CONSTRAINTS (WebGL1 / Tauri's WKWebView)
 * ──────────────────────────────────────────────────────
 * • All uniforms must be float or float-vector/matrix types (no int/bool uniforms)
 * • Loop bounds MUST be compile-time constant integers — you cannot write
 *   `for (int i = 0; i < int(u_complexity); i++)`. Instead, always loop the
 *   maximum number of iterations and use a float counter to break early.
 *   See the fbm() function below for the canonical pattern.
 * • No dynamic indexing of arrays
 *
 * READING GUIDE
 * ─────────────
 * The shader pipeline for each pixel:
 *   UV coords → centre & zoom → optional rotation → distortion warp
 *   → symmetry fold → fractal noise pattern → glow → pulse → HSB colour → output
 */
const FRAG_SHADER = `
    precision highp float;

    // ── Uniforms ──────────────────────────────────────────────────────────
    // All declared as float — GLSL ES 1.0 has no int/bool uniform types.

    uniform float u_time;        // seconds (millis()/1000 * speed, from draw())
    uniform vec2  u_resolution;  // canvas size in pixels

    uniform float u_hue;         // hue shift 0.0–360.0
    uniform float u_saturation;  // saturation 0.0–1.0
    uniform float u_brightness;  // brightness multiplier 0.0–2.0

    uniform float u_zoom;        // coordinate scale
    uniform float u_distortion;  // warp amount 0.0–1.0
    uniform float u_rotate;      // rotation: 0.0 = off, 1.0 = on

    uniform float u_complexity;  // octave count 1.0–8.0 (float threshold, see fbm)
    uniform float u_symmetry;    // fold count 1.0–8.0
    uniform float u_glow;        // radial glow 0.0–1.0

    uniform float u_invert;      // 0.0 = normal, 1.0 = invert
    uniform float u_pulse;       // 0.0 = off, 1.0 = pulse

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
    // GLSL ES 1.0 LOOP PATTERN:
    //   Loop bound must be a compile-time constant (8 here = MAX_OCTAVES).
    //   We use a float counter compared against u_complexity to break early.
    //   This is the standard workaround for dynamic octave counts in WebGL1.
    // fi is hoisted before the for loop — WebKit's GLSL compiler rejects
    // variable declarations inside a for-loop body when int counter i is in scope.
    float fbm(vec2 p) {
        float value     = 0.0;
        float amplitude = 0.5;
        float freq      = 1.0;
        float fi        = 0.0;          // hoisted — must be before the for loop
        for (int i = 0; i < 8; i++) {  // 8 = compile-time constant MAX
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

        // 2. Optional slow rotation (u_rotate = 0.0 → no effect)
        uv = rotate2D(u_time * 0.15 * u_rotate) * uv;

        // 3. Domain warp — perturb UV with noise for a liquid look
        float wt = u_time * 0.3;
        vec2 warpUV = uv + u_distortion * 2.0 * vec2(
            fbm(uv + vec2(wt,  0.0)) - 0.5,
            fbm(uv + vec2(0.0, wt )) - 0.5
        );

        // 4. Rotational symmetry — fold the angle into one sector
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

        // 6. Radial glow — brighten the centre
        pattern *= 1.0 + u_glow * (1.0 - smoothstep(0.0, 0.8, radius));

        // 7. Rhythmic brightness pulse (mix applies it only when u_pulse = 1.0)
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
// 5. p5.js sketch
// ---------------------------------------------------------------------------

let shd; // compiled shader (set in setup, used in draw)

/**
 * setup() — runs once at startup.
 *
 * KEY DIFFERENCE from the two-window template:
 *   canvas.parent('canvas-container') tells p5 to append the <canvas> element
 *   to #canvas-container (the right column div) instead of document.body.
 *   This is what keeps the canvas inside the layout column.
 */
function setup() {
    // Get the container's current pixel size for the initial canvas dimensions
    const container = document.getElementById('canvas-container');
    const w = container.clientWidth;
    const h = container.clientHeight;

    // Create the canvas and attach it to the right-column container
    const cnv = createCanvas(w, h, WEBGL);
    cnv.parent('canvas-container');

    pixelDensity(1); // 1 = consistent performance; use devicePixelRatio for HiDPI

    shd = createShader(VERT_SHADER, FRAG_SHADER);
    noStroke();

    console.log('[sketch] p5 started — canvas:', w, '×', h);
}

/**
 * draw() — called every frame (~60fps).
 * Reads params, passes them to the shader as uniforms, renders.
 *
 * This is the only place that reads `params`. No other synchronisation needed.
 */
function draw() {
    shader(shd);

    // Time — millis() / 1000 gives seconds; speed scales the animation rate
    shd.setUniform('u_time',       (millis() / 1000.0) * params.speed);
    shd.setUniform('u_resolution', [width, height]);

    // Color
    shd.setUniform('u_hue',        params.hue);
    shd.setUniform('u_saturation', params.saturation);
    shd.setUniform('u_brightness', params.brightness);

    // Shape
    shd.setUniform('u_zoom',       params.zoom);
    shd.setUniform('u_distortion', params.distortion);
    shd.setUniform('u_rotate',     params.rotate);

    // Pattern
    shd.setUniform('u_complexity', params.complexity);
    shd.setUniform('u_symmetry',   params.symmetry);
    shd.setUniform('u_glow',       params.glow);

    // Toggles
    shd.setUniform('u_invert',     params.invert);
    shd.setUniform('u_pulse',      params.pulse);

    // Full-screen quad — the fragment shader covers every pixel
    rect(-width / 2, -height / 2, width, height);
}

/**
 * windowResized() — p5 calls this automatically when the OS window resizes.
 * Resizes the canvas to match the new container size.
 */
function windowResized() {
    const container = document.getElementById('canvas-container');
    resizeCanvas(container.clientWidth, container.clientHeight);
}

// ---------------------------------------------------------------------------
// 6. UI wiring — connect DOM inputs directly to params
// ---------------------------------------------------------------------------

/**
 * wireControls() wires all sliders and checkboxes to write their values
 * into `params` on every change.
 *
 * This is the key architectural simplification vs. the two-window template:
 * instead of sending a WebSocket message, the handler just does:
 *   params[id] = parseFloat(input.value);
 * The next draw() call (≤16ms away) picks it up automatically.
 */
function wireControls() {
    // ── Sliders ──────────────────────────────────────────────────────────
    PARAMS.forEach(id => {
        const input = document.getElementById(id);
        const valEl = document.getElementById(`${id}-val`);

        if (!input) {
            console.warn(`[sketch] no element found for param id: "${id}"`);
            return;
        }

        input.addEventListener('input', () => {
            const val = parseFloat(input.value);

            // Write directly into shared params — draw() reads it next frame
            params[id] = val;

            // Update the value display span
            if (valEl) {
                valEl.textContent = Number.isInteger(val)
                    ? val.toString()
                    : val.toFixed(2);
            }
        });
    });

    // ── Checkboxes ───────────────────────────────────────────────────────
    TOGGLES.forEach(id => {
        const input = document.getElementById(id);
        if (!input) {
            console.warn(`[sketch] no element found for toggle id: "${id}"`);
            return;
        }

        input.addEventListener('change', () => {
            // Store as 1.0/0.0 so it can be used directly in GLSL uniforms
            params[id] = input.checked ? 1.0 : 0.0;
        });
    });
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

// Wire controls as soon as the DOM is ready.
// p5's setup() runs separately — both can happen in either order safely,
// because setup() only reads params at draw time, not at setup time.
document.addEventListener('DOMContentLoaded', wireControls);
