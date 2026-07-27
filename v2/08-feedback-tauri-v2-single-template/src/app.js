"use strict";

// Junkpile Example 08 — Feedback Lab Single Window
//
// Camera texture + previous feedback texture
//   → simulation program writes the next persistent state
//   → display program maps that state to a palette
//   → ping-pong targets exchange read/write roles

const DEFAULTS = Object.freeze({
  mode: 0,
  decay: 0.97,
  camMix: 0.3,
  speed: 1,
  scale: 1,
  intensity: 1,
  hue: 0,
  palette: 0,
  brush: 0.03,
});

const MODE_NAMES = Object.freeze([
  "Echo Trail",
  "Fluid Smear",
  "Reaction-Diffusion",
  "Thermal",
  "Mirror Echo",
  "Glitch Memory",
]);

const MODE_DESCRIPTIONS = Object.freeze([
  "The previous frame decays while the current webcam frame is injected, producing persistent motion trails.",
  "Webcam edges stir a curl-noise flow field, advecting stored pixels like a fluid.",
  "Webcam luminance continuously injects the V activator into a Gray-Scott reaction-diffusion state.",
  "Camera brightness acts as heat while a nine-tap neighborhood diffuses energy through the stored frame.",
  "A six-sector camera fold and a slightly contracting previous-frame lookup build a rotating live mandala.",
  "Block-shifted feedback and chromatic camera offsets accumulate a persistent VHS-like memory.",
]);

const PALETTE_NAMES = Object.freeze(["Fire", "Ice", "Acid", "Void", "Rainbow"]);
const RANGE_IDS = Object.freeze(["decay", "camMix", "speed", "scale", "intensity", "hue", "palette", "brush"]);
const params = { ...DEFAULTS };

const VERTEX_SHADER_SOURCE = `
    precision highp float;
    attribute vec2 a_position;
    varying   vec2 v_uv;
    void main() { v_uv = a_position*0.5+0.5; gl_Position = vec4(a_position,0.0,1.0); }
`;
const SIMULATION_FRAGMENT_SHADER_SOURCE = `
    precision highp float;

    uniform sampler2D u_prev;       // ← THE ping-pong texture: last frame's output
    uniform sampler2D u_webcam;     // ← live camera frame uploaded every tick

    uniform float u_time;
    uniform vec2  u_res;
    uniform int   u_mode;
    uniform float u_decay;
    uniform float u_camMix;         // how strongly webcam bleeds into prev each frame
    uniform float u_speed;
    uniform float u_scale;
    uniform float u_intensity;

    uniform vec2  u_mouse;
    uniform float u_mouseDown;
    uniform float u_brushSize;
    uniform float u_clearFlag;

    varying vec2 v_uv;

    // ── Helpers ────────────────────────────────────────────────────────────
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
    float hash(float n) { return fract(sin(n)*43758.5453); }

    float noise(vec2 p) {
        vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y);
    }

    vec2 curl(vec2 p, float t) {
        float e=0.01;
        float n1=noise(p+vec2(0,e)+t*0.1), n2=noise(p-vec2(0,e)+t*0.1);
        float n3=noise(p+vec2(e,0)+t*0.13),n4=noise(p-vec2(e,0)+t*0.13);
        return vec2((n1-n2)/(2.0*e), -(n3-n4)/(2.0*e));
    }

    float luma(vec3 c) { return dot(c, vec3(0.299,0.587,0.114)); }

    // Sobel on webcam — gives edge map used by Fluid mode
    float edges(vec2 uv) {
        vec2 px = 1.0/u_res;
        float gx =
            -luma(texture2D(u_webcam,uv+vec2(-px.x,-px.y)).rgb) +
             luma(texture2D(u_webcam,uv+vec2( px.x,-px.y)).rgb) +
          -2.0*luma(texture2D(u_webcam,uv+vec2(-px.x, 0.0)).rgb) +
           2.0*luma(texture2D(u_webcam,uv+vec2( px.x, 0.0)).rgb) +
            -luma(texture2D(u_webcam,uv+vec2(-px.x, px.y)).rgb) +
             luma(texture2D(u_webcam,uv+vec2( px.x, px.y)).rgb);
        float gy =
            -luma(texture2D(u_webcam,uv+vec2(-px.x,-px.y)).rgb) +
          -2.0*luma(texture2D(u_webcam,uv+vec2( 0.0,-px.y)).rgb) +
            -luma(texture2D(u_webcam,uv+vec2( px.x,-px.y)).rgb) +
             luma(texture2D(u_webcam,uv+vec2(-px.x, px.y)).rgb) +
           2.0*luma(texture2D(u_webcam,uv+vec2( 0.0, px.y)).rgb) +
             luma(texture2D(u_webcam,uv+vec2( px.x, px.y)).rgb);
        return clamp(sqrt(gx*gx+gy*gy)*3.0, 0.0, 1.0);
    }

    // ── Mode 0: Echo Trail ─────────────────────────────────────────────────
    // Simplest possible feedback. prev fades, webcam bleeds in.
    // Reveals the core idea: without u_prev, there are no trails.
    vec4 modeEcho(vec2 uv) {
        vec3 prev = texture2D(u_prev, uv).rgb * u_decay;
        vec3 cam  = texture2D(u_webcam, uv).rgb;
        // Mirror webcam horizontally (feels more natural for self-view)
        cam = texture2D(u_webcam, vec2(1.0-uv.x, uv.y)).rgb;
        return vec4(prev + cam * u_camMix * u_intensity, 1.0);
    }

    // ── Mode 1: Fluid Smear ────────────────────────────────────────────────
    // prev is advected through a curl field. Webcam edge magnitude modulates
    // flow strength — your moving edges stir the fluid harder.
    vec4 modeFluid(vec2 uv) {
        float t    = u_time * 0.3;
        float edge = edges(uv);
        vec2  flow = curl(uv * u_scale * 3.0, t) * (0.003 + edge * 0.006) * u_speed;
        vec3  prev = texture2D(u_prev, uv + flow).rgb * u_decay;
        vec3  cam  = texture2D(u_webcam, vec2(1.0-uv.x, uv.y)).rgb;
        // Inject webcam into the flowing prev
        prev += cam * u_camMix * u_intensity;
        // Slight hue drift gives rainbow advection trails
        prev = mix(prev, prev.gbr * 0.5 + prev * 0.5, 0.008 * u_intensity);
        return vec4(prev, 1.0);
    }

    // ── Mode 2: Reaction-Diffusion (Gray-Scott) ────────────────────────────
    // U+V chemicals in R+G. Webcam luminance injects V every frame →
    // bright parts of the image continuously seed the activator,
    // so coral/spots grow from your face and hands.
    vec4 modeReactDiff(vec2 uv) {
        vec2 px  = 1.0/u_res;
        vec4 cur = texture2D(u_prev, uv);
        float U  = cur.r, V = cur.g;

        // Laplacian
        float lapU = -U, lapV = -V;
        lapU += 0.2*texture2D(u_prev,uv+vec2( px.x,0)).r;
        lapU += 0.2*texture2D(u_prev,uv+vec2(-px.x,0)).r;
        lapU += 0.2*texture2D(u_prev,uv+vec2(0, px.y)).r;
        lapU += 0.2*texture2D(u_prev,uv+vec2(0,-px.y)).r;
        lapV += 0.2*texture2D(u_prev,uv+vec2( px.x,0)).g;
        lapV += 0.2*texture2D(u_prev,uv+vec2(-px.x,0)).g;
        lapV += 0.2*texture2D(u_prev,uv+vec2(0, px.y)).g;
        lapV += 0.2*texture2D(u_prev,uv+vec2(0,-px.y)).g;

        float f=0.0545, k=0.062, Du=0.21, Dv=0.105, dt=u_speed;
        float uvv = U*V*V;
        float newU = clamp(U + dt*(Du*lapU - uvv + f*(1.0-U)), 0.0, 1.0);
        float newV = clamp(V + dt*(Dv*lapV + uvv - (f+k)*V),  0.0, 1.0);

        // Webcam luminance continuously injects V (activator)
        float camLum = luma(texture2D(u_webcam, vec2(1.0-uv.x, uv.y)).rgb);
        newV = max(newV, camLum * u_camMix * 0.7);
        newU = max(0.0, newU - camLum * u_camMix * 0.3);

        return vec4(newU, newV, cur.b, 1.0);
    }

    // ── Mode 3: Thermal ────────────────────────────────────────────────────
    // Webcam brightness = ongoing heat source.
    // Heat diffuses from you outward, leaving glowing halos.
    vec4 modeThermal(vec2 uv) {
        vec2 px = 1.0/u_res;
        vec3 cur = texture2D(u_prev, uv).rgb;

        // 9-tap diffusion
        vec3 diff = vec3(0.0); float wt = 0.0;
        for (int dy=-1; dy<=1; dy++) {
            for (int dx=-1; dx<=1; dx++) {
                float w = (dx==0&&dy==0) ? 4.0 : 1.0;
                diff   += w * texture2D(u_prev, uv+vec2(float(dx),float(dy))*px).rgb;
                wt     += w;
            }
        }
        diff /= wt;

        vec3 state = mix(cur, diff, 0.15*u_speed) * u_decay;

        // Webcam is a heat source — bright pixels keep warm
        float heat = luma(texture2D(u_webcam, vec2(1.0-uv.x, uv.y)).rgb);
        state += heat * u_camMix * u_intensity * vec3(0.9, 0.5, 0.2);

        // Supersaturation bloom on hottest areas
        float lum = luma(state);
        state += state * lum * 0.04 * u_intensity;

        return vec4(state, 1.0);
    }

    // ── Mode 4: Mirror Echo ────────────────────────────────────────────────
    // Webcam through 6-fold symmetry fold, accumulated via feedback.
    // The mandala builds from whatever you do — without u_prev it's
    // just a static kaleidoscope; feedback makes it evolve.
    vec4 modeMirror(vec2 uv) {
        vec2  c  = uv - 0.5;
        float r  = length(c);
        float th = atan(c.y, c.x) + u_time * 0.004;

        float N   = 6.0;
        float sec = 3.14159*2.0/N;
        th  = mod(th, sec);
        if (th > sec*0.5) th = sec-th;

        // Sample webcam through the fold
        vec2  camUV = vec2(cos(th),sin(th))*r + 0.5;
        vec3  cam   = texture2D(u_webcam, camUV).rgb;

        // Also fold the prev frame lookup with a slight zoom spiral
        vec2  prevUV = vec2(cos(th),sin(th)) * r*(1.0-0.002*u_speed) + 0.5;
        vec3  prev   = texture2D(u_prev, prevUV).rgb * u_decay;

        return vec4(prev + cam * u_camMix * u_intensity, 1.0);
    }

    // ── Mode 5: Glitch Memory ──────────────────────────────────────────────
    // Block-shifted prev frame + webcam with chromatic split.
    // The accumulated ghost of you glitches and persists.
    vec4 modeGlitch(vec2 uv) {
        float t     = floor(u_time * 4.0);
        float bw    = 1.0/12.0, bh = 1.0/8.0;
        vec2  block = floor(uv/vec2(bw,bh));

        float rnd  = hash(block + t*0.17);
        float rnd2 = hash(block*3.7 + t*0.31);
        float isG  = step(0.75, rnd);
        float dx   = (rnd -0.5)*0.08*isG*u_intensity;
        float dy   = (rnd2-0.5)*0.04*isG*u_intensity;

        // Prev frame with block offsets + chromatic aberration
        float pr = texture2D(u_prev, uv+vec2(dx*1.1,dy)).r;
        float pg = texture2D(u_prev, uv+vec2(dx,    dy)).g;
        float pb = texture2D(u_prev, uv+vec2(dx*0.9,dy)).b;
        vec3  prev = vec3(pr,pg,pb) * u_decay;

        // Webcam injected with matching aberration
        vec3 cam = texture2D(u_webcam, vec2(1.0-uv.x+dx*0.5, uv.y)).rgb;
        return vec4(prev + cam * u_camMix * u_intensity, 1.0);
    }

    // ── Main ──────────────────────────────────────────────────────────────
    void main() {
        if (u_clearFlag > 0.5) {
            // React-diff needs U=1 initial state
            gl_FragColor = (u_mode == 2) ? vec4(1,0,0,1) : vec4(0,0,0,1);
            return;
        }

        vec2 uv = v_uv;
        vec4 state;

        if      (u_mode == 0) state = modeEcho(uv);
        else if (u_mode == 1) state = modeFluid(uv);
        else if (u_mode == 2) state = modeReactDiff(uv);
        else if (u_mode == 3) state = modeThermal(uv);
        else if (u_mode == 4) state = modeMirror(uv);
        else                  state = modeGlitch(uv);

        // Mouse brush injection
        if (u_mouseDown > 0.5) {
            float d = length(uv - u_mouse) / u_brushSize;
            float g = exp(-d*d*3.0);
            if (u_mode == 2) {
                state.g = max(state.g, g * 0.9);
                state.r = max(0.0, state.r - g * 0.5);
            } else {
                float hc = u_time * 0.4;
                vec3 col = vec3(0.5+0.5*sin(hc), 0.5+0.5*sin(hc+2.094), 0.5+0.5*sin(hc+4.189));
                state.rgb += col * g * u_intensity;
            }
        }

        gl_FragColor = clamp(state, 0.0, 2.0);
    }
`;
const DISPLAY_FRAGMENT_SHADER_SOURCE = `
    precision highp float;
    uniform sampler2D u_fbo;
    uniform int   u_mode;
    uniform float u_hue;
    uniform int   u_palette;
    uniform float u_time;
    varying vec2 v_uv;

    vec3 pal(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
        return a + b*cos(6.28318*(c*t+d));
    }
    vec3 applyPalette(float t, int p) {
        t = fract(t+0.0001);
        if (p==0) return pal(t, vec3(0.8,0.3,0.1), vec3(0.6,0.4,0.1), vec3(1.0,0.8,0.5), vec3(0.0,0.2,0.4));
        if (p==1) return pal(t, vec3(0.2,0.4,0.8), vec3(0.3,0.3,0.5), vec3(1.0,1.0,1.0), vec3(0.0,0.3,0.6));
        if (p==2) return pal(t, vec3(0.1,0.8,0.2), vec3(0.4,0.6,0.1), vec3(0.8,1.0,0.5), vec3(0.3,0.0,0.5));
        if (p==3) return pal(t, vec3(0.1,0.0,0.3), vec3(0.5,0.2,0.6), vec3(1.0,0.5,1.0), vec3(0.0,0.5,0.2));
                  return pal(t, vec3(0.5,0.5,0.5), vec3(0.5,0.5,0.5), vec3(1.0,1.0,1.0), vec3(0.0,0.33,0.67));
    }

    void main() {
        vec4  s   = texture2D(u_fbo, v_uv);
        vec3  col;

        if (u_mode == 2) {
            float t = s.g - s.r*0.5;
            col = applyPalette(t + u_hue, u_palette) * (0.3 + s.g*2.0);
        } else {
            float lum = dot(s.rgb, vec3(0.299,0.587,0.114));
            col = applyPalette(lum + u_hue + u_time*0.004, u_palette);
            if (u_mode == 0 || u_mode == 1 || u_mode == 5)
                col = mix(col, s.rgb, 0.3); // blend palette with raw colour
        }

        col = col / (col + 0.4);    // reinhard tone map
        col = pow(col, vec3(0.9));  // gamma
        gl_FragColor = vec4(clamp(col,0.0,1.0), 1.0);
    }
`;

const elements = {
  canvas: document.getElementById("gl-canvas"),
  rendererPanel: document.getElementById("renderer-panel"),
  video: document.getElementById("camera-video"),
  deviceSelect: document.getElementById("camera-device"),
  cameraButton: document.getElementById("camera-button"),
  refreshButton: document.getElementById("refresh-button"),
  clearButton: document.getElementById("clear-button"),
  pauseButton: document.getElementById("pause-button"),
  resetButton: document.getElementById("reset-button"),
  fullscreenButton: document.getElementById("fullscreen-button"),
  runtimeStatus: document.getElementById("runtime-status"),
  runtimeStatusText: document.getElementById("runtime-status-text"),
  modeDescription: document.getElementById("mode-description"),
  cameraNotice: document.getElementById("camera-notice"),
  cameraNoticeTitle: document.getElementById("camera-notice-title"),
  cameraNoticeMessage: document.getElementById("camera-notice-message"),
  rendererError: document.getElementById("renderer-error"),
  rendererErrorMessage: document.getElementById("renderer-error-message"),
  errorLog: document.getElementById("error-log"),
  hudMode: document.getElementById("hud-mode"),
  hudCamera: document.getElementById("hud-camera"),
  hudFormat: document.getElementById("hud-format"),
  hudResolution: document.getElementById("hud-resolution"),
};

let gl = null;
let simulationProgram = null;
let displayProgram = null;
let quadBuffer = null;
let simulationPositionLocation = -1;
let displayPositionLocation = -1;
let simulationUniforms = Object.create(null);
let displayUniforms = Object.create(null);

let webcamTexture = null;
let framebuffers = [];
let framebufferTextures = [];
let writeTarget = 0;
let readTarget = 1;
let feedbackType = null;
let feedbackFormatName = "RGBA8";

let rendererReady = false;
let contextLost = false;
let paused = false;
let clearPending = true;
let shaderTime = 0;
let previousFrameTime = performance.now();
let renderMetricStart = performance.now();
let renderMetricFrames = 0;

let cameraStream = null;
let activeDeviceId = "";
let cameraBusy = false;
let lastUploadedVideoTime = -1;
let uploadMetricStart = performance.now();
let uploadMetricFrames = 0;
let sourceWidth = 1;
let sourceHeight = 1;

const pointer = { x: 0.5, y: 0.5, down: false, id: null };

function setRuntimeStatus(state, text) {
  elements.runtimeStatus.dataset.state = state;
  elements.runtimeStatusText.textContent = text;
}

function setDiagnostic(id, text, result = "") {
  const element = document.getElementById(id);
  if (!element) return;
  element.textContent = text;
  if (result) element.dataset.result = result;
  else delete element.dataset.result;
}

function showCameraNotice(title, message, state = "idle") {
  elements.cameraNotice.hidden = false;
  elements.cameraNotice.dataset.state = state;
  elements.cameraNoticeTitle.textContent = title;
  elements.cameraNoticeMessage.textContent = message;
}

function hideCameraNotice() {
  elements.cameraNotice.hidden = true;
  delete elements.cameraNotice.dataset.state;
}

function showErrorLog(scope, message) {
  elements.errorLog.hidden = false;
  elements.errorLog.dataset.scope = scope;
  elements.errorLog.textContent = `[${scope}] ${message}`;
}

function clearErrorLog(scope = "") {
  if (scope && elements.errorLog.dataset.scope !== scope) return;
  elements.errorLog.hidden = true;
  elements.errorLog.textContent = "";
  delete elements.errorLog.dataset.scope;
}

function failRenderer(message, details = "") {
  rendererReady = false;
  setRuntimeStatus("error", "Renderer error");
  elements.rendererError.hidden = false;
  elements.rendererErrorMessage.textContent = details ? `${message}

${details}` : message;
  showErrorLog("webgl", details || message);
  console.error(message, details);
}

function compileShader(type, source, label, diagnosticId) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error(`Could not allocate the ${label} shader.`);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  const log = (gl.getShaderInfoLog(shader) || "").trim();
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    setDiagnostic(diagnosticId, "Failed", "error");
    throw new Error(`${label} shader compilation failed.
${log || "No compiler log was returned."}`);
  }
  setDiagnostic(diagnosticId, log ? "Compiled with notes" : "Compiled", "success");
  return { shader, log };
}

function linkProgram(vertexShader, fragmentShader, label) {
  const program = gl.createProgram();
  if (!program) throw new Error(`Could not allocate the ${label} program.`);
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  const log = (gl.getProgramInfoLog(program) || "").trim();
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    throw new Error(`${label} program linking failed.
${log || "No linker log was returned."}`);
  }
  return { program, log };
}

function createPrograms() {
  const vertex = compileShader(gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE, "Vertex", "vertex-status");
  const simulation = compileShader(gl.FRAGMENT_SHADER, SIMULATION_FRAGMENT_SHADER_SOURCE, "Simulation fragment", "simulation-status");
  const display = compileShader(gl.FRAGMENT_SHADER, DISPLAY_FRAGMENT_SHADER_SOURCE, "Display fragment", "display-status");
  try {
    const simulationLink = linkProgram(vertex.shader, simulation.shader, "Simulation");
    const displayLink = linkProgram(vertex.shader, display.shader, "Display");
    simulationProgram = simulationLink.program;
    displayProgram = displayLink.program;
    setDiagnostic("link-status", simulationLink.log || displayLink.log ? "Linked with notes" : "Simulation + display linked", "success");
  } catch (error) {
    setDiagnostic("link-status", "Failed", "error");
    throw error;
  } finally {
    gl.deleteShader(vertex.shader);
    gl.deleteShader(simulation.shader);
    gl.deleteShader(display.shader);
  }
}

function createQuad() {
  quadBuffer = gl.createBuffer();
  if (!quadBuffer) throw new Error("Could not allocate the fullscreen-quad buffer.");
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  simulationPositionLocation = gl.getAttribLocation(simulationProgram, "a_position");
  displayPositionLocation = gl.getAttribLocation(displayProgram, "a_position");
  if (simulationPositionLocation < 0 || displayPositionLocation < 0) {
    throw new Error("A linked program does not expose the required a_position attribute.");
  }
}

function bindQuad(positionLocation) {
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
}

function cacheUniforms() {
  const simulationNames = [
    "u_prev", "u_webcam", "u_time", "u_res", "u_mode", "u_decay", "u_camMix",
    "u_speed", "u_scale", "u_intensity", "u_mouse", "u_mouseDown", "u_brushSize", "u_clearFlag",
  ];
  for (const name of simulationNames) simulationUniforms[name] = gl.getUniformLocation(simulationProgram, name);
  for (const name of ["u_fbo", "u_mode", "u_hue", "u_palette", "u_time"]) {
    displayUniforms[name] = gl.getUniformLocation(displayProgram, name);
  }
}

function uniform1f(programUniforms, name, value) {
  const location = programUniforms[name];
  if (location !== null && location !== undefined) gl.uniform1f(location, value);
}
function uniform1i(programUniforms, name, value) {
  const location = programUniforms[name];
  if (location !== null && location !== undefined) gl.uniform1i(location, value);
}
function uniform2f(programUniforms, name, x, y) {
  const location = programUniforms[name];
  if (location !== null && location !== undefined) gl.uniform2f(location, x, y);
}

function makeTexture(type = gl.UNSIGNED_BYTE) {
  const texture = gl.createTexture();
  if (!texture) throw new Error("Could not allocate a WebGL texture.");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const floatLinear = type === gl.FLOAT && gl.getExtension("OES_texture_float_linear");
  const filter = type === gl.FLOAT && !floatLinear ? gl.NEAREST : gl.LINEAR;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  return texture;
}

function writePlaceholderTexture() {
  gl.bindTexture(gl.TEXTURE_2D, webcamTexture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([3, 4, 7, 255]));
  sourceWidth = 1;
  sourceHeight = 1;
  lastUploadedVideoTime = -1;
}

function uploadCameraFrame() {
  if (!cameraStream || elements.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return false;
  const videoTime = elements.video.currentTime;
  if (videoTime === lastUploadedVideoTime) return false;
  gl.bindTexture(gl.TEXTURE_2D, webcamTexture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, elements.video);
  lastUploadedVideoTime = videoTime;
  sourceWidth = elements.video.videoWidth || sourceWidth;
  sourceHeight = elements.video.videoHeight || sourceHeight;
  uploadMetricFrames += 1;
  return true;
}

function allocateFramebufferTarget(width, height, type) {
  const texture = makeTexture(type);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, type, null);
  const framebuffer = gl.createFramebuffer();
  if (!framebuffer) { gl.deleteTexture(texture); throw new Error("Could not allocate a WebGL framebuffer."); }
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    gl.deleteFramebuffer(framebuffer);
    gl.deleteTexture(texture);
    return null;
  }
  return { framebuffer, texture };
}

function destroyFramebufferTargets() {
  for (const framebuffer of framebuffers) if (framebuffer) gl.deleteFramebuffer(framebuffer);
  for (const texture of framebufferTextures) if (texture) gl.deleteTexture(texture);
  framebuffers = [];
  framebufferTextures = [];
}

function chooseFeedbackType(width, height) {
  const canTryFloat = Boolean(gl.getExtension("OES_texture_float"));
  if (canTryFloat) {
    const trial = allocateFramebufferTarget(width, height, gl.FLOAT);
    if (trial) {
      gl.deleteFramebuffer(trial.framebuffer);
      gl.deleteTexture(trial.texture);
      return { type: gl.FLOAT, name: gl.getExtension("OES_texture_float_linear") ? "RGBA32F linear" : "RGBA32F nearest" };
    }
  }
  return { type: gl.UNSIGNED_BYTE, name: "RGBA8" };
}

function rebuildFramebufferTargets(width, height) {
  if (!gl || width < 1 || height < 1) return;
  destroyFramebufferTargets();
  const selected = chooseFeedbackType(width, height);
  feedbackType = selected.type;
  feedbackFormatName = selected.name;
  for (let index = 0; index < 2; index += 1) {
    const target = allocateFramebufferTarget(width, height, feedbackType);
    if (!target) throw new Error(`Feedback framebuffer ${index} is incomplete for ${feedbackFormatName}.`);
    framebuffers.push(target.framebuffer);
    framebufferTextures.push(target.texture);
  }
  writeTarget = 0;
  readTarget = 1;
  setDiagnostic("target-format", feedbackFormatName, feedbackType === gl.FLOAT ? "success" : "warning");
  setDiagnostic("fbo-status", `2 complete · ${width}×${height}`, "success");
  elements.hudFormat.textContent = feedbackFormatName.toUpperCase();
  clearFeedbackState();
}

function clearFeedbackState() {
  if (!gl || framebuffers.length !== 2) return;
  const reactionDiffusion = params.mode === 2;
  gl.disable(gl.BLEND);
  gl.clearColor(reactionDiffusion ? 1 : 0.012, reactionDiffusion ? 0 : 0.016, reactionDiffusion ? 0 : 0.027, 1);
  for (const framebuffer of framebuffers) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  writeTarget = 0;
  readTarget = 1;
  clearPending = true;

  if (displayProgram && quadBuffer && elements.canvas.width > 0 && elements.canvas.height > 0) {
    renderDisplayPass();
  }
}

function resizeCanvas() {
  if (!gl || !elements.rendererPanel) return;
  const rect = elements.rendererPanel.getBoundingClientRect();
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * pixelRatio));
  const height = Math.max(1, Math.round(rect.height * pixelRatio));
  if (elements.canvas.width === width && elements.canvas.height === height) return;
  elements.canvas.width = width;
  elements.canvas.height = height;
  rebuildFramebufferTargets(width, height);
  const text = `${width}×${height}`;
  setDiagnostic("drawing-resolution", text);
  elements.hudResolution.textContent = text;
}

function updateSimulationUniforms() {
  gl.useProgram(simulationProgram);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, framebufferTextures[readTarget]);
  uniform1i(simulationUniforms, "u_prev", 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, webcamTexture);
  uniform1i(simulationUniforms, "u_webcam", 1);
  uniform1f(simulationUniforms, "u_time", shaderTime);
  uniform2f(simulationUniforms, "u_res", elements.canvas.width, elements.canvas.height);
  uniform1i(simulationUniforms, "u_mode", params.mode);
  uniform1f(simulationUniforms, "u_decay", params.decay);
  uniform1f(simulationUniforms, "u_camMix", params.camMix);
  uniform1f(simulationUniforms, "u_speed", params.speed);
  uniform1f(simulationUniforms, "u_scale", params.scale);
  uniform1f(simulationUniforms, "u_intensity", params.intensity);
  uniform2f(simulationUniforms, "u_mouse", pointer.x, pointer.y);
  uniform1f(simulationUniforms, "u_mouseDown", pointer.down ? 1 : 0);
  uniform1f(simulationUniforms, "u_brushSize", params.brush);
  uniform1f(simulationUniforms, "u_clearFlag", clearPending ? 1 : 0);
}

function renderSimulationPass() {
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[writeTarget]);
  gl.viewport(0, 0, elements.canvas.width, elements.canvas.height);
  updateSimulationUniforms();
  bindQuad(simulationPositionLocation);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  clearPending = false;
}

function renderDisplayPass() {
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, elements.canvas.width, elements.canvas.height);
  gl.useProgram(displayProgram);
  bindQuad(displayPositionLocation);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, framebufferTextures[writeTarget]);
  uniform1i(displayUniforms, "u_fbo", 0);
  uniform1i(displayUniforms, "u_mode", params.mode);
  uniform1f(displayUniforms, "u_hue", params.hue);
  uniform1i(displayUniforms, "u_palette", params.palette);
  uniform1f(displayUniforms, "u_time", shaderTime);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function updateMetrics(now) {
  if (now - renderMetricStart >= 1000) {
    const elapsed = (now - renderMetricStart) / 1000;
    const fps = paused ? 0 : renderMetricFrames / elapsed;
    setDiagnostic("render-fps", paused ? "0 (paused)" : `${fps.toFixed(1)} fps`);
    renderMetricStart = now;
    renderMetricFrames = 0;
  }
  if (now - uploadMetricStart >= 1000) {
    const elapsed = (now - uploadMetricStart) / 1000;
    const fps = cameraStream && !paused ? uploadMetricFrames / elapsed : 0;
    setDiagnostic("upload-fps", `${fps.toFixed(1)} fps`);
    uploadMetricStart = now;
    uploadMetricFrames = 0;
  }
}

function render(now) {
  requestAnimationFrame(render);
  if (!rendererReady || contextLost) return;
  const deltaSeconds = Math.min((now - previousFrameTime) / 1000, 0.1);
  previousFrameTime = now;
  if (paused) { updateMetrics(now); return; }
  try {
    resizeCanvas();
    shaderTime += deltaSeconds * params.speed;
    uploadCameraFrame();
    renderSimulationPass();
    renderDisplayPass();
    [writeTarget, readTarget] = [readTarget, writeTarget];
    renderMetricFrames += 1;
    updateMetrics(now);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failRenderer("The feedback render loop stopped.", message);
  }
}

function detectRenderer() {
  const extension = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  setDiagnostic("renderer-name", renderer || "WebGL 1 renderer");
}

function initializeWebGL() {
  gl = elements.canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: "high-performance" });
  if (!gl) throw new Error("WebGL 1 is unavailable in this WebView.");
  createPrograms();
  createQuad();
  cacheUniforms();
  webcamTexture = makeTexture(gl.UNSIGNED_BYTE);
  writePlaceholderTexture();
  resizeCanvas();
  detectRenderer();
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.disable(gl.BLEND);
  rendererReady = true;
  setRuntimeStatus("camera-idle", "Renderer ready · camera idle");
  clearErrorLog("webgl");
  requestAnimationFrame(render);
}

function mediaDevicesAvailable() {
  return Boolean(navigator.mediaDevices?.getUserMedia && navigator.mediaDevices?.enumerateDevices);
}

function makeCameraOption(device, index) {
  const option = document.createElement("option");
  option.value = device.deviceId;
  option.textContent = device.label || `Camera ${index + 1} — permission required`;
  return option;
}

async function enumerateCameras(preferredDeviceId = "") {
  if (!mediaDevicesAvailable()) {
    elements.deviceSelect.innerHTML = '<option value="">Camera API unavailable</option>';
    elements.deviceSelect.disabled = true;
    elements.refreshButton.disabled = true;
    elements.cameraButton.disabled = true;
    setDiagnostic("camera-state", "Unsupported", "error");
    showCameraNotice("Camera API unavailable", "This WebView does not expose navigator.mediaDevices.getUserMedia().", "error");
    return [];
  }
  const previousSelection = preferredDeviceId || elements.deviceSelect.value || activeDeviceId;
  elements.refreshButton.disabled = true;
  elements.refreshButton.textContent = "Refreshing…";
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter((device) => device.kind === "videoinput");
    elements.deviceSelect.innerHTML = "";
    if (cameras.length === 0) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No video inputs found";
      elements.deviceSelect.appendChild(option);
      setDiagnostic("camera-state", cameraStream ? "Running" : "No devices", cameraStream ? "success" : "warning");
      return cameras;
    }
    cameras.forEach((device, index) => elements.deviceSelect.appendChild(makeCameraOption(device, index)));
    const availableIds = new Set(cameras.map((device) => device.deviceId));
    if (previousSelection && availableIds.has(previousSelection)) elements.deviceSelect.value = previousSelection;
    else if (activeDeviceId && availableIds.has(activeDeviceId)) elements.deviceSelect.value = activeDeviceId;
    return cameras;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    elements.deviceSelect.innerHTML = '<option value="">Device enumeration failed</option>';
    setDiagnostic("camera-state", "Enumeration failed", "error");
    showErrorLog("camera", `Could not enumerate camera devices. ${message}`);
    return [];
  } finally {
    elements.refreshButton.disabled = false;
    elements.refreshButton.textContent = "Refresh Devices";
  }
}

function describeCameraError(error) {
  const name = error?.name || "CameraError";
  const message = error?.message || "The camera request failed.";
  switch (name) {
    case "NotAllowedError": case "PermissionDeniedError": return "Camera access was denied. Allow access in system privacy settings, then press Start Camera again.";
    case "NotFoundError": case "DevicesNotFoundError": return "No usable camera was found. Connect a camera and refresh the device list.";
    case "NotReadableError": case "TrackStartError": return "The camera is already in use or could not be opened by the WebView.";
    case "OverconstrainedError": return `The selected camera cannot satisfy the requested constraints: ${message}`;
    case "SecurityError": return "The WebView blocked camera access because the current context is not authorized.";
    default: return `${name}: ${message}`;
  }
}

function stopMediaTracks() {
  if (cameraStream) for (const track of cameraStream.getTracks()) track.stop();
  cameraStream = null;
  elements.video.srcObject = null;
}

function setCameraBusy(isBusy) {
  cameraBusy = isBusy;
  elements.cameraButton.disabled = isBusy;
  elements.deviceSelect.disabled = isBusy;
  elements.cameraButton.textContent = isBusy ? "Requesting…" : cameraStream ? "Stop Camera" : "Start Camera";
}

function updateCameraDiagnostics(track) {
  const settings = track.getSettings ? track.getSettings() : {};
  const width = settings.width || elements.video.videoWidth || 0;
  const height = settings.height || elements.video.videoHeight || 0;
  const fps = Number.isFinite(settings.frameRate) ? ` @ ${settings.frameRate.toFixed(1)} fps` : "";
  const resolution = width && height ? `${width}×${height}${fps}` : "Active stream";
  const label = track.label || "Camera permission granted";
  sourceWidth = width || sourceWidth;
  sourceHeight = height || sourceHeight;
  setDiagnostic("camera-state", "Running", "success");
  setDiagnostic("camera-name", label);
  setDiagnostic("camera-resolution", resolution);
  elements.hudCamera.textContent = width && height ? `${width}×${height}` : "CAMERA LIVE";
}

async function waitForVideoMetadata() {
  if (elements.video.readyState >= HTMLMediaElement.HAVE_METADATA) return;
  await new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => { cleanup(); reject(new Error("Timed out while waiting for camera metadata.")); }, 10000);
    const cleanup = () => { window.clearTimeout(timeout); elements.video.removeEventListener("loadedmetadata", handleLoaded); elements.video.removeEventListener("error", handleError); };
    const handleLoaded = () => { cleanup(); resolve(); };
    const handleError = () => { cleanup(); reject(new Error("The video element could not decode the camera stream.")); };
    elements.video.addEventListener("loadedmetadata", handleLoaded, { once: true });
    elements.video.addEventListener("error", handleError, { once: true });
  });
}

function createVideoConstraints(deviceId = "") {
  return { video: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 60 } }, audio: false };
}

async function requestCameraStream(deviceId) {
  try { return await navigator.mediaDevices.getUserMedia(createVideoConstraints(deviceId)); }
  catch (error) {
    const canRetryDefault = deviceId && ["NotFoundError", "OverconstrainedError"].includes(error?.name);
    if (!canRetryDefault) throw error;
    await enumerateCameras();
    elements.deviceSelect.value = "";
    return navigator.mediaDevices.getUserMedia(createVideoConstraints());
  }
}

async function startCamera() {
  if (cameraBusy || !mediaDevicesAvailable()) return;
  setCameraBusy(true);
  setRuntimeStatus("camera-idle", "Requesting camera access");
  setDiagnostic("camera-state", "Requesting…", "warning");
  showCameraNotice("Requesting camera access", "Approve the operating-system permission prompt to begin live simulation injection.");
  const requestedDeviceId = elements.deviceSelect.value;
  stopMediaTracks();
  try {
    const stream = await requestCameraStream(requestedDeviceId);
    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error("The media stream contains no video track.");
    cameraStream = stream;
    elements.video.srcObject = stream;
    await waitForVideoMetadata();
    await elements.video.play();
    const settings = track.getSettings ? track.getSettings() : {};
    activeDeviceId = settings.deviceId || requestedDeviceId || "";
    lastUploadedVideoTime = -1;
    uploadMetricFrames = 0;
    uploadMetricStart = performance.now();
    track.addEventListener("ended", () => { if (cameraStream?.getVideoTracks()[0] === track) stopCamera("The active camera track ended.", true); }, { once: true });
    updateCameraDiagnostics(track);
    await enumerateCameras(activeDeviceId);
    clearErrorLog("camera");
    clearFeedbackState();
    hideCameraNotice();
    setRuntimeStatus(paused ? "paused" : "running", paused ? "Paused · camera live" : "Running · camera live");
  } catch (error) {
    stopMediaTracks();
    activeDeviceId = "";
    writePlaceholderTexture();
    clearFeedbackState();
    const message = describeCameraError(error);
    setDiagnostic("camera-state", "Error", "error");
    setDiagnostic("camera-name", "—");
    setDiagnostic("camera-resolution", "—");
    elements.hudCamera.textContent = "CAMERA ERROR";
    showCameraNotice("Camera could not start", message, "error");
    showErrorLog("camera", message);
    setRuntimeStatus("camera-idle", "Renderer ready · camera error");
    await enumerateCameras();
  } finally { setCameraBusy(false); }
}

function stopCamera(message = "Camera stopped. Draw on the renderer or restart camera input.", endedUnexpectedly = false) {
  stopMediaTracks();
  activeDeviceId = "";
  writePlaceholderTexture();
  clearFeedbackState();
  setCameraBusy(false);
  setDiagnostic("camera-state", endedUnexpectedly ? "Track ended" : "Stopped", endedUnexpectedly ? "warning" : "");
  setDiagnostic("camera-name", "—");
  setDiagnostic("camera-resolution", "—");
  setDiagnostic("upload-fps", "0 fps");
  elements.hudCamera.textContent = "NO CAMERA";
  showCameraNotice(endedUnexpectedly ? "Camera track ended" : "Camera input idle", message, endedUnexpectedly ? "error" : "idle");
  setRuntimeStatus(paused ? "paused" : "camera-idle", paused ? "Paused · camera idle" : "Renderer ready · camera idle");
}

function formatRangeValue(id, value) {
  if (id === "palette") return PALETTE_NAMES[Math.round(value)] || String(value);
  if (["decay", "hue", "brush"].includes(id)) return Number(value).toFixed(3);
  return Number(value).toFixed(2);
}

function updateModeUi() {
  document.querySelectorAll(".mode-button").forEach((button) => button.classList.toggle("active", Number(button.dataset.mode) === params.mode));
  elements.modeDescription.textContent = MODE_DESCRIPTIONS[params.mode];
  elements.hudMode.textContent = MODE_NAMES[params.mode].toUpperCase();
}

function syncControlsFromParams() {
  for (const id of RANGE_IDS) {
    const input = document.getElementById(id);
    const output = document.getElementById(`${id}-value`);
    input.value = String(params[id]);
    output.textContent = formatRangeValue(id, params[id]);
  }
  updateModeUi();
}

function selectMode(mode, shouldClear = true) {
  params.mode = Math.max(0, Math.min(MODE_NAMES.length - 1, mode));
  updateModeUi();
  if (shouldClear) clearFeedbackState();
}

function wireControls() {
  for (const id of RANGE_IDS) {
    const input = document.getElementById(id);
    const output = document.getElementById(`${id}-value`);
    input.addEventListener("input", () => {
      const value = Number.parseFloat(input.value);
      params[id] = id === "palette" ? Math.round(value) : value;
      output.textContent = formatRangeValue(id, value);
    });
  }
  document.querySelectorAll(".mode-button").forEach((button) => button.addEventListener("click", () => selectMode(Number(button.dataset.mode))));
  elements.cameraButton.addEventListener("click", () => cameraStream ? stopCamera() : void startCamera());
  elements.refreshButton.addEventListener("click", () => void enumerateCameras(activeDeviceId));
  elements.deviceSelect.addEventListener("change", () => { if (cameraStream) void startCamera(); });
  elements.clearButton.addEventListener("click", clearFeedbackState);
  elements.pauseButton.addEventListener("click", togglePause);
  elements.resetButton.addEventListener("click", resetParameters);
  elements.fullscreenButton.addEventListener("click", () => void toggleFullscreen());
}

function pointerUv(event) {
  const rect = elements.canvas.getBoundingClientRect();
  return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, 1 - (event.clientY - rect.top) / rect.height)) };
}

function wireBrush() {
  elements.canvas.addEventListener("pointerdown", (event) => {
    const uv = pointerUv(event);
    pointer.x = uv.x; pointer.y = uv.y; pointer.down = true; pointer.id = event.pointerId;
    elements.rendererPanel.dataset.brushing = "true";
    elements.canvas.setPointerCapture?.(event.pointerId);
  });
  elements.canvas.addEventListener("pointermove", (event) => {
    if (!pointer.down || pointer.id !== event.pointerId) return;
    const uv = pointerUv(event); pointer.x = uv.x; pointer.y = uv.y;
  });
  const end = (event) => {
    if (pointer.id !== null && event.pointerId !== pointer.id) return;
    pointer.down = false; pointer.id = null; delete elements.rendererPanel.dataset.brushing;
  };
  elements.canvas.addEventListener("pointerup", end);
  elements.canvas.addEventListener("pointercancel", end);
  elements.canvas.addEventListener("lostpointercapture", end);
}

function togglePause() {
  paused = !paused;
  elements.pauseButton.textContent = paused ? "Resume" : "Pause";
  previousFrameTime = performance.now();
  if (paused) {
    setRuntimeStatus("paused", cameraStream ? "Paused · camera live" : "Paused · camera idle");
    setDiagnostic("render-fps", "0 (paused)");
    setDiagnostic("upload-fps", "0 fps");
  } else {
    setRuntimeStatus(cameraStream ? "running" : "camera-idle", cameraStream ? "Running · camera live" : "Renderer ready · camera idle");
  }
}

function resetParameters() {
  Object.assign(params, DEFAULTS);
  shaderTime = 0;
  syncControlsFromParams();
  clearFeedbackState();
}

async function toggleFullscreen() {
  try {
    const invoke = window.__TAURI__?.core?.invoke;
    if (typeof invoke === "function") { await invoke("toggle_fullscreen"); clearErrorLog("tauri"); return; }
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
    else if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showErrorLog("tauri", `Fullscreen request failed. ${message}`);
  }
}

function shortcutShouldBeIgnored(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  return ["INPUT", "SELECT", "BUTTON", "TEXTAREA"].includes(target.tagName) || target.isContentEditable;
}

function wireKeyboardShortcuts() {
  window.addEventListener("keydown", (event) => {
    if (shortcutShouldBeIgnored(event) || event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === " ") { event.preventDefault(); togglePause(); }
    else if (key === "r") resetParameters();
    else if (key === "x") clearFeedbackState();
    else if (key === "c") cameraStream ? stopCamera() : void startCamera();
    else if (key === "f") void toggleFullscreen();
    else if (/^[1-6]$/.test(key)) selectMode(Number(key) - 1);
  });
}

function wireLifecycleEvents() {
  elements.canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault(); contextLost = true;
    failRenderer("The WebGL context was lost.", "Reload the example to rebuild the camera texture and persistent feedback targets.");
  });
  elements.canvas.addEventListener("webglcontextrestored", () => window.location.reload());
  if (navigator.mediaDevices?.addEventListener) navigator.mediaDevices.addEventListener("devicechange", () => void enumerateCameras(activeDeviceId));
  window.addEventListener("beforeunload", stopMediaTracks);
}

async function start() {
  syncControlsFromParams();
  wireControls();
  wireBrush();
  wireKeyboardShortcuts();
  wireLifecycleEvents();
  try { initializeWebGL(); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failRenderer("WebGL initialization failed.", message);
    return;
  }
  const resizeObserver = new ResizeObserver(() => {
    try {
      resizeCanvas();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failRenderer("The feedback targets could not be resized.", message);
    }
  });
  resizeObserver.observe(elements.rendererPanel);
  await enumerateCameras();
}

void start();
