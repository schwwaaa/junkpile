(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const ui = {
    imageInput: $("image-input"),
    dropZone: $("drop-zone"),
    dropOverlay: $("drop-overlay"),
    sourceState: $("source-state"),
    sourceName: $("source-name"),
    sourceSize: $("source-size"),
    sourceAspect: $("source-aspect"),
    fitMode: $("fit-mode"),
    zoom: $("zoom"),
    zoomOutput: $("zoom-output"),
    panX: $("pan-x"),
    panXOutput: $("pan-x-output"),
    panY: $("pan-y"),
    panYOutput: $("pan-y-output"),
    rotation: $("rotation"),
    rotationOutput: $("rotation-output"),
    mirrorX: $("mirror-x"),
    mirrorY: $("mirror-y"),
    resetFraming: $("reset-framing"),
    effectMode: $("effect-mode"),
    effectLabel: $("effect-label"),
    effectAmount: $("effect-amount"),
    effectAmountOutput: $("effect-amount-output"),
    effectScale: $("effect-scale"),
    effectScaleOutput: $("effect-scale-output"),
    effectAngle: $("effect-angle"),
    effectAngleOutput: $("effect-angle-output"),
    hue: $("hue"),
    hueOutput: $("hue-output"),
    saturation: $("saturation"),
    saturationOutput: $("saturation-output"),
    brightness: $("brightness"),
    brightnessOutput: $("brightness-output"),
    contrast: $("contrast"),
    contrastOutput: $("contrast-output"),
    gamma: $("gamma"),
    gammaOutput: $("gamma-output"),
    resetGrade: $("reset-grade"),
    compareEnabled: $("compare-enabled"),
    comparePosition: $("compare-position"),
    comparePositionOutput: $("compare-position-output"),
    compareAxis: $("compare-axis"),
    exportSize: $("export-size"),
    customExportRow: $("custom-export-row"),
    exportWidth: $("export-width"),
    exportHeight: $("export-height"),
    exportFormat: $("export-format"),
    jpegQualityRow: $("jpeg-quality-row"),
    jpegQuality: $("jpeg-quality"),
    jpegQualityOutput: $("jpeg-quality-output"),
    saveImage: $("save-image"),
    saveOriginal: $("save-original"),
    exportState: $("export-state"),
    fpsLabel: $("fps-label"),
    renderSize: $("render-size"),
    hudEffect: $("hud-effect"),
    hudFile: $("hud-file"),
    unsupported: $("unsupported")
  };

  const canvas = $("gl-canvas");
  const stage = $("stage");
  const tauriApi = window.__TAURI__ || null;

  const EFFECT_NAMES = [
    "Clean",
    "Duotone",
    "Posterize",
    "Edge ink",
    "Chromatic split",
    "Halftone",
    "Prismatic warp",
    "Solarize"
  ];

  const state = {
    gl: null,
    program: null,
    texture: null,
    uniforms: {},
    sourceElement: null,
    sourceWidth: 1024,
    sourceHeight: 1024,
    sourceName: "Generated demo",
    objectUrl: null,
    startedAt: performance.now(),
    lastFrameAt: performance.now(),
    frameCounter: 0,
    fpsUpdatedAt: performance.now(),
    exporting: false,
    resizePending: true
  };

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

    uniform sampler2D u_image;
    uniform vec2 u_resolution;
    uniform vec2 u_image_size;
    uniform float u_time;
    uniform float u_fit_mode;
    uniform float u_zoom;
    uniform vec2 u_pan;
    uniform float u_rotation;
    uniform vec2 u_mirror;
    uniform float u_effect_mode;
    uniform float u_effect_amount;
    uniform float u_effect_scale;
    uniform float u_effect_angle;
    uniform float u_hue;
    uniform float u_saturation;
    uniform float u_brightness;
    uniform float u_contrast;
    uniform float u_gamma;
    uniform float u_compare_enabled;
    uniform float u_compare_position;
    uniform float u_compare_axis;
    uniform float u_force_original;

    const float PI = 3.141592653589793;

    vec2 rotate2d(vec2 p, float angle) {
      float c = cos(angle);
      float s = sin(angle);
      return mat2(c, -s, s, c) * p;
    }

    vec2 imageUv(vec2 screenUv, out float inside) {
      float canvasAspect = u_resolution.x / max(u_resolution.y, 1.0);
      float imageAspect = u_image_size.x / max(u_image_size.y, 1.0);
      vec2 displaySize = vec2(1.0);

      if (u_fit_mode < 0.5) {
        if (imageAspect > canvasAspect) {
          displaySize.y = canvasAspect / imageAspect;
        } else {
          displaySize.x = imageAspect / canvasAspect;
        }
      } else if (u_fit_mode < 1.5) {
        if (imageAspect > canvasAspect) {
          displaySize.x = imageAspect / canvasAspect;
        } else {
          displaySize.y = canvasAspect / imageAspect;
        }
      }

      vec2 p = (screenUv - 0.5) / displaySize;
      p -= u_pan * 0.5;
      p /= max(u_zoom, 0.001);
      p = rotate2d(p, -u_rotation);
      p *= u_mirror;
      vec2 uv = p + 0.5;
      inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
      return uv;
    }

    vec4 sampleSource(vec2 uv) {
      float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
      return texture2D(u_image, clamp(uv, 0.0, 1.0)) * inside;
    }

    vec3 hueShift(vec3 color, float angle) {
      float y = dot(color, vec3(0.299, 0.587, 0.114));
      float i = dot(color, vec3(0.596, -0.274, -0.322));
      float q = dot(color, vec3(0.211, -0.523, 0.312));
      float chroma = sqrt(i * i + q * q);
      float hue = atan(q, i) + angle;
      i = chroma * cos(hue);
      q = chroma * sin(hue);
      return vec3(
        y + 0.956 * i + 0.621 * q,
        y - 0.272 * i - 0.647 * q,
        y - 1.106 * i + 1.703 * q
      );
    }

    vec3 grade(vec3 color) {
      color = hueShift(color, u_hue);
      float luminance = dot(color, vec3(0.299, 0.587, 0.114));
      color = mix(vec3(luminance), color, u_saturation);
      color = (color - 0.5) * u_contrast + 0.5;
      color *= u_brightness;
      color = pow(max(color, vec3(0.0)), vec3(1.0 / max(u_gamma, 0.001)));
      return clamp(color, 0.0, 1.0);
    }

    vec3 applyEffect(vec2 uv, vec3 graded, float alpha) {
      float mode = u_effect_mode;
      float amount = u_effect_amount;
      vec3 result = graded;

      if (mode > 0.5 && mode < 1.5) {
        float l = dot(graded, vec3(0.299, 0.587, 0.114));
        vec3 shadow = vec3(0.018, 0.055, 0.09);
        vec3 highlight = vec3(0.31, 0.96, 1.0);
        float tint = 0.5 + 0.5 * sin(u_effect_angle);
        highlight = mix(highlight, vec3(1.0, 0.43, 0.2), tint);
        result = mix(shadow, highlight, smoothstep(0.05, 0.95, l));
      } else if (mode > 1.5 && mode < 2.5) {
        float levels = floor(mix(2.0, 16.0, u_effect_scale / 160.0));
        result = floor(graded * levels + 0.5) / levels;
      } else if (mode > 2.5 && mode < 3.5) {
        vec2 texel = (1.0 / u_image_size) * mix(0.8, 7.0, u_effect_scale / 160.0);
        vec3 leftColor = grade(sampleSource(uv - vec2(texel.x, 0.0)).rgb);
        vec3 rightColor = grade(sampleSource(uv + vec2(texel.x, 0.0)).rgb);
        vec3 downColor = grade(sampleSource(uv - vec2(0.0, texel.y)).rgb);
        vec3 upColor = grade(sampleSource(uv + vec2(0.0, texel.y)).rgb);
        float edge = length(rightColor - leftColor) + length(upColor - downColor);
        edge = smoothstep(0.03, 0.65, edge);
        result = mix(vec3(0.98), graded * 0.18, edge);
      } else if (mode > 3.5 && mode < 4.5) {
        vec2 direction = vec2(cos(u_effect_angle), sin(u_effect_angle));
        vec2 offset = direction * (u_effect_scale * 0.22) / u_image_size;
        vec3 leftColor = grade(sampleSource(uv - offset).rgb);
        vec3 rightColor = grade(sampleSource(uv + offset).rgb);
        result = vec3(leftColor.r, graded.g, rightColor.b);
      } else if (mode > 4.5 && mode < 5.5) {
        float cellSize = mix(3.0, 42.0, u_effect_scale / 160.0);
        vec2 cell = rotate2d(gl_FragCoord.xy / cellSize, u_effect_angle);
        vec2 local = fract(cell) - 0.5;
        float luminance = dot(graded, vec3(0.299, 0.587, 0.114));
        float radius = 0.08 + luminance * 0.46;
        float dotShape = 1.0 - smoothstep(radius, radius + 0.08, length(local));
        vec3 ink = mix(vec3(0.035, 0.045, 0.05), graded, 0.22);
        result = mix(vec3(0.96, 0.94, 0.88), ink, dotShape);
      } else if (mode > 5.5 && mode < 6.5) {
        vec2 centered = uv - 0.5;
        float radial = length(centered);
        float wave = sin(radial * mix(18.0, 92.0, u_effect_scale / 160.0) - u_time * 1.4);
        vec2 direction = normalize(centered + vec2(0.0001));
        vec2 warpedUv = uv + direction * wave * 0.018 * amount;
        vec2 split = vec2(cos(u_effect_angle), sin(u_effect_angle)) * 4.0 / u_image_size;
        vec3 centerColor = grade(sampleSource(warpedUv).rgb);
        vec3 redColor = grade(sampleSource(warpedUv + split).rgb);
        vec3 blueColor = grade(sampleSource(warpedUv - split).rgb);
        result = vec3(redColor.r, centerColor.g, blueColor.b);
      } else if (mode > 6.5) {
        vec3 solarized = mix(graded, 1.0 - graded, step(vec3(0.5), graded));
        result = solarized;
      }

      return mix(graded, result, amount) * step(0.001, alpha);
    }

    void main() {
      float inside = 0.0;
      vec2 uv = imageUv(v_uv, inside);
      vec4 source = sampleSource(uv) * inside;
      vec3 processed = applyEffect(uv, grade(source.rgb), source.a);
      vec3 finalColor = processed;
      float finalAlpha = source.a;

      if (u_force_original > 0.5) {
        finalColor = source.rgb;
      } else if (u_compare_enabled > 0.5) {
        float coordinate = u_compare_axis < 0.5 ? v_uv.x : v_uv.y;
        float originalSide = step(coordinate, u_compare_position);
        finalColor = mix(processed, source.rgb, originalSide);
        float line = 1.0 - smoothstep(0.0, 0.0035, abs(coordinate - u_compare_position));
        finalColor = mix(finalColor, vec3(0.5, 0.94, 1.0), line * 0.9);
        finalAlpha = max(finalAlpha, line);
      }

      gl_FragColor = vec4(clamp(finalColor, 0.0, 1.0), finalAlpha);
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
    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program) || "Unknown program link error";
      gl.deleteProgram(program);
      throw new Error(message);
    }
    return program;
  }

  function uniform(name) {
    const value = state.gl.getUniformLocation(state.program, name);
    if (value === null) throw new Error(`Shader uniform not found: ${name}`);
    return value;
  }

  function initializeWebGL() {
    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true,
      premultipliedAlpha: false,
      powerPreference: "high-performance"
    });
    if (!gl) throw new Error("WebGL 1 is unavailable in this WebView");

    state.gl = gl;
    state.program = createProgram(gl);
    gl.useProgram(state.program);

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const attributeLocation = gl.getAttribLocation(state.program, "a_position");
    gl.enableVertexAttribArray(attributeLocation);
    gl.vertexAttribPointer(attributeLocation, 2, gl.FLOAT, false, 0, 0);

    state.uniforms = {
      image: uniform("u_image"),
      resolution: uniform("u_resolution"),
      imageSize: uniform("u_image_size"),
      time: uniform("u_time"),
      fitMode: uniform("u_fit_mode"),
      zoom: uniform("u_zoom"),
      pan: uniform("u_pan"),
      rotation: uniform("u_rotation"),
      mirror: uniform("u_mirror"),
      effectMode: uniform("u_effect_mode"),
      effectAmount: uniform("u_effect_amount"),
      effectScale: uniform("u_effect_scale"),
      effectAngle: uniform("u_effect_angle"),
      hue: uniform("u_hue"),
      saturation: uniform("u_saturation"),
      brightness: uniform("u_brightness"),
      contrast: uniform("u_contrast"),
      gamma: uniform("u_gamma"),
      compareEnabled: uniform("u_compare_enabled"),
      comparePosition: uniform("u_compare_position"),
      compareAxis: uniform("u_compare_axis"),
      forceOriginal: uniform("u_force_original")
    };

    state.texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, state.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.uniform1i(state.uniforms.image, 0);
  }

  function createDemoImage() {
    const demo = document.createElement("canvas");
    demo.width = 1024;
    demo.height = 1024;
    const context = demo.getContext("2d");
    const gradient = context.createLinearGradient(0, 0, 1024, 1024);
    gradient.addColorStop(0, "#101923");
    gradient.addColorStop(0.35, "#1c6d83");
    gradient.addColorStop(0.66, "#f4a66a");
    gradient.addColorStop(1, "#481a56");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 1024, 1024);

    context.globalCompositeOperation = "screen";
    for (let index = 0; index < 18; index += 1) {
      const x = 100 + ((index * 173) % 850);
      const y = 90 + ((index * 257) % 860);
      const radius = 45 + ((index * 31) % 150);
      const radial = context.createRadialGradient(x, y, 0, x, y, radius);
      radial.addColorStop(0, `hsla(${170 + index * 19}, 90%, 70%, .7)`);
      radial.addColorStop(1, "rgba(0,0,0,0)");
      context.fillStyle = radial;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    }

    context.globalCompositeOperation = "source-over";
    context.strokeStyle = "rgba(255,255,255,.62)";
    context.lineWidth = 3;
    context.strokeRect(74, 74, 876, 876);
    context.strokeStyle = "rgba(255,255,255,.18)";
    context.lineWidth = 1;
    for (let index = 1; index < 12; index += 1) {
      const position = 74 + (876 / 12) * index;
      context.beginPath();
      context.moveTo(position, 74);
      context.lineTo(position, 950);
      context.stroke();
      context.beginPath();
      context.moveTo(74, position);
      context.lineTo(950, position);
      context.stroke();
    }
    context.fillStyle = "rgba(4,9,13,.76)";
    context.fillRect(74, 808, 876, 142);
    context.fillStyle = "#eafcff";
    context.font = "700 72px -apple-system, BlinkMacSystemFont, sans-serif";
    context.fillText("JUNKPILE 16", 112, 882);
    context.fillStyle = "rgba(234,252,255,.72)";
    context.font = "24px ui-monospace, monospace";
    context.fillText("IMAGE TEXTURE / WEBGL PROCESSOR", 116, 923);
    return demo;
  }

  function uploadSource(element, width, height, name) {
    const gl = state.gl;
    state.sourceElement = element;
    state.sourceWidth = width;
    state.sourceHeight = height;
    state.sourceName = name;

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, state.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, element);

    ui.sourceState.textContent = "Loaded";
    ui.sourceName.textContent = name;
    ui.sourceSize.textContent = `${width} × ${height}`;
    ui.sourceAspect.textContent = (width / height).toFixed(3);
    ui.hudFile.textContent = name;
  }

  function loadFile(file) {
    if (!file || !file.type.startsWith("image/")) {
      window.alert("Choose a supported image file.");
      return;
    }

    ui.sourceState.textContent = "Loading…";
    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => uploadSource(image, image.naturalWidth, image.naturalHeight, file.name);
    image.onerror = () => {
      ui.sourceState.textContent = "Load failed";
      window.alert("The WebView could not decode that image.");
    };
    image.src = state.objectUrl;
  }

  function resizePreview() {
    if (state.exporting) return;
    const rect = stage.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      state.gl.viewport(0, 0, width, height);
      ui.renderSize.textContent = `${width} × ${height}`;
    }
  }

  function renderOnce(now, options = {}) {
    const gl = state.gl;
    if (!gl || !state.sourceElement) return;
    const exporting = Boolean(options.exporting);
    const forceOriginal = Boolean(options.forceOriginal);

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(state.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, state.texture);

    gl.uniform2f(state.uniforms.resolution, canvas.width, canvas.height);
    gl.uniform2f(state.uniforms.imageSize, state.sourceWidth, state.sourceHeight);
    gl.uniform1f(state.uniforms.time, (now - state.startedAt) / 1000);
    gl.uniform1f(state.uniforms.fitMode, Number(ui.fitMode.value));
    gl.uniform1f(state.uniforms.zoom, Number(ui.zoom.value));
    gl.uniform2f(state.uniforms.pan, Number(ui.panX.value), Number(ui.panY.value));
    gl.uniform1f(state.uniforms.rotation, Number(ui.rotation.value) * Math.PI / 180);
    gl.uniform2f(state.uniforms.mirror, ui.mirrorX.checked ? -1 : 1, ui.mirrorY.checked ? -1 : 1);
    gl.uniform1f(state.uniforms.effectMode, Number(ui.effectMode.value));
    gl.uniform1f(state.uniforms.effectAmount, Number(ui.effectAmount.value));
    gl.uniform1f(state.uniforms.effectScale, Number(ui.effectScale.value));
    gl.uniform1f(state.uniforms.effectAngle, Number(ui.effectAngle.value) * Math.PI / 180);
    gl.uniform1f(state.uniforms.hue, Number(ui.hue.value) * Math.PI / 180);
    gl.uniform1f(state.uniforms.saturation, Number(ui.saturation.value));
    gl.uniform1f(state.uniforms.brightness, Number(ui.brightness.value));
    gl.uniform1f(state.uniforms.contrast, Number(ui.contrast.value));
    gl.uniform1f(state.uniforms.gamma, Number(ui.gamma.value));
    gl.uniform1f(state.uniforms.compareEnabled, !exporting && ui.compareEnabled.checked ? 1 : 0);
    gl.uniform1f(state.uniforms.comparePosition, Number(ui.comparePosition.value));
    gl.uniform1f(state.uniforms.compareAxis, Number(ui.compareAxis.value));
    gl.uniform1f(state.uniforms.forceOriginal, forceOriginal ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function animationFrame(now) {
    if (!state.exporting) {
      resizePreview();
      renderOnce(now);
    }
    state.frameCounter += 1;
    if (now - state.fpsUpdatedAt >= 500) {
      const fps = Math.round(state.frameCounter * 1000 / (now - state.fpsUpdatedAt));
      ui.fpsLabel.textContent = `${fps} fps`;
      state.frameCounter = 0;
      state.fpsUpdatedAt = now;
    }
    state.lastFrameAt = now;
    requestAnimationFrame(animationFrame);
  }

  function setRange(input, output, formatter) {
    const update = () => { output.textContent = formatter(Number(input.value)); };
    input.addEventListener("input", update);
    update();
  }

  function setEffectLabel() {
    const name = EFFECT_NAMES[Number(ui.effectMode.value)] || "Effect";
    ui.effectLabel.textContent = name;
    ui.hudEffect.textContent = name;
  }

  function resetFraming() {
    ui.fitMode.value = "1";
    ui.zoom.value = "1";
    ui.panX.value = "0";
    ui.panY.value = "0";
    ui.rotation.value = "0";
    ui.mirrorX.checked = false;
    ui.mirrorY.checked = false;
    ui.zoom.dispatchEvent(new Event("input"));
    ui.panX.dispatchEvent(new Event("input"));
    ui.panY.dispatchEvent(new Event("input"));
    ui.rotation.dispatchEvent(new Event("input"));
  }

  function resetGrade() {
    ui.hue.value = "0";
    ui.saturation.value = "1";
    ui.brightness.value = "1";
    ui.contrast.value = "1";
    ui.gamma.value = "1";
    [ui.hue, ui.saturation, ui.brightness, ui.contrast, ui.gamma]
      .forEach((element) => element.dispatchEvent(new Event("input")));
  }

  const PRESETS = {
    editorial: { effect: 1, amount: 0.72, scale: 48, angle: -35, hue: -7, saturation: 0.88, brightness: 1.05, contrast: 1.28, gamma: 0.95 },
    print: { effect: 5, amount: 0.92, scale: 84, angle: 18, hue: 0, saturation: 0.72, brightness: 1.08, contrast: 1.42, gamma: 1.08 },
    signal: { effect: 4, amount: 0.88, scale: 110, angle: 0, hue: 9, saturation: 1.32, brightness: 1.02, contrast: 1.16, gamma: 0.92 },
    soft: { effect: 0, amount: 0, scale: 36, angle: 0, hue: -8, saturation: 0.82, brightness: 1.08, contrast: 0.88, gamma: 1.14 }
  };

  function applyPreset(name) {
    const preset = PRESETS[name];
    if (!preset) return;
    ui.effectMode.value = String(preset.effect);
    ui.effectAmount.value = String(preset.amount);
    ui.effectScale.value = String(preset.scale);
    ui.effectAngle.value = String(preset.angle);
    ui.hue.value = String(preset.hue);
    ui.saturation.value = String(preset.saturation);
    ui.brightness.value = String(preset.brightness);
    ui.contrast.value = String(preset.contrast);
    ui.gamma.value = String(preset.gamma);
    [ui.effectAmount, ui.effectScale, ui.effectAngle, ui.hue, ui.saturation, ui.brightness, ui.contrast, ui.gamma]
      .forEach((element) => element.dispatchEvent(new Event("input")));
    setEffectLabel();
  }

  function clampExportDimension(value, fallback) {
    const number = Number(value);
    return Math.max(64, Math.min(8192, Number.isFinite(number) ? Math.round(number) : fallback));
  }

  function resolveExportSize() {
    const choice = ui.exportSize.value;
    if (choice === "source") return [state.sourceWidth, state.sourceHeight];
    if (choice === "custom") {
      return [
        clampExportDimension(ui.exportWidth.value, state.sourceWidth),
        clampExportDimension(ui.exportHeight.value, state.sourceHeight)
      ];
    }
    const [width, height] = choice.split("x").map(Number);
    return [width, height];
  }

  function canvasToBlob(type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("The WebView could not encode the canvas."));
      }, type, quality);
    });
  }

  async function renderProcessedBlob() {
    const [width, height] = resolveExportSize();
    const maxViewport = state.gl.getParameter(state.gl.MAX_VIEWPORT_DIMS);
    if (width > maxViewport[0] || height > maxViewport[1]) {
      throw new Error(`Requested ${width} × ${height}, but this WebGL context supports up to ${maxViewport[0]} × ${maxViewport[1]}.`);
    }

    const previousWidth = canvas.width;
    const previousHeight = canvas.height;
    state.exporting = true;
    canvas.width = width;
    canvas.height = height;
    renderOnce(performance.now(), { exporting: true });
    state.gl.finish();

    const format = ui.exportFormat.value;
    const type = format === "jpeg" ? "image/jpeg" : "image/png";
    const quality = Number(ui.jpegQuality.value);
    try {
      return await canvasToBlob(type, quality);
    } finally {
      canvas.width = previousWidth;
      canvas.height = previousHeight;
      state.exporting = false;
      resizePreview();
      renderOnce(performance.now());
    }
  }

  function sourceToBlob() {
    return new Promise((resolve, reject) => {
      const sourceCanvas = document.createElement("canvas");
      sourceCanvas.width = state.sourceWidth;
      sourceCanvas.height = state.sourceHeight;
      const context = sourceCanvas.getContext("2d");
      context.drawImage(state.sourceElement, 0, 0, state.sourceWidth, state.sourceHeight);
      const format = ui.exportFormat.value;
      const type = format === "jpeg" ? "image/jpeg" : "image/png";
      sourceCanvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("The WebView could not encode the source image."));
      }, type, Number(ui.jpegQuality.value));
    });
  }

  function safeBaseName() {
    const withoutExtension = state.sourceName.replace(/\.[^.]+$/, "");
    const cleaned = withoutExtension.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "");
    return cleaned || "junkpile-image";
  }

  async function saveBlob(blob, suggestedName, extension) {
    if (tauriApi?.dialog?.save && tauriApi?.fs?.writeBinaryFile) {
      const path = await tauriApi.dialog.save({
        defaultPath: suggestedName,
        filters: [{ name: extension.toUpperCase(), extensions: [extension] }]
      });
      if (!path) return null;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      await tauriApi.fs.writeBinaryFile(path, bytes);
      return path;
    }

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = suggestedName;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return suggestedName;
  }

  async function exportImage(original = false) {
    if (state.exporting) return;
    const button = original ? ui.saveOriginal : ui.saveImage;
    const previousText = button.textContent;
    try {
      state.exporting = true;
      button.disabled = true;
      ui.saveImage.disabled = true;
      ui.saveOriginal.disabled = true;
      button.textContent = "Rendering…";
      ui.exportState.textContent = "Rendering";
      const blob = original ? await sourceToBlob() : await renderProcessedBlob();
      const extension = ui.exportFormat.value === "jpeg" ? "jpg" : "png";
      const suffix = original ? "original" : "processed";
      button.textContent = "Saving…";
      ui.exportState.textContent = "Choose location";
      const path = await saveBlob(blob, `${safeBaseName()}-${suffix}.${extension}`, extension);
      ui.exportState.textContent = path ? "Saved" : "Cancelled";
    } catch (error) {
      console.error("Image export failed", error);
      ui.exportState.textContent = "Export failed";
      window.alert(`Could not export image:\n${error.message || error}`);
    } finally {
      state.exporting = false;
      button.textContent = previousText;
      ui.saveImage.disabled = false;
      ui.saveOriginal.disabled = false;
    }
  }

  function setDragState(active) {
    ui.dropZone.classList.toggle("dragging", active);
    ui.dropOverlay.classList.toggle("hidden", !active);
  }

  function handleDrop(event) {
    event.preventDefault();
    setDragState(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) loadFile(file);
  }

  function initializeControls() {
    setRange(ui.zoom, ui.zoomOutput, (value) => value.toFixed(2));
    setRange(ui.panX, ui.panXOutput, (value) => value.toFixed(3));
    setRange(ui.panY, ui.panYOutput, (value) => value.toFixed(3));
    setRange(ui.rotation, ui.rotationOutput, (value) => `${Math.round(value)}°`);
    setRange(ui.effectAmount, ui.effectAmountOutput, (value) => value.toFixed(3));
    setRange(ui.effectScale, ui.effectScaleOutput, (value) => String(Math.round(value)));
    setRange(ui.effectAngle, ui.effectAngleOutput, (value) => `${Math.round(value)}°`);
    setRange(ui.hue, ui.hueOutput, (value) => `${Math.round(value)}°`);
    setRange(ui.saturation, ui.saturationOutput, (value) => value.toFixed(3));
    setRange(ui.brightness, ui.brightnessOutput, (value) => value.toFixed(3));
    setRange(ui.contrast, ui.contrastOutput, (value) => value.toFixed(3));
    setRange(ui.gamma, ui.gammaOutput, (value) => value.toFixed(3));
    setRange(ui.comparePosition, ui.comparePositionOutput, (value) => `${Math.round(value * 100)}%`);
    setRange(ui.jpegQuality, ui.jpegQualityOutput, (value) => `${Math.round(value * 100)}%`);

    ui.effectMode.addEventListener("change", setEffectLabel);
    ui.imageInput.addEventListener("change", () => loadFile(ui.imageInput.files?.[0]));
    ui.resetFraming.addEventListener("click", resetFraming);
    ui.resetGrade.addEventListener("click", resetGrade);
    document.querySelectorAll("[data-preset]").forEach((button) => {
      button.addEventListener("click", () => applyPreset(button.dataset.preset));
    });

    ui.exportSize.addEventListener("change", () => {
      ui.customExportRow.classList.toggle("hidden", ui.exportSize.value !== "custom");
    });
    ui.exportFormat.addEventListener("change", () => {
      ui.jpegQualityRow.classList.toggle("hidden", ui.exportFormat.value !== "jpeg");
    });
    ui.exportFormat.dispatchEvent(new Event("change"));
    ui.saveImage.addEventListener("click", () => exportImage(false));
    ui.saveOriginal.addEventListener("click", () => exportImage(true));

    [ui.dropZone, stage].forEach((element) => {
      element.addEventListener("dragenter", (event) => { event.preventDefault(); setDragState(true); });
      element.addEventListener("dragover", (event) => { event.preventDefault(); setDragState(true); });
      element.addEventListener("dragleave", (event) => {
        if (!event.relatedTarget || !element.contains(event.relatedTarget)) setDragState(false);
      });
      element.addEventListener("drop", handleDrop);
    });

    ui.dropZone.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        ui.imageInput.click();
      }
    });

    window.addEventListener("resize", resizePreview);
    setEffectLabel();
  }

  function start() {
    try {
      initializeWebGL();
      initializeControls();
      const demo = createDemoImage();
      uploadSource(demo, demo.width, demo.height, "Generated demo");
      resizePreview();
      requestAnimationFrame(animationFrame);
    } catch (error) {
      console.error("Could not initialize Example 16", error);
      ui.unsupported.classList.remove("hidden");
      ui.unsupported.querySelector("p").textContent = error.message || String(error);
    }
  }

  window.addEventListener("beforeunload", () => {
    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  });

  start();
})();
