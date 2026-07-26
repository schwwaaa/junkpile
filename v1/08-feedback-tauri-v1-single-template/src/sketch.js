// Junkpile · Tauri v1 Essentials · Example 08
// Single-window raw WebGL ping-pong feedback with webcam or generated input.
'use strict';

const MODE_NAMES = ['Echo Trail', 'Fluid Smear', 'Reaction-Diffusion', 'Thermal', 'Mirror Echo', 'Glitch Memory'];
const MODE_DESCS = [
  'The previous frame decays while the source is reinjected, leaving luminous motion trails.',
  'Source edges stir a curl-noise field that advects accumulated color like liquid.',
  'Source luminance injects activator into a Gray-Scott reaction-diffusion state.',
  'Source brightness becomes heat that diffuses outward and decays through time.',
  'A six-way fold accumulates the source into an evolving live mandala.',
  'Aberrated source frames combine with displaced memory to produce a VHS-like recursive smear.'
];

const DEFAULTS = {
  mode: 0,
  decay: 0.97,
  camMix: 0.30,
  speed: 1.0,
  scale: 1.0,
  intensity: 1.0,
  hue: 0.0,
  palette: 0,
  brush: 0.03,
  fitMode: 1,
  mirror: true,
  bufferScale: 0.5
};

const PRESETS = {
  echo:    { mode:0, decay:0.982, camMix:0.24, speed:0.75, scale:1.0, intensity:1.05, hue:0.0, palette:4, brush:0.035 },
  fluid:   { mode:1, decay:0.991, camMix:0.08, speed:1.25, scale:1.7, intensity:1.15, hue:-0.08, palette:1, brush:0.045 },
  reaction:{ mode:2, decay:0.999, camMix:0.34, speed:0.75, scale:1.0, intensity:1.0, hue:0.12, palette:2, brush:0.028 },
  thermal: { mode:3, decay:0.976, camMix:0.18, speed:1.2, scale:1.0, intensity:1.45, hue:-0.03, palette:0, brush:0.05 },
  mirror:  { mode:4, decay:0.976, camMix:0.25, speed:0.9, scale:1.0, intensity:1.1, hue:0.04, palette:4, brush:0.035 },
  glitch:  { mode:5, decay:0.955, camMix:0.36, speed:1.45, scale:1.0, intensity:1.25, hue:0.08, palette:3, brush:0.025 }
};

const params = { ...DEFAULTS };

const VERT = `
    precision highp float;
    attribute vec2 a_pos;
    varying   vec2 v_uv;
    void main() { v_uv = a_pos*0.5+0.5; gl_Position = vec4(a_pos,0.0,1.0); }
`;
const SIM = `
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
    uniform float u_cameraAspect;
    uniform float u_outputAspect;
    uniform int   u_fitMode;
    uniform float u_mirror;

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

    vec4 cameraSample(vec2 uv) {
        vec2 mapped = uv;
        float sourceAspect = max(u_cameraAspect, 0.0001);
        float targetAspect = max(u_outputAspect, 0.0001);

        if (u_fitMode == 0) {
            if (targetAspect > sourceAspect) {
                mapped.x = (uv.x - 0.5) * (targetAspect / sourceAspect) + 0.5;
            } else {
                mapped.y = (uv.y - 0.5) * (sourceAspect / targetAspect) + 0.5;
            }
        } else if (u_fitMode == 1) {
            if (targetAspect > sourceAspect) {
                mapped.y = (uv.y - 0.5) * (sourceAspect / targetAspect) + 0.5;
            } else {
                mapped.x = (uv.x - 0.5) * (targetAspect / sourceAspect) + 0.5;
            }
        }

        if (u_mirror > 0.5) mapped.x = 1.0 - mapped.x;
        if (any(lessThan(mapped, vec2(0.0))) || any(greaterThan(mapped, vec2(1.0)))) {
            return vec4(0.0, 0.0, 0.0, 1.0);
        }
        return texture2D(u_webcam, mapped);
    }


    // Sobel on webcam — gives edge map used by Fluid mode
    float edges(vec2 uv) {
        vec2 px = 1.0/u_res;
        float gx =
            -luma(cameraSample(uv+vec2(-px.x,-px.y)).rgb) +
             luma(cameraSample(uv+vec2( px.x,-px.y)).rgb) +
          -2.0*luma(cameraSample(uv+vec2(-px.x, 0.0)).rgb) +
           2.0*luma(cameraSample(uv+vec2( px.x, 0.0)).rgb) +
            -luma(cameraSample(uv+vec2(-px.x, px.y)).rgb) +
             luma(cameraSample(uv+vec2( px.x, px.y)).rgb);
        float gy =
            -luma(cameraSample(uv+vec2(-px.x,-px.y)).rgb) +
          -2.0*luma(cameraSample(uv+vec2( 0.0,-px.y)).rgb) +
            -luma(cameraSample(uv+vec2( px.x,-px.y)).rgb) +
             luma(cameraSample(uv+vec2(-px.x, px.y)).rgb) +
           2.0*luma(cameraSample(uv+vec2( 0.0, px.y)).rgb) +
             luma(cameraSample(uv+vec2( px.x, px.y)).rgb);
        return clamp(sqrt(gx*gx+gy*gy)*3.0, 0.0, 1.0);
    }

    // ── Mode 0: Echo Trail ─────────────────────────────────────────────────
    // Simplest possible feedback. prev fades, webcam bleeds in.
    // Reveals the core idea: without u_prev, there are no trails.
    vec4 modeEcho(vec2 uv) {
        vec3 prev = texture2D(u_prev, uv).rgb * u_decay;
        vec3 cam  = cameraSample(uv).rgb;
        return vec4(prev + cam * u_camMix * u_intensity, 1.0);
    }

    // ── Mode 1: Fluid Smear ────────────────────────────────────────────────
    // prev is advected through a curl field. Webcam edge magnitude modulates
    // flow strength — your moving edges stir the fluid harder.
    vec4 modeFluid(vec2 uv) {
        float t    = u_time * u_speed * 0.3;
        float edge = edges(uv);
        vec2  flow = curl(uv * u_scale * 3.0, t) * (0.003 + edge * 0.006) * u_speed;
        vec3  prev = texture2D(u_prev, uv + flow).rgb * u_decay;
        vec3  cam  = cameraSample(uv).rgb;
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
        float camLum = luma(cameraSample(uv).rgb);
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
        float heat = luma(cameraSample(uv).rgb);
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
        float th = atan(c.y, c.x) + u_time * u_speed * 0.004;

        float N   = 6.0;
        float sec = 3.14159*2.0/N;
        th  = mod(th, sec);
        if (th > sec*0.5) th = sec-th;

        // Sample webcam through the fold
        vec2  camUV = vec2(cos(th),sin(th))*r + 0.5;
        vec3  cam   = cameraSample(camUV).rgb;

        // Also fold the prev frame lookup with a slight zoom spiral
        vec2  prevUV = vec2(cos(th),sin(th)) * r*(1.0-0.002*u_speed) + 0.5;
        vec3  prev   = texture2D(u_prev, prevUV).rgb * u_decay;

        return vec4(prev + cam * u_camMix * u_intensity, 1.0);
    }

    // ── Mode 5: Glitch Memory ──────────────────────────────────────────────
    // Block-shifted prev frame + webcam with chromatic split.
    // The accumulated ghost of you glitches and persists.
    vec4 modeGlitch(vec2 uv) {
        float t     = floor(u_time * u_speed * 4.0);
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
        vec3 cam = cameraSample(uv + vec2(dx*0.5, 0.0)).rgb;
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
const DISPLAY = `
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

const $ = (id) => document.getElementById(id);
const canvas = $('glcanvas');
const container = $('canvas-container');
const video = $('webcam-video');
const generatedCanvas = $('generated-source');
const generatedCtx = generatedCanvas.getContext('2d');

let gl = null;
let simProgram = null;
let displayProgram = null;
let quadBuffer = null;
let sourceTexture = null;
let historyTextures = [null, null];
let historyFramebuffers = [null, null];
let readIndex = 0;
let historyWidth = 0;
let historyHeight = 0;
let clearPending = true;
let paused = false;
let contextLost = false;
let accumulatedTime = 0;
let previousFrameTime = performance.now();
let renderFrames = 0;
let renderFps = 0;
let fpsWindowStart = performance.now();
let cameraFrames = 0;
let cameraFps = 0;
let cameraWindowStart = performance.now();
let lastVideoTime = -1;
let stream = null;
let activeDeviceId = '';
let sourceWidth = generatedCanvas.width;
let sourceHeight = generatedCanvas.height;
let resizeQueued = false;
const pointer = { x: 0.5, y: 0.5, down: false };

function setStatus(message, kind = 'ok') {
  $('statusText').textContent = message;
  $('canvasBadge').className = `canvas-badge ${kind === 'warning' ? 'paused' : kind === 'ok' ? 'live' : ''}`;
}

function writeDiagnostics(lines, kind = 'ok') {
  const list = Array.isArray(lines) ? lines : [String(lines)];
  $('diagnostics').textContent = list.join('\n');
  $('compileStatus').textContent = kind === 'ok' ? 'Pipeline ready' : 'Pipeline error';
  $('compileDot').className = `status-dot ${kind}`;
}

function shaderStageName(type) {
  return type === gl.VERTEX_SHADER ? 'vertex shader' : 'fragment shader';
}

function compileShader(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) || 'Unknown compiler error';
    gl.deleteShader(shader);
    throw new Error(`${shaderStageName(type)}:
${info}`);
  }
  return shader;
}

function linkProgram(vertexSource, fragmentSource, label) {
  const vertex = compileShader(gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program) || 'Unknown linker error';
    gl.deleteProgram(program);
    throw new Error(`${label} link:
${info}`);
  }
  return program;
}

function compilePipeline() {
  if (!gl || contextLost) return false;
  try {
    const nextSim = linkProgram(VERT, SIM, 'simulation program');
    const nextDisplay = linkProgram(VERT, DISPLAY, 'display program');
    if (simProgram) gl.deleteProgram(simProgram);
    if (displayProgram) gl.deleteProgram(displayProgram);
    simProgram = nextSim;
    displayProgram = nextDisplay;
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    writeDiagnostics([
      '✓ simulation shader compiled',
      '✓ display shader compiled',
      '✓ both programs linked',
      `✓ renderer: ${renderer}`,
      '✓ history format: RGBA8 ping-pong'
    ]);
    clearPending = true;
    return true;
  } catch (error) {
    writeDiagnostics(error.message, 'error');
    setStatus('Shader pipeline failed; check diagnostics.', 'error');
    return false;
  }
}

function createTexture(width = 1, height = 1, data = null) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  return texture;
}

function destroyHistory() {
  historyTextures.forEach((texture) => texture && gl.deleteTexture(texture));
  historyFramebuffers.forEach((framebuffer) => framebuffer && gl.deleteFramebuffer(framebuffer));
  historyTextures = [null, null];
  historyFramebuffers = [null, null];
}

function allocateHistory() {
  if (!gl || !canvas.width || !canvas.height || contextLost) return;
  destroyHistory();
  historyWidth = Math.max(2, Math.floor(canvas.width * params.bufferScale));
  historyHeight = Math.max(2, Math.floor(canvas.height * params.bufferScale));
  for (let index = 0; index < 2; index += 1) {
    historyTextures[index] = createTexture(historyWidth, historyHeight);
    historyFramebuffers[index] = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, historyFramebuffers[index]);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, historyTextures[index], 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`Feedback framebuffer ${index} is incomplete: 0x${status.toString(16)}`);
    gl.viewport(0, 0, historyWidth, historyHeight);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  readIndex = 0;
  clearPending = true;
  $('bufferReadout').textContent = `${historyWidth} × ${historyHeight}`;
}

function initializeGpuResources() {
  gl = canvas.getContext('webgl', { alpha: false, antialias: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error('WebGL 1 is unavailable in this WebView.');
  quadBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  sourceTexture = createTexture(1, 1, new Uint8Array([0, 0, 0, 255]));
  compilePipeline();
  resizeCanvas(true);
}

function bindQuad(program) {
  const location = gl.getAttribLocation(program, 'a_pos');
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
}

function uniform1f(program, name, value) {
  const location = gl.getUniformLocation(program, name);
  if (location !== null) gl.uniform1f(location, value);
}
function uniform1i(program, name, value) {
  const location = gl.getUniformLocation(program, name);
  if (location !== null) gl.uniform1i(location, value);
}
function uniform2f(program, name, x, y) {
  const location = gl.getUniformLocation(program, name);
  if (location !== null) gl.uniform2f(location, x, y);
}

function drawGeneratedSource(now) {
  const width = generatedCanvas.width;
  const height = generatedCanvas.height;
  const time = now * 0.001;
  const gradient = generatedCtx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#07101b');
  gradient.addColorStop(0.45, '#572875');
  gradient.addColorStop(1, '#9eff3f');
  generatedCtx.fillStyle = gradient;
  generatedCtx.fillRect(0, 0, width, height);
  generatedCtx.globalAlpha = 0.22;
  generatedCtx.strokeStyle = '#ffffff';
  generatedCtx.lineWidth = 1;
  const spacing = 45;
  for (let x = 0; x <= width; x += spacing) { generatedCtx.beginPath(); generatedCtx.moveTo(x,0); generatedCtx.lineTo(x,height); generatedCtx.stroke(); }
  for (let y = 0; y <= height; y += spacing) { generatedCtx.beginPath(); generatedCtx.moveTo(0,y); generatedCtx.lineTo(width,y); generatedCtx.stroke(); }
  generatedCtx.globalAlpha = 1;
  const cx = width * (0.5 + Math.sin(time * 0.73) * 0.23);
  const cy = height * (0.5 + Math.cos(time * 0.91) * 0.25);
  for (let ring = 5; ring >= 1; ring -= 1) {
    generatedCtx.beginPath();
    generatedCtx.arc(cx, cy, ring * 38 + Math.sin(time * 1.7 + ring) * 12, 0, Math.PI * 2);
    generatedCtx.strokeStyle = `hsla(${(time * 70 + ring * 42) % 360}, 95%, 70%, ${0.14 + ring * 0.08})`;
    generatedCtx.lineWidth = 7;
    generatedCtx.stroke();
  }
  generatedCtx.fillStyle = '#ffffff';
  generatedCtx.globalAlpha = 0.75;
  const barX = width * (0.5 + Math.sin(time * 1.3) * 0.38);
  generatedCtx.fillRect(barX - 22, 0, 44, height);
  generatedCtx.globalAlpha = 1;
}

function uploadSource(now) {
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  if (stream && video.readyState >= video.HAVE_CURRENT_DATA) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    sourceWidth = video.videoWidth || 1280;
    sourceHeight = video.videoHeight || 720;
    if (video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      cameraFrames += 1;
    }
  } else {
    drawGeneratedSource(now);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, generatedCanvas);
    sourceWidth = generatedCanvas.width;
    sourceHeight = generatedCanvas.height;
    cameraFrames += 1;
  }
}

function renderSimulation() {
  const writeIndex = 1 - readIndex;
  gl.bindFramebuffer(gl.FRAMEBUFFER, historyFramebuffers[writeIndex]);
  gl.viewport(0, 0, historyWidth, historyHeight);
  gl.useProgram(simProgram);
  bindQuad(simProgram);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, historyTextures[readIndex]);
  uniform1i(simProgram, 'u_prev', 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
  uniform1i(simProgram, 'u_webcam', 1);

  uniform1f(simProgram, 'u_time', accumulatedTime);
  uniform2f(simProgram, 'u_res', historyWidth, historyHeight);
  uniform1i(simProgram, 'u_mode', params.mode);
  uniform1f(simProgram, 'u_decay', params.decay);
  uniform1f(simProgram, 'u_camMix', params.camMix);
  uniform1f(simProgram, 'u_speed', params.speed);
  uniform1f(simProgram, 'u_scale', params.scale);
  uniform1f(simProgram, 'u_intensity', params.intensity);
  uniform1f(simProgram, 'u_brushSize', params.brush);
  uniform2f(simProgram, 'u_mouse', pointer.x, pointer.y);
  uniform1f(simProgram, 'u_mouseDown', pointer.down ? 1 : 0);
  uniform1f(simProgram, 'u_clearFlag', clearPending ? 1 : 0);
  uniform1f(simProgram, 'u_cameraAspect', sourceWidth / Math.max(1, sourceHeight));
  uniform1f(simProgram, 'u_outputAspect', historyWidth / Math.max(1, historyHeight));
  uniform1i(simProgram, 'u_fitMode', params.fitMode);
  uniform1f(simProgram, 'u_mirror', params.mirror ? 1 : 0);

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  readIndex = writeIndex;
  clearPending = false;
}

function renderDisplay() {
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.useProgram(displayProgram);
  bindQuad(displayProgram);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, historyTextures[readIndex]);
  uniform1i(displayProgram, 'u_fbo', 0);
  uniform1i(displayProgram, 'u_mode', params.mode);
  uniform1f(displayProgram, 'u_hue', params.hue);
  uniform1i(displayProgram, 'u_palette', params.palette);
  uniform1f(displayProgram, 'u_time', accumulatedTime);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function updateTelemetry(now) {
  renderFrames += 1;
  if (now - fpsWindowStart >= 500) {
    renderFps = Math.round(renderFrames * 1000 / (now - fpsWindowStart));
    renderFrames = 0;
    fpsWindowStart = now;
    $('fpsReadout').textContent = String(renderFps);
  }
  if (now - cameraWindowStart >= 1000) {
    cameraFps = Math.round(cameraFrames * 1000 / (now - cameraWindowStart));
    cameraFrames = 0;
    cameraWindowStart = now;
    $('cameraFpsReadout').textContent = String(cameraFps);
  }
}

function render(now) {
  const delta = Math.min(0.1, Math.max(0, (now - previousFrameTime) / 1000));
  previousFrameTime = now;
  if (!contextLost && gl && simProgram && displayProgram && historyTextures[0]) {
    uploadSource(now);
    if (!paused) {
      accumulatedTime += delta;
      renderSimulation();
    }
    renderDisplay();
    updateTelemetry(now);
  }
  requestAnimationFrame(render);
}

function resizeCanvas(force = false) {
  if (!gl || contextLost) return;
  const rect = container.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(2, Math.round(rect.width * dpr));
  const height = Math.max(2, Math.round(rect.height * dpr));
  if (!force && width === canvas.width && height === canvas.height) return;
  canvas.width = width;
  canvas.height = height;
  $('canvasReadout').textContent = `${width} × ${height}`;
  allocateHistory();
}

function queueResize() {
  if (resizeQueued) return;
  resizeQueued = true;
  requestAnimationFrame(() => { resizeQueued = false; resizeCanvas(); });
}

function cameraConstraints() {
  const preset = $('capturePreset').value;
  const dimensions = {
    '480': { width: { ideal: 640 }, height: { ideal: 480 } },
    '720': { width: { ideal: 1280 }, height: { ideal: 720 } },
    '1080': { width: { ideal: 1920 }, height: { ideal: 1080 } },
    'highest': { width: { ideal: 3840 }, height: { ideal: 2160 } }
  }[preset];
  const deviceId = $('cam-select').value || activeDeviceId;
  return { audio: false, video: { ...dimensions, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) } };
}

async function enumerateCameras(preferred = activeDeviceId) {
  if (!navigator.mediaDevices?.enumerateDevices) {
    $('cameraMessage').textContent = 'Media-device enumeration is unavailable.';
    return;
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter((device) => device.kind === 'videoinput');
    $('cam-select').innerHTML = '';
    if (!cameras.length) {
      $('cam-select').innerHTML = '<option value="">Default camera</option>';
      $('cameraMessage').textContent = 'No labeled cameras yet. Start the default camera to request permission.';
      return;
    }
    cameras.forEach((camera, index) => {
      const option = document.createElement('option');
      option.value = camera.deviceId;
      option.textContent = camera.label || `Camera ${index + 1}`;
      $('cam-select').appendChild(option);
    });
    if (preferred && [...$('cam-select').options].some((option) => option.value === preferred)) $('cam-select').value = preferred;
    $('cameraMessage').textContent = `${cameras.length} camera${cameras.length === 1 ? '' : 's'} available.`;
  } catch (error) {
    $('cameraMessage').textContent = `Could not enumerate cameras: ${error.message}`;
  }
}

function stopCamera() {
  if (stream) stream.getTracks().forEach((track) => track.stop());
  stream = null;
  video.srcObject = null;
  lastVideoTime = -1;
  $('cam-btn').textContent = 'Start camera';
  $('cameraState').textContent = 'Generated source';
  $('cameraDot').className = 'status-dot ok';
  $('cameraMessage').textContent = 'Camera stopped. The generated source is active.';
  $('canvasBadge').textContent = 'GENERATED SOURCE';
  $('sourceName').textContent = 'Generated calibration source';
  $('sourceDetails').textContent = 'Start a camera to inject live frames';
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    $('cameraMessage').textContent = 'getUserMedia() is unavailable in this WebView.';
    $('cameraDot').className = 'status-dot error';
    return;
  }
  stopCamera();
  $('cameraState').textContent = 'Requesting permission…';
  $('cameraDot').className = 'status-dot warning';
  try {
    stream = await navigator.mediaDevices.getUserMedia(cameraConstraints());
    video.srcObject = stream;
    await video.play();
    const track = stream.getVideoTracks()[0];
    const settings = track.getSettings();
    activeDeviceId = settings.deviceId || $('cam-select').value || '';
    sourceWidth = settings.width || video.videoWidth || 1280;
    sourceHeight = settings.height || video.videoHeight || 720;
    $('cam-btn').textContent = 'Stop camera';
    $('cameraState').textContent = track.label || 'Camera live';
    $('cameraDot').className = 'status-dot ok';
    $('cameraMessage').textContent = `${sourceWidth} × ${sourceHeight} requested through getUserMedia().`;
    $('canvasBadge').textContent = 'CAMERA LIVE';
    $('sourceName').textContent = track.label || 'Live camera';
    $('sourceDetails').textContent = `${sourceWidth} × ${sourceHeight} · browser media texture`;
    await enumerateCameras(activeDeviceId);
  } catch (error) {
    stream = null;
    $('cameraState').textContent = 'Camera unavailable';
    $('cameraDot').className = 'status-dot error';
    $('cameraMessage').textContent = `${error.name || 'Camera error'}: ${error.message}`;
    $('canvasBadge').textContent = 'GENERATED SOURCE';
  }
}

function setMode(mode) {
  params.mode = Number(mode);
  document.querySelectorAll('.mode-btn').forEach((button) => button.classList.toggle('active', Number(button.dataset.mode) === params.mode));
  $('modeName').textContent = MODE_NAMES[params.mode];
  $('mode-desc').textContent = MODE_DESCS[params.mode];
  clearPending = true;
}

const sliderFormatters = {
  decay: (value) => value.toFixed(3),
  camMix: (value) => value.toFixed(2),
  speed: (value) => `${value.toFixed(2)}×`,
  scale: (value) => value.toFixed(2),
  intensity: (value) => value.toFixed(2),
  hue: (value) => value.toFixed(3),
  brush: (value) => value.toFixed(3)
};

function syncControls() {
  Object.entries(sliderFormatters).forEach(([id, formatter]) => {
    $(id).value = String(params[id]);
    $(`${id}-val`).textContent = formatter(params[id]);
  });
  $('palette').value = String(params.palette);
  $('fitMode').value = String(params.fitMode);
  $('mirror').checked = params.mirror;
  $('bufferScale').value = String(params.bufferScale);
  setMode(params.mode);
}

function applyPreset(name) {
  Object.assign(params, PRESETS[name]);
  syncControls();
  clearPending = true;
  setStatus(`${MODE_NAMES[params.mode]} preset loaded.`, 'ok');
}

function resetState() {
  Object.assign(params, DEFAULTS);
  accumulatedTime = 0;
  syncControls();
  allocateHistory();
  setStatus('Feedback state reset.', 'ok');
}

function togglePause() {
  paused = !paused;
  $('pauseBtn').textContent = paused ? 'Resume render' : 'Pause render';
  $('canvasBadge').className = `canvas-badge ${paused ? 'paused' : 'live'}`;
  if (paused) $('canvasBadge').textContent = 'PAUSED';
  else $('canvasBadge').textContent = stream ? 'CAMERA LIVE' : 'GENERATED SOURCE';
  setStatus(paused ? 'Simulation paused; the current history remains visible.' : 'Simulation resumed.', paused ? 'warning' : 'ok');
}

async function toggleFullscreen() {
  try {
    const invoke = window.__TAURI__?.tauri?.invoke;
    if (invoke) await invoke('toggle_fullscreen');
    else if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  } catch (error) {
    setStatus(`Fullscreen failed: ${error.message}`, 'error');
  }
}

function pointerUv(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, 1 - (event.clientY - rect.top) / rect.height))
  };
}

function wireControls() {
  Object.entries(sliderFormatters).forEach(([id, formatter]) => {
    $(id).addEventListener('input', () => {
      params[id] = Number($(id).value);
      $(`${id}-val`).textContent = formatter(params[id]);
    });
  });
  $('palette').addEventListener('change', () => { params.palette = Number($('palette').value); });
  $('fitMode').addEventListener('change', () => { params.fitMode = Number($('fitMode').value); });
  $('mirror').addEventListener('change', () => { params.mirror = $('mirror').checked; });
  $('bufferScale').addEventListener('change', () => { params.bufferScale = Number($('bufferScale').value); allocateHistory(); });
  document.querySelectorAll('.mode-btn').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));
  document.querySelectorAll('[data-preset]').forEach((button) => button.addEventListener('click', () => applyPreset(button.dataset.preset)));
  $('cam-refresh').addEventListener('click', () => enumerateCameras());
  $('cam-select').addEventListener('change', () => { activeDeviceId = $('cam-select').value; if (stream) startCamera(); });
  $('capturePreset').addEventListener('change', () => { if (stream) startCamera(); });
  $('cam-btn').addEventListener('click', () => stream ? stopCamera() : startCamera());
  $('clearBtn').addEventListener('click', () => { clearPending = true; setStatus('Feedback history cleared.', 'ok'); });
  $('resetBtn').addEventListener('click', resetState);
  $('pauseBtn').addEventListener('click', togglePause);
  $('fullscreenBtn').addEventListener('click', toggleFullscreen);
  $('compileBtn').addEventListener('click', compilePipeline);

  canvas.addEventListener('pointerdown', (event) => {
    const uv = pointerUv(event);
    pointer.x = uv.x; pointer.y = uv.y; pointer.down = true;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!pointer.down) return;
    const uv = pointerUv(event);
    pointer.x = uv.x; pointer.y = uv.y;
  });
  const release = (event) => { pointer.down = false; if (event.pointerId !== undefined && canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId); };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  document.addEventListener('keydown', (event) => {
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName)) return;
    if (event.code === 'Space') { event.preventDefault(); togglePause(); }
    if (event.key.toLowerCase() === 'x') { clearPending = true; }
    if (event.key.toLowerCase() === 'r') resetState();
    if (event.key.toLowerCase() === 'f') toggleFullscreen();
  });
}

canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  contextLost = true;
  writeDiagnostics('WebGL context lost. Waiting for restoration…', 'warning');
  setStatus('WebGL context lost.', 'error');
});

canvas.addEventListener('webglcontextrestored', () => {
  contextLost = false;
  try { initializeGpuResources(); setStatus('WebGL context restored.', 'ok'); }
  catch (error) { writeDiagnostics(error.message, 'error'); }
});

window.addEventListener('beforeunload', stopCamera);
if (navigator.mediaDevices?.addEventListener) navigator.mediaDevices.addEventListener('devicechange', () => enumerateCameras());
new ResizeObserver(queueResize).observe(container);

function start() {
  wireControls();
  syncControls();
  enumerateCameras();
  try {
    initializeGpuResources();
    setStatus('Feedback pipeline ready. Generated source active.', 'ok');
  } catch (error) {
    writeDiagnostics(error.message, 'error');
    setStatus(error.message, 'error');
  }
  previousFrameTime = performance.now();
  requestAnimationFrame(render);
}

start();
