"use strict";

// Example 00 intentionally uses one shared JavaScript object. The UI writes to
// params; p5 reads params on the next frame and uploads them as GLSL uniforms.

const DEFAULT_PARAMS = Object.freeze({
  hue: 180,
  saturation: 0.8,
  brightness: 1,
  zoom: 1.5,
  speed: 0.5,
  distortion: 0.3,
  complexity: 4,
  symmetry: 3,
  glow: 0.4,
  invert: 0,
  pulse: 1,
  rotate: 0,
});

const params = { ...DEFAULT_PARAMS };
const SLIDER_IDS = ["hue", "saturation", "brightness", "zoom", "speed", "distortion", "complexity", "symmetry", "glow"];
const TOGGLE_IDS = ["invert", "pulse", "rotate"];

const PRESETS = {
  default: { ...DEFAULT_PARAMS },
  soft: { ...DEFAULT_PARAMS, hue: 202, saturation: 0.48, brightness: 0.9, speed: 0.2, distortion: 0.12, complexity: 3, symmetry: 2, glow: 0.68, rotate: 1 },
  prism: { ...DEFAULT_PARAMS, hue: 312, saturation: 1, brightness: 1.35, zoom: 2.1, speed: 0.9, distortion: 0.7, complexity: 6, symmetry: 7, glow: 0.75, pulse: 1, rotate: 1 },
  mono: { ...DEFAULT_PARAMS, hue: 0, saturation: 0, brightness: 1.25, zoom: 1.1, speed: 0.35, distortion: 0.38, complexity: 5, symmetry: 4, glow: 0.5, pulse: 1 },
};

const VALUE_FORMATTERS = {
  hue: value => `${Math.round(value)}°`,
  speed: value => `${value.toFixed(2)}×`,
  complexity: value => String(Math.round(value)),
  symmetry: value => String(Math.round(value)),
};

let shaderProgram;
let elapsedSeconds = 0;
let animationPaused = false;
let telemetryLastMs = 0;

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

    uniform float u_time;        // accumulated animation seconds, from draw()
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
    float fbm(vec2 p) {
        float value     = 0.0;
        float amplitude = 0.5;
        float freq      = 1.0;
        float fi        = 0.0;          // float iteration counter
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
// p5 renderer
// ---------------------------------------------------------------------------

function setup() {
  const container = document.getElementById("canvas-container");
  const canvas = createCanvas(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight), WEBGL);
  canvas.parent("canvas-container");
  pixelDensity(1);
  noStroke();

  shaderProgram = createShader(VERT_SHADER, FRAG_SHADER);
  updateStatus("Rendering");
  updateCanvasSize();
}

function draw() {
  const safeDelta = Math.min(deltaTime / 1000, 0.1);
  if (!animationPaused) elapsedSeconds += safeDelta * params.speed;

  shader(shaderProgram);
  shaderProgram.setUniform("u_time", elapsedSeconds);
  shaderProgram.setUniform("u_resolution", [width, height]);
  shaderProgram.setUniform("u_hue", params.hue);
  shaderProgram.setUniform("u_saturation", params.saturation);
  shaderProgram.setUniform("u_brightness", params.brightness);
  shaderProgram.setUniform("u_zoom", params.zoom);
  shaderProgram.setUniform("u_distortion", params.distortion);
  shaderProgram.setUniform("u_rotate", params.rotate);
  shaderProgram.setUniform("u_complexity", params.complexity);
  shaderProgram.setUniform("u_symmetry", params.symmetry);
  shaderProgram.setUniform("u_glow", params.glow);
  shaderProgram.setUniform("u_invert", params.invert);
  shaderProgram.setUniform("u_pulse", params.pulse);
  rect(-width / 2, -height / 2, width, height);

  const now = millis();
  if (now - telemetryLastMs > 250) {
    telemetryLastMs = now;
    document.getElementById("fpsReadout").textContent = Math.round(frameRate()).toString();
  }
}

function windowResized() {
  const container = document.getElementById("canvas-container");
  resizeCanvas(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight));
  updateCanvasSize();
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

function formatValue(id, value) {
  return VALUE_FORMATTERS[id]?.(value) ?? value.toFixed(2);
}

function syncControlsFromParams() {
  for (const id of SLIDER_IDS) {
    const input = document.getElementById(id);
    const output = document.getElementById(`${id}-val`);
    input.value = String(params[id]);
    output.textContent = formatValue(id, params[id]);
  }

  for (const id of TOGGLE_IDS) {
    document.getElementById(id).checked = params[id] > 0.5;
  }
}

function applyState(nextState, { resetClock = false } = {}) {
  Object.assign(params, nextState);
  if (resetClock) elapsedSeconds = 0;
  syncControlsFromParams();
}

function resetExample() {
  applyState(DEFAULT_PARAMS, { resetClock: true });
  updateStatus(animationPaused ? "Paused · reset" : "Rendering · reset");
}

function setPaused(paused) {
  animationPaused = paused;
  const button = document.getElementById("pauseBtn");
  const badge = document.getElementById("canvasBadge");
  button.textContent = paused ? "Resume" : "Pause";
  badge.textContent = paused ? "PAUSED" : "RUNNING";
  badge.classList.toggle("paused", paused);
  updateStatus(paused ? "Animation paused" : "Rendering");
}

async function toggleFullscreen() {
  try {
    const isFullscreen = await window.__TAURI__.tauri.invoke("toggle_fullscreen");
    document.getElementById("fullscreenBtn").textContent = isFullscreen ? "Windowed" : "Fullscreen";
  } catch (error) {
    console.error("[junkpile] fullscreen command failed", error);
    updateStatus(`Fullscreen error: ${String(error)}`);
  }
}

function updateStatus(text) {
  const element = document.getElementById("statusText");
  if (element) element.textContent = text;
}

function updateCanvasSize() {
  const element = document.getElementById("sizeReadout");
  if (element && typeof width === "number") element.textContent = `${width} × ${height}`;
}

function wireControls() {
  for (const id of SLIDER_IDS) {
    const input = document.getElementById(id);
    const output = document.getElementById(`${id}-val`);
    input.addEventListener("input", () => {
      params[id] = Number.parseFloat(input.value);
      output.textContent = formatValue(id, params[id]);
    });
  }

  for (const id of TOGGLE_IDS) {
    document.getElementById(id).addEventListener("change", event => {
      params[id] = event.currentTarget.checked ? 1 : 0;
    });
  }

  document.querySelectorAll("[data-preset]").forEach(button => {
    button.addEventListener("click", () => applyState(PRESETS[button.dataset.preset], { resetClock: true }));
  });

  document.getElementById("resetBtn").addEventListener("click", resetExample);
  document.getElementById("pauseBtn").addEventListener("click", () => setPaused(!animationPaused));
  document.getElementById("fullscreenBtn").addEventListener("click", toggleFullscreen);

  window.addEventListener("keydown", event => {
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

    if (event.code === "Space") {
      event.preventDefault();
      setPaused(!animationPaused);
    } else if (event.key.toLowerCase() === "r") {
      resetExample();
    } else if (event.key.toLowerCase() === "f") {
      toggleFullscreen();
    }
  });

  syncControlsFromParams();
}

document.addEventListener("DOMContentLoaded", () => {
  if (typeof window.p5 === "undefined") {
    updateStatus("p5.js missing · run npm install, then npm run dev");
    return;
  }
  wireControls();
});
