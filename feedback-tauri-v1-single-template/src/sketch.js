// =============================================================================
// sketch.js — Webcam → Ping-Pong Framebuffer Feedback
// =============================================================================
//
// WHY WEBCAM + PING-PONG
// ───────────────────────
//   The webcam frame is injected into the simulation every tick as u_webcam.
//   The previous FBO output is available as u_prev. Each mode mixes these two
//   inputs differently — but all of them would be impossible without u_prev:
//
//   Echo Trail   — prev × decay + webcam × camMix → trails follow your body
//   Fluid Smear  — prev advected through curl field seeded by webcam edges
//   React-Diff   — webcam luminance continuously injects V chemical → you grow coral
//   Thermal      — webcam brightness = heat source → you radiate and burn outward
//   Mirror Echo  — webcam through folded symmetry, feedback builds the mandala
//   Glitch Mem   — webcam + glitched prev → VHS ghost accumulation
//
// TWO-PROGRAM ARCHITECTURE
// ─────────────────────────
//   sim.frag    reads u_prev + u_webcam → writes new state to ping FBO
//   display.frag reads ping FBO → tone-maps to screen with palette
//
//   This separation keeps simulation state in full precision and lets the
//   display layer do colour work without affecting the simulation.
//
// TEXTURE UNITS
//   TEXTURE0 — u_prev    (previous FBO frame)
//   TEXTURE1 — u_webcam  (current camera frame, uploaded every tick)
//
// =============================================================================

'use strict';

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

const params = {
    mode: 0, decay: 0.97, camMix: 0.3,
    speed: 1.0, scale: 1.0, intensity: 1.0,
    hue: 0.0, palette: 0, brush: 0.03,
};

const MODE_DESCS = [
    'Your webcam frame decays and accumulates — movement leaves glowing trails.',
    'Webcam edges seed a curl-noise flow field. You become liquid.',
    'Webcam luminance injects V chemical each frame — your silhouette grows coral.',
    'Webcam brightness is a continuous heat source. You radiate and erode.',
    'Webcam folded into 6-way symmetry — you become a live mandala.',
    'Webcam + glitched accumulated memory. VHS ghost of everything you did.',
];

const PALETTE_NAMES = ['Fire', 'Ice', 'Acid', 'Void', 'Rainbow'];

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

const VERT = `
    precision highp float;
    attribute vec2 a_pos;
    varying   vec2 v_uv;
    void main() { v_uv = a_pos*0.5+0.5; gl_Position = vec4(a_pos,0.0,1.0); }
`;

// ── Simulation shader ──────────────────────────────────────────────────────
// u_prev   = previous FBO (the feedback source)
// u_webcam = live camera frame (the input driving every mode)
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
        float t    = u_time * u_speed * 0.3;
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
        float th = atan(c.y, c.x) + u_time * u_speed * 0.004;

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

// ── Display shader ─────────────────────────────────────────────────────────
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

// ---------------------------------------------------------------------------
// WebGL init
// ---------------------------------------------------------------------------

const canvas = document.getElementById('glcanvas');
const gl     = canvas.getContext('webgl');
if (!gl) { document.body.innerHTML = '<p style="color:#f88;padding:2rem">WebGL not supported.</p>'; throw new Error('no webgl'); }

const floatExt = gl.getExtension('OES_texture_float');
const floatLinExt = gl.getExtension('OES_texture_float_linear');
const USE_FLOAT = !!floatExt;

function mkShader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
}
function mkProg(vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, mkShader(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, mkShader(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
}

const simProg     = mkProg(VERT, SIM);
const displayProg = mkProg(VERT, DISPLAY);

const qBuf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, qBuf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);

function bindQuad(prog) {
    const l = gl.getAttribLocation(prog, 'a_pos');
    gl.bindBuffer(gl.ARRAY_BUFFER, qBuf);
    gl.enableVertexAttribArray(l);
    gl.vertexAttribPointer(l, 2, gl.FLOAT, false, 0, 0);
}

function u1f(p,n,v){const l=gl.getUniformLocation(p,n);if(l!==null)gl.uniform1f(l,v);}
function u1i(p,n,v){const l=gl.getUniformLocation(p,n);if(l!==null)gl.uniform1i(l,v);}
function u2f(p,n,a,b){const l=gl.getUniformLocation(p,n);if(l!==null)gl.uniform2f(l,a,b);}

// ---------------------------------------------------------------------------
// Webcam texture
// ---------------------------------------------------------------------------

const video = document.getElementById('webcam-video');
let cameraOn = false;
let webcamTex = null;
let activeDeviceId = null;

function mkTex(w, h, isFloat) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    if (w && h) {
        const type = isFloat ? gl.FLOAT : gl.UNSIGNED_BYTE;
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, type, null);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const filter = (isFloat && floatLinExt) ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, isFloat ? filter : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, isFloat ? filter : gl.LINEAR);
    return t;
}

function initWebcamTex() {
    webcamTex = mkTex(null, null, false);
    // 1×1 black placeholder until camera starts
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0,0,0,255]));
}

function uploadFrame() {
    if (!cameraOn || video.readyState < video.HAVE_CURRENT_DATA) return;
    gl.bindTexture(gl.TEXTURE_2D, webcamTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
}

// ---------------------------------------------------------------------------
// Ping-pong FBOs
// ---------------------------------------------------------------------------

let fbW = 0, fbH = 0;
let fbos = [null, null], fbTexs = [null, null], ping = 0;
let clearPending = false;

function initFBOs(w, h) {
    fbW = w; fbH = h;
    for (let i = 0; i < 2; i++) {
        if (fbTexs[i]) gl.deleteTexture(fbTexs[i]);
        if (fbos[i])   gl.deleteFramebuffer(fbos[i]);
        fbTexs[i] = mkTex(w, h, USE_FLOAT);
        fbos[i]   = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbos[i]);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fbTexs[i], 0);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    clearPending = true;
}

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------

const t0 = performance.now();
const mouse = { x: 0.5, y: 0.5, down: false };

function render() {
    const elapsed = (performance.now() - t0) / 1000;
    const pong    = 1 - ping;

    uploadFrame();

    // ── Sim pass ──────────────────────────────────────────────────────────
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbos[ping]);
    gl.viewport(0, 0, fbW, fbH);
    gl.useProgram(simProg);
    bindQuad(simProg);

    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fbTexs[pong]); u1i(simProg,'u_prev',0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, webcamTex);    u1i(simProg,'u_webcam',1);

    u1f(simProg,'u_time',      elapsed);
    u2f(simProg,'u_res',       fbW, fbH);
    u1i(simProg,'u_mode',      params.mode);
    u1f(simProg,'u_decay',     params.decay);
    u1f(simProg,'u_camMix',    params.camMix);
    u1f(simProg,'u_speed',     params.speed);
    u1f(simProg,'u_scale',     params.scale);
    u1f(simProg,'u_intensity', params.intensity);
    u1f(simProg,'u_brushSize', params.brush);
    u2f(simProg,'u_mouse',     mouse.x, mouse.y);
    u1f(simProg,'u_mouseDown', mouse.down ? 1.0 : 0.0);
    u1f(simProg,'u_clearFlag', clearPending ? 1.0 : 0.0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    clearPending = false;

    // ── Display pass ──────────────────────────────────────────────────────
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(displayProg);
    bindQuad(displayProg);

    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fbTexs[ping]); u1i(displayProg,'u_fbo',0);
    u1i(displayProg,'u_mode',    params.mode);
    u1f(displayProg,'u_hue',     params.hue);
    u1i(displayProg,'u_palette', params.palette);
    u1f(displayProg,'u_time',    elapsed);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    ping = pong;
    requestAnimationFrame(render);
}

// ---------------------------------------------------------------------------
// Camera management  (same pattern as webcam single template)
// ---------------------------------------------------------------------------

function enableCameraControls(enabled) {
    document.getElementById('cam-select').disabled  = !enabled;
    document.getElementById('cam-refresh').disabled = !enabled;
    document.getElementById('cam-refresh').style.opacity = enabled ? '1' : '0.4';
    document.getElementById('cam-refresh').style.cursor  = enabled ? 'pointer' : 'not-allowed';
}

async function enumerateDevices(selectId) {
    const sel = document.getElementById('cam-select');
    const target = selectId !== undefined ? selectId : activeDeviceId;
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cams    = devices.filter(d => d.kind === 'videoinput');
        sel.innerHTML = '';
        if (cams.length === 0) { sel.innerHTML = '<option value="">No cameras found</option>'; return; }
        cams.forEach((cam, i) => {
            const o = document.createElement('option');
            o.value = cam.deviceId; o.textContent = cam.label || `Camera ${i+1}`;
            sel.appendChild(o);
        });
        if (target && sel.querySelector(`option[value="${target}"]`)) sel.value = target;
    } catch (_) { sel.innerHTML = '<option value="">Permission denied</option>'; }
}

function stopStream() {
    if (video.srcObject) { video.srcObject.getTracks().forEach(t => t.stop()); video.srcObject = null; }
    cameraOn = false; activeDeviceId = null;
}

async function startCamera() {
    const sel  = document.getElementById('cam-select');
    const stat = document.getElementById('cam-status');
    const btn  = document.getElementById('cam-btn');
    stopStream();
    const did = sel.value || undefined;
    stat.textContent = 'requesting…'; stat.className = '';
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: did ? { deviceId:{exact:did}, width:{ideal:1280}, height:{ideal:720} }
                       : { width:{ideal:1280}, height:{ideal:720} },
            audio: false,
        });
        video.srcObject = stream; await video.play();
        const track = stream.getVideoTracks()[0];
        activeDeviceId = track?.getSettings()?.deviceId || did || null;
        cameraOn = true;
        stat.textContent = `${video.videoWidth}×${video.videoHeight}`; stat.className = 'ok';
        btn.textContent  = '■ Stop';
        enableCameraControls(true);
        await enumerateDevices(activeDeviceId);
    } catch (e) {
        stat.textContent = `Error: ${e.message}`; stat.className = 'err';
    }
}

function stopCamera() {
    stopStream(); enableCameraControls(false);
    document.getElementById('cam-status').textContent = 'stopped';
    document.getElementById('cam-status').className   = '';
    document.getElementById('cam-btn').textContent    = '▶ Start';
}

// ---------------------------------------------------------------------------
// Mouse
// ---------------------------------------------------------------------------

function canvasUV(e) {
    const r = canvas.getBoundingClientRect();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    return { x:(cx-r.left)/r.width, y:1.0-(cy-r.top)/r.height };
}
canvas.addEventListener('mousedown',  e => { const uv=canvasUV(e); mouse.x=uv.x; mouse.y=uv.y; mouse.down=true; });
canvas.addEventListener('mousemove',  e => { if(!mouse.down)return; const uv=canvasUV(e); mouse.x=uv.x; mouse.y=uv.y; });
canvas.addEventListener('mouseup',    () => mouse.down=false);
canvas.addEventListener('mouseleave', () => mouse.down=false);

// ---------------------------------------------------------------------------
// Controls wiring
// ---------------------------------------------------------------------------

const SLIDER_FMT = {
    decay:     v => v.toFixed(3),
    camMix:    v => v.toFixed(2),
    speed:     v => v.toFixed(2),
    scale:     v => v.toFixed(2),
    intensity: v => v.toFixed(2),
    hue:       v => v.toFixed(3),
    palette:   v => PALETTE_NAMES[Math.round(v)],
    brush:     v => v.toFixed(3),
};

function wireControls() {
    Object.keys(SLIDER_FMT).forEach(id => {
        const input = document.getElementById(id);
        const valEl = document.getElementById(`${id}-val`);
        if (!input) return;
        input.addEventListener('input', () => {
            const val = parseFloat(input.value);
            params[id] = (id === 'palette') ? Math.round(val) : val;
            if (valEl) valEl.textContent = SLIDER_FMT[id](val);
        });
    });

    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            params.mode = parseInt(btn.dataset.mode);
            document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('mode-desc').textContent = MODE_DESCS[params.mode];
            clearPending = true;
        });
    });

    document.getElementById('cam-btn').addEventListener('click', () => {
        if (cameraOn) stopCamera(); else startCamera();
    });
    document.getElementById('cam-select').addEventListener('change', () => startCamera());
    document.getElementById('cam-refresh').addEventListener('click', () => enumerateDevices());
    document.getElementById('clear-btn').addEventListener('click', () => { clearPending = true; });
}

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------

function resize() {
    const c = document.getElementById('canvas-container');
    canvas.width  = c.clientWidth;
    canvas.height = c.clientHeight;
    initFBOs(Math.floor(c.clientWidth / 2), Math.floor(c.clientHeight / 2));
}
new ResizeObserver(resize).observe(document.getElementById('canvas-container'));

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
    wireControls();
    resize();
    initWebcamTex();
    enumerateDevices();
    requestAnimationFrame(render);
});
