(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const tauriCore = window.__TAURI__?.core ?? null;
  const invoke = tauriCore?.invoke?.bind(tauriCore) ?? null;
  const tauriDialog = window.__TAURI__?.dialog ?? null;

  const ui = {
    canvas: $("gl-canvas"),
    stage: $("stage"),
    unsupported: $("unsupported"),
    pipelineState: $("pipeline-state"),
    bypassButton: $("bypass-button"),
    clearHistory: $("clear-history"),
    resetPipeline: $("reset-pipeline"),
    snapshotButton: $("snapshot-button"),
    fullscreenButton: $("fullscreen-button"),
    freezeHistory: $("freeze-history"),
    renderScale: $("render-scale"),
    activePassCount: $("active-pass-count"),
    drawCallCount: $("draw-call-count"),
    historyLabel: $("history-label"),
    sourceMode: $("source-mode"),
    sourceSpeed: $("source-speed"),
    sourceScale: $("source-scale"),
    sourceDetail: $("source-detail"),
    sourceHue: $("source-hue"),
    passList: $("pass-list"),
    selectedPassLabel: $("selected-pass-label"),
    selectedEffect: $("selected-effect"),
    amountLabel: $("amount-label"),
    secondaryLabel: $("secondary-label"),
    passAmount: $("pass-amount"),
    passSecondary: $("pass-secondary"),
    passMix: $("pass-mix"),
    fpsLabel: $("fps-label"),
    renderSize: $("render-size"),
    hudSource: $("hud-source"),
    hudPipeline: $("hud-pipeline")
  };

  const sourceNames = ["Fluid field", "Infinite tunnel", "Cellular lattice", "Signal bands"];

  const EFFECTS = [
    { id: "feedback", code: 1, name: "Feedback trails", summary: "Persistent previous-frame echo", amountLabel: "Decay", secondaryLabel: "Drift", defaults: [0.84, 0.18, 1] },
    { id: "kaleidoscope", code: 2, name: "Kaleidoscope", summary: "Mirrored polar segmentation", amountLabel: "Segments", secondaryLabel: "Twist", defaults: [0.55, 0.24, 1] },
    { id: "edge", code: 3, name: "Edge isolate", summary: "Four-tap luminance gradient", amountLabel: "Gain", secondaryLabel: "Threshold", defaults: [0.62, 0.22, 0.82] },
    { id: "rgb", code: 4, name: "RGB split", summary: "Chromatic channel displacement", amountLabel: "Offset", secondaryLabel: "Angle", defaults: [0.23, 0.15, 0.72] },
    { id: "pixelate", code: 5, name: "Pixelate", summary: "Quantized texture coordinates", amountLabel: "Cells", secondaryLabel: "Jitter", defaults: [0.52, 0.08, 1] },
    { id: "displace", code: 6, name: "Wave displace", summary: "Animated two-axis UV warp", amountLabel: "Warp", secondaryLabel: "Frequency", defaults: [0.34, 0.4, 0.88] },
    { id: "blur", code: 7, name: "Directional blur", summary: "Nine-tap linear convolution", amountLabel: "Radius", secondaryLabel: "Angle", defaults: [0.28, 0.12, 0.72] },
    { id: "grade", code: 8, name: "Color grade", summary: "Hue rotation and contrast", amountLabel: "Hue", secondaryLabel: "Contrast", defaults: [0.55, 0.5, 0.82] },
    { id: "solarize", code: 9, name: "Solarize", summary: "Threshold-based inversion", amountLabel: "Strength", secondaryLabel: "Threshold", defaults: [0.8, 0.52, 0.74] }
  ];

  const effectById = (id) => EFFECTS.find((effect) => effect.id === id) || EFFECTS[0];

  const createPass = (id, effectId, enabled, amount, secondary, mix) => ({
    id,
    effectId,
    enabled,
    amount,
    secondary,
    mix
  });

  const defaultPasses = () => [
    createPass("pass-1", "feedback", true, 0.84, 0.18, 1),
    createPass("pass-2", "displace", true, 0.31, 0.36, 0.82),
    createPass("pass-3", "kaleidoscope", false, 0.52, 0.22, 1),
    createPass("pass-4", "rgb", true, 0.18, 0.12, 0.68),
    createPass("pass-5", "grade", true, 0.55, 0.54, 0.72)
  ];

  const state = {
    gl: null,
    programs: null,
    quadBuffer: null,
    targets: null,
    historyReadIndex: 0,
    passes: defaultPasses(),
    selectedPassId: "pass-1",
    bypassed: false,
    startedAt: performance.now(),
    lastFrameAt: performance.now(),
    fpsAverage: 0,
    needsResize: true,
    maxTextureSize: 4096
  };

  const VERTEX_SHADER = `
    attribute vec2 a_position;
    varying vec2 v_uv;
    void main() {
      v_uv = a_position * 0.5 + 0.5;
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  const SOURCE_SHADER = `
    precision highp float;
    varying vec2 v_uv;
    uniform vec2 u_resolution;
    uniform float u_time;
    uniform float u_mode;
    uniform float u_speed;
    uniform float u_scale;
    uniform float u_detail;
    uniform float u_hue;

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

    float fbm(vec2 p) {
      float sum = 0.0;
      float amp = 0.5;
      mat2 rotation = mat2(0.80, -0.60, 0.60, 0.80);
      for (int i = 0; i < 6; i++) {
        if (float(i) >= u_detail) { break; }
        sum += amp * noise2(p);
        p = rotation * p * 2.03 + 17.13;
        amp *= 0.5;
      }
      return sum;
    }

    vec3 hsv2rgb(vec3 c) {
      vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
      vec3 rgb = clamp(p - 1.0, 0.0, 1.0);
      return c.z * mix(vec3(1.0), rgb, c.y);
    }

    vec3 fluidField(vec2 p, float t) {
      vec2 q = vec2(fbm(p * 1.2 + vec2(t * 0.17, -t * 0.1)), fbm(p * 1.2 + vec2(5.2, -3.7) - t * 0.12));
      vec2 r = vec2(fbm(p * 1.55 + q * 1.15 + vec2(1.7, 9.2) + t * 0.07), fbm(p * 1.55 + q * 1.15 + vec2(8.3, 2.8) - t * 0.08));
      float f = fbm(p * 1.8 + r * 1.75);
      float hue = u_hue / 360.0 + 0.55 + f * 0.3 + q.x * 0.13;
      return hsv2rgb(vec3(hue, 0.76, 0.16 + f * 1.05));
    }

    vec3 tunnel(vec2 p, float t) {
      float radius = max(length(p), 0.002);
      float angle = atan(p.y, p.x);
      float depth = 0.76 / radius + t * 0.76;
      float bands = sin(depth * 7.0 + sin(angle * 5.0 + t) * 2.3);
      float spokes = sin(angle * 11.0 + depth * 0.8 - t * 1.4);
      float grain = fbm(vec2(angle * 1.7, depth * 0.15));
      float shape = smoothstep(-0.22, 0.88, bands * 0.6 + spokes * 0.25 + grain * 0.68);
      return hsv2rgb(vec3(u_hue / 360.0 + angle / (2.0 * PI) + depth * 0.026, 0.84, shape));
    }

    vec3 cells(vec2 p, float t) {
      vec2 grid = p * 7.0;
      vec2 cell = floor(grid);
      vec2 local = fract(grid) - 0.5;
      float nearest = 10.0;
      float id = 0.0;
      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          vec2 offset = vec2(float(x), float(y));
          float randomValue = hash21(cell + offset);
          vec2 point = offset + 0.37 * vec2(sin(t * 0.9 + randomValue * 6.283), cos(t * 0.73 + randomValue * 8.1));
          float distanceValue = length(local - point);
          if (distanceValue < nearest) {
            nearest = distanceValue;
            id = randomValue;
          }
        }
      }
      float body = smoothstep(0.46, 0.04, nearest);
      float ring = smoothstep(0.065, 0.0, abs(nearest - 0.25 - 0.05 * sin(t + id * 8.0)));
      return hsv2rgb(vec3(u_hue / 360.0 + id * 0.55 + t * 0.014, 0.72, body * 0.38 + ring * 0.72));
    }

    vec3 bands(vec2 p, float t) {
      float n = fbm(vec2(p.x * 2.5 + t * 0.08, p.y * 1.1));
      float y = p.y + (n - 0.5) * 0.82;
      float a = sin(y * 16.0 + p.x * 4.0 - t * 2.0);
      float b = sin(y * 29.0 - p.x * 2.5 + t * 1.1);
      float c = sin(y * 53.0 + t * 0.55 + n * 5.0);
      float signal = smoothstep(0.18, 1.0, abs(a * 0.55 + b * 0.3 + c * 0.15));
      return hsv2rgb(vec3(u_hue / 360.0 + 0.82 + p.y * 0.18 + n * 0.25, 0.7, signal * 0.92));
    }

    void main() {
      vec2 p = v_uv * 2.0 - 1.0;
      p.x *= u_resolution.x / max(u_resolution.y, 1.0);
      p *= u_scale;
      float t = u_time * u_speed;
      vec3 color;
      if (u_mode < 0.5) {
        color = fluidField(p, t);
      } else if (u_mode < 1.5) {
        color = tunnel(p, t);
      } else if (u_mode < 2.5) {
        color = cells(p, t);
      } else {
        color = bands(p, t);
      }
      float vignette = smoothstep(1.75, 0.18, length(p / max(u_scale, 0.001)));
      color *= 0.68 + vignette * 0.48;
      gl_FragColor = vec4(max(color, 0.0), 1.0);
    }
  `;

  const EFFECT_SHADER = `
    precision highp float;
    varying vec2 v_uv;
    uniform sampler2D u_input;
    uniform sampler2D u_history;
    uniform vec2 u_resolution;
    uniform float u_time;
    uniform float u_effect;
    uniform float u_amount;
    uniform float u_secondary;
    uniform float u_mix;

    #define PI 3.14159265359

    float luma(vec3 color) {
      return dot(color, vec3(0.299, 0.587, 0.114));
    }

    vec2 safeUv(vec2 uv) {
      vec2 inset = 0.5 / max(u_resolution, vec2(1.0));
      return clamp(uv, inset, vec2(1.0) - inset);
    }

    vec3 hueRotate(vec3 color, float angle) {
      float s = sin(angle);
      float c = cos(angle);
      mat3 matrix = mat3(
        0.299 + 0.701 * c + 0.168 * s,
        0.587 - 0.587 * c + 0.330 * s,
        0.114 - 0.114 * c - 0.497 * s,
        0.299 - 0.299 * c - 0.328 * s,
        0.587 + 0.413 * c + 0.035 * s,
        0.114 - 0.114 * c + 0.292 * s,
        0.299 - 0.300 * c + 1.250 * s,
        0.587 - 0.588 * c - 1.050 * s,
        0.114 + 0.886 * c - 0.203 * s
      );
      return clamp(matrix * color, 0.0, 2.0);
    }

    void main() {
      vec2 uv = v_uv;
      vec2 texel = 1.0 / max(u_resolution, vec2(1.0));
      vec4 current = texture2D(u_input, safeUv(uv));
      vec4 effected = current;

      if (u_effect < 1.5) {
        vec2 centered = uv - 0.5;
        float zoom = 1.0 + u_secondary * 0.025;
        vec2 drift = vec2(sin(u_time * 0.71), cos(u_time * 0.59)) * u_secondary * 0.006;
        vec2 historyUv = centered * zoom + 0.5 + drift;
        vec4 history = texture2D(u_history, safeUv(historyUv));
        effected = mix(current, max(current * 0.42, history), clamp(u_amount, 0.0, 0.985));
      } else if (u_effect < 2.5) {
        vec2 p = uv - 0.5;
        float radius = length(p);
        float angle = atan(p.y, p.x) + (radius - 0.2) * u_secondary * 5.0;
        float segments = floor(2.0 + u_amount * 18.0);
        float sector = 2.0 * PI / max(segments, 2.0);
        angle = mod(angle, sector);
        angle = abs(angle - sector * 0.5);
        vec2 kaleidoUv = vec2(cos(angle), sin(angle)) * radius + 0.5;
        effected = texture2D(u_input, safeUv(kaleidoUv));
      } else if (u_effect < 3.5) {
        float left = luma(texture2D(u_input, safeUv(uv - vec2(texel.x, 0.0))).rgb);
        float right = luma(texture2D(u_input, safeUv(uv + vec2(texel.x, 0.0))).rgb);
        float down = luma(texture2D(u_input, safeUv(uv - vec2(0.0, texel.y))).rgb);
        float up = luma(texture2D(u_input, safeUv(uv + vec2(0.0, texel.y))).rgb);
        float edge = length(vec2(right - left, up - down)) * (2.0 + u_amount * 16.0);
        edge = smoothstep(u_secondary * 0.8, u_secondary * 0.8 + 0.18, edge);
        vec3 tint = vec3(edge, edge * 0.72, edge * 1.15);
        effected = vec4(tint, 1.0);
      } else if (u_effect < 4.5) {
        float angle = u_secondary * PI * 2.0 + u_time * 0.07;
        vec2 offset = vec2(cos(angle), sin(angle)) * u_amount * 0.035;
        float red = texture2D(u_input, safeUv(uv + offset)).r;
        float green = current.g;
        float blue = texture2D(u_input, safeUv(uv - offset)).b;
        effected = vec4(red, green, blue, 1.0);
      } else if (u_effect < 5.5) {
        float cells = mix(8.0, 260.0, u_amount);
        vec2 jitter = vec2(sin(u_time * 2.1), cos(u_time * 1.7)) * u_secondary * 0.35;
        vec2 pixelUv = (floor(uv * cells + jitter) + 0.5) / cells;
        effected = texture2D(u_input, safeUv(pixelUv));
      } else if (u_effect < 6.5) {
        float frequency = mix(2.0, 28.0, u_secondary);
        vec2 wave = vec2(
          sin(uv.y * frequency + u_time * 1.7),
          cos(uv.x * frequency * 0.83 - u_time * 1.23)
        );
        vec2 displacedUv = uv + wave * u_amount * 0.045;
        effected = texture2D(u_input, safeUv(displacedUv));
      } else if (u_effect < 7.5) {
        float angle = u_secondary * PI * 2.0;
        vec2 direction = vec2(cos(angle), sin(angle)) * texel * (1.0 + u_amount * 18.0);
        vec4 blur = vec4(0.0);
        blur += texture2D(u_input, safeUv(uv - direction * 4.0)) * 0.05;
        blur += texture2D(u_input, safeUv(uv - direction * 3.0)) * 0.09;
        blur += texture2D(u_input, safeUv(uv - direction * 2.0)) * 0.12;
        blur += texture2D(u_input, safeUv(uv - direction)) * 0.15;
        blur += current * 0.18;
        blur += texture2D(u_input, safeUv(uv + direction)) * 0.15;
        blur += texture2D(u_input, safeUv(uv + direction * 2.0)) * 0.12;
        blur += texture2D(u_input, safeUv(uv + direction * 3.0)) * 0.09;
        blur += texture2D(u_input, safeUv(uv + direction * 4.0)) * 0.05;
        effected = blur;
      } else if (u_effect < 8.5) {
        float angle = (u_amount - 0.5) * PI * 2.0;
        float contrast = mix(0.45, 2.4, u_secondary);
        vec3 graded = hueRotate(current.rgb, angle);
        graded = (graded - 0.5) * contrast + 0.5;
        effected = vec4(max(graded, 0.0), 1.0);
      } else {
        float threshold = mix(0.12, 0.88, u_secondary);
        vec3 inverted = 1.0 - current.rgb;
        vec3 solarized = mix(current.rgb, inverted, step(vec3(threshold), current.rgb));
        effected = vec4(mix(current.rgb, solarized, u_amount), 1.0);
      }

      gl_FragColor = mix(current, effected, clamp(u_mix, 0.0, 1.0));
    }
  `;

  const COPY_SHADER = `
    precision highp float;
    varying vec2 v_uv;
    uniform sampler2D u_input;
    void main() {
      gl_FragColor = texture2D(u_input, v_uv);
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

  function createProgram(gl, fragmentSource) {
    const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.bindAttribLocation(program, 0, "a_position");
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program) || "Unknown shader link error";
      gl.deleteProgram(program);
      throw new Error(message);
    }
    return program;
  }

  function createRenderTarget(gl, width, height) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
      throw new Error(`Framebuffer incomplete: 0x${status.toString(16)}`);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return { texture, framebuffer, width, height };
  }

  function deleteRenderTarget(gl, target) {
    if (!target) return;
    gl.deleteFramebuffer(target.framebuffer);
    gl.deleteTexture(target.texture);
  }

  function createPrograms(gl) {
    const source = createProgram(gl, SOURCE_SHADER);
    const effect = createProgram(gl, EFFECT_SHADER);
    const copy = createProgram(gl, COPY_SHADER);
    return {
      source: {
        program: source,
        resolution: gl.getUniformLocation(source, "u_resolution"),
        time: gl.getUniformLocation(source, "u_time"),
        mode: gl.getUniformLocation(source, "u_mode"),
        speed: gl.getUniformLocation(source, "u_speed"),
        scale: gl.getUniformLocation(source, "u_scale"),
        detail: gl.getUniformLocation(source, "u_detail"),
        hue: gl.getUniformLocation(source, "u_hue")
      },
      effect: {
        program: effect,
        input: gl.getUniformLocation(effect, "u_input"),
        history: gl.getUniformLocation(effect, "u_history"),
        resolution: gl.getUniformLocation(effect, "u_resolution"),
        time: gl.getUniformLocation(effect, "u_time"),
        effect: gl.getUniformLocation(effect, "u_effect"),
        amount: gl.getUniformLocation(effect, "u_amount"),
        secondary: gl.getUniformLocation(effect, "u_secondary"),
        mix: gl.getUniformLocation(effect, "u_mix")
      },
      copy: {
        program: copy,
        input: gl.getUniformLocation(copy, "u_input")
      }
    };
  }

  function bindQuad(gl) {
    gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  }

  function setTarget(gl, target) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.framebuffer : null);
    gl.viewport(0, 0, ui.canvas.width, ui.canvas.height);
  }

  function bindTexture(gl, texture, unit) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
  }

  function clearTarget(gl, target) {
    setTarget(gl, target);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  function destroyTargets() {
    if (!state.gl || !state.targets) return;
    const gl = state.gl;
    deleteRenderTarget(gl, state.targets.source);
    state.targets.work.forEach((target) => deleteRenderTarget(gl, target));
    state.targets.history.forEach((target) => deleteRenderTarget(gl, target));
    state.targets = null;
  }

  function rebuildTargets() {
    const gl = state.gl;
    destroyTargets();
    state.targets = {
      source: createRenderTarget(gl, ui.canvas.width, ui.canvas.height),
      work: [
        createRenderTarget(gl, ui.canvas.width, ui.canvas.height),
        createRenderTarget(gl, ui.canvas.width, ui.canvas.height)
      ],
      history: [
        createRenderTarget(gl, ui.canvas.width, ui.canvas.height),
        createRenderTarget(gl, ui.canvas.width, ui.canvas.height)
      ]
    };
    state.historyReadIndex = 0;
    clearTarget(gl, state.targets.source);
    state.targets.work.forEach((target) => clearTarget(gl, target));
    state.targets.history.forEach((target) => clearTarget(gl, target));
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function resizeIfNeeded() {
    const scale = Number(ui.renderScale.value);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const desiredWidth = Math.max(2, Math.min(state.maxTextureSize, Math.round(ui.canvas.clientWidth * dpr * scale)));
    const desiredHeight = Math.max(2, Math.min(state.maxTextureSize, Math.round(ui.canvas.clientHeight * dpr * scale)));
    if (!state.needsResize && ui.canvas.width === desiredWidth && ui.canvas.height === desiredHeight) return;
    ui.canvas.width = desiredWidth;
    ui.canvas.height = desiredHeight;
    rebuildTargets();
    state.needsResize = false;
    ui.renderSize.textContent = `${desiredWidth} × ${desiredHeight}`;
  }

  function renderSource(timeSeconds) {
    const gl = state.gl;
    const program = state.programs.source;
    setTarget(gl, state.targets.source);
    gl.useProgram(program.program);
    bindQuad(gl);
    gl.uniform2f(program.resolution, ui.canvas.width, ui.canvas.height);
    gl.uniform1f(program.time, timeSeconds);
    gl.uniform1f(program.mode, Number(ui.sourceMode.value));
    gl.uniform1f(program.speed, Number(ui.sourceSpeed.value));
    gl.uniform1f(program.scale, Number(ui.sourceScale.value));
    gl.uniform1f(program.detail, Number(ui.sourceDetail.value));
    gl.uniform1f(program.hue, Number(ui.sourceHue.value));
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function renderEffect(inputTexture, historyTexture, pass, target, timeSeconds) {
    const gl = state.gl;
    const program = state.programs.effect;
    const effect = effectById(pass.effectId);
    setTarget(gl, target);
    gl.useProgram(program.program);
    bindQuad(gl);
    bindTexture(gl, inputTexture, 0);
    bindTexture(gl, historyTexture, 1);
    gl.uniform1i(program.input, 0);
    gl.uniform1i(program.history, 1);
    gl.uniform2f(program.resolution, ui.canvas.width, ui.canvas.height);
    gl.uniform1f(program.time, timeSeconds);
    gl.uniform1f(program.effect, effect.code);
    gl.uniform1f(program.amount, pass.amount);
    gl.uniform1f(program.secondary, pass.secondary);
    gl.uniform1f(program.mix, pass.mix);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function renderCopy(inputTexture, target) {
    const gl = state.gl;
    const program = state.programs.copy;
    setTarget(gl, target);
    gl.useProgram(program.program);
    bindQuad(gl);
    bindTexture(gl, inputTexture, 0);
    gl.uniform1i(program.input, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function renderFrame(now) {
    if (!state.gl) return;
    resizeIfNeeded();

    const timeSeconds = (now - state.startedAt) / 1000;
    renderSource(timeSeconds);

    const historyRead = state.targets.history[state.historyReadIndex];
    const historyWrite = state.targets.history[1 - state.historyReadIndex];
    const activePasses = state.bypassed ? [] : state.passes.filter((pass) => pass.enabled);

    let currentTexture = state.targets.source.texture;
    let workIndex = 0;
    for (const pass of activePasses) {
      const outputTarget = state.targets.work[workIndex];
      renderEffect(currentTexture, historyRead.texture, pass, outputTarget, timeSeconds);
      currentTexture = outputTarget.texture;
      workIndex = 1 - workIndex;
    }

    renderCopy(currentTexture, null);
    if (!ui.freezeHistory.checked) {
      renderCopy(currentTexture, historyWrite);
      state.historyReadIndex = 1 - state.historyReadIndex;
    }

    const elapsed = Math.max(1, now - state.lastFrameAt);
    const instantaneousFps = 1000 / elapsed;
    state.fpsAverage = state.fpsAverage === 0 ? instantaneousFps : state.fpsAverage * 0.9 + instantaneousFps * 0.1;
    state.lastFrameAt = now;
    ui.fpsLabel.textContent = `${Math.round(state.fpsAverage)} fps`;
    updateTelemetry(activePasses.length);

    requestAnimationFrame(renderFrame);
  }

  function updateTelemetry(activeCount = state.passes.filter((pass) => pass.enabled).length) {
    const visibleCount = state.bypassed ? 0 : activeCount;
    ui.activePassCount.textContent = `${visibleCount} ${visibleCount === 1 ? "pass" : "passes"}`;
    ui.drawCallCount.textContent = `${visibleCount + 3} / frame`;
    ui.historyLabel.textContent = `Buffer ${state.historyReadIndex === 0 ? "A" : "B"}${ui.freezeHistory.checked ? " · frozen" : ""}`;
    ui.hudPipeline.textContent = state.bypassed ? "Pipeline bypassed" : `${visibleCount} active ${visibleCount === 1 ? "pass" : "passes"}`;
    ui.pipelineState.textContent = state.bypassed ? "Bypass" : "Live";
    ui.pipelineState.classList.toggle("ready", !state.bypassed);
    ui.pipelineState.classList.toggle("bypassed", state.bypassed);
    ui.bypassButton.classList.toggle("active", state.bypassed);
  }

  function selectedPass() {
    return state.passes.find((pass) => pass.id === state.selectedPassId) || state.passes[0];
  }

  function fillEffectSelect() {
    ui.selectedEffect.innerHTML = "";
    for (const effect of EFFECTS) {
      const option = document.createElement("option");
      option.value = effect.id;
      option.textContent = effect.name;
      ui.selectedEffect.appendChild(option);
    }
  }

  function renderPassList() {
    ui.passList.innerHTML = "";
    state.passes.forEach((pass, index) => {
      const effect = effectById(pass.effectId);
      const row = document.createElement("div");
      row.className = `pass-row${pass.id === state.selectedPassId ? " selected" : ""}${pass.enabled ? "" : " disabled"}`;
      row.dataset.passId = pass.id;

      const enabled = document.createElement("input");
      enabled.type = "checkbox";
      enabled.checked = pass.enabled;
      enabled.setAttribute("aria-label", `Enable ${effect.name}`);
      enabled.addEventListener("change", () => {
        pass.enabled = enabled.checked;
        renderPassList();
        updateTelemetry();
      });

      const main = document.createElement("div");
      main.className = "pass-main";
      main.innerHTML = `<strong>${index + 1}. ${effect.name}</strong><span>${effect.summary}</span>`;
      main.addEventListener("click", () => selectPass(pass.id));

      const up = document.createElement("button");
      up.type = "button";
      up.className = "pass-move";
      up.textContent = "↑";
      up.disabled = index === 0;
      up.title = "Move pass earlier";
      up.addEventListener("click", () => movePass(index, -1));

      const down = document.createElement("button");
      down.type = "button";
      down.className = "pass-move";
      down.textContent = "↓";
      down.disabled = index === state.passes.length - 1;
      down.title = "Move pass later";
      down.addEventListener("click", () => movePass(index, 1));

      row.append(enabled, main, up, down);
      ui.passList.appendChild(row);
    });
  }

  function movePass(index, direction) {
    const target = index + direction;
    if (target < 0 || target >= state.passes.length) return;
    const [pass] = state.passes.splice(index, 1);
    state.passes.splice(target, 0, pass);
    renderPassList();
    updateTelemetry();
  }

  function selectPass(id) {
    state.selectedPassId = id;
    renderPassList();
    syncInspector();
  }

  function syncInspector() {
    const pass = selectedPass();
    const effect = effectById(pass.effectId);
    const index = state.passes.indexOf(pass);
    ui.selectedPassLabel.textContent = `Pass ${index + 1}`;
    ui.selectedEffect.value = pass.effectId;
    ui.amountLabel.textContent = effect.amountLabel;
    ui.secondaryLabel.textContent = effect.secondaryLabel;
    ui.passAmount.value = String(pass.amount);
    ui.passSecondary.value = String(pass.secondary);
    ui.passMix.value = String(pass.mix);
    ui.passAmount.nextElementSibling.textContent = pass.amount.toFixed(3);
    ui.passSecondary.nextElementSibling.textContent = pass.secondary.toFixed(3);
    ui.passMix.nextElementSibling.textContent = pass.mix.toFixed(3);
  }

  function clearHistoryBuffers() {
    if (!state.gl || !state.targets) return;
    state.targets.history.forEach((target) => clearTarget(state.gl, target));
    state.historyReadIndex = 0;
    state.gl.bindFramebuffer(state.gl.FRAMEBUFFER, null);
    updateTelemetry();
  }

  function resetPipeline() {
    state.passes = defaultPasses();
    state.selectedPassId = "pass-1";
    state.bypassed = false;
    ui.freezeHistory.checked = false;
    renderPassList();
    syncInspector();
    clearHistoryBuffers();
    updateTelemetry();
  }

  function applyPreset(name) {
    const set = (definitions) => {
      state.passes = definitions.map((item, index) => createPass(
        `pass-${index + 1}`,
        item[0],
        item[1],
        item[2],
        item[3],
        item[4]
      ));
      state.selectedPassId = "pass-1";
      state.bypassed = false;
      ui.freezeHistory.checked = false;
      renderPassList();
      syncInspector();
      clearHistoryBuffers();
      updateTelemetry();
    };

    if (name === "echo") {
      set([
        ["feedback", true, 0.91, 0.2, 1],
        ["blur", true, 0.18, 0.04, 0.62],
        ["rgb", true, 0.12, 0.08, 0.46],
        ["grade", true, 0.53, 0.59, 0.68],
        ["solarize", false, 0.7, 0.5, 0.5]
      ]);
    } else if (name === "prism") {
      set([
        ["kaleidoscope", true, 0.67, 0.27, 1],
        ["rgb", true, 0.42, 0.22, 0.9],
        ["edge", true, 0.44, 0.18, 0.36],
        ["grade", true, 0.69, 0.57, 0.82],
        ["feedback", true, 0.62, 0.08, 0.58]
      ]);
    } else if (name === "scan") {
      set([
        ["pixelate", true, 0.71, 0.03, 0.92],
        ["edge", true, 0.72, 0.28, 0.78],
        ["rgb", true, 0.19, 0.25, 0.58],
        ["solarize", true, 0.68, 0.45, 0.42],
        ["feedback", false, 0.78, 0.12, 0.6]
      ]);
    } else if (name === "melt") {
      set([
        ["feedback", true, 0.94, 0.44, 1],
        ["displace", true, 0.79, 0.62, 1],
        ["blur", true, 0.42, 0.31, 0.74],
        ["solarize", true, 0.9, 0.58, 0.68],
        ["rgb", true, 0.38, 0.71, 0.74]
      ]);
    } else {
      set([
        ["grade", true, 0.52, 0.54, 0.72],
        ["edge", false, 0.4, 0.22, 0.5],
        ["rgb", false, 0.15, 0.1, 0.5],
        ["blur", false, 0.18, 0.0, 0.5],
        ["feedback", false, 0.7, 0.1, 0.5]
      ]);
    }
  }

  function timestampName(prefix, extension) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return `${prefix}-${stamp}.${extension}`;
  }

  async function blobToBytes(blob) {
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  }

  async function saveBlob(blob, suggestedName) {
    if (invoke && tauriDialog?.save) {
      const path = await tauriDialog.save({
        title: "Save compositor frame",
        defaultPath: suggestedName,
        filters: [{ name: "PNG image", extensions: ["png"] }]
      });
      if (!path) return null;
      return invoke("write_binary", { path, bytes: await blobToBytes(blob) });
    }

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = suggestedName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return suggestedName;
  }

  async function saveSnapshot() {
    const oldText = ui.snapshotButton.textContent;
    try {
      ui.snapshotButton.disabled = true;
      ui.snapshotButton.textContent = "Rendering…";
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const blob = await new Promise((resolve, reject) => {
        ui.canvas.toBlob(
          (value) => value ? resolve(value) : reject(new Error("Canvas could not create a PNG blob")),
          "image/png"
        );
      });
      ui.snapshotButton.textContent = "Saving…";
      const saved = await saveBlob(blob, timestampName("junkpile-v2-15-composite", "png"));
      if (saved) {
        ui.pipelineState.textContent = "Saved";
        ui.pipelineState.classList.add("ready");
        setTimeout(() => updateTelemetry(), 900);
      }
    } catch (error) {
      console.error("Could not save compositor PNG", error);
      ui.pipelineState.textContent = "Save error";
      window.alert(`Could not save PNG:
${error.message || error}`);
    } finally {
      ui.snapshotButton.disabled = false;
      ui.snapshotButton.textContent = oldText;
    }
  }

  async function toggleFullscreen() {
    try {
      if (invoke) {
        const fullscreen = await invoke("toggle_fullscreen");
        ui.fullscreenButton.textContent = fullscreen ? "Windowed preview" : "Fullscreen preview";
        return;
      }
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
    } catch (error) {
      console.error("Could not toggle fullscreen", error);
      ui.pipelineState.textContent = "Fullscreen error";
    }
  }

  function bindSlider(input, output, formatter, handler) {
    const update = () => {
      output.textContent = formatter(Number(input.value));
      if (handler) handler(Number(input.value));
    };
    input.addEventListener("input", update);
    update();
  }

  function bindUi() {
    fillEffectSelect();
    renderPassList();
    syncInspector();

    bindSlider(ui.sourceSpeed, $("source-speed-output"), (value) => value.toFixed(2));
    bindSlider(ui.sourceScale, $("source-scale-output"), (value) => value.toFixed(2));
    bindSlider(ui.sourceDetail, $("source-detail-output"), (value) => String(Math.round(value)));
    bindSlider(ui.sourceHue, $("source-hue-output"), (value) => `${Math.round(value)}°`);
    bindSlider(ui.passAmount, $("pass-amount-output"), (value) => value.toFixed(3), (value) => {
      selectedPass().amount = value;
    });
    bindSlider(ui.passSecondary, $("pass-secondary-output"), (value) => value.toFixed(3), (value) => {
      selectedPass().secondary = value;
    });
    bindSlider(ui.passMix, $("pass-mix-output"), (value) => value.toFixed(3), (value) => {
      selectedPass().mix = value;
    });

    ui.selectedEffect.addEventListener("change", () => {
      const pass = selectedPass();
      const effect = effectById(ui.selectedEffect.value);
      pass.effectId = effect.id;
      [pass.amount, pass.secondary, pass.mix] = effect.defaults;
      renderPassList();
      syncInspector();
    });

    ui.bypassButton.addEventListener("click", () => {
      state.bypassed = !state.bypassed;
      updateTelemetry();
    });
    ui.clearHistory.addEventListener("click", clearHistoryBuffers);
    ui.resetPipeline.addEventListener("click", resetPipeline);
    ui.snapshotButton.addEventListener("click", saveSnapshot);
    ui.fullscreenButton.addEventListener("click", toggleFullscreen);
    ui.freezeHistory.addEventListener("change", () => updateTelemetry());
    ui.renderScale.addEventListener("change", () => {
      state.needsResize = true;
    });
    ui.sourceMode.addEventListener("change", () => {
      ui.hudSource.textContent = sourceNames[Number(ui.sourceMode.value)] || sourceNames[0];
    });

    document.querySelectorAll("[data-preset]").forEach((button) => {
      button.addEventListener("click", () => applyPreset(button.dataset.preset));
    });

    window.addEventListener("resize", () => {
      state.needsResize = true;
    });
  }

  function initializeWebGl() {
    const gl = ui.canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true
    });
    if (!gl) throw new Error("Unable to create a WebGL 1 context");

    state.gl = gl;
    state.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;
    state.programs = createPrograms(gl);
    state.quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, state.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
      -1,  1,
       1, -1,
       1,  1
    ]), gl.STATIC_DRAW);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

    ui.canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      ui.pipelineState.textContent = "Lost";
      ui.pipelineState.classList.remove("ready");
    });
    ui.canvas.addEventListener("webglcontextrestored", () => window.location.reload());
  }

  function start() {
    bindUi();
    ui.hudSource.textContent = sourceNames[Number(ui.sourceMode.value)] || sourceNames[0];
    try {
      initializeWebGl();
      state.needsResize = true;
      requestAnimationFrame(renderFrame);
    } catch (error) {
      console.error("Tauri v2 Example 15 initialization failed", error);
      ui.unsupported.classList.remove("hidden");
      ui.unsupported.querySelector("p").textContent = error instanceof Error ? error.message : String(error);
    }
  }

  start();
})();
