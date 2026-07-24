// =============================================================================
// sketch.js — webcam → WebGL texture → GLSL effects + ping-pong feedback
// =============================================================================
//
// HOW IT WORKS
// ─────────────
//   1. getUserMedia() → hidden <video> element streams camera frames
//   2. Every render tick: gl.texImage2D uploads the video frame to u_webcam
//   3. Fragment shader samples u_webcam and applies the selected effect
//   4. Ping-pong framebuffers: previous output is u_prevFrame for feedback
//
// EFFECT MODES (u_effect)
// ────────────────────────
//   0  Passthrough       Raw camera + colour adjustments only
//   1  Wave Distortion   Sine UV warp driven by u_time
//   2  Radial Warp       Zoom-pulse from centre
//   3  Kaleidoscope      6-fold rotational symmetry
//   4  Edge Detect       Sobel operator on luminance
//   5  Glitch            RGB-split band displacement
//
// =============================================================================

'use strict';

// ---------------------------------------------------------------------------
// 1. Params
// ---------------------------------------------------------------------------

const params = {
    effect:     0.0,
    distortion: 0.0,
    feedback:   0.0,
    zoom:       1.0,
    speed:      0.3,
    hue:        0.0,
    saturation: 1.0,
    brightness: 1.0,
    contrast:   1.0,
    mirror:     0.0,
    invert:     0.0,
    greyscale:  0.0,
};

const PARAMS  = ['effect','distortion','feedback','zoom','speed','hue','saturation','brightness','contrast'];
const TOGGLES = ['mirror','invert','greyscale'];
const EFFECT_NAMES = ['Passthrough','Wave Distort','Radial Warp','Kaleidoscope','Edge Detect','Glitch'];

// ---------------------------------------------------------------------------
// 2. Shaders
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

const FRAG_SHADER = `
    precision highp float;

    uniform sampler2D u_webcam;
    uniform sampler2D u_prevFrame;

    uniform float u_time;
    uniform vec2  u_resolution;

    uniform float u_effect;
    uniform float u_distortion;
    uniform float u_feedback;
    uniform float u_zoom;
    uniform float u_speed;

    uniform float u_hue;
    uniform float u_saturation;
    uniform float u_brightness;
    uniform float u_contrast;

    uniform float u_mirror;
    uniform float u_invert;
    uniform float u_greyscale;

    varying vec2 vTexCoord;

    float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

    vec3 rotateHue(vec3 col, float deg) {
        float a  = deg * 3.14159 / 180.0;
        float c  = cos(a); float s = sin(a);
        float k  = 1.0 / 3.0; float sq = sqrt(k);
        mat3 m   = mat3(
            c+(1.0-c)*k,      (1.0-c)*k-sq*s,  (1.0-c)*k+sq*s,
            (1.0-c)*k+sq*s,   c+(1.0-c)*k,     (1.0-c)*k-sq*s,
            (1.0-c)*k-sq*s,   (1.0-c)*k+sq*s,  c+(1.0-c)*k
        );
        return clamp(m * col, 0.0, 1.0);
    }

    float sobel(vec2 uv) {
        vec2 px = 1.0 / u_resolution;
        float gx =
            -1.0*luma(texture2D(u_webcam,uv+vec2(-px.x,-px.y)).rgb) +
             1.0*luma(texture2D(u_webcam,uv+vec2( px.x,-px.y)).rgb) +
            -2.0*luma(texture2D(u_webcam,uv+vec2(-px.x, 0.0 )).rgb) +
             2.0*luma(texture2D(u_webcam,uv+vec2( px.x, 0.0 )).rgb) +
            -1.0*luma(texture2D(u_webcam,uv+vec2(-px.x, px.y)).rgb) +
             1.0*luma(texture2D(u_webcam,uv+vec2( px.x, px.y)).rgb);
        float gy =
            -1.0*luma(texture2D(u_webcam,uv+vec2(-px.x,-px.y)).rgb) +
            -2.0*luma(texture2D(u_webcam,uv+vec2( 0.0, -px.y)).rgb) +
            -1.0*luma(texture2D(u_webcam,uv+vec2( px.x,-px.y)).rgb) +
             1.0*luma(texture2D(u_webcam,uv+vec2(-px.x, px.y)).rgb) +
             2.0*luma(texture2D(u_webcam,uv+vec2( 0.0,  px.y)).rgb) +
             1.0*luma(texture2D(u_webcam,uv+vec2( px.x, px.y)).rgb);
        return clamp(sqrt(gx*gx + gy*gy) * 4.0, 0.0, 1.0);
    }

    vec3 applyEffect(vec2 uv) {
        float t = u_time * u_speed;

        if (u_effect < 0.5) {
            return texture2D(u_webcam, uv).rgb;
        }
        else if (u_effect < 1.5) {
            vec2 warpUV = uv + u_distortion * vec2(
                sin(uv.y * 10.0 + t) * 0.05,
                cos(uv.x * 10.0 + t) * 0.05
            );
            return texture2D(u_webcam, warpUV).rgb;
        }
        else if (u_effect < 2.5) {
            vec2 centre = uv - 0.5;
            float r     = length(centre);
            float theta = atan(centre.y, centre.x);
            float rW    = r + u_distortion * 0.3 * sin(r * 8.0 - t);
            return texture2D(u_webcam, vec2(cos(theta), sin(theta)) * rW + 0.5).rgb;
        }
        else if (u_effect < 3.5) {
            vec2  centre  = uv - 0.5;
            float r       = length(centre);
            float theta   = atan(centre.y, centre.x);
            float sector  = 3.14159 * 2.0 / 6.0;
            theta         = mod(theta, sector);
            if (theta > sector * 0.5) theta = sector - theta;
            theta        += t * u_distortion * 0.5;
            return texture2D(u_webcam, vec2(cos(theta), sin(theta)) * r + 0.5).rgb;
        }
        else if (u_effect < 4.5) {
            float edge = sobel(uv);
            return mix(vec3(0.0), texture2D(u_webcam, uv).rgb, edge);
        }
        else {
            float band  = floor(uv.y * 20.0) / 20.0;
            float rnd   = fract(sin(band * 127.1 + floor(t * 8.0) * 31.7) * 43758.5);
            float shift = (rnd - 0.5) * u_distortion * 0.3;
            float rS    = shift + (fract(rnd * 3.7) - 0.5) * u_distortion * 0.05;
            float bS    = shift - (fract(rnd * 5.3) - 0.5) * u_distortion * 0.05;
            float rv    = texture2D(u_webcam, vec2(uv.x + rS, uv.y)).r;
            float gv    = texture2D(u_webcam, vec2(uv.x + shift, uv.y)).g;
            float bv    = texture2D(u_webcam, vec2(uv.x + bS, uv.y)).b;
            return vec3(rv, gv, bv);
        }
    }

    void main() {
        vec2 uv = vTexCoord;
        if (u_mirror > 0.5) uv.x = 1.0 - uv.x;
        uv = (uv - 0.5) / u_zoom + 0.5;

        vec3 col = applyEffect(uv);

        if (u_feedback > 0.001) {
            col = mix(col, texture2D(u_prevFrame, vTexCoord).rgb, u_feedback);
        }

        if (u_hue > 0.5 || u_hue < -0.5) col = rotateHue(col, u_hue);

        if (u_greyscale > 0.5) {
            col = vec3(luma(col));
        } else if (abs(u_saturation - 1.0) > 0.01) {
            col = mix(vec3(luma(col)), col, u_saturation);
        }

        col *= u_brightness;
        col  = (col - 0.5) * u_contrast + 0.5;
        if (u_invert > 0.5) col = 1.0 - col;

        gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
`;

// ---------------------------------------------------------------------------
// 3. WebGL init
// ---------------------------------------------------------------------------

const canvas = document.getElementById('glcanvas');
const gl     = canvas.getContext('webgl');

if (!gl) {
    document.body.innerHTML = '<p style="color:#f88;padding:2rem">WebGL not supported.</p>';
    throw new Error('WebGL unavailable');
}

function compileShader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(s));
    return s;
}

const program = (() => {
    const p = gl.createProgram();
    gl.attachShader(p, compileShader(gl.VERTEX_SHADER,   VERT_SHADER));
    gl.attachShader(p, compileShader(gl.FRAGMENT_SHADER, FRAG_SHADER));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
        throw new Error(gl.getProgramInfoLog(p));
    return p;
})();

gl.useProgram(program);

const quadBuf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
const aPos = gl.getAttribLocation(program, 'a_position');
gl.enableVertexAttribArray(aPos);
gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

function u1f(name, v) { const l = gl.getUniformLocation(program, name); if (l) gl.uniform1f(l, v); }
function u2f(name, a, b) { const l = gl.getUniformLocation(program, name); if (l) gl.uniform2f(l, a, b); }
function u1i(name, v) { const l = gl.getUniformLocation(program, name); if (l) gl.uniform1i(l, v); }

// ---------------------------------------------------------------------------
// 4. Webcam texture
// ---------------------------------------------------------------------------

const video = document.getElementById('webcam-video');
let cameraOn = false;
let webcamTex = null;

function makeTexture() {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
}

function uploadFrame() {
    if (!cameraOn || video.readyState < video.HAVE_CURRENT_DATA) return;
    gl.bindTexture(gl.TEXTURE_2D, webcamTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
}

// ---------------------------------------------------------------------------
// 5. Ping-pong framebuffers
// ---------------------------------------------------------------------------

let fbos = [null, null], fbTexs = [null, null], ping = 0;

function makeFBO(w, h) {
    const tex = makeTexture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return { fb, tex };
}

function initFBOs(w, h) {
    for (let i = 0; i < 2; i++) {
        const { fb, tex } = makeFBO(w, h);
        fbos[i] = fb; fbTexs[i] = tex;
    }
}

function resizeFBOs(w, h) {
    for (let i = 0; i < 2; i++) {
        gl.bindTexture(gl.TEXTURE_2D, fbTexs[i]);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
}

// ---------------------------------------------------------------------------
// 6. render()
// ---------------------------------------------------------------------------

const startTime = performance.now();

function render() {
    const elapsed = (performance.now() - startTime) / 1000.0;
    const pong = 1 - ping;

    uploadFrame();

    // Pass 1: render effect into ping FBO
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbos[ping]);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program);

    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, webcamTex); u1i('u_webcam', 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, fbTexs[pong]); u1i('u_prevFrame', 1);

    u1f('u_time', elapsed);
    u2f('u_resolution', canvas.width, canvas.height);
    u1f('u_effect',     params.effect);
    u1f('u_distortion', params.distortion);
    u1f('u_feedback',   params.feedback);
    u1f('u_zoom',       params.zoom);
    u1f('u_speed',      params.speed);
    u1f('u_hue',        params.hue);
    u1f('u_saturation', params.saturation);
    u1f('u_brightness', params.brightness);
    u1f('u_contrast',   params.contrast);
    u1f('u_mirror',     params.mirror);
    u1f('u_invert',     params.invert);
    u1f('u_greyscale',  params.greyscale);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Pass 2: blit ping FBO to screen (no feedback, no effect re-apply)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fbTexs[ping]); u1i('u_webcam', 0);
    u1f('u_feedback', 0.0); u1f('u_effect', 0.0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Restore for next FBO pass
    u1f('u_feedback', params.feedback);
    u1f('u_effect',   params.effect);

    ping = pong;
    requestAnimationFrame(render);
}

// ---------------------------------------------------------------------------
// 7. Camera management
// ---------------------------------------------------------------------------

// The deviceId of the currently running stream (set in startCamera, cleared in stopCamera)
let activeDeviceId = null;

/**
 * Stop any running stream tracks without changing UI state.
 * Used internally before switching cameras.
 */
function stopStream() {
    if (video.srcObject) {
        video.srcObject.getTracks().forEach(t => t.stop());
        video.srcObject = null;
    }
    cameraOn = false;
    activeDeviceId = null;
}

/**
 * Enable or disable the camera select and refresh button.
 * They are disabled on startup because browsers won't return device labels
 * until getUserMedia permission has been granted at least once.
 */
function enableCameraControls(enabled) {
    const sel = document.getElementById('cam-select');
    const btn = document.getElementById('cam-refresh');
    sel.disabled = !enabled;
    btn.disabled = !enabled;
    btn.style.cursor  = enabled ? 'pointer'      : 'not-allowed';
    btn.style.color   = enabled ? '#7c9fff'      : 'rgba(124,159,255,0.3)';
    btn.style.background   = enabled ? 'rgba(124,159,255,0.08)' : 'rgba(124,159,255,0.04)';
    btn.style.borderColor  = enabled ? 'rgba(124,159,255,0.25)' : 'rgba(124,159,255,0.12)';
}

/**
 * Enumerate video input devices and rebuild the <select>.
 * Preserves whichever deviceId is currently active so the select
 * visually reflects the running camera after a switch or refresh.
 *
 * @param {string} [selectId] — deviceId to select after rebuilding (defaults to activeDeviceId)
 */
async function enumerateDevices(selectId) {
    const sel    = document.getElementById('cam-select');
    const target = selectId !== undefined ? selectId : activeDeviceId;

    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cams    = devices.filter(d => d.kind === 'videoinput');

        sel.innerHTML = '';

        if (cams.length === 0) {
            sel.innerHTML = '<option value="">No cameras found</option>';
            return;
        }

        cams.forEach((cam, i) => {
            const o = document.createElement('option');
            o.value = cam.deviceId;
            o.textContent = cam.label || `Camera ${i + 1}`;
            sel.appendChild(o);
        });

        // Restore selection to the active camera (or requested target)
        if (target && sel.querySelector(`option[value="${target}"]`)) {
            sel.value = target;
        }
    } catch (_) {
        sel.innerHTML = '<option value="">Permission denied</option>';
    }
}

/**
 * Start (or restart) the camera.
 * Always stops any existing stream first to avoid track conflicts.
 * Uses the currently selected deviceId from the <select>.
 */
async function startCamera() {
    const sel  = document.getElementById('cam-select');
    const stat = document.getElementById('cam-status');
    const btn  = document.getElementById('cam-btn');

    // Stop old stream before requesting a new one
    stopStream();

    const did = sel.value || undefined;
    stat.textContent = 'requesting…'; stat.className = '';

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: did
                ? { deviceId: { exact: did }, width: { ideal: 1280 }, height: { ideal: 720 } }
                : { width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false,
        });

        video.srcObject = stream;
        await video.play();

        // Record which device is now active
        const track = stream.getVideoTracks()[0];
        activeDeviceId = track?.getSettings()?.deviceId || did || null;

        cameraOn = true;
        stat.textContent = `${video.videoWidth}×${video.videoHeight}`;
        stat.className   = 'ok';
        btn.textContent  = '■ Stop Camera';

        // Permission granted — unlock the select and refresh button
        enableCameraControls(true);

        // Re-enumerate now that labels are available, restore active selection
        await enumerateDevices(activeDeviceId);

    } catch (e) {
        stat.textContent = `Error: ${e.message}`;
        stat.className   = 'err';
    }
}

function stopCamera() {
    const stat = document.getElementById('cam-status');
    const btn  = document.getElementById('cam-btn');
    stopStream();
    enableCameraControls(false);
    stat.textContent = 'stopped'; stat.className = '';
    btn.textContent  = '▶ Start Camera';
}

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
            if (valEl) valEl.textContent = id === 'effect'
                ? (EFFECT_NAMES[Math.round(val)] || val)
                : (Number.isInteger(val) ? val.toString() : val.toFixed(2));
        });
    });
    TOGGLES.forEach(id => {
        const input = document.getElementById(id);
        if (!input) return;
        input.addEventListener('change', () => { params[id] = input.checked ? 1.0 : 0.0; });
    });
    document.getElementById('cam-btn').addEventListener('click', () => {
        if (cameraOn) stopCamera(); else startCamera();
    });
    // Selecting a different camera always restarts the stream with that device
    document.getElementById('cam-select').addEventListener('change', () => {
        startCamera();
    });
    // Refresh button: re-enumerate without restarting the stream
    document.getElementById('cam-refresh').addEventListener('click', () => {
        enumerateDevices();
    });
}

// ---------------------------------------------------------------------------
// 9. Resize
// ---------------------------------------------------------------------------

function resize() {
    const c = document.getElementById('canvas-container');
    const w = c.clientWidth, h = c.clientHeight;
    if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w; canvas.height = h;
        if (fbTexs[0]) resizeFBOs(w, h);
    }
}
new ResizeObserver(resize).observe(document.getElementById('canvas-container'));

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
    wireControls();
    resize();
    webcamTex = makeTexture();
    // Fill webcam texture with a 1x1 black pixel so the shader doesn't sample garbage before camera starts
    gl.bindTexture(gl.TEXTURE_2D, webcamTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0,0,0,255]));
    initFBOs(canvas.width, canvas.height);
    enumerateDevices();
    requestAnimationFrame(render);
});
