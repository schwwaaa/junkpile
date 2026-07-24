// =============================================================================
// shader.frag — default fBm fractal noise fragment shader
// =============================================================================
//
// This file is loaded at runtime via fetch() by canvas.js / sketch.js.
// To swap the shader: replace this file's contents, or (in the WS template)
// load a new .frag file in the controls window and send it over WebSocket.
//
// UNIFORMS EXPECTED BY THE RENDER LOOP
// ──────────────────────────────────────
//   u_time        — elapsed seconds (scaled by params.speed)
//   u_resolution  — canvas size in pixels [width, height]
//   u_hue         — hue shift 0.0–360.0
//   u_saturation  — saturation 0.0–1.0
//   u_brightness  — brightness multiplier 0.0–2.0
//   u_zoom        — coordinate scale 0.5–4.0
//   u_distortion  — UV warp strength 0.0–1.0
//   u_rotate      — rotation on/off 0.0 or 1.0
//   u_complexity  — fBm octave count 1.0–8.0
//   u_symmetry    — mirror fold count 1.0–8.0
//   u_glow        — radial glow intensity 0.0–1.0
//   u_invert      — colour inversion 0.0 or 1.0
//   u_pulse       — brightness pulse 0.0 or 1.0
//
// GLSL ES 1.0 / WKWebView RULES
// ───────────────────────────────
// • All uniforms must be float/vec/mat — no int or bool uniform types
// • Loop bounds must be compile-time constant integers
// • Declare ALL variables before any for loop in the same scope block —
//   WebKit's strict parser rejects declarations after a for-loop opener
//   (the 'fi' hoist pattern used in fbm() below)
//
// =============================================================================

precision highp float;

// ── Uniforms ──────────────────────────────────────────────────────────────────
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

// ── HSB → RGB ──────────────────────────────────────────────────────────────
vec3 hsb2rgb(float h, float s, float b) {
    vec3 rgb = clamp(
        abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0,
        0.0, 1.0
    );
    return b * mix(vec3(1.0), rgb, s);
}

// ── Pseudo-random hash ─────────────────────────────────────────────────────
float hash(vec2 p) {
    p  = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
}

// ── Smooth value noise ─────────────────────────────────────────────────────
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

// ── Fractal Brownian Motion ────────────────────────────────────────────────
// fi is declared before the for loop — WebKit's GLSL parser rejects variable
// declarations inside a loop body when an int counter (i) is already in scope.
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

// ── 2D rotation matrix ─────────────────────────────────────────────────────
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

    // 9. Optional colour inversion
    col = mix(col, 1.0 - col, u_invert);

    gl_FragColor = vec4(col, 1.0);
}
