(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const canvas = $("gl-canvas");
  const overlayCanvas = $("overlay-canvas");
  const overlayCtx = overlayCanvas.getContext("2d");
  const cameraVideo = $("camera-video");
  const unsupported = $("unsupported");

  const ui = {
    sourceSummary: $("source-summary"), cameraSelect: $("camera-select"), refreshCameras: $("refresh-cameras"), cameraState: $("camera-state"),
    busState: $("bus-state"), programBus: $("program-bus"), previewBus: $("preview-bus"), cutButton: $("cut-button"), autoButton: $("auto-button"),
    transitionType: $("transition-type"), transitionDuration: $("transition-duration"), transitionDurationOutput: $("transition-duration-output"),
    transitionSoftness: $("transition-softness"), transitionSoftnessOutput: $("transition-softness-output"), transitionState: $("transition-state"),
    tbar: $("tbar"), tbarOutput: $("tbar-output"), easeTransition: $("ease-transition"),
    overlayEnabled: $("overlay-enabled"), titleText: $("title-text"), subtitleText: $("subtitle-text"), overlayColor: $("overlay-color"),
    overlayTextColor: $("overlay-text-color"), overlayOpacity: $("overlay-opacity"), overlayOpacityOutput: $("overlay-opacity-output"),
    overlayPosition: $("overlay-position"), overlayPositionOutput: $("overlay-position-output"), overlayState: $("overlay-state"),
    logoFile: $("logo-file"), clearLogo: $("clear-logo"), viewMode: $("view-mode"), masterFade: $("master-fade"), masterFadeOutput: $("master-fade-output"),
    recordButton: $("record-button"), pauseButton: $("pause-button"), stopRecording: $("stop-recording"), saveRecording: $("save-recording"), saveSnapshot: $("save-snapshot"),
    recordFps: $("record-fps"), recordState: $("record-state"), codecLabel: $("codec-label"), recordTime: $("record-time"), recordSize: $("record-size"), lastFile: $("last-file"),
    fpsLabel: $("fps-label"), hudProgram: $("hud-program"), hudPreview: $("hud-preview"), hudView: $("hud-view"), previewChip: $("preview-chip"), transitionChip: $("transition-chip"), recordingBorder: $("recording-border")
  };

  const sourceUi = Array.from({ length: 4 }, (_, index) => ({
    name: $(`source-${index}-name`), state: $(`source-${index}-state`), size: $(`source-${index}-size`), time: $(`source-${index}-time`),
    file: $(`source-${index}-file`), play: $(`source-${index}-play`), speed: $(`source-${index}-speed`), speedOutput: $(`source-${index}-speed-output`),
    pattern: document.querySelector(`[data-pattern="${index}"]`), camera: document.querySelector(`[data-camera="${index}"]`)
  }));

  const patternNames = ["Signal Field", "Prism Grid", "Orbit Rings", "Color Bars"];
  const viewNames = ["PROGRAM", "PREVIEW", "MULTIVIEW"];
  const transitionNames = ["Dissolve", "Horizontal wipe", "Vertical wipe", "Radial reveal", "Box reveal", "Noise dissolve", "Luma melt"];

  const state = {
    gl: null, programObject: null, positionBuffer: null, locations: {}, sourceTextures: [], overlayTexture: null,
    sources: [], program: 0, preview: 1, progress: 0, transitioning: false, transitionStart: 0, transitionStartProgress: 0,
    cameraStream: null, cameraSlot: -1, cameraDeviceId: "", logoImage: null, logoUrl: "", overlayDirty: true,
    chosenMime: "", recorder: null, recorderStream: null, chunks: [], recordedBytes: 0, lastBlob: null, lastMime: "",
    recordStartedAt: 0, pausedDuration: 0, pauseStartedAt: 0, recordingTimer: 0,
    lastFrameTime: performance.now(), fpsFrames: 0, fpsTime: performance.now(), lastPatternTime: 0
  };

  const vertexShaderSource = `
    attribute vec2 a_position;
    varying vec2 v_uv;
    void main() {
      v_uv = a_position * 0.5 + 0.5;
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  const fragmentShaderSource = `
    precision highp float;
    varying vec2 v_uv;
    uniform sampler2D u_source0;
    uniform sampler2D u_source1;
    uniform sampler2D u_source2;
    uniform sampler2D u_source3;
    uniform sampler2D u_overlay;
    uniform vec2 u_sourceSize0;
    uniform vec2 u_sourceSize1;
    uniform vec2 u_sourceSize2;
    uniform vec2 u_sourceSize3;
    uniform vec2 u_resolution;
    uniform float u_time;
    uniform int u_program;
    uniform int u_preview;
    uniform int u_transitionType;
    uniform float u_progress;
    uniform float u_softness;
    uniform int u_viewMode;
    uniform float u_masterFade;

    float hash21(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    vec2 coverUv(vec2 uv, vec2 sourceSize, vec2 destinationSize) {
      float sourceAspect = max(sourceSize.x, 1.0) / max(sourceSize.y, 1.0);
      float destinationAspect = max(destinationSize.x, 1.0) / max(destinationSize.y, 1.0);
      vec2 centered = uv - 0.5;
      if (sourceAspect > destinationAspect) {
        centered.x *= destinationAspect / sourceAspect;
      } else {
        centered.y *= sourceAspect / destinationAspect;
      }
      return centered + 0.5;
    }

    vec4 sampleSource(int index, vec2 uv, vec2 destinationSize) {
      if (index == 0) return texture2D(u_source0, coverUv(uv, u_sourceSize0, destinationSize));
      if (index == 1) return texture2D(u_source1, coverUv(uv, u_sourceSize1, destinationSize));
      if (index == 2) return texture2D(u_source2, coverUv(uv, u_sourceSize2, destinationSize));
      return texture2D(u_source3, coverUv(uv, u_sourceSize3, destinationSize));
    }

    float transitionMask(vec2 uv, vec4 previewColor) {
      float p = clamp(u_progress, 0.0, 1.0);
      float s = max(u_softness, 0.001);
      if (u_transitionType == 0) return p;
      if (u_transitionType == 1) return 1.0 - smoothstep(p - s, p + s, uv.x);
      if (u_transitionType == 2) return 1.0 - smoothstep(p - s, p + s, uv.y);
      if (u_transitionType == 3) {
        float radius = distance(uv, vec2(0.5));
        return 1.0 - smoothstep(p * 0.72 - s, p * 0.72 + s, radius);
      }
      if (u_transitionType == 4) {
        float boxDistance = max(abs(uv.x - 0.5), abs(uv.y - 0.5));
        return 1.0 - smoothstep(p * 0.5 - s, p * 0.5 + s, boxDistance);
      }
      if (u_transitionType == 5) {
        float noise = hash21(floor(uv * 120.0) + floor(u_time * 6.0));
        return smoothstep(noise - s, noise + s, p);
      }
      float luma = dot(previewColor.rgb, vec3(0.2126, 0.7152, 0.0722));
      float melt = luma * 0.7 + (1.0 - uv.y) * 0.3;
      return smoothstep(melt - s, melt + s, p);
    }

    vec3 applyOverlay(vec2 uv, vec3 color) {
      vec4 overlay = texture2D(u_overlay, uv);
      return mix(color, overlay.rgb, overlay.a);
    }

    vec3 multiview(vec2 uv) {
      vec2 localUv = fract(uv * 2.0);
      int index = 0;
      if (uv.x >= 0.5 && uv.y >= 0.5) index = 1;
      if (uv.x < 0.5 && uv.y < 0.5) index = 2;
      if (uv.x >= 0.5 && uv.y < 0.5) index = 3;
      vec3 color = sampleSource(index, localUv, u_resolution * 0.5).rgb;
      float border = step(localUv.x, 0.012) + step(localUv.y, 0.012) + step(0.988, localUv.x) + step(0.988, localUv.y);
      vec3 borderColor = vec3(0.18);
      if (index == u_program) borderColor = vec3(1.0, 0.08, 0.25);
      else if (index == u_preview) borderColor = vec3(0.18, 1.0, 0.35);
      color = mix(color, borderColor, clamp(border, 0.0, 1.0));
      return color;
    }

    void main() {
      vec3 color;
      if (u_viewMode == 2) {
        color = multiview(v_uv);
      } else if (u_viewMode == 1) {
        color = sampleSource(u_preview, v_uv, u_resolution).rgb;
      } else {
        vec4 programColor = sampleSource(u_program, v_uv, u_resolution);
        vec4 previewColor = sampleSource(u_preview, v_uv, u_resolution);
        float mask = transitionMask(v_uv, previewColor);
        color = mix(programColor.rgb, previewColor.rgb, mask);
        color = applyOverlay(v_uv, color);
      }
      color *= 1.0 - clamp(u_masterFade, 0.0, 1.0);
      gl_FragColor = vec4(color, 1.0);
    }
  `;

  function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) || "Shader compilation failed";
      gl.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  }

  function createProgram(gl, vertexSource, fragmentSource) {
    const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program) || "Program linking failed";
      gl.deleteProgram(program);
      throw new Error(message);
    }
    return program;
  }

  function createTexture(gl) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([16, 20, 24, 255]));
    return texture;
  }

  function initializeWebGL() {
    const gl = canvas.getContext("webgl", { alpha: false, antialias: true, preserveDrawingBuffer: true });
    if (!gl) throw new Error("WebGL 1 is not available in this WebView.");
    state.gl = gl;
    state.programObject = createProgram(gl, vertexShaderSource, fragmentShaderSource);
    state.positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, state.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
    state.sourceTextures = Array.from({ length: 4 }, () => createTexture(gl));
    state.overlayTexture = createTexture(gl);
    const uniformNames = [
      "u_source0","u_source1","u_source2","u_source3","u_overlay","u_sourceSize0","u_sourceSize1","u_sourceSize2","u_sourceSize3",
      "u_resolution","u_time","u_program","u_preview","u_transitionType","u_progress","u_softness","u_viewMode","u_masterFade"
    ];
    state.locations.aPosition = gl.getAttribLocation(state.programObject, "a_position");
    uniformNames.forEach((name) => { state.locations[name] = gl.getUniformLocation(state.programObject, name); });
    gl.useProgram(state.programObject);
    gl.uniform1i(state.locations.u_source0, 0);
    gl.uniform1i(state.locations.u_source1, 1);
    gl.uniform1i(state.locations.u_source2, 2);
    gl.uniform1i(state.locations.u_source3, 3);
    gl.uniform1i(state.locations.u_overlay, 4);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  }

  function initializeSources() {
    state.sources = Array.from({ length: 4 }, (_, index) => {
      const patternCanvas = $(`pattern-canvas-${index}`);
      patternCanvas.width = 640;
      patternCanvas.height = 360;
      return { kind: "pattern", element: patternCanvas, name: patternNames[index], width: 640, height: 360, url: "", playing: true, patternIndex: index, speed: 1 };
    });
    refreshAllSourceUi();
  }

  function sourceDimensions(source) {
    if (source.kind === "video" || source.kind === "camera") return [source.element.videoWidth || source.width || 1, source.element.videoHeight || source.height || 1];
    if (source.kind === "image") return [source.element.naturalWidth || source.width || 1, source.element.naturalHeight || source.height || 1];
    return [source.element.width || source.width || 1, source.element.height || source.height || 1];
  }

  function sourceReady(source) {
    if (source.kind === "video" || source.kind === "camera") return source.element.readyState >= 2 && source.element.videoWidth > 0;
    if (source.kind === "image") return source.element.complete && source.element.naturalWidth > 0;
    return true;
  }

  function revokeSourceUrl(index) {
    const source = state.sources[index];
    if (source?.url) URL.revokeObjectURL(source.url);
    if (source) source.url = "";
  }

  function resetSourceToPattern(index) {
    if (state.cameraSlot === index) stopCamera();
    revokeSourceUrl(index);
    const patternCanvas = $(`pattern-canvas-${index}`);
    const speed = Number(sourceUi[index].speed.value) || state.sources[index]?.speed || 1;
    state.sources[index] = { kind: "pattern", element: patternCanvas, name: patternNames[index], width: patternCanvas.width, height: patternCanvas.height, url: "", playing: true, patternIndex: index, speed };
    refreshSourceUi(index);
  }

  async function loadSourceFile(index, file) {
    if (!file) return;
    if (state.cameraSlot === index) stopCamera();
    revokeSourceUrl(index);
    const url = URL.createObjectURL(file);
    if (file.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|ogv)$/i.test(file.name)) {
      const video = document.createElement("video");
      video.src = url;
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      await new Promise((resolve, reject) => {
        video.addEventListener("loadeddata", resolve, { once: true });
        video.addEventListener("error", () => reject(new Error(`Could not decode ${file.name}`)), { once: true });
      });
      const speed = Number(sourceUi[index].speed.value) || state.sources[index]?.speed || 1;
      video.defaultPlaybackRate = speed;
      video.playbackRate = speed;
      await video.play().catch(() => {});
      state.sources[index] = { kind: "video", element: video, name: file.name, width: video.videoWidth, height: video.videoHeight, url, playing: !video.paused, patternIndex: index, speed };
    } else if (file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name)) {
      const image = new Image();
      image.src = url;
      await image.decode();
      state.sources[index] = { kind: "image", element: image, name: file.name, width: image.naturalWidth, height: image.naturalHeight, url, playing: false, patternIndex: index, speed: state.sources[index]?.speed || 1 };
    } else {
      URL.revokeObjectURL(url);
      throw new Error("Choose an image or video file.");
    }
    refreshSourceUi(index);
  }

  function toggleSourcePlayback(index) {
    const source = state.sources[index];
    if (source.kind !== "video") return;
    if (source.element.paused) source.element.play().catch(() => {});
    else source.element.pause();
    source.playing = !source.element.paused;
    refreshSourceUi(index);
  }

  function changeSourceSpeed(index) {
    const source = state.sources[index];
    const speed = Number(sourceUi[index].speed.value);
    source.speed = speed;
    sourceUi[index].speedOutput.textContent = `${speed.toFixed(2)}×`;
    if (source.kind === "video") {
      source.element.defaultPlaybackRate = speed;
      source.element.playbackRate = speed;
    }
  }

  async function refreshCameras() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices.filter((device) => device.kind === "videoinput");
      const current = ui.cameraSelect.value;
      ui.cameraSelect.replaceChildren();
      const defaultOption = new Option("Default camera", "");
      ui.cameraSelect.append(defaultOption);
      cameras.forEach((device, index) => ui.cameraSelect.append(new Option(device.label || `Camera ${index + 1}`, device.deviceId)));
      if ([...ui.cameraSelect.options].some((option) => option.value === current)) ui.cameraSelect.value = current;
      ui.cameraState.textContent = state.cameraStream ? `Live on source ${state.cameraSlot + 1}` : `${cameras.length || "No"} device${cameras.length === 1 ? "" : "s"}`;
    } catch (error) {
      console.warn("Could not enumerate cameras", error);
      ui.cameraState.textContent = "Permission needed";
    }
  }

  function stopCamera() {
    if (state.cameraStream) state.cameraStream.getTracks().forEach((track) => track.stop());
    state.cameraStream = null;
    cameraVideo.srcObject = null;
    const oldSlot = state.cameraSlot;
    state.cameraSlot = -1;
    if (oldSlot >= 0 && state.sources[oldSlot]?.kind === "camera") {
      const patternCanvas = $(`pattern-canvas-${oldSlot}`);
      state.sources[oldSlot] = { kind: "pattern", element: patternCanvas, name: patternNames[oldSlot], width: patternCanvas.width, height: patternCanvas.height, url: "", playing: true, patternIndex: oldSlot, speed: state.sources[oldSlot]?.speed || 1 };
      refreshSourceUi(oldSlot);
    }
    ui.cameraState.textContent = "Stopped";
  }

  async function assignCamera(index) {
    if (!navigator.mediaDevices?.getUserMedia) {
      window.alert("Camera capture is unavailable in this WebView.");
      return;
    }
    if (state.cameraSlot >= 0 && state.cameraSlot !== index && state.sources[state.cameraSlot]?.kind === "camera") {
      const previous = state.cameraSlot;
      const patternCanvas = $(`pattern-canvas-${previous}`);
      state.sources[previous] = { kind: "pattern", element: patternCanvas, name: patternNames[previous], width: patternCanvas.width, height: patternCanvas.height, url: "", playing: true, patternIndex: previous, speed: state.sources[previous]?.speed || 1 };
      refreshSourceUi(previous);
    }
    if (state.cameraStream) state.cameraStream.getTracks().forEach((track) => track.stop());
    revokeSourceUrl(index);
    const selectedDevice = ui.cameraSelect.value;
    const constraints = {
      audio: false,
      video: {
        deviceId: selectedDevice ? { exact: selectedDevice } : undefined,
        width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 60 }
      }
    };
    ui.cameraState.textContent = "Requesting…";
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      state.cameraStream = stream;
      state.cameraSlot = index;
      cameraVideo.srcObject = stream;
      await cameraVideo.play();
      state.sources[index] = { kind: "camera", element: cameraVideo, name: "Live Camera", width: cameraVideo.videoWidth || 1280, height: cameraVideo.videoHeight || 720, url: "", playing: true, patternIndex: index, speed: state.sources[index]?.speed || 1 };
      ui.cameraState.textContent = `Live on source ${index + 1}`;
      refreshSourceUi(index);
      await refreshCameras();
    } catch (error) {
      console.error(error);
      ui.cameraState.textContent = "Camera failed";
      window.alert(`Could not start camera:\n${error.message || error}`);
    }
  }

  function refreshSourceUi(index) {
    const source = state.sources[index];
    const panel = sourceUi[index];
    const [width, height] = sourceDimensions(source);
    panel.name.textContent = source.name;
    panel.state.textContent = source.kind === "pattern" ? "Pattern" : source.kind === "image" ? "Image" : source.kind === "camera" ? "Camera" : "Video";
    panel.size.textContent = `${width || "—"} × ${height || "—"}`;
    if (source.kind === "video") panel.time.textContent = `${formatMediaTime(source.element.currentTime)} / ${formatMediaTime(source.element.duration)}`;
    else panel.time.textContent = source.kind === "camera" ? "Live" : source.kind === "image" ? "Still frame" : "Generated";
    const isVideo = source.kind === "video";
    const hasSpeed = source.kind === "video" || source.kind === "pattern";
    panel.play.disabled = !isVideo;
    panel.speed.disabled = !hasSpeed;
    panel.play.textContent = isVideo && !source.element.paused ? "Pause" : "Play";
    if (hasSpeed) panel.speed.value = String(source.speed || source.element?.playbackRate || 1);
    panel.speedOutput.textContent = hasSpeed ? `${Number(panel.speed.value).toFixed(2)}×` : "N/A";
    updateBusUi();
    updateSourceSummary();
  }

  function refreshAllSourceUi() { state.sources.forEach((_, index) => refreshSourceUi(index)); }

  function updateSourceSummary() {
    const counts = state.sources.reduce((acc, source) => { acc[source.kind] = (acc[source.kind] || 0) + 1; return acc; }, {});
    ui.sourceSummary.textContent = Object.entries(counts).map(([kind, count]) => `${count} ${kind}`).join(" · ");
  }

  function formatMediaTime(seconds) {
    if (!Number.isFinite(seconds)) return "00:00";
    const minutes = Math.floor(seconds / 60);
    const remaining = Math.floor(seconds % 60);
    return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
  }

  function drawPatterns(time) {
    if (time - state.lastPatternTime < 33) return;
    state.lastPatternTime = time;
    const baseTime = time * 0.001;
    state.sources.forEach((source, index) => {
      if (source.kind !== "pattern") return;
      const sourceTime = baseTime * (source.speed || 1);
      const c = source.element;
      const ctx = c.getContext("2d");
      const w = c.width, h = c.height;
      ctx.clearRect(0, 0, w, h);
      if (index === 0) {
        const gradient = ctx.createLinearGradient(0, 0, w, h);
        gradient.addColorStop(0, `hsl(${(sourceTime * 28) % 360} 84% 45%)`);
        gradient.addColorStop(.5, "#111c39");
        gradient.addColorStop(1, `hsl(${(210 + sourceTime * 19) % 360} 90% 58%)`);
        ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = "rgba(255,255,255,.28)"; ctx.lineWidth = 2;
        for (let y = 0; y < h; y += 24) {
          ctx.beginPath();
          for (let x = 0; x <= w; x += 8) {
            const yy = y + Math.sin(x * .018 + sourceTime * 2.2 + y * .012) * 13;
            x ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy);
          }
          ctx.stroke();
        }
      } else if (index === 1) {
        ctx.fillStyle = "#071017"; ctx.fillRect(0, 0, w, h);
        const hue = (sourceTime * 42) % 360;
        ctx.strokeStyle = `hsla(${hue} 100% 70% / .58)`; ctx.lineWidth = 2;
        const offset = (sourceTime * 45) % 40;
        for (let x = -40 + offset; x < w + 40; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(w / 2 + (x - w / 2) * .18, h); ctx.stroke(); }
        for (let y = 0; y < h; y += 30) { const perspective = y / h; ctx.globalAlpha = .25 + perspective * .7; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
        ctx.globalAlpha = 1;
      } else if (index === 2) {
        const gradient = ctx.createRadialGradient(w * .5, h * .5, 0, w * .5, h * .5, w * .65);
        gradient.addColorStop(0, "#ff8cda"); gradient.addColorStop(.45, "#482184"); gradient.addColorStop(1, "#070710");
        ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, h);
        ctx.translate(w / 2, h / 2);
        for (let i = 0; i < 14; i++) {
          const radius = 18 + i * 18 + Math.sin(sourceTime * 2 + i) * 8;
          ctx.strokeStyle = `hsla(${(285 + i * 12 + sourceTime * 20) % 360} 100% 76% / ${.65 - i * .025})`;
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(Math.sin(sourceTime + i) * 25, Math.cos(sourceTime * .7 + i) * 18, radius, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.setTransform(1,0,0,1,0,0);
      } else {
        const colors = ["#e84b63", "#f5c84c", "#59d676", "#46bce8", "#7757d8", "#e052c4", "#f2f2f2"];
        const barWidth = w / colors.length;
        colors.forEach((color, i) => { ctx.fillStyle = color; ctx.fillRect(i * barWidth, 0, barWidth + 1, h); });
        ctx.fillStyle = "rgba(0,0,0,.75)"; ctx.fillRect(0, h * .72, w, h * .28);
        ctx.fillStyle = "white"; ctx.font = "700 34px monospace"; ctx.fillText("JUNKPILE 20", 28, h * .84);
        const scan = (sourceTime * 90) % h; ctx.fillStyle = "rgba(255,255,255,.38)"; ctx.fillRect(0, scan, w, 3);
      }
    });
  }

  function hexToRgba(hex, alpha = 1) {
    const value = hex.replace("#", "");
    const number = Number.parseInt(value.length === 3 ? value.split("").map((c) => c + c).join("") : value, 16);
    return `rgba(${(number >> 16) & 255}, ${(number >> 8) & 255}, ${number & 255}, ${alpha})`;
  }

  function redrawOverlay() {
    const width = overlayCanvas.width;
    const height = overlayCanvas.height;
    overlayCtx.clearRect(0, 0, width, height);
    if (ui.overlayEnabled.checked) {
      const opacity = Number(ui.overlayOpacity.value);
      const y = Math.round(Number(ui.overlayPosition.value) * height);
      const barHeight = 100;
      overlayCtx.fillStyle = `rgba(5, 8, 12, ${0.82 * opacity})`;
      overlayCtx.fillRect(42, y - barHeight, Math.min(width * .62, 760), barHeight);
      overlayCtx.fillStyle = hexToRgba(ui.overlayColor.value, opacity);
      overlayCtx.fillRect(42, y - barHeight, 12, barHeight);
      overlayCtx.fillRect(42, y - barHeight, Math.min(width * .62, 760), 5);
      overlayCtx.fillStyle = hexToRgba(ui.overlayTextColor.value, opacity);
      overlayCtx.font = "800 34px Inter, Arial, sans-serif";
      overlayCtx.fillText(ui.titleText.value || "UNTITLED", 76, y - 52);
      overlayCtx.globalAlpha = .72 * opacity;
      overlayCtx.font = "600 18px Inter, Arial, sans-serif";
      overlayCtx.fillText(ui.subtitleText.value || "", 76, y - 23);
      overlayCtx.globalAlpha = 1;
    }
    if (state.logoImage) {
      const maxW = 190, maxH = 90;
      const ratio = Math.min(maxW / state.logoImage.naturalWidth, maxH / state.logoImage.naturalHeight, 1);
      const w = state.logoImage.naturalWidth * ratio;
      const h = state.logoImage.naturalHeight * ratio;
      overlayCtx.drawImage(state.logoImage, width - w - 36, 30, w, h);
    }
    state.overlayDirty = false;
    ui.overlayState.textContent = ui.overlayEnabled.checked || state.logoImage ? "On" : "Off";
  }

  async function loadLogo(file) {
    if (!file) return;
    if (state.logoUrl) URL.revokeObjectURL(state.logoUrl);
    state.logoUrl = URL.createObjectURL(file);
    const image = new Image();
    image.src = state.logoUrl;
    await image.decode();
    state.logoImage = image;
    state.overlayDirty = true;
  }

  function clearLogo() {
    if (state.logoUrl) URL.revokeObjectURL(state.logoUrl);
    state.logoUrl = "";
    state.logoImage = null;
    state.overlayDirty = true;
  }

  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(2, Math.round(canvas.clientWidth * dpr));
    const height = Math.max(2, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function uploadTexture(unit, texture, element) {
    const gl = state.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, element); }
    catch (error) { console.warn("Texture upload failed", error); }
  }

  function ease(value) { return value * value * (3 - 2 * value); }

  function updateTransition(time) {
    if (!state.transitioning) return;
    const duration = Math.max(.1, Number(ui.transitionDuration.value)) * 1000;
    const raw = Math.min(1, state.transitionStartProgress + (time - state.transitionStart) / duration);
    state.progress = ui.easeTransition.checked ? ease(raw) : raw;
    ui.tbar.value = String(state.progress);
    ui.tbarOutput.textContent = state.progress.toFixed(3);
    ui.transitionState.textContent = `${transitionNames[Number(ui.transitionType.value)]} ${Math.round(state.progress * 100)}%`;
    ui.transitionChip.textContent = `AUTO ${Math.round(state.progress * 100)}%`;
    ui.transitionChip.classList.remove("hidden");
    if (raw >= 1) commitTransition();
  }

  function beginAutoTransition() {
    if (state.transitioning || state.program === state.preview) return;
    state.transitioning = true;
    state.transitionStart = performance.now();
    state.transitionStartProgress = state.progress;
    ui.autoButton.classList.add("transitioning");
    ui.transitionState.textContent = "Transitioning";
    ui.transitionChip.classList.remove("hidden");
  }

  function commitTransition() {
    const oldProgram = state.program;
    state.program = state.preview;
    state.preview = oldProgram;
    state.progress = 0;
    state.transitioning = false;
    ui.tbar.value = "0";
    ui.tbarOutput.textContent = "0.000";
    ui.transitionState.textContent = "Ready";
    ui.autoButton.classList.remove("transitioning");
    ui.transitionChip.classList.add("hidden");
    updateBusUi();
  }

  function cutToPreview() {
    if (state.program === state.preview) return;
    commitTransition();
  }

  function setProgram(index) {
    if (index === state.program) return;
    const old = state.program;
    state.program = index;
    if (state.preview === index) state.preview = old;
    state.progress = 0;
    state.transitioning = false;
    ui.tbar.value = "0";
    ui.tbarOutput.textContent = "0.000";
    updateBusUi();
  }

  function setPreview(index) {
    if (index === state.preview) return;
    state.preview = index;
    updateBusUi();
  }

  function updateBusUi() {
    document.querySelectorAll("[data-program]").forEach((button) => button.classList.toggle("active", Number(button.dataset.program) === state.program));
    document.querySelectorAll("[data-preview]").forEach((button) => button.classList.toggle("active", Number(button.dataset.preview) === state.preview));
    const programSource = state.sources[state.program];
    const previewSource = state.sources[state.preview];
    if (!programSource || !previewSource) return;
    ui.busState.textContent = `Program ${state.program + 1} · Preview ${state.preview + 1}`;
    ui.hudProgram.textContent = `PGM ${state.program + 1} · ${programSource.name}`;
    ui.hudPreview.textContent = `PVW ${state.preview + 1} · ${previewSource.name}`;
    ui.previewChip.textContent = `PREVIEW · ${state.preview + 1}`;
  }

  function render(time) {
    requestAnimationFrame(render);
    const gl = state.gl;
    if (!gl) return;
    drawPatterns(time);
    updateTransition(time);
    resizeCanvas();
    if (state.overlayDirty) redrawOverlay();

    state.sources.forEach((source, index) => {
      if (source.kind === "video" && Math.abs(source.element.playbackRate - (source.speed || 1)) > 0.001) {
        source.element.defaultPlaybackRate = source.speed || 1;
        source.element.playbackRate = source.speed || 1;
      }
      if (sourceReady(source)) uploadTexture(index, state.sourceTextures[index], source.element);
      if (source.kind === "video") refreshSourceUiTime(index);
    });
    uploadTexture(4, state.overlayTexture, overlayCanvas);

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(state.programObject);
    gl.bindBuffer(gl.ARRAY_BUFFER, state.positionBuffer);
    gl.enableVertexAttribArray(state.locations.aPosition);
    gl.vertexAttribPointer(state.locations.aPosition, 2, gl.FLOAT, false, 0, 0);

    const sizes = state.sources.map(sourceDimensions);
    gl.uniform2f(state.locations.u_sourceSize0, sizes[0][0], sizes[0][1]);
    gl.uniform2f(state.locations.u_sourceSize1, sizes[1][0], sizes[1][1]);
    gl.uniform2f(state.locations.u_sourceSize2, sizes[2][0], sizes[2][1]);
    gl.uniform2f(state.locations.u_sourceSize3, sizes[3][0], sizes[3][1]);
    gl.uniform2f(state.locations.u_resolution, canvas.width, canvas.height);
    gl.uniform1f(state.locations.u_time, time * .001);
    gl.uniform1i(state.locations.u_program, state.program);
    gl.uniform1i(state.locations.u_preview, state.preview);
    gl.uniform1i(state.locations.u_transitionType, Number(ui.transitionType.value));
    gl.uniform1f(state.locations.u_progress, state.progress);
    gl.uniform1f(state.locations.u_softness, Number(ui.transitionSoftness.value));
    gl.uniform1i(state.locations.u_viewMode, Number(ui.viewMode.value));
    gl.uniform1f(state.locations.u_masterFade, Number(ui.masterFade.value));
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    updateFps(time);
  }

  function refreshSourceUiTime(index) {
    const source = state.sources[index];
    sourceUi[index].time.textContent = `${formatMediaTime(source.element.currentTime)} / ${formatMediaTime(source.element.duration)}`;
    sourceUi[index].play.textContent = source.element.paused ? "Play" : "Pause";
  }

  function updateFps(time) {
    state.fpsFrames += 1;
    if (time - state.fpsTime >= 500) {
      const fps = state.fpsFrames * 1000 / (time - state.fpsTime);
      ui.fpsLabel.textContent = `${fps.toFixed(0)} fps`;
      state.fpsFrames = 0;
      state.fpsTime = time;
    }
  }

  function chooseMimeType() {
    if (typeof MediaRecorder === "undefined") return "";
    const candidates = [
      "video/mp4;codecs=h264,aac", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"
    ];
    return candidates.find((mime) => MediaRecorder.isTypeSupported(mime)) || "";
  }

  function extensionForMime(mime) { return mime.includes("mp4") ? "mp4" : "webm"; }
  function timestampName(prefix, extension) { return `${prefix}-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`; }
  function formatBytes(bytes) {
    if (!bytes) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / Math.pow(1024, index)).toFixed(index ? 1 : 0)} ${units[index]}`;
  }
  function formatDuration(milliseconds) {
    const total = Math.max(0, milliseconds);
    const minutes = Math.floor(total / 60000);
    const seconds = Math.floor((total % 60000) / 1000);
    const ms = Math.floor(total % 1000);
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
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
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = suggestedName;
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

  function stopRecording() { if (state.recorder && state.recorder.state !== "inactive") state.recorder.stop(); }

  async function saveRecording() {
    if (!state.lastBlob) return;
    try {
      ui.saveRecording.disabled = true; ui.saveRecording.textContent = "Saving…";
      const extension = extensionForMime(state.lastMime);
      const path = await saveBlob(state.lastBlob, timestampName("junkpile-20-program", extension), extension);
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
      const path = await saveBlob(blob, timestampName("junkpile-20-program", "png"), "png");
      if (path) { ui.lastFile.textContent = path; ui.recordState.textContent = "PNG saved"; }
    } catch (error) {
      console.error(error); window.alert(`Could not save PNG:\n${error.message || error}`);
    } finally {
      ui.saveSnapshot.disabled = false; ui.saveSnapshot.textContent = "Save PNG";
    }
  }

  function syncControls() {
    ui.transitionDurationOutput.textContent = `${Number(ui.transitionDuration.value).toFixed(2)}s`;
    ui.transitionSoftnessOutput.textContent = Number(ui.transitionSoftness.value).toFixed(3);
    ui.tbarOutput.textContent = Number(ui.tbar.value).toFixed(3);
    ui.overlayOpacityOutput.textContent = Number(ui.overlayOpacity.value).toFixed(2);
    ui.overlayPositionOutput.textContent = Number(ui.overlayPosition.value).toFixed(3);
    ui.masterFadeOutput.textContent = Number(ui.masterFade.value).toFixed(3);
    ui.hudView.textContent = viewNames[Number(ui.viewMode.value)] || "PROGRAM";
  }

  function bindControls() {
    sourceUi.forEach((panel, index) => {
      panel.file.addEventListener("change", () => loadSourceFile(index, panel.file.files?.[0]).catch((error) => window.alert(error.message || error)));
      panel.pattern.addEventListener("click", () => resetSourceToPattern(index));
      panel.camera.addEventListener("click", () => assignCamera(index));
      panel.play.addEventListener("click", () => toggleSourcePlayback(index));
      panel.speed.addEventListener("input", () => changeSourceSpeed(index));
    });
    document.querySelectorAll("[data-program]").forEach((button) => button.addEventListener("click", () => setProgram(Number(button.dataset.program))));
    document.querySelectorAll("[data-preview]").forEach((button) => button.addEventListener("click", () => setPreview(Number(button.dataset.preview))));
    ui.cutButton.addEventListener("click", cutToPreview);
    ui.autoButton.addEventListener("click", beginAutoTransition);
    ui.tbar.addEventListener("input", () => {
      state.transitioning = false;
      ui.autoButton.classList.remove("transitioning");
      state.progress = Number(ui.tbar.value);
      ui.tbarOutput.textContent = state.progress.toFixed(3);
      ui.transitionState.textContent = state.progress > 0 ? `Manual ${Math.round(state.progress * 100)}%` : "Ready";
      if (state.progress >= .999) commitTransition();
    });
    [ui.transitionDuration, ui.transitionSoftness, ui.overlayOpacity, ui.overlayPosition, ui.masterFade].forEach((input) => input.addEventListener("input", syncControls));
    ui.viewMode.addEventListener("change", syncControls);
    [ui.overlayEnabled, ui.titleText, ui.subtitleText, ui.overlayColor, ui.overlayTextColor, ui.overlayOpacity, ui.overlayPosition].forEach((input) => {
      input.addEventListener("input", () => { state.overlayDirty = true; syncControls(); });
      input.addEventListener("change", () => { state.overlayDirty = true; syncControls(); });
    });
    ui.logoFile.addEventListener("change", () => loadLogo(ui.logoFile.files?.[0]).catch((error) => window.alert(error.message || error)));
    ui.clearLogo.addEventListener("click", clearLogo);
    ui.refreshCameras.addEventListener("click", refreshCameras);
    ui.cameraSelect.addEventListener("change", () => { state.cameraDeviceId = ui.cameraSelect.value; if (state.cameraSlot >= 0) assignCamera(state.cameraSlot); });
    ui.recordButton.addEventListener("click", startRecording);
    ui.pauseButton.addEventListener("click", togglePause);
    ui.stopRecording.addEventListener("click", stopRecording);
    ui.saveRecording.addEventListener("click", saveRecording);
    ui.saveSnapshot.addEventListener("click", saveSnapshot);
    navigator.mediaDevices?.addEventListener?.("devicechange", refreshCameras);
    window.addEventListener("keydown", (event) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      if (event.code === "Space") { event.preventDefault(); beginAutoTransition(); }
      if (event.key.toLowerCase() === "c") cutToPreview();
      if (/^[1-4]$/.test(event.key)) setPreview(Number(event.key) - 1);
    });
    window.addEventListener("beforeunload", () => {
      stopCamera();
      state.sources.forEach((_, index) => revokeSourceUrl(index));
      clearLogo();
      if (state.recorder && state.recorder.state !== "inactive") state.recorder.stop();
    });
  }

  function initializeCapabilities() {
    state.chosenMime = chooseMimeType();
    ui.codecLabel.textContent = state.chosenMime || "No recording codec";
    if (!canvas.captureStream || !state.chosenMime) {
      ui.recordButton.disabled = true;
      ui.recordState.textContent = "Recording unsupported";
    }
  }

  function initialize() {
    try {
      initializeWebGL();
      initializeSources();
      bindControls();
      initializeCapabilities();
      syncControls();
      redrawOverlay();
      refreshCameras();
      updateBusUi();
      requestAnimationFrame(render);
    } catch (error) {
      console.error("Example 20 initialization failed", error);
      unsupported.classList.remove("hidden");
      unsupported.querySelector("p").textContent = error.message || String(error);
    }
  }

  initialize();
})();
