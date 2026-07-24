// =============================================================================
// canvas.js — p5.js WEBGL shader renderer + WebSocket receiver
// =============================================================================
//
// This file does three things:
//   1. Connects to the WebSocket relay and identifies as role="canvas"
//   2. Receives parameter messages and stores them in the `params` object
//   3. Runs a p5.js sketch that renders a GLSL fragment shader, passing the
//      `params` values as uniforms on every frame
//
// GLOSSARY FOR NEW USERS
// ──────────────────────
// uniform    — A GLSL variable that is the same for every pixel in a frame.
//              Think of it as a "setting" you pass from JavaScript to the GPU.
//
// fragment shader — A small GPU program that runs once per pixel.
//                   It receives the UV coordinates (0.0–1.0) of the pixel
//                   and outputs an RGBA colour.
//
// vertex shader — A small GPU program that transforms geometry.
//                 For a full-screen effect like ours, it just passes through
//                 a rectangle covering the whole canvas.
//
// WEBGL mode — p5.js mode where the canvas is rendered by the GPU.
//              Required for shader support.
//
// HOW TO MODIFY THE SHADER
// ─────────────────────────
//   1. Edit the FRAG_SHADER string below.
//   2. Add or remove `uniform` declarations to match your params.
//   3. In draw(), call `shd.setUniform('myUniform', params.myParam)`.
//   4. Add the corresponding control in controls.html + controls.js.
//
// GLSL CHEAT SHEET
// ─────────────────
//   float    — a single decimal number (0.0–1.0)
//   vec2     — two floats (e.g. UV coordinates: x, y)
//   vec3     — three floats (e.g. RGB colour: r, g, b)
//   vec4     — four floats (e.g. RGBA colour: r, g, b, a)
//   sin(x)   — sine wave, returns -1.0 to 1.0
//   cos(x)   — cosine wave, returns -1.0 to 1.0
//   length(v)— distance from origin to point v
//   mod(a,b) — modulo (remainder of a/b)
//   mix(a,b,t)— linearly interpolates between a and b by t (0.0–1.0)
//   clamp(x,mn,mx) — clamps x between mn and mx
//
// =============================================================================

'use strict';

// ---------------------------------------------------------------------------
// WebSocket configuration
// ---------------------------------------------------------------------------

/** Must match PORT in main.rs and WS_URL in controls.js */
const WS_URL = 'ws://127.0.0.1:2727';

// ---------------------------------------------------------------------------
// Shared parameter state
// ---------------------------------------------------------------------------

/**
 * `params` holds the current value of every parameter sent from the controls
 * window. Default values are set here — these are what you see before any
 * slider is moved.
 *
 * The draw() loop reads from this object every frame, so any WebSocket message
 * that updates a value here is reflected in the next rendered frame.
 *
 * HOW TO ADD A PARAMETER:
 *   1. Add a default value here:      params.myParam = 0.5;
 *   2. Add a uniform in FRAG_SHADER:  uniform float myParam;
 *   3. Pass it in draw():             shd.setUniform('myParam', params.myParam);
 *   4. Use it in the shader GLSL:     float v = myParam * something;
 */
const params = {
    // Color
    hue:        180.0,  // Hue rotation in degrees (0–360)
    saturation: 0.8,    // Saturation (0 = grey, 1 = vivid)
    brightness: 1.0,    // Luminance multiplier

    // Shape
    zoom:       1.5,    // Zoom level (larger = zoomed out)
    speed:      0.5,    // Animation speed multiplier
    distortion: 0.3,    // UV warp amount

    // Pattern
    complexity: 4,      // Noise octave count
    symmetry:   3,      // Mirror fold count
    glow:       0.4,    // Radial glow intensity

    // Toggles (booleans stored as numbers: 1.0 = on, 0.0 = off)
    invert:     0.0,    // Colour inversion
    pulse:      1.0,    // Rhythmic brightness pulsation
    rotate:     0.0,    // Slow global rotation
};

// ---------------------------------------------------------------------------
// GLSL shader source
// ---------------------------------------------------------------------------

/**
 * VERTEX SHADER
 * ─────────────
 * This is boilerplate for full-screen 2D effects.
 * It positions a rectangle covering the entire canvas and passes the
 * texture coordinate (vTexCoord) to the fragment shader.
 *
 * You will rarely need to change this.
 */
const VERT_SHADER = `
    // Required by WebGL 1.0 — sets floating point precision
    precision highp float;

    // Built-in p5.js WEBGL attributes (set automatically by p5)
    attribute vec3 aPosition;   // vertex position in 3D space
    attribute vec2 aTexCoord;   // UV coordinate for this vertex (0.0–1.0)

    // Output to fragment shader: the interpolated UV coordinate per pixel
    varying vec2 vTexCoord;

    void main() {
        // Pass the UV coordinate through
        vTexCoord = aTexCoord;

        // Transform position to clip space
        // The 0.0 w-divide trick maps the 3D position to 2D screen coords
        vec4 positionVec4 = vec4(aPosition, 1.0);
        positionVec4.xy = positionVec4.xy * 2.0 - 1.0;
        gl_Position = positionVec4;
    }
`;

/**
 * FRAGMENT SHADER
 * ───────────────
 * This runs once per pixel.
 * Input: vTexCoord — the UV position of this pixel (0.0 = bottom-left, 1.0 = top-right)
 * Output: gl_FragColor — the final RGBA colour of this pixel
 *
 * UNIFORMS EXPECTED:
 *   u_time        — elapsed time in seconds (auto-updated by draw())
 *   u_resolution  — canvas size in pixels (for aspect ratio correction)
 *   u_hue         — hue shift in degrees (0–360)
 *   u_saturation  — colour saturation (0–1)
 *   u_brightness  — brightness multiplier (0–2)
 *   u_zoom        — zoom level (0.5–4)
 *   u_speed       — animation speed (read via u_time * u_speed)
 *   u_distortion  — UV warp strength (0–1)
 *   u_complexity  — number of noise layers (1–8)
 *   u_symmetry    — mirror fold count (1–8)
 *   u_glow        — radial glow intensity (0–1)
 *   u_invert      — colour inversion flag (0.0 or 1.0)
 *   u_pulse       — pulsation enable flag (0.0 or 1.0)
 *   u_rotate      — rotation enable flag (0.0 or 1.0)
 *
 * TO UNDERSTAND THIS SHADER:
 *   - UV coords are centred at (0,0) and scaled by zoom.
 *   - Symmetry folds are applied by reflecting/rotating the UV.
 *   - A distance-based noise function generates the pattern.
 *   - The pattern is colourised using HSB→RGB conversion.
 */
const FRAG_SHADER = `
    precision highp float;

    // ── Uniforms ──────────────────────────────────────────────────────────
    // GLSL ES 1.0 (WebGL1) rule: ALL uniforms must be float or vec/mat types.
    // There are no int uniforms — complexity and symmetry are passed as float
    // and compared using float arithmetic inside the shader.

    uniform float u_time;        // seconds since app start
    uniform vec2  u_resolution;  // canvas size in pixels (for aspect ratio)

    uniform float u_hue;         // hue shift 0.0–360.0
    uniform float u_saturation;  // saturation 0.0–1.0
    uniform float u_brightness;  // brightness multiplier 0.0–2.0

    uniform float u_zoom;        // coordinate scale (larger = zoomed out)
    uniform float u_distortion;  // UV warp strength 0.0–1.0
    uniform float u_rotate;      // rotation enable: 1.0 = on, 0.0 = off

    uniform float u_complexity;  // fBm octave count 1.0–8.0 (used as float threshold)
    uniform float u_symmetry;    // mirror fold count 1.0–8.0
    uniform float u_glow;        // radial glow intensity 0.0–1.0

    uniform float u_invert;      // colour inversion: 1.0 = on, 0.0 = off
    uniform float u_pulse;       // brightness pulse: 1.0 = on, 0.0 = off

    varying vec2 vTexCoord;      // interpolated UV from vertex shader

    // ── HSB → RGB conversion ─────────────────────────────────────────────
    // Standard HSB-to-RGB formula using the "mod hue" trick.
    // h, s, b all in range 0.0–1.0.
    vec3 hsb2rgb(float h, float s, float b) {
        vec3 rgb = clamp(
            abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0,
            0.0, 1.0
        );
        return b * mix(vec3(1.0), rgb, s);
    }

    // ── 2D pseudo-random hash ────────────────────────────────────────────
    // Returns a repeatable pseudo-random float in [0,1] for any vec2 input.
    float hash(vec2 p) {
        p = fract(p * vec2(127.1, 311.7));
        p += dot(p, p + 19.19);
        return fract(p.x * p.y);
    }

    // ── Smooth value noise ───────────────────────────────────────────────
    // Bilinear interpolation over a grid of random values.
    float vnoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f); // Hermite smoothstep
        return mix(
            mix(hash(i),               hash(i + vec2(1.0, 0.0)), u.x),
            mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
            u.y
        );
    }

    // ── Fractal Brownian Motion (fBm) ────────────────────────────────────
    // Sums noise octaves at increasing frequency / decreasing amplitude.
    //
    // IMPORTANT — GLSL ES 1.0 LOOP RESTRICTION:
    // Loop bounds MUST be compile-time constant integers.
    // We cannot write:  for (int i = 0; i < int(u_complexity); i++)
    // Instead we always run 8 iterations and use a float counter fi
    // compared against u_complexity to decide whether to accumulate.
    // This is the standard workaround for dynamic octave counts in WebGL1.
    // fi is declared outside the loop — WebKit's GLSL compiler (WKWebView/Tauri)
    // rejects variable declarations that appear inside a for-loop body when an
    // int loop counter (i) is already in scope. Hoisting fi above the loop fixes
    // the "Unexpected identifier 'fi'" SyntaxError on macOS/Safari/Tauri.
    float fbm(vec2 p) {
        float value     = 0.0;
        float amplitude = 0.5;
        float freq      = 1.0;
        float fi        = 0.0;  // hoisted — declared before the for loop
        for (int i = 0; i < 8; i++) {   // 8 = MAX_OCTAVES (compile-time constant)
            if (fi >= u_complexity) break; // stop once we've done enough octaves
            value     += amplitude * vnoise(p * freq);
            freq      *= 2.0;
            amplitude *= 0.5;
            fi        += 1.0;
        }
        return value;
    }

    // ── 2D rotation matrix ───────────────────────────────────────────────
    mat2 rotate2D(float a) {
        return mat2(cos(a), -sin(a), sin(a), cos(a));
    }

    void main() {
        // ── 1. UV setup ───────────────────────────────────────────────────
        // Centre coordinates at (0,0), correct for aspect ratio, apply zoom.
        vec2 uv = vTexCoord - 0.5;
        uv.x   *= u_resolution.x / u_resolution.y;
        uv     *= u_zoom;

        // ── 2. Optional rotation ──────────────────────────────────────────
        // u_rotate is 0.0 or 1.0, so the angle is either 0 or slowly advancing.
        uv = rotate2D(u_time * 0.15 * u_rotate) * uv;

        // ── 3. Distortion warp ────────────────────────────────────────────
        // Offset UV by noise to create a liquid / warped look.
        float wt = u_time * 0.3;
        vec2 warpUV = uv + u_distortion * 2.0 * vec2(
            fbm(uv + vec2(wt,  0.0)) - 0.5,
            fbm(uv + vec2(0.0, wt )) - 0.5
        );

        // ── 4. Rotational symmetry ────────────────────────────────────────
        // Fold the angle coordinate so the pattern repeats u_symmetry times.
        float ang    = atan(warpUV.y, warpUV.x);
        float radius = length(warpUV);
        float sector = 6.28318 / u_symmetry;
        ang          = mod(ang + 3.14159, sector) - sector * 0.5;
        vec2 symUV   = vec2(cos(ang), sin(ang)) * radius;

        // ── 5. Pattern generation ─────────────────────────────────────────
        // Three fBm passes at different scales and time offsets, blended together.
        float t = u_time * 0.5;
        float pattern =
            fbm(symUV * 2.0 + vec2( t,       t * 0.7)) * 0.5 +
            fbm(symUV * 3.0 + vec2(-t * 0.8, t      )) * 0.3 +
            fbm(symUV * 1.5 + vec2( t * 0.3,-t      )) * 0.2;

        // ── 6. Radial glow ────────────────────────────────────────────────
        // Boost brightness near the centre for a spotlight/halo effect.
        float glowVal = 1.0 + u_glow * (1.0 - smoothstep(0.0, 0.8, radius));
        pattern *= glowVal;

        // ── 7. Brightness pulse ───────────────────────────────────────────
        // Rhythmic brightness oscillation. mix() applies it only when u_pulse=1.
        float pulseVal = 1.0 + 0.15 * sin(u_time * 2.5);
        pattern *= mix(1.0, pulseVal, u_pulse);

        // ── 8. Colour mapping ─────────────────────────────────────────────
        // Drive hue from pattern value + manual hue shift + slow time drift.
        float hue = mod(
            (u_hue / 360.0) + pattern * 0.5 + u_time * 0.05,
            1.0
        );
        vec3 col = hsb2rgb(hue, u_saturation, clamp(pattern * u_brightness, 0.0, 1.5));

        // ── 9. Colour inversion ───────────────────────────────────────────
        col = mix(col, 1.0 - col, u_invert);

        gl_FragColor = vec4(col, 1.0);
    }
`;

// ---------------------------------------------------------------------------
// WebSocket receiver
// ---------------------------------------------------------------------------

/** Elapsed time accumulator — advanced by the WebSocket connection's lifetime
 *  to give a continuously running animation clock independent of reconnects. */
let wsConnected = false;

/**
 * Connects to the WebSocket relay and listens for parameter messages.
 * This runs independently of p5.js — it just updates the `params` object.
 * The p5 draw() loop reads `params` on the next frame automatically.
 */
function connectWS() {
    const overlay = document.getElementById('overlay');

    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
        wsConnected = true;
        if (overlay) {
            overlay.textContent = 'WS: connected';
            // Fade out the status overlay after 2 seconds
            setTimeout(() => overlay.classList.add('hidden'), 2000);
        }
        console.log('[canvas] WebSocket connected');

        // ── Hello handshake ────────────────────────────────────────────────
        // Identify as role="canvas" — the relay uses this to route binary
        // messages (image/audio data) exclusively to canvas-role clients.
        ws.send(JSON.stringify({ type: 'hello', role: 'canvas' }));
    };

    ws.onmessage = (event) => {
        // We only receive text messages (JSON parameter updates)
        if (typeof event.data !== 'string') return;
        try {
            const msg = JSON.parse(event.data);

            // ── Parameter message ──────────────────────────────────────────
            // Format: { "type": "param", "name": "speed", "value": 0.75 }
            //
            // We accept any name/value pair and store it in params.
            // Unknown names are silently ignored by the shader (no uniform set).
            if (msg.type === 'param' && msg.name !== undefined) {
                // Booleans (from checkboxes) are stored as 1.0/0.0 for GLSL
                params[msg.name] = (typeof msg.value === 'boolean')
                    ? (msg.value ? 1.0 : 0.0)
                    : msg.value;
            }
        } catch (e) {
            // Non-JSON or malformed message — ignore
        }
    };

    ws.onclose = (event) => {
        wsConnected = false;
        if (overlay) {
            overlay.textContent = `WS: disconnected (${event.code})`;
            overlay.classList.remove('hidden');
        }
        console.log('[canvas] WebSocket closed, retrying in 1.5s…');
        setTimeout(connectWS, 1500);
    };

    ws.onerror = () => {
        // onerror always precedes onclose — reconnect is handled there
    };
}

// ---------------------------------------------------------------------------
// p5.js sketch
// ---------------------------------------------------------------------------

/**
 * p5.js uses a global function API:
 *   setup()  — called once when the sketch starts
 *   draw()   — called every frame (default 60fps)
 *
 * We use WEBGL mode to enable GPU shader support.
 *
 * KEY PATTERN:
 *   - In setup(), compile the GLSL shader with p5.createShader()
 *   - In draw(), set the uniforms from the `params` object and render
 */

let shd; // The compiled shader program (set in setup)

/**
 * setup() — runs once at startup.
 * Creates the canvas in WEBGL mode and compiles the shader.
 */
function setup() {
    // createCanvas(width, height, WEBGL) — WEBGL is required for shaders
    createCanvas(windowWidth, windowHeight, WEBGL);

    // pixelDensity(1) prevents Retina/HiDPI scaling for consistent performance.
    // Set to window.devicePixelRatio for sharper output on HiDPI screens.
    pixelDensity(1);

    // Compile the vertex + fragment shader pair.
    // p5 returns a p5.Shader object we can pass to shader() in draw().
    shd = createShader(VERT_SHADER, FRAG_SHADER);

    // Disable the p5 default stroke (WebGL mode draws shapes with outlines by default)
    noStroke();

    console.log('[canvas] p5 sketch started');
}

/**
 * draw() — called every frame (~60fps).
 * Reads the current `params` state and passes everything to the GPU as uniforms.
 * Then draws a full-screen rectangle so the fragment shader covers the canvas.
 */
function draw() {
    // Activate our shader for all subsequent drawing operations
    shader(shd);

    // ── Pass uniforms to the shader ────────────────────────────────────────
    //
    // setUniform(name, value) binds a JavaScript value to a GLSL uniform.
    // The name must exactly match the `uniform` declaration in FRAG_SHADER.
    //
    // u_time: Use p5's `millis()` (milliseconds since start) converted to seconds.
    //         The speed param scales the animation rate.
    shd.setUniform('u_time',        (millis() / 1000.0) * params.speed);

    // u_resolution: Canvas size in pixels — used for aspect ratio correction in shader
    shd.setUniform('u_resolution',  [width, height]);

    // Color uniforms
    shd.setUniform('u_hue',         params.hue);
    shd.setUniform('u_saturation',  params.saturation);
    shd.setUniform('u_brightness',  params.brightness);

    // Shape uniforms
    shd.setUniform('u_zoom',        params.zoom);
    shd.setUniform('u_distortion',  params.distortion);
    shd.setUniform('u_rotate',      params.rotate);

    // Pattern uniforms
    shd.setUniform('u_complexity',  params.complexity);
    shd.setUniform('u_symmetry',    params.symmetry);
    shd.setUniform('u_glow',        params.glow);

    // Toggle uniforms (booleans stored as 0.0/1.0)
    shd.setUniform('u_invert',      params.invert);
    shd.setUniform('u_pulse',       params.pulse);

    // ── Draw a full-screen quad ────────────────────────────────────────────
    // rect() in WEBGL mode draws a rectangle centred at (0,0).
    // Width and height match the canvas so the fragment shader covers every pixel.
    rect(-width/2, -height/2, width, height);
}

/**
 * windowResized() — called automatically by p5 when the window is resized.
 * Resizes the canvas to match the new window dimensions.
 */
function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

// Start the WebSocket connection immediately.
// This runs in parallel with p5 — no need to wait for setup().
connectWS();
