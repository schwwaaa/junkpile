(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const canvas = $("gl-canvas");
  const stage = $("stage");
  const cameraVideo = $("camera-video");
  const backgroundVideo = $("background-video");
  const emptyState = $("empty-state");
  const unsupported = $("unsupported");

  const ui = {
    cameraState: $("camera-state"), cameraSelect: $("camera-select"), refreshCameras: $("refresh-cameras"),
    startCamera: $("start-camera"), stopCamera: $("stop-camera"), cameraResolution: $("camera-resolution"),
    cameraMirror: $("camera-mirror"), cameraSize: $("camera-size"), cameraFrames: $("camera-frames"),
    backgroundFile: $("background-file"), clearBackground: $("clear-background"), backgroundPlay: $("background-play"),
    backgroundName: $("background-name"), backgroundStyle: $("background-style"), backgroundColorA: $("background-color-a"),
    backgroundColorB: $("background-color-b"), backgroundFit: $("background-fit"), backgroundZoom: $("background-zoom"),
    backgroundPanX: $("background-pan-x"), backgroundPanY: $("background-pan-y"), backgroundBlur: $("background-blur"),
    backgroundSpeed: $("background-speed"), keyMode: $("key-mode"), keyColor: $("key-color"), sampleKey: $("sample-key"),
    keyThreshold: $("key-threshold"), keySoftness: $("key-softness"), spill: $("spill"), matteExpand: $("matte-expand"),
    lumaLevel: $("luma-level"), invertMatte: $("invert-matte"), matteReadout: $("matte-readout"),
    foregroundFit: $("foreground-fit"), foregroundZoom: $("foreground-zoom"), foregroundPanX: $("foreground-pan-x"),
    foregroundPanY: $("foreground-pan-y"), foregroundRotation: $("foreground-rotation"),
    foregroundSaturation: $("foreground-saturation"), foregroundExposure: $("foreground-exposure"), foregroundContrast: $("foreground-contrast"),
    overlayFile: $("overlay-file"), clearOverlay: $("clear-overlay"), overlayName: $("overlay-name"), overlayBlend: $("overlay-blend"),
    overlayOpacity: $("overlay-opacity"), overlayScale: $("overlay-scale"), overlayPanX: $("overlay-pan-x"), overlayPanY: $("overlay-pan-y"),
    viewMode: $("view-mode"), recordFps: $("record-fps"), recordButton: $("record-button"), pauseButton: $("pause-button"),
    stopRecording: $("stop-recording"), saveRecording: $("save-recording"), saveSnapshot: $("save-snapshot"),
    recordState: $("record-state"), recordTime: $("record-time"), recordSize: $("record-size"), codecLabel: $("codec-label"),
    lastFile: $("last-file"), fpsLabel: $("fps-label"), renderSize: $("render-size"), hudCamera: $("hud-camera"),
    hudView: $("hud-view"), hudKey: $("hud-key"), recordingBorder: $("recording-border"), emptyStart: $("empty-start")
  };

  const rangeFormats = {
    "background-zoom": (v) => Number(v).toFixed(2), "background-pan-x": (v) => Number(v).toFixed(2),
    "background-pan-y": (v) => Number(v).toFixed(2), "background-blur": (v) => Number(v).toFixed(1),
    "background-speed": (v) => Number(v).toFixed(2), "key-threshold": (v) => Number(v).toFixed(3),
    "key-softness": (v) => Number(v).toFixed(3), "spill": (v) => Number(v).toFixed(2),
    "matte-expand": (v) => Number(v).toFixed(3), "luma-level": (v) => Number(v).toFixed(3),
    "foreground-zoom": (v) => Number(v).toFixed(2), "foreground-pan-x": (v) => Number(v).toFixed(2),
    "foreground-pan-y": (v) => Number(v).toFixed(2), "foreground-rotation": (v) => `${Math.round(Number(v))}°`,
    "foreground-saturation": (v) => Number(v).toFixed(2), "foreground-exposure": (v) => Number(v).toFixed(2),
    "foreground-contrast": (v) => Number(v).toFixed(2), "overlay-opacity": (v) => Number(v).toFixed(2),
    "overlay-scale": (v) => Number(v).toFixed(2), "overlay-pan-x": (v) => Number(v).toFixed(2),
    "overlay-pan-y": (v) => Number(v).toFixed(2)
  };

  const keyNames = ["No key", "Chroma key", "Luminance key"];
  const viewNames = ["Composite", "Matte", "Foreground", "Background"];

  const state = {
    gl: null, program: null, uniforms: {}, cameraTexture: null, backgroundTexture: null, overlayTexture: null,
    cameraStream: null, cameraActive: false, cameraFrames: 0, cameraWidth: 1280, cameraHeight: 720,
    backgroundKind: "procedural", backgroundUrl: "", backgroundWidth: 1280, backgroundHeight: 720,
    overlayUrl: "", overlayWidth: 1280, overlayHeight: 720, overlayGenerated: true,
    startedAt: performance.now(), previousFrameAt: performance.now(), fpsAverage: 0,
    recorder: null, recorderStream: null, chunks: [], recordedBytes: 0, recordStartedAt: 0,
    pauseStartedAt: 0, pausedDuration: 0, lastBlob: null, lastMime: "", chosenMime: "", recordingTimer: 0,
    sampleCanvas: document.createElement("canvas"), sampleContext: null
  };
  state.sampleCanvas.width = 1;
  state.sampleCanvas.height = 1;
  state.sampleContext = state.sampleCanvas.getContext("2d", { willReadFrequently: true });

  const VERTEX_SHADER = `
    attribute vec2 a_position;
    varying vec2 v_uv;
    void main() {
      v_uv = a_position * 0.5 + 0.5;
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  const FRAGMENT_SHADER = `
    precision highp float;
    varying vec2 v_uv;
    uniform vec2 u_resolution;
    uniform float u_time;
    uniform sampler2D u_camera;
    uniform sampler2D u_background;
    uniform sampler2D u_overlay;
    uniform vec2 u_camera_size;
    uniform vec2 u_background_size;
    uniform vec2 u_overlay_size;
    uniform float u_camera_active;
    uniform float u_background_media;
    uniform float u_background_style;
    uniform vec3 u_background_color_a;
    uniform vec3 u_background_color_b;
    uniform float u_background_fit;
    uniform float u_background_zoom;
    uniform vec2 u_background_pan;
    uniform float u_background_blur;
    uniform float u_background_speed;
    uniform float u_foreground_fit;
    uniform float u_foreground_zoom;
    uniform vec2 u_foreground_pan;
    uniform float u_foreground_rotation;
    uniform float u_foreground_mirror;
    uniform float u_foreground_saturation;
    uniform float u_foreground_exposure;
    uniform float u_foreground_contrast;
    uniform float u_key_mode;
    uniform vec3 u_key_color;
    uniform float u_key_threshold;
    uniform float u_key_softness;
    uniform float u_spill;
    uniform float u_matte_expand;
    uniform float u_luma_level;
    uniform float u_invert_matte;
    uniform float u_overlay_generated;
    uniform float u_overlay_blend;
    uniform float u_overlay_opacity;
    uniform float u_overlay_scale;
    uniform vec2 u_overlay_pan;
    uniform float u_view_mode;

    #define PI 3.14159265359

    float hash21(vec2 p) {
      p = fract(p * vec2(123.34, 345.45));
      p += dot(p, p + 34.345);
      return fract(p.x * p.y);
    }

    float noise2(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = hash21(i);
      float b = hash21(i + vec2(1.0, 0.0));
      float c = hash21(i + vec2(0.0, 1.0));
      float d = hash21(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }

    vec2 rotate2(vec2 p, float angle) {
      float c = cos(angle);
      float s = sin(angle);
      return mat2(c, -s, s, c) * p;
    }

    vec2 mappedUv(vec2 uv, vec2 sourceSize, float fitMode, float zoom, vec2 pan, float rotation, float mirror) {
      float targetAspect = u_resolution.x / max(u_resolution.y, 1.0);
      float sourceAspect = sourceSize.x / max(sourceSize.y, 1.0);
      vec2 p = uv - 0.5;
      p -= pan * 0.5;
      p = rotate2(p, -rotation);
      p /= max(zoom, 0.001);
      if (mirror > 0.5) p.x *= -1.0;
      if (fitMode < 0.5) {
        if (sourceAspect > targetAspect) p.x *= targetAspect / sourceAspect;
        else p.y *= sourceAspect / targetAspect;
      } else if (fitMode < 1.5) {
        if (sourceAspect > targetAspect) p.y *= sourceAspect / targetAspect;
        else p.x *= targetAspect / sourceAspect;
      }
      return p + 0.5;
    }

    float insideUv(vec2 uv) {
      return step(0.0, uv.x) * step(0.0, uv.y) * step(uv.x, 1.0) * step(uv.y, 1.0);
    }

    vec3 proceduralBackground(vec2 uv) {
      vec2 p = uv * 2.0 - 1.0;
      p.x *= u_resolution.x / max(u_resolution.y, 1.0);
      float t = u_time * u_background_speed;
      if (u_background_style < 0.5) {
        float wave = 0.5 + 0.5 * sin(p.x * 2.4 + p.y * 1.7 + t);
        float glow = exp(-1.8 * length(p - vec2(sin(t * 0.3), cos(t * 0.24)) * 0.32));
        return mix(u_background_color_a, u_background_color_b, clamp(wave * 0.72 + glow * 0.36, 0.0, 1.0));
      }
      if (u_background_style < 1.5) {
        float n = noise2(p * 2.2 + vec2(t * 0.16, -t * 0.11));
        float n2 = noise2(p * 4.6 - vec2(t * 0.08, t * 0.13));
        return mix(u_background_color_a, u_background_color_b, smoothstep(0.15, 0.9, n * 0.72 + n2 * 0.28));
      }
      if (u_background_style < 2.5) {
        float horizon = smoothstep(-0.15, 0.1, -p.y);
        vec2 q = p / max(0.22, p.y + 1.2);
        float grid = max(smoothstep(0.06, 0.0, abs(fract(q.x * 4.0 + t * 0.25) - 0.5)), smoothstep(0.05, 0.0, abs(fract(q.y * 7.0 - t * 0.3) - 0.5)));
        vec3 base = mix(u_background_color_a * 0.2, u_background_color_b * 0.45, horizon);
        return base + grid * u_background_color_b * horizon;
      }
      float radial = smoothstep(1.25, 0.0, length(p - vec2(sin(t * 0.2), cos(t * 0.17)) * 0.42));
      return mix(u_background_color_a, u_background_color_b, radial);
    }

    vec3 sampleBackground(vec2 uv) {
      if (u_background_media < 0.5) return proceduralBackground(uv);
      vec2 tuv = mappedUv(uv, u_background_size, u_background_fit, u_background_zoom, u_background_pan, 0.0, 0.0);
      float inside = insideUv(tuv);
      if (u_background_blur < 0.05) return texture2D(u_background, clamp(tuv, 0.0, 1.0)).rgb * inside;
      vec2 texel = u_background_blur / max(u_background_size, vec2(1.0));
      vec3 sum = vec3(0.0);
      sum += texture2D(u_background, clamp(tuv + texel * vec2(-1.0, -1.0), 0.0, 1.0)).rgb;
      sum += texture2D(u_background, clamp(tuv + texel * vec2( 0.0, -1.0), 0.0, 1.0)).rgb * 2.0;
      sum += texture2D(u_background, clamp(tuv + texel * vec2( 1.0, -1.0), 0.0, 1.0)).rgb;
      sum += texture2D(u_background, clamp(tuv + texel * vec2(-1.0,  0.0), 0.0, 1.0)).rgb * 2.0;
      sum += texture2D(u_background, clamp(tuv, 0.0, 1.0)).rgb * 4.0;
      sum += texture2D(u_background, clamp(tuv + texel * vec2( 1.0,  0.0), 0.0, 1.0)).rgb * 2.0;
      sum += texture2D(u_background, clamp(tuv + texel * vec2(-1.0,  1.0), 0.0, 1.0)).rgb;
      sum += texture2D(u_background, clamp(tuv + texel * vec2( 0.0,  1.0), 0.0, 1.0)).rgb * 2.0;
      sum += texture2D(u_background, clamp(tuv + texel * vec2( 1.0,  1.0), 0.0, 1.0)).rgb;
      return sum / 16.0 * inside;
    }

    vec3 gradeForeground(vec3 c) {
      c = (c - 0.5) * u_foreground_contrast + 0.5;
      c *= u_foreground_exposure;
      float luma = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(luma), c, u_foreground_saturation);
      return max(c, 0.0);
    }

    float keyMatte(vec3 c) {
      if (u_key_mode < 0.5) return 1.0;
      float matte;
      if (u_key_mode < 1.5) {
        vec3 cn = c / max(c.r + c.g + c.b, 0.001);
        vec3 kn = u_key_color / max(u_key_color.r + u_key_color.g + u_key_color.b, 0.001);
        float distanceValue = length(cn - kn);
        matte = smoothstep(u_key_threshold - u_key_softness, u_key_threshold + u_key_softness, distanceValue + u_matte_expand);
      } else {
        float luma = dot(c, vec3(0.299, 0.587, 0.114));
        matte = smoothstep(u_luma_level - u_key_softness, u_luma_level + u_key_softness, luma + u_matte_expand);
      }
      if (u_invert_matte > 0.5) matte = 1.0 - matte;
      return clamp(matte, 0.0, 1.0);
    }

    vec3 removeSpill(vec3 c, float matte) {
      vec3 keyN = normalize(max(u_key_color, vec3(0.001)));
      float alongKey = dot(c, keyN);
      float neutral = dot(c, vec3(0.333333));
      float dominance = max(alongKey - neutral, 0.0);
      float edge = 1.0 - smoothstep(0.3, 1.0, matte);
      return max(c - keyN * dominance * u_spill * edge, 0.0);
    }

    vec3 blendOverlay(vec3 base, vec3 over, float mode) {
      if (mode < 0.5) return over;
      if (mode < 1.5) return base + over;
      if (mode < 2.5) return 1.0 - (1.0 - base) * (1.0 - over);
      return base * over;
    }

    vec4 sampleOverlay(vec2 uv) {
      vec2 p = (uv - 0.5 - u_overlay_pan * 0.5) / max(u_overlay_scale, 0.001) + 0.5;
      float targetAspect = u_resolution.x / max(u_resolution.y, 1.0);
      float sourceAspect = u_overlay_size.x / max(u_overlay_size.y, 1.0);
      if (sourceAspect > targetAspect) p.y = (p.y - 0.5) * sourceAspect / targetAspect + 0.5;
      else p.x = (p.x - 0.5) * targetAspect / sourceAspect + 0.5;
      return texture2D(u_overlay, clamp(p, 0.0, 1.0)) * insideUv(p);
    }

    void main() {
      vec3 bg = sampleBackground(v_uv);
      vec2 cameraUv = mappedUv(v_uv, u_camera_size, u_foreground_fit, u_foreground_zoom, u_foreground_pan, radians(u_foreground_rotation), u_foreground_mirror);
      float cameraInside = insideUv(cameraUv) * u_camera_active;
      vec3 fg = gradeForeground(texture2D(u_camera, clamp(cameraUv, 0.0, 1.0)).rgb);
      float matte = keyMatte(fg) * cameraInside;
      fg = removeSpill(fg, matte);
      vec3 composite = mix(bg, fg, matte);
      vec4 overlay = sampleOverlay(v_uv);
      vec3 overlayBlend = blendOverlay(composite, overlay.rgb, u_overlay_blend);
      composite = mix(composite, overlayBlend, overlay.a * u_overlay_opacity);
      if (u_view_mode < 0.5) gl_FragColor = vec4(composite, 1.0);
      else if (u_view_mode < 1.5) gl_FragColor = vec4(vec3(matte), 1.0);
      else if (u_view_mode < 2.5) gl_FragColor = vec4(fg * cameraInside, 1.0);
      else gl_FragColor = vec4(bg, 1.0);
    }
  `;

  function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) || "Unknown shader compilation error";
      gl.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  }

  function createProgram(gl) {
    const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program) || "Unknown program link error";
      gl.deleteProgram(program);
      throw new Error(message);
    }
    return program;
  }

  function createTexture(gl, sourceCanvas) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);
    return texture;
  }

  function placeholderCanvas(width, height, kind) {
    const c = document.createElement("canvas");
    c.width = width; c.height = height;
    const ctx = c.getContext("2d");
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, kind === "camera" ? "#101820" : "#0a2d42");
    gradient.addColorStop(1, kind === "overlay" ? "rgba(0,0,0,0)" : "#e76744");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    if (kind === "camera") {
      ctx.fillStyle = "rgba(255,255,255,.12)";
      ctx.font = `700 ${Math.round(height * 0.13)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("CAMERA", width / 2, height / 2);
    }
    if (kind === "overlay") {
      ctx.clearRect(0, 0, width, height);
      const margin = Math.round(Math.min(width, height) * 0.045);
      ctx.strokeStyle = "rgba(120,232,255,.86)";
      ctx.lineWidth = Math.max(3, Math.round(Math.min(width, height) * 0.008));
      ctx.strokeRect(margin, margin, width - margin * 2, height - margin * 2);
      ctx.fillStyle = "rgba(5,10,14,.68)";
      ctx.fillRect(margin, margin, Math.round(width * 0.34), Math.round(height * 0.085));
      ctx.fillStyle = "rgba(238,248,252,.94)";
      ctx.font = `700 ${Math.round(height * 0.035)}px ui-monospace, monospace`;
      ctx.textAlign = "left";
      ctx.fillText("JUNKPILE // LIVE", margin * 1.45, margin + height * 0.055);
    }
    return c;
  }

  function initializeWebGL() {
    const gl = canvas.getContext("webgl", { alpha: false, antialias: true, preserveDrawingBuffer: true });
    if (!gl) throw new Error("WebGL 1 is not available");
    state.gl = gl;
    state.program = createProgram(gl);
    gl.useProgram(state.program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(state.program, "a_position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const names = [
      "u_resolution","u_time","u_camera","u_background","u_overlay","u_camera_size","u_background_size","u_overlay_size",
      "u_camera_active","u_background_media","u_background_style","u_background_color_a","u_background_color_b","u_background_fit",
      "u_background_zoom","u_background_pan","u_background_blur","u_background_speed","u_foreground_fit","u_foreground_zoom",
      "u_foreground_pan","u_foreground_rotation","u_foreground_mirror","u_foreground_saturation","u_foreground_exposure",
      "u_foreground_contrast","u_key_mode","u_key_color","u_key_threshold","u_key_softness","u_spill","u_matte_expand",
      "u_luma_level","u_invert_matte","u_overlay_generated","u_overlay_blend","u_overlay_opacity","u_overlay_scale","u_overlay_pan","u_view_mode"
    ];
    names.forEach((name) => { state.uniforms[name] = gl.getUniformLocation(state.program, name); });
    state.cameraTexture = createTexture(gl, placeholderCanvas(1280, 720, "camera"));
    state.backgroundTexture = createTexture(gl, placeholderCanvas(1280, 720, "background"));
    const overlayCanvas = placeholderCanvas(1280, 720, "overlay");
    state.overlayTexture = createTexture(gl, overlayCanvas);
    state.overlayWidth = overlayCanvas.width; state.overlayHeight = overlayCanvas.height;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, state.cameraTexture);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, state.backgroundTexture);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, state.overlayTexture);
    gl.uniform1i(state.uniforms.u_camera, 0);
    gl.uniform1i(state.uniforms.u_background, 1);
    gl.uniform1i(state.uniforms.u_overlay, 2);
  }

  function hexToRgb(value) {
    const hex = value.replace("#", "");
    return [parseInt(hex.slice(0,2), 16) / 255, parseInt(hex.slice(2,4), 16) / 255, parseInt(hex.slice(4,6), 16) / 255];
  }

  function uploadTexture(texture, source, unit) {
    const gl = state.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  function updateDynamicTextures() {
    if (state.cameraActive && cameraVideo.readyState >= 2) {
      try {
        uploadTexture(state.cameraTexture, cameraVideo, 0);
        state.cameraFrames += 1;
        ui.cameraFrames.textContent = String(state.cameraFrames);
      } catch (_) {}
    }
    if (state.backgroundKind === "video" && backgroundVideo.readyState >= 2) {
      try { uploadTexture(state.backgroundTexture, backgroundVideo, 1); } catch (_) {}
    }
  }

  function setUniforms(now) {
    const gl = state.gl;
    const u = state.uniforms;
    const [bgA0,bgA1,bgA2] = hexToRgb(ui.backgroundColorA.value);
    const [bgB0,bgB1,bgB2] = hexToRgb(ui.backgroundColorB.value);
    const [key0,key1,key2] = hexToRgb(ui.keyColor.value);
    gl.uniform2f(u.u_resolution, canvas.width, canvas.height);
    gl.uniform1f(u.u_time, (now - state.startedAt) / 1000);
    gl.uniform2f(u.u_camera_size, state.cameraWidth, state.cameraHeight);
    gl.uniform2f(u.u_background_size, state.backgroundWidth, state.backgroundHeight);
    gl.uniform2f(u.u_overlay_size, state.overlayWidth, state.overlayHeight);
    gl.uniform1f(u.u_camera_active, state.cameraActive ? 1 : 0);
    gl.uniform1f(u.u_background_media, state.backgroundKind === "procedural" ? 0 : 1);
    gl.uniform1f(u.u_background_style, Number(ui.backgroundStyle.value));
    gl.uniform3f(u.u_background_color_a, bgA0,bgA1,bgA2);
    gl.uniform3f(u.u_background_color_b, bgB0,bgB1,bgB2);
    gl.uniform1f(u.u_background_fit, Number(ui.backgroundFit.value));
    gl.uniform1f(u.u_background_zoom, Number(ui.backgroundZoom.value));
    gl.uniform2f(u.u_background_pan, Number(ui.backgroundPanX.value), Number(ui.backgroundPanY.value));
    gl.uniform1f(u.u_background_blur, Number(ui.backgroundBlur.value));
    gl.uniform1f(u.u_background_speed, Number(ui.backgroundSpeed.value));
    gl.uniform1f(u.u_foreground_fit, Number(ui.foregroundFit.value));
    gl.uniform1f(u.u_foreground_zoom, Number(ui.foregroundZoom.value));
    gl.uniform2f(u.u_foreground_pan, Number(ui.foregroundPanX.value), Number(ui.foregroundPanY.value));
    gl.uniform1f(u.u_foreground_rotation, Number(ui.foregroundRotation.value));
    gl.uniform1f(u.u_foreground_mirror, ui.cameraMirror.checked ? 1 : 0);
    gl.uniform1f(u.u_foreground_saturation, Number(ui.foregroundSaturation.value));
    gl.uniform1f(u.u_foreground_exposure, Number(ui.foregroundExposure.value));
    gl.uniform1f(u.u_foreground_contrast, Number(ui.foregroundContrast.value));
    gl.uniform1f(u.u_key_mode, Number(ui.keyMode.value));
    gl.uniform3f(u.u_key_color, key0,key1,key2);
    gl.uniform1f(u.u_key_threshold, Number(ui.keyThreshold.value));
    gl.uniform1f(u.u_key_softness, Number(ui.keySoftness.value));
    gl.uniform1f(u.u_spill, Number(ui.spill.value));
    gl.uniform1f(u.u_matte_expand, Number(ui.matteExpand.value));
    gl.uniform1f(u.u_luma_level, Number(ui.lumaLevel.value));
    gl.uniform1f(u.u_invert_matte, ui.invertMatte.checked ? 1 : 0);
    gl.uniform1f(u.u_overlay_generated, state.overlayGenerated ? 1 : 0);
    gl.uniform1f(u.u_overlay_blend, Number(ui.overlayBlend.value));
    gl.uniform1f(u.u_overlay_opacity, Number(ui.overlayOpacity.value));
    gl.uniform1f(u.u_overlay_scale, Number(ui.overlayScale.value));
    gl.uniform2f(u.u_overlay_pan, Number(ui.overlayPanX.value), Number(ui.overlayPanY.value));
    gl.uniform1f(u.u_view_mode, Number(ui.viewMode.value));
  }

  function resizeCanvas() {
    const rect = stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(2, Math.round(rect.width * dpr));
    const height = Math.max(2, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width; canvas.height = height;
      state.gl.viewport(0, 0, width, height);
      ui.renderSize.textContent = `${width} × ${height}`;
    }
  }

  function render(now) {
    resizeCanvas();
    updateDynamicTextures();
    state.gl.useProgram(state.program);
    setUniforms(now);
    state.gl.drawArrays(state.gl.TRIANGLES, 0, 6);
    const dt = Math.max(now - state.previousFrameAt, 1);
    const fps = 1000 / dt;
    state.fpsAverage = state.fpsAverage ? state.fpsAverage * 0.9 + fps * 0.1 : fps;
    state.previousFrameAt = now;
    ui.fpsLabel.textContent = `${Math.round(state.fpsAverage)} fps`;
    requestAnimationFrame(render);
  }

  function cameraConstraints() {
    const selected = ui.cameraSelect.value;
    const value = ui.cameraResolution.value;
    const video = { deviceId: selected ? { exact: selected } : undefined };
    if (value === "ideal") {
      video.width = { ideal: 3840 }; video.height = { ideal: 2160 };
    } else {
      const [width, height] = value.split("x").map(Number);
      video.width = { ideal: width }; video.height = { ideal: height };
    }
    return { video, audio: false };
  }

  async function refreshCameras() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const previous = ui.cameraSelect.value;
    try {
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "videoinput");
      ui.cameraSelect.innerHTML = "";
      if (!devices.length) {
        const option = document.createElement("option"); option.value = ""; option.textContent = "Default camera"; ui.cameraSelect.appendChild(option);
      } else {
        devices.forEach((device, index) => {
          const option = document.createElement("option");
          option.value = device.deviceId;
          option.textContent = device.label || `Camera ${index + 1}`;
          ui.cameraSelect.appendChild(option);
        });
      }
      if ([...ui.cameraSelect.options].some((option) => option.value === previous)) ui.cameraSelect.value = previous;
    } catch (error) {
      console.warn("Could not enumerate cameras", error);
    }
  }

  function stopCamera() {
    state.cameraStream?.getTracks().forEach((track) => track.stop());
    state.cameraStream = null;
    cameraVideo.srcObject = null;
    state.cameraActive = false;
    ui.cameraState.textContent = "Stopped";
    ui.cameraState.classList.add("warm-pill");
    ui.startCamera.disabled = false;
    ui.stopCamera.disabled = true;
    ui.cameraSize.textContent = "—";
    ui.hudCamera.textContent = "Camera stopped";
    emptyState.classList.remove("hidden");
  }

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) return;
    ui.startCamera.disabled = true;
    ui.cameraState.textContent = "Requesting…";
    try {
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia(cameraConstraints());
      state.cameraStream = stream;
      cameraVideo.srcObject = stream;
      await cameraVideo.play();
      const settings = stream.getVideoTracks()[0]?.getSettings?.() || {};
      state.cameraWidth = settings.width || cameraVideo.videoWidth || 1280;
      state.cameraHeight = settings.height || cameraVideo.videoHeight || 720;
      state.cameraFrames = 0;
      state.cameraActive = true;
      ui.cameraState.textContent = "Live";
      ui.cameraState.classList.remove("warm-pill");
      ui.startCamera.disabled = true;
      ui.stopCamera.disabled = false;
      ui.cameraSize.textContent = `${state.cameraWidth} × ${state.cameraHeight}`;
      ui.hudCamera.textContent = stream.getVideoTracks()[0]?.label || "Camera live";
      emptyState.classList.add("hidden");
      await refreshCameras();
    } catch (error) {
      console.error("Could not start camera", error);
      ui.cameraState.textContent = "Permission/error";
      ui.cameraState.classList.add("warm-pill");
      ui.startCamera.disabled = false;
      window.alert(`Could not start camera:\n${error.message || error}`);
    }
  }

  function revokeBackgroundUrl() {
    if (state.backgroundUrl) URL.revokeObjectURL(state.backgroundUrl);
    state.backgroundUrl = "";
  }

  async function loadBackground(file) {
    if (!file) return;
    revokeBackgroundUrl();
    const url = URL.createObjectURL(file);
    state.backgroundUrl = url;
    ui.backgroundName.textContent = file.name;
    if (file.type.startsWith("video/")) {
      state.backgroundKind = "video";
      backgroundVideo.src = url;
      backgroundVideo.loop = true; backgroundVideo.muted = true;
      await new Promise((resolve, reject) => {
        backgroundVideo.onloadedmetadata = resolve;
        backgroundVideo.onerror = () => reject(new Error("Background video could not be decoded"));
      });
      state.backgroundWidth = backgroundVideo.videoWidth || 1280;
      state.backgroundHeight = backgroundVideo.videoHeight || 720;
      await backgroundVideo.play().catch(() => {});
      ui.backgroundPlay.disabled = false;
      ui.backgroundPlay.textContent = "Pause video";
    } else {
      state.backgroundKind = "image";
      const image = new Image();
      image.src = url;
      await image.decode();
      state.backgroundWidth = image.naturalWidth || image.width;
      state.backgroundHeight = image.naturalHeight || image.height;
      uploadTexture(state.backgroundTexture, image, 1);
      backgroundVideo.pause(); backgroundVideo.removeAttribute("src");
      ui.backgroundPlay.disabled = true;
    }
    ui.backgroundFile.value = "";
  }

  function clearBackground() {
    revokeBackgroundUrl();
    backgroundVideo.pause(); backgroundVideo.removeAttribute("src");
    state.backgroundKind = "procedural";
    state.backgroundWidth = 1280; state.backgroundHeight = 720;
    ui.backgroundName.textContent = "Procedural";
    ui.backgroundPlay.disabled = true;
  }

  function toggleBackgroundVideo() {
    if (state.backgroundKind !== "video") return;
    if (backgroundVideo.paused) {
      backgroundVideo.play(); ui.backgroundPlay.textContent = "Pause video";
    } else {
      backgroundVideo.pause(); ui.backgroundPlay.textContent = "Play video";
    }
  }

  function revokeOverlayUrl() {
    if (state.overlayUrl) URL.revokeObjectURL(state.overlayUrl);
    state.overlayUrl = "";
  }

  async function loadOverlay(file) {
    if (!file) return;
    revokeOverlayUrl();
    const url = URL.createObjectURL(file);
    state.overlayUrl = url;
    const image = new Image(); image.src = url; await image.decode();
    state.overlayWidth = image.naturalWidth || image.width;
    state.overlayHeight = image.naturalHeight || image.height;
    state.overlayGenerated = false;
    uploadTexture(state.overlayTexture, image, 2);
    ui.overlayName.textContent = file.name;
    ui.overlayFile.value = "";
  }

  function clearOverlay() {
    revokeOverlayUrl();
    const generated = placeholderCanvas(1280, 720, "overlay");
    state.overlayWidth = generated.width; state.overlayHeight = generated.height;
    state.overlayGenerated = true;
    uploadTexture(state.overlayTexture, generated, 2);
    ui.overlayName.textContent = "Generated frame";
  }

  function sampleCenterKey() {
    if (!state.cameraActive || cameraVideo.readyState < 2) return;
    try {
      const ctx = state.sampleContext;
      ctx.drawImage(cameraVideo, Math.floor(cameraVideo.videoWidth / 2), Math.floor(cameraVideo.videoHeight / 2), 1, 1, 0, 0, 1, 1);
      const data = ctx.getImageData(0, 0, 1, 1).data;
      ui.keyColor.value = `#${[data[0],data[1],data[2]].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
    } catch (error) {
      console.warn("Could not sample camera center", error);
    }
  }

  function applyKeyPreset(name) {
    if (name === "green") {
      ui.keyMode.value = "1"; ui.keyColor.value = "#00ff3b"; ui.keyThreshold.value = "0.32"; ui.keySoftness.value = "0.14"; ui.spill.value = "0.58"; ui.invertMatte.checked = false;
    } else if (name === "blue") {
      ui.keyMode.value = "1"; ui.keyColor.value = "#174dff"; ui.keyThreshold.value = "0.30"; ui.keySoftness.value = "0.13"; ui.spill.value = "0.52"; ui.invertMatte.checked = false;
    } else if (name === "dark") {
      ui.keyMode.value = "2"; ui.lumaLevel.value = "0.28"; ui.keySoftness.value = "0.12"; ui.invertMatte.checked = false;
    } else {
      ui.keyMode.value = "2"; ui.lumaLevel.value = "0.72"; ui.keySoftness.value = "0.12"; ui.invertMatte.checked = true;
    }
    syncAllOutputs();
    updateHud();
  }

  function chooseMimeType() {
    if (typeof MediaRecorder === "undefined") return "";
    const candidates = [
      "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm",
      "video/mp4;codecs=h264", "video/mp4"
    ];
    return candidates.find((mime) => !MediaRecorder.isTypeSupported || MediaRecorder.isTypeSupported(mime)) || "";
  }

  function formatBytes(bytes) {
    if (!bytes) return "0 B";
    const units = ["B","KB","MB","GB"];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / Math.pow(1024, index)).toFixed(index ? 1 : 0)} ${units[index]}`;
  }

  function formatDuration(milliseconds) {
    const total = Math.max(0, milliseconds);
    const minutes = Math.floor(total / 60000);
    const seconds = Math.floor((total % 60000) / 1000);
    const ms = Math.floor(total % 1000);
    return `${String(minutes).padStart(2,"0")}:${String(seconds).padStart(2,"0")}.${String(ms).padStart(3,"0")}`;
  }

  function extensionForMime(mime) { return mime.includes("mp4") ? "mp4" : "webm"; }
  function timestampName(prefix, extension) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return `${prefix}-${stamp}.${extension}`;
  }

  function filterForExtension(extension) {
    if (extension === "png") return [{ name: "PNG image", extensions: ["png"] }];
    if (extension === "mp4") return [{ name: "MP4 video", extensions: ["mp4"] }];
    return [{ name: "WebM video", extensions: ["webm"] }];
  }

  async function saveBlob(blob, suggestedName, extension) {
    const tauriApi = window.__TAURI__;
    if (tauriApi?.dialog?.save && tauriApi?.fs?.writeBinaryFile) {
      const path = await tauriApi.dialog.save({ defaultPath: suggestedName, filters: filterForExtension(extension) });
      if (!path) return "";
      await tauriApi.fs.writeBinaryFile(path, new Uint8Array(await blob.arrayBuffer()));
      return path;
    }
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = suggestedName;
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    return suggestedName;
  }

  function updateRecordingClock() {
    if (!state.recorder || state.recorder.state === "inactive") return;
    const pausedNow = state.recorder.state === "paused" ? performance.now() - state.pauseStartedAt : 0;
    const elapsed = performance.now() - state.recordStartedAt - state.pausedDuration - pausedNow;
    ui.recordTime.textContent = formatDuration(elapsed);
    ui.recordSize.textContent = formatBytes(state.recordedBytes);
    state.recordingTimer = requestAnimationFrame(updateRecordingClock);
  }

  function startRecording() {
    if (!canvas.captureStream || !state.chosenMime || state.recorder?.state === "recording") return;
    state.chunks = []; state.recordedBytes = 0; state.lastBlob = null;
    const stream = canvas.captureStream(Number(ui.recordFps.value));
    state.recorderStream = stream;
    const recorder = new MediaRecorder(stream, { mimeType: state.chosenMime, videoBitsPerSecond: 24000000 });
    state.recorder = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data?.size) { state.chunks.push(event.data); state.recordedBytes += event.data.size; }
    };
    recorder.onstop = () => {
      cancelAnimationFrame(state.recordingTimer);
      state.lastBlob = new Blob(state.chunks, { type: recorder.mimeType || state.chosenMime });
      state.lastMime = recorder.mimeType || state.chosenMime;
      ui.recordSize.textContent = formatBytes(state.lastBlob.size);
      ui.recordState.textContent = "Capture ready";
      ui.recordButton.disabled = false; ui.recordButton.classList.remove("recording");
      ui.pauseButton.disabled = true; ui.stopRecording.disabled = true; ui.saveRecording.disabled = false;
      ui.recordingBorder.classList.remove("active");
      state.recorderStream?.getTracks().forEach((track) => track.stop());
    };
    recorder.start(500);
    state.recordStartedAt = performance.now(); state.pausedDuration = 0;
    ui.recordState.textContent = "Recording";
    ui.recordButton.disabled = true; ui.recordButton.classList.add("recording");
    ui.pauseButton.disabled = false; ui.stopRecording.disabled = false; ui.saveRecording.disabled = true;
    ui.recordingBorder.classList.add("active");
    updateRecordingClock();
  }

  function togglePause() {
    if (!state.recorder) return;
    if (state.recorder.state === "recording") {
      state.recorder.pause(); state.pauseStartedAt = performance.now(); ui.pauseButton.textContent = "Resume"; ui.recordState.textContent = "Paused";
    } else if (state.recorder.state === "paused") {
      state.pausedDuration += performance.now() - state.pauseStartedAt;
      state.recorder.resume(); ui.pauseButton.textContent = "Pause"; ui.recordState.textContent = "Recording";
    }
  }

  function stopRecording() {
    if (state.recorder && state.recorder.state !== "inactive") state.recorder.stop();
  }

  async function saveRecording() {
    if (!state.lastBlob) return;
    try {
      ui.saveRecording.disabled = true; ui.saveRecording.textContent = "Saving…";
      const extension = extensionForMime(state.lastMime);
      const path = await saveBlob(state.lastBlob, timestampName("junkpile-19-composite", extension), extension);
      if (path) { ui.lastFile.textContent = path; ui.recordState.textContent = "Saved"; }
    } catch (error) {
      console.error(error); window.alert(`Could not save recording:\n${error.message || error}`);
    } finally {
      ui.saveRecording.disabled = !state.lastBlob; ui.saveRecording.textContent = "Save recording";
    }
  }

  async function saveSnapshot() {
    try {
      ui.saveSnapshot.disabled = true; ui.saveSnapshot.textContent = "Saving…";
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("PNG creation failed")), "image/png"));
      const path = await saveBlob(blob, timestampName("junkpile-19-frame", "png"), "png");
      if (path) { ui.lastFile.textContent = path; ui.recordState.textContent = "PNG saved"; }
    } catch (error) {
      console.error(error); window.alert(`Could not save PNG:\n${error.message || error}`);
    } finally {
      ui.saveSnapshot.disabled = false; ui.saveSnapshot.textContent = "Save PNG";
    }
  }

  function syncOutput(id) {
    const input = $(id); const output = $(`${id}-output`); const formatter = rangeFormats[id];
    if (input && output && formatter) output.textContent = formatter(input.value);
  }

  function syncAllOutputs() { Object.keys(rangeFormats).forEach(syncOutput); }

  function updateHud() {
    const keyName = keyNames[Number(ui.keyMode.value)] || keyNames[0];
    const viewName = viewNames[Number(ui.viewMode.value)] || viewNames[0];
    ui.matteReadout.textContent = keyName;
    ui.hudKey.textContent = keyName;
    ui.hudView.textContent = viewName;
  }

  function bindControls() {
    Object.keys(rangeFormats).forEach((id) => {
      const input = $(id); input.addEventListener("input", () => syncOutput(id)); syncOutput(id);
    });
    ui.startCamera.addEventListener("click", startCamera);
    ui.emptyStart.addEventListener("click", startCamera);
    ui.stopCamera.addEventListener("click", stopCamera);
    ui.refreshCameras.addEventListener("click", refreshCameras);
    ui.cameraSelect.addEventListener("change", () => { if (state.cameraActive) startCamera(); });
    ui.cameraResolution.addEventListener("change", () => { if (state.cameraActive) startCamera(); });
    ui.backgroundFile.addEventListener("change", () => loadBackground(ui.backgroundFile.files?.[0]).catch((error) => window.alert(error.message || error)));
    ui.clearBackground.addEventListener("click", clearBackground);
    ui.backgroundPlay.addEventListener("click", toggleBackgroundVideo);
    ui.overlayFile.addEventListener("change", () => loadOverlay(ui.overlayFile.files?.[0]).catch((error) => window.alert(error.message || error)));
    ui.clearOverlay.addEventListener("click", clearOverlay);
    ui.sampleKey.addEventListener("click", sampleCenterKey);
    ui.keyMode.addEventListener("change", updateHud);
    ui.viewMode.addEventListener("change", updateHud);
    document.querySelectorAll("[data-key-preset]").forEach((button) => button.addEventListener("click", () => applyKeyPreset(button.dataset.keyPreset)));
    ui.recordButton.addEventListener("click", startRecording);
    ui.pauseButton.addEventListener("click", togglePause);
    ui.stopRecording.addEventListener("click", stopRecording);
    ui.saveRecording.addEventListener("click", saveRecording);
    ui.saveSnapshot.addEventListener("click", saveSnapshot);
    navigator.mediaDevices?.addEventListener?.("devicechange", refreshCameras);
    window.addEventListener("beforeunload", () => {
      stopCamera(); revokeBackgroundUrl(); revokeOverlayUrl();
      if (state.recorder && state.recorder.state !== "inactive") state.recorder.stop();
    });
  }

  function initializeCapabilities() {
    const mediaAvailable = Boolean(navigator.mediaDevices?.getUserMedia);
    const captureAvailable = typeof canvas.captureStream === "function";
    state.chosenMime = chooseMimeType();
    ui.codecLabel.textContent = state.chosenMime || "No recording codec";
    if (!mediaAvailable || !state.gl) {
      unsupported.classList.remove("hidden");
      emptyState.classList.add("hidden");
      ui.startCamera.disabled = true;
    }
    if (!captureAvailable || !state.chosenMime) {
      ui.recordButton.disabled = true;
      ui.recordState.textContent = "Recording unsupported";
    }
  }

  function initialize() {
    try {
      initializeWebGL();
      bindControls();
      initializeCapabilities();
      syncAllOutputs();
      updateHud();
      refreshCameras();
      requestAnimationFrame(render);
    } catch (error) {
      console.error("Example 19 initialization failed", error);
      unsupported.classList.remove("hidden"); emptyState.classList.add("hidden");
      unsupported.querySelector("p").textContent = error.message || String(error);
    }
  }

  initialize();
})();
