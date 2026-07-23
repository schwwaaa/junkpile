(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const ui = {
    sourceAInput: $("source-a-input"),
    sourceBInput: $("source-b-input"),
    dropA: $("drop-a"),
    dropB: $("drop-b"),
    sourceAName: $("source-a-name"),
    sourceBName: $("source-b-name"),
    sourceAState: $("source-a-state"),
    sourceBState: $("source-b-state"),
    sourceASize: $("source-a-size"),
    sourceBSize: $("source-b-size"),
    sourceATime: $("source-a-time"),
    sourceBTime: $("source-b-time"),
    sourceAPlay: $("source-a-play"),
    sourceBPlay: $("source-b-play"),
    sourceASpeed: $("source-a-speed"),
    sourceBSpeed: $("source-b-speed"),
    sourceASpeedOutput: $("source-a-speed-output"),
    sourceBSpeedOutput: $("source-b-speed-output"),
    swapLayers: $("swap-layers"),
    editLayerA: $("edit-layer-a"),
    editLayerB: $("edit-layer-b"),
    activeLayerLabel: $("active-layer-label"),
    fitMode: $("fit-mode"),
    layerOpacity: $("layer-opacity"),
    layerOpacityOutput: $("layer-opacity-output"),
    layerZoom: $("layer-zoom"),
    layerZoomOutput: $("layer-zoom-output"),
    layerPanX: $("layer-pan-x"),
    layerPanXOutput: $("layer-pan-x-output"),
    layerPanY: $("layer-pan-y"),
    layerPanYOutput: $("layer-pan-y-output"),
    layerRotation: $("layer-rotation"),
    layerRotationOutput: $("layer-rotation-output"),
    layerMirrorX: $("layer-mirror-x"),
    layerMirrorY: $("layer-mirror-y"),
    resetLayer: $("reset-layer"),
    blendMode: $("blend-mode"),
    blendLabel: $("blend-label"),
    mixAmount: $("mix-amount"),
    mixAmountOutput: $("mix-amount-output"),
    autoCrossfade: $("auto-crossfade"),
    freezeVideos: $("freeze-videos"),
    crossfadeSpeed: $("crossfade-speed"),
    crossfadeSpeedOutput: $("crossfade-speed-output"),
    maskMode: $("mask-mode"),
    maskLabel: $("mask-label"),
    maskPosition: $("mask-position"),
    maskPositionOutput: $("mask-position-output"),
    maskFeather: $("mask-feather"),
    maskFeatherOutput: $("mask-feather-output"),
    maskScale: $("mask-scale"),
    maskScaleOutput: $("mask-scale-output"),
    maskAngle: $("mask-angle"),
    maskAngleOutput: $("mask-angle-output"),
    maskCenterX: $("mask-center-x"),
    maskCenterXOutput: $("mask-center-x-output"),
    maskCenterY: $("mask-center-y"),
    maskCenterYOutput: $("mask-center-y-output"),
    maskInvert: $("mask-invert"),
    viewMode: $("view-mode"),
    backgroundMode: $("background-mode"),
    previewScale: $("preview-scale"),
    exportSize: $("export-size"),
    customExportRow: $("custom-export-row"),
    exportWidth: $("export-width"),
    exportHeight: $("export-height"),
    exportFormat: $("export-format"),
    jpegQualityRow: $("jpeg-quality-row"),
    jpegQuality: $("jpeg-quality"),
    jpegQualityOutput: $("jpeg-quality-output"),
    saveFrame: $("save-frame"),
    exportState: $("export-state"),
    fpsLabel: $("fps-label"),
    renderSize: $("render-size"),
    hudLeft: $("hud-left"),
    hudCenter: $("hud-center"),
    hudRight: $("hud-right"),
    dropOverlay: $("drop-overlay"),
    unsupported: $("unsupported")
  };

  const canvas = $("gl-canvas");
  const stage = $("stage");
  const tauriApi = window.__TAURI__ || null;

  const BLEND_NAMES = [
    "Normal", "Add", "Multiply", "Screen", "Overlay", "Hard light",
    "Difference", "Exclusion", "Lighten", "Darken", "Color dodge"
  ];
  const MASK_NAMES = [
    "None", "Linear", "Radial", "Layer A luminance", "Layer B luminance",
    "Checker", "Stripes", "Animated noise"
  ];

  function defaultTransform() {
    return {
      fit: 1,
      opacity: 1,
      zoom: 1,
      panX: 0,
      panY: 0,
      rotation: 0,
      mirrorX: false,
      mirrorY: false
    };
  }

  function createLayer(key) {
    return {
      key,
      texture: null,
      element: null,
      type: "image",
      name: key === "a" ? "Generated gradient" : "Generated signal",
      width: 1024,
      height: 1024,
      objectUrl: null,
      userPaused: false,
      ready: false,
      uploadFailed: false,
      transform: defaultTransform()
    };
  }

  const state = {
    gl: null,
    program: null,
    uniforms: {},
    layers: { a: createLayer("a"), b: createLayer("b") },
    activeLayer: "a",
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

    uniform sampler2D u_tex_a;
    uniform sampler2D u_tex_b;
    uniform vec2 u_resolution;
    uniform vec2 u_size_a;
    uniform vec2 u_size_b;
    uniform float u_time;

    uniform float u_fit_a;
    uniform float u_fit_b;
    uniform float u_opacity_a;
    uniform float u_opacity_b;
    uniform float u_zoom_a;
    uniform float u_zoom_b;
    uniform vec2 u_pan_a;
    uniform vec2 u_pan_b;
    uniform float u_rotation_a;
    uniform float u_rotation_b;
    uniform vec2 u_mirror_a;
    uniform vec2 u_mirror_b;

    uniform float u_blend_mode;
    uniform float u_mix_amount;
    uniform float u_auto_crossfade;
    uniform float u_crossfade_speed;

    uniform float u_mask_mode;
    uniform float u_mask_position;
    uniform float u_mask_feather;
    uniform float u_mask_scale;
    uniform float u_mask_angle;
    uniform vec2 u_mask_center;
    uniform float u_mask_invert;

    uniform float u_view_mode;
    uniform float u_background_mode;

    const float PI = 3.141592653589793;

    vec2 rotate2d(vec2 p, float angle) {
      float c = cos(angle);
      float s = sin(angle);
      return mat2(c, -s, s, c) * p;
    }

    vec3 mapLayerUv(
      vec2 screenUv,
      vec2 sourceSize,
      float fitMode,
      float zoom,
      vec2 pan,
      float rotation,
      vec2 mirrorValue
    ) {
      float canvasAspect = u_resolution.x / max(u_resolution.y, 1.0);
      float sourceAspect = sourceSize.x / max(sourceSize.y, 1.0);
      vec2 displaySize = vec2(1.0);

      if (fitMode < 0.5) {
        if (sourceAspect > canvasAspect) {
          displaySize.y = canvasAspect / sourceAspect;
        } else {
          displaySize.x = sourceAspect / canvasAspect;
        }
      } else if (fitMode < 1.5) {
        if (sourceAspect > canvasAspect) {
          displaySize.x = sourceAspect / canvasAspect;
        } else {
          displaySize.y = canvasAspect / sourceAspect;
        }
      }

      vec2 p = (screenUv - 0.5) / displaySize;
      p -= pan * 0.5;
      p /= max(zoom, 0.001);
      p = rotate2d(p, -rotation);
      p *= mirrorValue;
      vec2 uv = p + 0.5;
      float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
      return vec3(uv, inside);
    }

    vec3 overlayBlend(vec3 a, vec3 b) {
      vec3 low = 2.0 * a * b;
      vec3 high = 1.0 - 2.0 * (1.0 - a) * (1.0 - b);
      return mix(low, high, step(vec3(0.5), a));
    }

    vec3 hardLightBlend(vec3 a, vec3 b) {
      vec3 low = 2.0 * a * b;
      vec3 high = 1.0 - 2.0 * (1.0 - a) * (1.0 - b);
      return mix(low, high, step(vec3(0.5), b));
    }

    vec3 blendColors(vec3 a, vec3 b) {
      if (u_blend_mode < 0.5) return b;
      if (u_blend_mode < 1.5) return min(a + b, vec3(1.0));
      if (u_blend_mode < 2.5) return a * b;
      if (u_blend_mode < 3.5) return 1.0 - (1.0 - a) * (1.0 - b);
      if (u_blend_mode < 4.5) return overlayBlend(a, b);
      if (u_blend_mode < 5.5) return hardLightBlend(a, b);
      if (u_blend_mode < 6.5) return abs(a - b);
      if (u_blend_mode < 7.5) return a + b - 2.0 * a * b;
      if (u_blend_mode < 8.5) return max(a, b);
      if (u_blend_mode < 9.5) return min(a, b);
      return min(a / max(vec3(0.001), 1.0 - b), vec3(1.0));
    }

    float hash21(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    float valueNoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = hash21(i);
      float b = hash21(i + vec2(1.0, 0.0));
      float c = hash21(i + vec2(0.0, 1.0));
      float d = hash21(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }

    float buildMask(vec2 uv, vec3 colorA, vec3 colorB) {
      float feather = max(u_mask_feather, 0.001);
      vec2 p = uv - u_mask_center;
      p = rotate2d(p, u_mask_angle);
      float pattern = 1.0;

      if (u_mask_mode > 0.5 && u_mask_mode < 1.5) {
        float coordinate = p.x * max(0.2, u_mask_scale * 0.15) + 0.5;
        pattern = smoothstep(u_mask_position - feather, u_mask_position + feather, coordinate);
      } else if (u_mask_mode > 1.5 && u_mask_mode < 2.5) {
        float radius = mix(0.03, 0.82, u_mask_position);
        float distanceValue = length(p) * max(0.2, u_mask_scale * 0.15);
        pattern = 1.0 - smoothstep(radius - feather, radius + feather, distanceValue);
      } else if (u_mask_mode > 2.5 && u_mask_mode < 3.5) {
        float lumaA = dot(colorA, vec3(0.299, 0.587, 0.114));
        pattern = smoothstep(u_mask_position - feather, u_mask_position + feather, lumaA);
      } else if (u_mask_mode > 3.5 && u_mask_mode < 4.5) {
        float lumaB = dot(colorB, vec3(0.299, 0.587, 0.114));
        pattern = smoothstep(u_mask_position - feather, u_mask_position + feather, lumaB);
      } else if (u_mask_mode > 4.5 && u_mask_mode < 5.5) {
        float checker = 0.5 + 0.5 * sin(p.x * u_mask_scale * PI) * sin(p.y * u_mask_scale * PI);
        pattern = smoothstep(u_mask_position - feather, u_mask_position + feather, checker);
      } else if (u_mask_mode > 5.5 && u_mask_mode < 6.5) {
        float stripes = 0.5 + 0.5 * sin(p.x * u_mask_scale * PI * 2.0);
        pattern = smoothstep(u_mask_position - feather, u_mask_position + feather, stripes);
      } else if (u_mask_mode > 6.5) {
        float noiseValue = valueNoise(p * u_mask_scale + vec2(u_time * 0.17, -u_time * 0.11));
        pattern = smoothstep(u_mask_position - feather, u_mask_position + feather, noiseValue);
      }

      return mix(pattern, 1.0 - pattern, u_mask_invert);
    }

    vec4 backgroundColor(vec2 uv) {
      if (u_background_mode < 0.5) return vec4(0.0);
      if (u_background_mode < 1.5) return vec4(0.0, 0.0, 0.0, 1.0);
      if (u_background_mode < 2.5) return vec4(1.0, 1.0, 1.0, 1.0);
      vec2 cell = floor(uv * u_resolution / 22.0);
      float checker = mod(cell.x + cell.y, 2.0);
      vec3 color = mix(vec3(0.12), vec3(0.2), checker);
      return vec4(color, 1.0);
    }

    vec4 compositeOver(vec4 backgroundValue, vec4 foreground) {
      float outAlpha = foreground.a + backgroundValue.a * (1.0 - foreground.a);
      vec3 premultiplied = foreground.rgb * foreground.a + backgroundValue.rgb * backgroundValue.a * (1.0 - foreground.a);
      vec3 outColor = premultiplied / max(outAlpha, 0.0001);
      return vec4(outColor, outAlpha);
    }

    void main() {
      vec3 mappedA = mapLayerUv(v_uv, u_size_a, u_fit_a, u_zoom_a, u_pan_a, u_rotation_a, u_mirror_a);
      vec3 mappedB = mapLayerUv(v_uv, u_size_b, u_fit_b, u_zoom_b, u_pan_b, u_rotation_b, u_mirror_b);
      vec4 sampleA = texture2D(u_tex_a, clamp(mappedA.xy, 0.0, 1.0));
      vec4 sampleB = texture2D(u_tex_b, clamp(mappedB.xy, 0.0, 1.0));
      sampleA.a *= mappedA.z * u_opacity_a;
      sampleB.a *= mappedB.z * u_opacity_b;

      vec4 backgroundValue = backgroundColor(v_uv);
      vec4 base = compositeOver(backgroundValue, sampleA);
      float maskValue = buildMask(v_uv, sampleA.rgb, sampleB.rgb);
      float animatedMix = 0.5 + 0.5 * sin(u_time * u_crossfade_speed * PI * 2.0);
      float chosenMix = mix(u_mix_amount, animatedMix, u_auto_crossfade);
      float contribution = clamp(chosenMix * maskValue * sampleB.a, 0.0, 1.0);
      vec3 blended = blendColors(base.rgb, sampleB.rgb);
      float outputAlpha = base.a + contribution * (1.0 - base.a);
      vec3 outputPremultiplied = base.rgb * base.a * (1.0 - contribution) + blended * contribution;
      vec3 outputColor = outputPremultiplied / max(outputAlpha, 0.0001);
      vec4 composite = vec4(clamp(outputColor, 0.0, 1.0), outputAlpha);

      if (u_view_mode > 0.5 && u_view_mode < 1.5) {
        gl_FragColor = compositeOver(backgroundValue, sampleA);
      } else if (u_view_mode > 1.5 && u_view_mode < 2.5) {
        gl_FragColor = compositeOver(backgroundValue, sampleB);
      } else if (u_view_mode > 2.5) {
        gl_FragColor = vec4(vec3(maskValue), 1.0);
      } else {
        gl_FragColor = composite;
      }
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

  function getUniformLocation(name) {
    const value = state.gl.getUniformLocation(state.program, name);
    if (value === null) throw new Error(`Shader uniform not found: ${name}`);
    return value;
  }

  function createTexture(gl, unit) {
    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    return texture;
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
      texA: getUniformLocation("u_tex_a"),
      texB: getUniformLocation("u_tex_b"),
      resolution: getUniformLocation("u_resolution"),
      sizeA: getUniformLocation("u_size_a"),
      sizeB: getUniformLocation("u_size_b"),
      time: getUniformLocation("u_time"),
      fitA: getUniformLocation("u_fit_a"),
      fitB: getUniformLocation("u_fit_b"),
      opacityA: getUniformLocation("u_opacity_a"),
      opacityB: getUniformLocation("u_opacity_b"),
      zoomA: getUniformLocation("u_zoom_a"),
      zoomB: getUniformLocation("u_zoom_b"),
      panA: getUniformLocation("u_pan_a"),
      panB: getUniformLocation("u_pan_b"),
      rotationA: getUniformLocation("u_rotation_a"),
      rotationB: getUniformLocation("u_rotation_b"),
      mirrorA: getUniformLocation("u_mirror_a"),
      mirrorB: getUniformLocation("u_mirror_b"),
      blendMode: getUniformLocation("u_blend_mode"),
      mixAmount: getUniformLocation("u_mix_amount"),
      autoCrossfade: getUniformLocation("u_auto_crossfade"),
      crossfadeSpeed: getUniformLocation("u_crossfade_speed"),
      maskMode: getUniformLocation("u_mask_mode"),
      maskPosition: getUniformLocation("u_mask_position"),
      maskFeather: getUniformLocation("u_mask_feather"),
      maskScale: getUniformLocation("u_mask_scale"),
      maskAngle: getUniformLocation("u_mask_angle"),
      maskCenter: getUniformLocation("u_mask_center"),
      maskInvert: getUniformLocation("u_mask_invert"),
      viewMode: getUniformLocation("u_view_mode"),
      backgroundMode: getUniformLocation("u_background_mode")
    };

    state.layers.a.texture = createTexture(gl, 0);
    state.layers.b.texture = createTexture(gl, 1);
    gl.uniform1i(state.uniforms.texA, 0);
    gl.uniform1i(state.uniforms.texB, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  }

  function createDemoA() {
    const demo = document.createElement("canvas");
    demo.width = 1024;
    demo.height = 1024;
    const context = demo.getContext("2d");
    const gradient = context.createLinearGradient(0, 0, 1024, 1024);
    gradient.addColorStop(0, "#06121f");
    gradient.addColorStop(0.42, "#127f9b");
    gradient.addColorStop(1, "#d8fbff");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 1024, 1024);
    for (let index = 0; index < 22; index += 1) {
      const x = 90 + (index % 6) * 175 + Math.sin(index * 4.2) * 45;
      const y = 80 + Math.floor(index / 6) * 245 + Math.cos(index * 2.7) * 55;
      const radius = 42 + (index % 4) * 22;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fillStyle = `hsla(${178 + index * 6}, 95%, ${42 + (index % 5) * 8}%, 0.52)`;
      context.fill();
    }
    context.strokeStyle = "rgba(255,255,255,.28)";
    context.lineWidth = 3;
    for (let index = -3; index < 9; index += 1) {
      context.beginPath();
      context.moveTo(index * 160, 0);
      context.lineTo(index * 160 + 700, 1024);
      context.stroke();
    }
    return demo;
  }

  function createDemoB() {
    const demo = document.createElement("canvas");
    demo.width = 1024;
    demo.height = 1024;
    const context = demo.getContext("2d");
    context.fillStyle = "#14090d";
    context.fillRect(0, 0, 1024, 1024);
    for (let y = 0; y < 1024; y += 32) {
      context.fillStyle = y % 64 === 0 ? "rgba(255,126,67,.58)" : "rgba(255,220,138,.16)";
      context.fillRect(0, y, 1024, 13);
    }
    context.save();
    context.translate(512, 512);
    context.rotate(-0.32);
    for (let index = 0; index < 18; index += 1) {
      const size = 70 + index * 28;
      context.strokeStyle = `hsla(${18 + index * 5}, 96%, 65%, ${0.8 - index * 0.03})`;
      context.lineWidth = 9;
      context.strokeRect(-size / 2, -size / 2, size, size);
    }
    context.restore();
    context.globalCompositeOperation = "screen";
    for (let index = 0; index < 65; index += 1) {
      const x = (index * 179) % 1024;
      const y = (index * 307) % 1024;
      const radius = 3 + (index % 7) * 2;
      context.fillStyle = `rgba(255, ${100 + (index % 6) * 22}, 72, ${0.18 + (index % 5) * 0.08})`;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    }
    context.globalCompositeOperation = "source-over";
    return demo;
  }

  function layerUi(key) {
    return key === "a"
      ? {
          name: ui.sourceAName,
          stateLabel: ui.sourceAState,
          size: ui.sourceASize,
          time: ui.sourceATime,
          play: ui.sourceAPlay,
          speed: ui.sourceASpeed,
          speedOutput: ui.sourceASpeedOutput
        }
      : {
          name: ui.sourceBName,
          stateLabel: ui.sourceBState,
          size: ui.sourceBSize,
          time: ui.sourceBTime,
          play: ui.sourceBPlay,
          speed: ui.sourceBSpeed,
          speedOutput: ui.sourceBSpeedOutput
        };
  }

  function revokeLayerUrl(layer) {
    if (layer.objectUrl) {
      URL.revokeObjectURL(layer.objectUrl);
      layer.objectUrl = null;
    }
  }

  function stopLayerElement(layer) {
    if (layer.type === "video" && layer.element) {
      layer.element.pause();
      layer.element.removeAttribute("src");
      layer.element.load();
    }
  }

  function uploadTexture(layer) {
    const gl = state.gl;
    if (!layer.element || !layer.ready) return;
    const unit = layer.key === "a" ? 0 : 1;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, layer.texture);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, layer.element);
      layer.uploadFailed = false;
    } catch (error) {
      if (!layer.uploadFailed) {
        console.error(`Could not upload Layer ${layer.key.toUpperCase()} texture`, error);
        layer.uploadFailed = true;
      }
    }
  }

  function updateLayerUi(key) {
    const layer = state.layers[key];
    const controls = layerUi(key);
    controls.name.textContent = layer.name;
    controls.stateLabel.textContent = layer.type === "video" ? "Video" : "Image";
    controls.size.textContent = `${layer.width} × ${layer.height}`;
    controls.play.disabled = layer.type !== "video" || !layer.ready;
    controls.speed.disabled = layer.type !== "video" || !layer.ready;
    controls.speed.value = layer.type === "video" && layer.element ? String(layer.element.playbackRate) : "1";
    controls.speedOutput.textContent = `${Number(controls.speed.value).toFixed(2)}×`;
    controls.play.textContent = layer.type === "video" && layer.element && !layer.element.paused ? "Pause" : "Play";
    if (layer.type !== "video") controls.time.textContent = "Still frame";
    updateHud();
  }

  function setLayerElement(key, element, width, height, name, type, objectUrl = null) {
    const layer = state.layers[key];
    stopLayerElement(layer);
    revokeLayerUrl(layer);
    layer.element = element;
    layer.width = Math.max(1, width);
    layer.height = Math.max(1, height);
    layer.name = name;
    layer.type = type;
    layer.objectUrl = objectUrl;
    layer.ready = true;
    layer.userPaused = false;
    uploadTexture(layer);
    updateLayerUi(key);
  }

  function loadImageFile(key, file, objectUrl) {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      setLayerElement(key, image, image.naturalWidth, image.naturalHeight, file.name, "image", objectUrl);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      window.alert(`Layer ${key.toUpperCase()} could not decode this image.`);
    };
    image.src = objectUrl;
  }

  function syncVideoPlayback(layer) {
    if (layer.type !== "video" || !layer.element || !layer.ready) return;
    if (ui.freezeVideos.checked || layer.userPaused) {
      layer.element.pause();
    } else {
      layer.element.play().catch(() => {
        layer.userPaused = true;
        updateLayerUi(layer.key);
      });
    }
    updateLayerUi(layer.key);
  }

  function loadVideoFile(key, file, objectUrl) {
    const video = document.createElement("video");
    video.preload = "auto";
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.addEventListener("loadedmetadata", () => {
      setLayerElement(key, video, video.videoWidth, video.videoHeight, file.name, "video", objectUrl);
      video.playbackRate = Number(layerUi(key).speed.value) || 1;
      syncVideoPlayback(state.layers[key]);
    }, { once: true });
    video.addEventListener("loadeddata", () => {
      const layer = state.layers[key];
      if (layer.element === video) {
        layer.ready = true;
        uploadTexture(layer);
        updateLayerUi(key);
      }
    });
    video.addEventListener("error", () => {
      URL.revokeObjectURL(objectUrl);
      window.alert(`Layer ${key.toUpperCase()} could not decode this video in the current WebView.`);
    }, { once: true });
    video.src = objectUrl;
    video.load();
  }

  function inferMediaType(file) {
    if (file.type.startsWith("video/")) return "video";
    if (file.type.startsWith("image/")) return "image";
    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    if (["mp4", "mov", "m4v", "webm", "ogv", "ogg"].includes(extension)) return "video";
    if (["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"].includes(extension)) return "image";
    return "unknown";
  }

  function loadFile(key, file) {
    if (!file) return;
    const type = inferMediaType(file);
    if (type === "unknown") {
      window.alert("Choose a WebView-supported image or video file.");
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    if (type === "video") loadVideoFile(key, file, objectUrl);
    else loadImageFile(key, file, objectUrl);
  }

  function setActiveLayer(key) {
    state.activeLayer = key;
    const isA = key === "a";
    ui.editLayerA.classList.toggle("active", isA);
    ui.editLayerB.classList.toggle("active", !isA);
    ui.editLayerA.setAttribute("aria-selected", String(isA));
    ui.editLayerB.setAttribute("aria-selected", String(!isA));
    ui.activeLayerLabel.textContent = `Editing Layer ${key.toUpperCase()}`;
    document.documentElement.style.setProperty("--active-accent", isA ? "var(--accent-a)" : "var(--accent-b)");
    loadTransformControls();
  }

  function loadTransformControls() {
    const transform = state.layers[state.activeLayer].transform;
    ui.fitMode.value = String(transform.fit);
    ui.layerOpacity.value = String(transform.opacity);
    ui.layerZoom.value = String(transform.zoom);
    ui.layerPanX.value = String(transform.panX);
    ui.layerPanY.value = String(transform.panY);
    ui.layerRotation.value = String(transform.rotation);
    ui.layerMirrorX.checked = transform.mirrorX;
    ui.layerMirrorY.checked = transform.mirrorY;
    refreshTransformOutputs();
  }

  function refreshTransformOutputs() {
    ui.layerOpacityOutput.textContent = Number(ui.layerOpacity.value).toFixed(3);
    ui.layerZoomOutput.textContent = Number(ui.layerZoom.value).toFixed(2);
    ui.layerPanXOutput.textContent = Number(ui.layerPanX.value).toFixed(3);
    ui.layerPanYOutput.textContent = Number(ui.layerPanY.value).toFixed(3);
    ui.layerRotationOutput.textContent = `${Math.round(Number(ui.layerRotation.value))}°`;
  }

  function storeTransformControls() {
    const transform = state.layers[state.activeLayer].transform;
    transform.fit = Number(ui.fitMode.value);
    transform.opacity = Number(ui.layerOpacity.value);
    transform.zoom = Number(ui.layerZoom.value);
    transform.panX = Number(ui.layerPanX.value);
    transform.panY = Number(ui.layerPanY.value);
    transform.rotation = Number(ui.layerRotation.value);
    transform.mirrorX = ui.layerMirrorX.checked;
    transform.mirrorY = ui.layerMirrorY.checked;
    refreshTransformOutputs();
  }

  function resetActiveLayer() {
    state.layers[state.activeLayer].transform = defaultTransform();
    loadTransformControls();
  }

  function swapLayers() {
    const previousA = state.layers.a;
    const previousB = state.layers.b;
    state.layers.a = previousB;
    state.layers.b = previousA;
    state.layers.a.key = "a";
    state.layers.b.key = "b";
    updateLayerUi("a");
    updateLayerUi("b");
    loadTransformControls();
  }

  function resizePreview() {
    if (state.exporting) return;
    const rect = stage.getBoundingClientRect();
    const scale = Number(ui.previewScale.value) || 1;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2) * scale;
    const width = Math.max(2, Math.round(rect.width * pixelRatio));
    const height = Math.max(2, Math.round(rect.height * pixelRatio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ui.renderSize.textContent = `${canvas.width} × ${canvas.height}`;
  }

  function bindLayerTextures() {
    const gl = state.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, state.layers.a.texture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, state.layers.b.texture);
  }

  function updateDynamicTextures() {
    [state.layers.a, state.layers.b].forEach((layer) => {
      if (layer.type === "video" && layer.element && layer.ready && layer.element.readyState >= 2) {
        uploadTexture(layer);
      }
    });
    bindLayerTextures();
  }

  function setTransformUniforms(prefix, layer) {
    const gl = state.gl;
    const transform = layer.transform;
    gl.uniform1f(state.uniforms[`fit${prefix}`], transform.fit);
    gl.uniform1f(state.uniforms[`opacity${prefix}`], transform.opacity);
    gl.uniform1f(state.uniforms[`zoom${prefix}`], transform.zoom);
    gl.uniform2f(state.uniforms[`pan${prefix}`], transform.panX, transform.panY);
    gl.uniform1f(state.uniforms[`rotation${prefix}`], transform.rotation * Math.PI / 180);
    gl.uniform2f(state.uniforms[`mirror${prefix}`], transform.mirrorX ? -1 : 1, transform.mirrorY ? -1 : 1);
  }

  function renderOnce(timestamp) {
    const gl = state.gl;
    if (!gl || !state.program) return;
    updateDynamicTextures();
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(state.program);
    gl.uniform2f(state.uniforms.resolution, canvas.width, canvas.height);
    gl.uniform2f(state.uniforms.sizeA, state.layers.a.width, state.layers.a.height);
    gl.uniform2f(state.uniforms.sizeB, state.layers.b.width, state.layers.b.height);
    gl.uniform1f(state.uniforms.time, (timestamp - state.startedAt) / 1000);
    setTransformUniforms("A", state.layers.a);
    setTransformUniforms("B", state.layers.b);
    gl.uniform1f(state.uniforms.blendMode, Number(ui.blendMode.value));
    gl.uniform1f(state.uniforms.mixAmount, Number(ui.mixAmount.value));
    gl.uniform1f(state.uniforms.autoCrossfade, ui.autoCrossfade.checked ? 1 : 0);
    gl.uniform1f(state.uniforms.crossfadeSpeed, Number(ui.crossfadeSpeed.value));
    gl.uniform1f(state.uniforms.maskMode, Number(ui.maskMode.value));
    gl.uniform1f(state.uniforms.maskPosition, Number(ui.maskPosition.value));
    gl.uniform1f(state.uniforms.maskFeather, Number(ui.maskFeather.value));
    gl.uniform1f(state.uniforms.maskScale, Number(ui.maskScale.value));
    gl.uniform1f(state.uniforms.maskAngle, Number(ui.maskAngle.value) * Math.PI / 180);
    gl.uniform2f(state.uniforms.maskCenter, Number(ui.maskCenterX.value), Number(ui.maskCenterY.value));
    gl.uniform1f(state.uniforms.maskInvert, ui.maskInvert.checked ? 1 : 0);
    gl.uniform1f(state.uniforms.viewMode, Number(ui.viewMode.value));
    gl.uniform1f(state.uniforms.backgroundMode, Number(ui.backgroundMode.value));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function updateVideoTime(key) {
    const layer = state.layers[key];
    const controls = layerUi(key);
    if (layer.type !== "video" || !layer.element || !Number.isFinite(layer.element.duration)) {
      controls.time.textContent = "Still frame";
      return;
    }
    const current = layer.element.currentTime || 0;
    const duration = layer.element.duration || 0;
    controls.time.textContent = `${current.toFixed(1)} / ${duration.toFixed(1)} s`;
    controls.play.textContent = layer.element.paused ? "Play" : "Pause";
  }

  function updateHud(timestamp = performance.now()) {
    ui.hudLeft.textContent = `A · ${state.layers.a.name}`;
    ui.hudRight.textContent = `B · ${state.layers.b.name}`;
    const blendName = BLEND_NAMES[Number(ui.blendMode.value)] || "Blend";
    const effectiveMix = ui.autoCrossfade.checked
      ? 0.5 + 0.5 * Math.sin(((timestamp - state.startedAt) / 1000) * Number(ui.crossfadeSpeed.value) * Math.PI * 2)
      : Number(ui.mixAmount.value);
    ui.hudCenter.textContent = `${blendName} · ${Math.round(effectiveMix * 100)}%`;
  }

  function animationFrame(timestamp) {
    if (state.resizePending) {
      resizePreview();
      state.resizePending = false;
    }
    renderOnce(timestamp);
    updateVideoTime("a");
    updateVideoTime("b");
    updateHud(timestamp);

    state.frameCounter += 1;
    if (timestamp - state.fpsUpdatedAt >= 500) {
      const fps = state.frameCounter * 1000 / (timestamp - state.fpsUpdatedAt);
      ui.fpsLabel.textContent = `${fps.toFixed(0)} fps`;
      state.frameCounter = 0;
      state.fpsUpdatedAt = timestamp;
    }
    state.lastFrameAt = timestamp;
    requestAnimationFrame(animationFrame);
  }

  function bindRange(element, output, formatter, callback = null) {
    const update = () => {
      output.textContent = formatter(Number(element.value));
      if (callback) callback();
    };
    element.addEventListener("input", update);
    update();
  }

  function updateBlendLabels() {
    ui.blendLabel.textContent = BLEND_NAMES[Number(ui.blendMode.value)] || "Blend";
    ui.maskLabel.textContent = MASK_NAMES[Number(ui.maskMode.value)] || "Mask";
    updateHud();
  }

  function toggleLayerPlayback(key) {
    const layer = state.layers[key];
    if (layer.type !== "video" || !layer.element) return;
    layer.userPaused = !layer.element.paused ? true : false;
    if (layer.element.paused) layer.userPaused = false;
    syncVideoPlayback(layer);
  }

  function setLayerSpeed(key, value) {
    const layer = state.layers[key];
    if (layer.type === "video" && layer.element) layer.element.playbackRate = value;
    layerUi(key).speedOutput.textContent = `${value.toFixed(2)}×`;
  }

  function setDropState(element, active) {
    element.classList.toggle("dragging", active);
  }

  function configureDropZone(key, element, input) {
    ["dragenter", "dragover"].forEach((eventName) => {
      element.addEventListener(eventName, (event) => {
        event.preventDefault();
        setDropState(element, true);
      });
    });
    element.addEventListener("dragleave", (event) => {
      if (!event.relatedTarget || !element.contains(event.relatedTarget)) setDropState(element, false);
    });
    element.addEventListener("drop", (event) => {
      event.preventDefault();
      setDropState(element, false);
      loadFile(key, event.dataTransfer?.files?.[0]);
    });
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        input.click();
      }
    });
  }

  const PRESETS = {
    ghost: {
      blend: 3, mix: 0.58, mask: 1, position: 0.44, feather: 0.28, scale: 3.5,
      angle: -18, centerX: 0.5, centerY: 0.5, invert: false, auto: true, speed: 0.12
    },
    cut: {
      blend: 0, mix: 1, mask: 1, position: 0.5, feather: 0.008, scale: 2.4,
      angle: 0, centerX: 0.5, centerY: 0.5, invert: false, auto: false, speed: 0.35
    },
    print: {
      blend: 2, mix: 0.9, mask: 5, position: 0.48, feather: 0.055, scale: 18,
      angle: 28, centerX: 0.5, centerY: 0.5, invert: false, auto: false, speed: 0.35
    },
    signal: {
      blend: 6, mix: 0.88, mask: 7, position: 0.52, feather: 0.13, scale: 9,
      angle: 0, centerX: 0.5, centerY: 0.5, invert: false, auto: true, speed: 0.24
    }
  };

  function applyPreset(name) {
    const preset = PRESETS[name];
    if (!preset) return;
    ui.blendMode.value = String(preset.blend);
    ui.mixAmount.value = String(preset.mix);
    ui.maskMode.value = String(preset.mask);
    ui.maskPosition.value = String(preset.position);
    ui.maskFeather.value = String(preset.feather);
    ui.maskScale.value = String(preset.scale);
    ui.maskAngle.value = String(preset.angle);
    ui.maskCenterX.value = String(preset.centerX);
    ui.maskCenterY.value = String(preset.centerY);
    ui.maskInvert.checked = preset.invert;
    ui.autoCrossfade.checked = preset.auto;
    ui.crossfadeSpeed.value = String(preset.speed);
    [
      ui.mixAmount, ui.maskPosition, ui.maskFeather, ui.maskScale,
      ui.maskAngle, ui.maskCenterX, ui.maskCenterY, ui.crossfadeSpeed
    ].forEach((element) => element.dispatchEvent(new Event("input")));
    updateBlendLabels();
  }

  function clampExportDimension(value, fallback) {
    const number = Number(value);
    return Math.max(64, Math.min(8192, Number.isFinite(number) ? Math.round(number) : fallback));
  }

  function resolveExportSize() {
    const choice = ui.exportSize.value;
    if (choice === "preview") return [canvas.width, canvas.height];
    if (choice === "custom") {
      return [
        clampExportDimension(ui.exportWidth.value, 1920),
        clampExportDimension(ui.exportHeight.value, 1080)
      ];
    }
    return choice.split("x").map(Number);
  }

  function canvasToBlob(type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("The WebView could not encode the composited canvas."));
      }, type, quality);
    });
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

  function safeLayerName(layer) {
    return layer.name.replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || layer.key;
  }

  async function exportFrame() {
    if (state.exporting) return;
    const previousText = ui.saveFrame.textContent;
    const previousWidth = canvas.width;
    const previousHeight = canvas.height;
    try {
      state.exporting = true;
      ui.saveFrame.disabled = true;
      ui.saveFrame.textContent = "Rendering…";
      ui.exportState.textContent = "Rendering";
      const [width, height] = resolveExportSize();
      const maxViewport = state.gl.getParameter(state.gl.MAX_VIEWPORT_DIMS);
      if (width > maxViewport[0] || height > maxViewport[1]) {
        throw new Error(`Requested ${width} × ${height}, but this WebGL context supports up to ${maxViewport[0]} × ${maxViewport[1]}.`);
      }
      canvas.width = width;
      canvas.height = height;
      renderOnce(performance.now());
      state.gl.finish();
      const format = ui.exportFormat.value;
      const extension = format === "jpeg" ? "jpg" : "png";
      const type = format === "jpeg" ? "image/jpeg" : "image/png";
      const blob = await canvasToBlob(type, Number(ui.jpegQuality.value));
      ui.saveFrame.textContent = "Saving…";
      ui.exportState.textContent = "Choose location";
      const name = `${safeLayerName(state.layers.a)}-${safeLayerName(state.layers.b)}-mix.${extension}`;
      const path = await saveBlob(blob, name, extension);
      ui.exportState.textContent = path ? "Saved" : "Cancelled";
    } catch (error) {
      console.error("Texture mixer export failed", error);
      ui.exportState.textContent = "Export failed";
      window.alert(`Could not export the composited frame:\n${error.message || error}`);
    } finally {
      canvas.width = previousWidth;
      canvas.height = previousHeight;
      state.exporting = false;
      ui.saveFrame.disabled = false;
      ui.saveFrame.textContent = previousText;
      state.resizePending = true;
    }
  }

  function initializeControls() {
    bindRange(ui.layerOpacity, ui.layerOpacityOutput, (value) => value.toFixed(3), storeTransformControls);
    bindRange(ui.layerZoom, ui.layerZoomOutput, (value) => value.toFixed(2), storeTransformControls);
    bindRange(ui.layerPanX, ui.layerPanXOutput, (value) => value.toFixed(3), storeTransformControls);
    bindRange(ui.layerPanY, ui.layerPanYOutput, (value) => value.toFixed(3), storeTransformControls);
    bindRange(ui.layerRotation, ui.layerRotationOutput, (value) => `${Math.round(value)}°`, storeTransformControls);
    bindRange(ui.mixAmount, ui.mixAmountOutput, (value) => value.toFixed(3), updateHud);
    bindRange(ui.crossfadeSpeed, ui.crossfadeSpeedOutput, (value) => value.toFixed(2));
    bindRange(ui.maskPosition, ui.maskPositionOutput, (value) => value.toFixed(3));
    bindRange(ui.maskFeather, ui.maskFeatherOutput, (value) => value.toFixed(3));
    bindRange(ui.maskScale, ui.maskScaleOutput, (value) => value.toFixed(1));
    bindRange(ui.maskAngle, ui.maskAngleOutput, (value) => `${Math.round(value)}°`);
    bindRange(ui.maskCenterX, ui.maskCenterXOutput, (value) => value.toFixed(3));
    bindRange(ui.maskCenterY, ui.maskCenterYOutput, (value) => value.toFixed(3));
    bindRange(ui.jpegQuality, ui.jpegQualityOutput, (value) => `${Math.round(value * 100)}%`);

    ui.fitMode.addEventListener("change", storeTransformControls);
    ui.layerMirrorX.addEventListener("change", storeTransformControls);
    ui.layerMirrorY.addEventListener("change", storeTransformControls);
    ui.editLayerA.addEventListener("click", () => setActiveLayer("a"));
    ui.editLayerB.addEventListener("click", () => setActiveLayer("b"));
    ui.resetLayer.addEventListener("click", resetActiveLayer);
    ui.swapLayers.addEventListener("click", swapLayers);

    ui.sourceAInput.addEventListener("change", () => loadFile("a", ui.sourceAInput.files?.[0]));
    ui.sourceBInput.addEventListener("change", () => loadFile("b", ui.sourceBInput.files?.[0]));
    configureDropZone("a", ui.dropA, ui.sourceAInput);
    configureDropZone("b", ui.dropB, ui.sourceBInput);

    ui.sourceAPlay.addEventListener("click", () => toggleLayerPlayback("a"));
    ui.sourceBPlay.addEventListener("click", () => toggleLayerPlayback("b"));
    ui.sourceASpeed.addEventListener("input", () => setLayerSpeed("a", Number(ui.sourceASpeed.value)));
    ui.sourceBSpeed.addEventListener("input", () => setLayerSpeed("b", Number(ui.sourceBSpeed.value)));
    ui.freezeVideos.addEventListener("change", () => {
      syncVideoPlayback(state.layers.a);
      syncVideoPlayback(state.layers.b);
    });

    ui.blendMode.addEventListener("change", updateBlendLabels);
    ui.maskMode.addEventListener("change", updateBlendLabels);
    ui.autoCrossfade.addEventListener("change", updateHud);
    ui.previewScale.addEventListener("change", () => { state.resizePending = true; });
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
    ui.saveFrame.addEventListener("click", exportFrame);

    ["dragenter", "dragover"].forEach((eventName) => {
      stage.addEventListener(eventName, (event) => {
        event.preventDefault();
        ui.dropOverlay.classList.remove("hidden");
      });
    });
    stage.addEventListener("dragleave", (event) => {
      if (!event.relatedTarget || !stage.contains(event.relatedTarget)) ui.dropOverlay.classList.add("hidden");
    });
    stage.addEventListener("drop", (event) => {
      event.preventDefault();
      ui.dropOverlay.classList.add("hidden");
    });

    window.addEventListener("resize", () => { state.resizePending = true; });
    setActiveLayer("a");
    updateBlendLabels();
  }

  function initializeDemoSources() {
    const demoA = createDemoA();
    const demoB = createDemoB();
    setLayerElement("a", demoA, demoA.width, demoA.height, "Generated gradient", "image");
    setLayerElement("b", demoB, demoB.width, demoB.height, "Generated signal", "image");
  }

  function start() {
    try {
      initializeWebGL();
      initializeControls();
      initializeDemoSources();
      resizePreview();
      requestAnimationFrame(animationFrame);
    } catch (error) {
      console.error("Could not initialize Example 18", error);
      ui.unsupported.classList.remove("hidden");
      ui.unsupported.querySelector("p").textContent = error.message || String(error);
    }
  }

  window.addEventListener("beforeunload", () => {
    [state.layers.a, state.layers.b].forEach((layer) => {
      stopLayerElement(layer);
      revokeLayerUrl(layer);
    });
  });

  start();
})();
