(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const canvas = $("gl-canvas");
  const stage = $("stage");
  const unsupported = $("unsupported");

  const ui = {
    recordState: $("record-state"),
    recordButton: $("record-button"),
    pauseButton: $("pause-button"),
    stopButton: $("stop-button"),
    recordTime: $("record-time"),
    recordSize: $("record-size"),
    countdownOverlay: $("countdown-overlay"),
    stageCountdown: $("stage-countdown"),
    resolution: $("resolution"),
    customSizeRow: $("custom-size-row"),
    customWidth: $("custom-width"),
    customHeight: $("custom-height"),
    applySize: $("apply-size"),
    frameRate: $("frame-rate"),
    videoBitrate: $("video-bitrate"),
    recordDuration: $("record-duration"),
    countdown: $("countdown"),
    codecLabel: $("codec-label"),
    canvasSizeLabel: $("canvas-size-label"),
    estimateLabel: $("estimate-label"),
    includeMic: $("include-mic"),
    deviceSelect: $("device-select"),
    refreshDevices: $("refresh-devices"),
    audioBitrate: $("audio-bitrate"),
    micState: $("mic-state"),
    visualMode: $("visual-mode"),
    speed: $("speed"),
    scale: $("scale"),
    detail: $("detail"),
    warp: $("warp"),
    pulse: $("pulse"),
    hue: $("hue"),
    saturation: $("saturation"),
    brightness: $("brightness"),
    contrast: $("contrast"),
    saveButton: $("save-button"),
    discardButton: $("discard-button"),
    snapshotButton: $("snapshot-button"),
    autoSave: $("auto-save"),
    lastFormat: $("last-format"),
    lastDuration: $("last-duration"),
    lastSize: $("last-size"),
    lastFile: $("last-file"),
    fpsLabel: $("fps-label"),
    renderSize: $("render-size"),
    hudMode: $("hud-mode"),
    hudRecording: $("hud-recording")
  };

  const visualControls = [
    ["speed", 2, (v) => Number(v).toFixed(2)],
    ["scale", 2, (v) => Number(v).toFixed(2)],
    ["detail", 0, (v) => String(Math.round(Number(v)))],
    ["warp", 2, (v) => Number(v).toFixed(2)],
    ["pulse", 2, (v) => Number(v).toFixed(2)],
    ["hue", 0, (v) => `${Math.round(Number(v))}°`],
    ["saturation", 2, (v) => Number(v).toFixed(2)],
    ["brightness", 2, (v) => Number(v).toFixed(2)],
    ["contrast", 2, (v) => Number(v).toFixed(2)]
  ];

  const modeNames = ["Liquid field", "Infinite tunnel", "Cellular lattice", "Signal bands"];

  const state = {
    gl: null,
    program: null,
    uniforms: {},
    startedAt: performance.now(),
    previousFrameAt: performance.now(),
    fpsAverage: 0,
    recorder: null,
    recorderStream: null,
    microphoneStream: null,
    chunks: [],
    recordedBytes: 0,
    recordStartedAt: 0,
    pauseStartedAt: 0,
    totalPausedMs: 0,
    timerId: 0,
    autoStopId: 0,
    countdownId: 0,
    countdownActive: false,
    lastBlob: null,
    lastMime: "",
    lastDurationMs: 0,
    lastSavedPath: "",
    chosenMime: "",
    outputWidth: 1920,
    outputHeight: 1080,
    recording: false,
    paused: false
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
    uniform vec2 u_resolution;
    uniform float u_time;
    uniform float u_mode;
    uniform float u_speed;
    uniform float u_scale;
    uniform float u_detail;
    uniform float u_warp;
    uniform float u_pulse;
    uniform float u_hue;
    uniform float u_saturation;
    uniform float u_brightness;
    uniform float u_contrast;

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

    vec3 grade(vec3 color) {
      color = (color - 0.5) * u_contrast + 0.5;
      color *= u_brightness;
      float luma = dot(color, vec3(0.299, 0.587, 0.114));
      color = mix(vec3(luma), color, u_saturation);
      return max(color, 0.0);
    }

    vec3 liquidField(vec2 p, float t) {
      vec2 q = vec2(fbm(p * 1.25 + vec2(t * 0.17, -t * 0.12)), fbm(p * 1.25 + vec2(5.2, -3.7) - t * 0.11));
      vec2 r = vec2(fbm(p * 1.55 + u_warp * q + vec2(1.7, 9.2) + t * 0.07), fbm(p * 1.55 + u_warp * q + vec2(8.3, 2.8) - t * 0.09));
      float f = fbm(p * 1.8 + u_warp * 1.65 * r);
      float pulse = sin((length(p) * 9.0 - t * 2.0) + f * 4.0) * 0.5 + 0.5;
      float hue = u_hue / 360.0 + 0.56 + f * 0.28 + q.x * 0.12;
      float value = 0.18 + f * 0.95 + pulse * u_pulse * 0.18;
      return hsv2rgb(vec3(hue, 0.72, value));
    }

    vec3 infiniteTunnel(vec2 p, float t) {
      float radius = max(length(p), 0.002);
      float angle = atan(p.y, p.x);
      float depth = 0.75 / radius + t * 0.75;
      float bands = sin(depth * 7.0 + sin(angle * 5.0 + t) * u_warp * 3.0);
      float spokes = sin(angle * 10.0 + depth * 0.8 - t * 1.3);
      float grain = fbm(vec2(angle * 1.8, depth * 0.15));
      float shape = smoothstep(-0.2, 0.85, bands * 0.62 + spokes * 0.24 + grain * 0.65);
      float hue = u_hue / 360.0 + angle / (2.0 * PI) + depth * 0.025;
      float flash = pow(max(0.0, sin(depth * 2.5 - t * 3.0)), 6.0) * u_pulse;
      return hsv2rgb(vec3(hue, 0.8, shape * 0.92 + flash * 0.4));
    }

    vec3 cellularLattice(vec2 p, float t) {
      vec2 grid = p * (4.0 + u_scale * 1.8);
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
      float edge = smoothstep(0.38, 0.05, nearest);
      float ring = smoothstep(0.06, 0.0, abs(nearest - 0.24 - 0.05 * sin(t + id * 8.0)));
      float hue = u_hue / 360.0 + id * 0.5 + t * 0.015;
      return hsv2rgb(vec3(hue, 0.7, edge * 0.42 + ring * (0.5 + u_pulse * 0.22)));
    }

    vec3 signalBands(vec2 p, float t) {
      float n = fbm(vec2(p.x * 2.5 + t * 0.08, p.y * 1.1));
      float y = p.y + (n - 0.5) * u_warp;
      float bandA = sin(y * 16.0 + p.x * 4.0 - t * 2.0);
      float bandB = sin(y * 29.0 - p.x * 2.5 + t * 1.1);
      float bandC = sin(y * 53.0 + t * 0.55 + n * 5.0);
      float signal = smoothstep(0.18, 1.0, abs(bandA * 0.55 + bandB * 0.3 + bandC * 0.15));
      float scan = pow(max(0.0, sin((p.x + n) * 5.0 - t * 2.6)), 8.0) * u_pulse;
      float hue = u_hue / 360.0 + 0.82 + p.y * 0.18 + n * 0.25;
      return hsv2rgb(vec3(hue, 0.68, signal * 0.86 + scan * 0.36));
    }

    void main() {
      vec2 p = v_uv * 2.0 - 1.0;
      p.x *= u_resolution.x / max(u_resolution.y, 1.0);
      p *= u_scale;
      float t = u_time * u_speed;
      vec3 color;
      if (u_mode < 0.5) {
        color = liquidField(p, t);
      } else if (u_mode < 1.5) {
        color = infiniteTunnel(p, t);
      } else if (u_mode < 2.5) {
        color = cellularLattice(p, t);
      } else {
        color = signalBands(p, t);
      }
      float vignette = smoothstep(1.7, 0.2, length(p / max(u_scale, 0.001)));
      color *= 0.68 + vignette * 0.48;
      gl_FragColor = vec4(grade(color), 1.0);
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
    if (value === null) {
      throw new Error(`Shader uniform not found: ${name}`);
    }
    return value;
  }

  function initializeWebGL() {
    const gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance"
    });
    if (!gl) {
      throw new Error("WebGL 1 is unavailable in this WebView");
    }
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
      resolution: getUniformLocation("u_resolution"),
      time: getUniformLocation("u_time"),
      mode: getUniformLocation("u_mode"),
      speed: getUniformLocation("u_speed"),
      scale: getUniformLocation("u_scale"),
      detail: getUniformLocation("u_detail"),
      warp: getUniformLocation("u_warp"),
      pulse: getUniformLocation("u_pulse"),
      hue: getUniformLocation("u_hue"),
      saturation: getUniformLocation("u_saturation"),
      brightness: getUniformLocation("u_brightness"),
      contrast: getUniformLocation("u_contrast")
    };
    resizeCanvas(1920, 1080);
  }

  function resizeCanvas(width, height) {
    const safeWidth = Math.max(320, Math.min(4096, Math.round(width / 2) * 2));
    const safeHeight = Math.max(240, Math.min(4096, Math.round(height / 2) * 2));
    state.outputWidth = safeWidth;
    state.outputHeight = safeHeight;
    canvas.width = safeWidth;
    canvas.height = safeHeight;
    ui.canvasSizeLabel.textContent = `${safeWidth} × ${safeHeight}`;
    ui.renderSize.textContent = `${safeWidth} × ${safeHeight}`;
    if (state.gl) {
      state.gl.viewport(0, 0, safeWidth, safeHeight);
    }
  }

  function render(now) {
    const gl = state.gl;
    const elapsed = (now - state.startedAt) / 1000;
    gl.useProgram(state.program);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(state.uniforms.resolution, canvas.width, canvas.height);
    gl.uniform1f(state.uniforms.time, elapsed);
    gl.uniform1f(state.uniforms.mode, Number(ui.visualMode.value));
    gl.uniform1f(state.uniforms.speed, Number(ui.speed.value));
    gl.uniform1f(state.uniforms.scale, Number(ui.scale.value));
    gl.uniform1f(state.uniforms.detail, Number(ui.detail.value));
    gl.uniform1f(state.uniforms.warp, Number(ui.warp.value));
    gl.uniform1f(state.uniforms.pulse, Number(ui.pulse.value));
    gl.uniform1f(state.uniforms.hue, Number(ui.hue.value));
    gl.uniform1f(state.uniforms.saturation, Number(ui.saturation.value));
    gl.uniform1f(state.uniforms.brightness, Number(ui.brightness.value));
    gl.uniform1f(state.uniforms.contrast, Number(ui.contrast.value));
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const delta = Math.max(1, now - state.previousFrameAt);
    const currentFps = 1000 / delta;
    state.fpsAverage = state.fpsAverage === 0 ? currentFps : state.fpsAverage * 0.92 + currentFps * 0.08;
    state.previousFrameAt = now;
    ui.fpsLabel.textContent = `${Math.round(state.fpsAverage)} fps`;
    requestAnimationFrame(render);
  }

  function chooseMimeType(includeAudio = ui.includeMic?.checked === true) {
    if (typeof MediaRecorder === "undefined") return "";
    const candidates = includeAudio ? [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/mp4;codecs=h264,aac",
      "video/mp4",
      "video/webm"
    ] : [
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/mp4;codecs=h264",
      "video/mp4",
      "video/webm"
    ];
    return candidates.find((candidate) => {
      try {
        return MediaRecorder.isTypeSupported(candidate);
      } catch (_) {
        return false;
      }
    }) || "";
  }

  function extensionForMime(mime) {
    return mime.includes("mp4") ? "mp4" : "webm";
  }

  function filterForExtension(extension) {
    if (extension === "png") return [{ name: "PNG image", extensions: ["png"] }];
    if (extension === "mp4") return [{ name: "MPEG-4 video", extensions: ["mp4"] }];
    return [{ name: "WebM video", extensions: ["webm"] }];
  }

  function timestampName(prefix, extension) {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    return `${prefix}_${state.outputWidth}x${state.outputHeight}_${stamp}.${extension}`;
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    const value = bytes / Math.pow(1024, index);
    return `${value >= 100 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
  }

  function formatDuration(milliseconds) {
    const total = Math.max(0, milliseconds);
    const minutes = Math.floor(total / 60000);
    const seconds = Math.floor((total % 60000) / 1000);
    const ms = Math.floor(total % 1000);
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
  }

  function activeDurationMs() {
    if (!state.recordStartedAt) return 0;
    const end = state.recording ? performance.now() : state.recordStartedAt + state.lastDurationMs + state.totalPausedMs;
    const currentPause = state.paused ? performance.now() - state.pauseStartedAt : 0;
    return Math.max(0, end - state.recordStartedAt - state.totalPausedMs - currentPause);
  }

  function updateEstimate() {
    const videoBits = Number(ui.videoBitrate.value);
    const audioBits = ui.includeMic.checked ? Number(ui.audioBitrate.value) : 0;
    const bytesPerMinute = ((videoBits + audioBits) / 8) * 60;
    ui.estimateLabel.textContent = `≈ ${formatBytes(bytesPerMinute)}/min`;
  }

  function setRecordState(label, className) {
    ui.recordState.textContent = label;
    ui.recordState.className = `status-pill ${className}`;
  }

  function setControlsLocked(locked) {
    [ui.resolution, ui.customWidth, ui.customHeight, ui.applySize, ui.frameRate, ui.videoBitrate, ui.includeMic, ui.deviceSelect, ui.audioBitrate, ui.recordDuration, ui.countdown].forEach((element) => {
      if (!element) return;
      if (element === ui.deviceSelect || element === ui.audioBitrate) {
        element.disabled = locked || !ui.includeMic.checked;
      } else {
        element.disabled = locked;
      }
    });
    ui.refreshDevices.disabled = locked;
  }

  async function refreshMicrophones() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      ui.deviceSelect.innerHTML = '<option value="">Microphone enumeration unavailable</option>';
      return;
    }
    const selected = ui.deviceSelect.value;
    try {
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "audioinput");
      ui.deviceSelect.innerHTML = '<option value="">Default microphone</option>';
      devices.forEach((device, index) => {
        const option = document.createElement("option");
        option.value = device.deviceId;
        option.textContent = device.label || `Microphone ${index + 1}`;
        ui.deviceSelect.appendChild(option);
      });
      if ([...ui.deviceSelect.options].some((option) => option.value === selected)) {
        ui.deviceSelect.value = selected;
      }
      ui.micState.textContent = devices.length ? `${devices.length} found` : "Permission needed";
    } catch (error) {
      console.error("Could not enumerate microphones", error);
      ui.micState.textContent = "Refresh failed";
    }
  }

  async function acquireMicrophone() {
    if (!ui.includeMic.checked) return null;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Microphone capture is unavailable in this WebView");
    }
    const selectedId = ui.deviceSelect.value;
    const constraints = {
      audio: selectedId ? { deviceId: { exact: selectedId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } : { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: false
    };
    ui.micState.textContent = "Requesting…";
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    state.microphoneStream = stream;
    const track = stream.getAudioTracks()[0];
    ui.micState.textContent = track?.label || "Microphone active";
    await refreshMicrophones();
    return stream;
  }

  function stopMicrophone() {
    if (state.microphoneStream) {
      state.microphoneStream.getTracks().forEach((track) => track.stop());
      state.microphoneStream = null;
    }
    ui.micState.textContent = ui.includeMic.checked ? "Ready" : "Off";
  }

  function clearTimers() {
    if (state.timerId) window.clearInterval(state.timerId);
    if (state.autoStopId) window.clearTimeout(state.autoStopId);
    if (state.countdownId) window.clearTimeout(state.countdownId);
    state.timerId = 0;
    state.autoStopId = 0;
    state.countdownId = 0;
  }

  async function runCountdown(seconds) {
    if (seconds <= 0) return true;
    state.countdownActive = true;
    setRecordState("Countdown", "countdown");
    ui.recordButton.disabled = true;
    ui.countdownOverlay.classList.remove("hidden");
    ui.stageCountdown.classList.remove("hidden");
    for (let remaining = seconds; remaining > 0; remaining -= 1) {
      ui.countdownOverlay.textContent = `Recording in ${remaining}`;
      ui.stageCountdown.textContent = String(remaining);
      await new Promise((resolve) => {
        state.countdownId = window.setTimeout(resolve, 1000);
      });
      if (!state.countdownActive) return false;
    }
    ui.countdownOverlay.classList.add("hidden");
    ui.stageCountdown.classList.add("hidden");
    state.countdownActive = false;
    return true;
  }

  async function startRecording() {
    if (state.recording || state.countdownActive) return;
    const countdownCompleted = await runCountdown(Number(ui.countdown.value));
    if (!countdownCompleted) return;

    try {
      state.chosenMime = chooseMimeType(ui.includeMic.checked);
      if (!state.chosenMime) throw new Error("No supported MediaRecorder video codec was found");
      const canvasStream = canvas.captureStream(Number(ui.frameRate.value));
      const combinedTracks = [...canvasStream.getVideoTracks()];
      const micStream = await acquireMicrophone();
      if (micStream) combinedTracks.push(...micStream.getAudioTracks());
      const stream = new MediaStream(combinedTracks);
      state.recorderStream = stream;
      state.chunks = [];
      state.recordedBytes = 0;
      state.totalPausedMs = 0;
      state.pauseStartedAt = 0;
      state.lastSavedPath = "";

      const options = {
        mimeType: state.chosenMime,
        videoBitsPerSecond: Number(ui.videoBitrate.value)
      };
      if (ui.includeMic.checked) options.audioBitsPerSecond = Number(ui.audioBitrate.value);

      const recorder = new MediaRecorder(stream, options);
      state.recorder = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          state.chunks.push(event.data);
          state.recordedBytes += event.data.size;
          ui.recordSize.textContent = formatBytes(state.recordedBytes);
        }
      };
      recorder.onerror = (event) => {
        console.error("MediaRecorder error", event.error || event);
        setRecordState("Error", "error");
      };
      recorder.onstop = finalizeRecording;

      state.recordStartedAt = performance.now();
      state.recording = true;
      state.paused = false;
      setControlsLocked(true);
      ui.recordButton.disabled = true;
      ui.pauseButton.disabled = false;
      ui.stopButton.disabled = false;
      ui.pauseButton.textContent = "Pause";
      setRecordState("Recording", "recording");
      stage.classList.add("recording");
      stage.classList.remove("paused");
      ui.hudRecording.textContent = `REC · ${ui.frameRate.value} FPS`;
      recorder.start(500);

      state.timerId = window.setInterval(() => {
        ui.recordTime.textContent = formatDuration(activeDurationMs());
      }, 31);

      const autoStopSeconds = Number(ui.recordDuration.value);
      if (autoStopSeconds > 0) {
        state.autoStopId = window.setTimeout(stopRecording, autoStopSeconds * 1000);
      }
    } catch (error) {
      console.error("Could not start recording", error);
      state.recording = false;
      state.paused = false;
      clearTimers();
      stopMicrophone();
      setControlsLocked(false);
      ui.recordButton.disabled = false;
      ui.pauseButton.disabled = true;
      ui.stopButton.disabled = true;
      setRecordState("Error", "error");
      ui.hudRecording.textContent = "Preview";
      window.alert(`Could not start recording:\n${error.message || error}`);
    }
  }

  function togglePause() {
    if (!state.recorder || !state.recording) return;
    if (state.recorder.state === "recording") {
      state.recorder.pause();
      state.paused = true;
      state.pauseStartedAt = performance.now();
      ui.pauseButton.textContent = "Resume";
      setRecordState("Paused", "paused");
      stage.classList.add("paused");
      ui.hudRecording.textContent = "PAUSED";
    } else if (state.recorder.state === "paused") {
      state.recorder.resume();
      state.totalPausedMs += performance.now() - state.pauseStartedAt;
      state.pauseStartedAt = 0;
      state.paused = false;
      ui.pauseButton.textContent = "Pause";
      setRecordState("Recording", "recording");
      stage.classList.remove("paused");
      ui.hudRecording.textContent = `REC · ${ui.frameRate.value} FPS`;
    }
  }

  function stopRecording() {
    if (state.countdownActive) {
      state.countdownActive = false;
      clearTimers();
      ui.countdownOverlay.classList.add("hidden");
      ui.stageCountdown.classList.add("hidden");
      ui.recordButton.disabled = false;
      setRecordState("Ready", "ready");
      return;
    }
    if (!state.recorder || !state.recording) return;
    if (state.paused) {
      state.totalPausedMs += performance.now() - state.pauseStartedAt;
      state.pauseStartedAt = 0;
    }
    state.lastDurationMs = activeDurationMs();
    state.recording = false;
    state.paused = false;
    clearTimers();
    ui.recordTime.textContent = formatDuration(state.lastDurationMs);
    ui.pauseButton.disabled = true;
    ui.stopButton.disabled = true;
    ui.pauseButton.textContent = "Pause";
    setRecordState("Encoding", "countdown");
    stage.classList.remove("recording", "paused");
    ui.hudRecording.textContent = "Encoding…";
    if (state.recorder.state !== "inactive") state.recorder.stop();
  }

  async function finalizeRecording() {
    const mime = state.recorder?.mimeType || state.chosenMime || "video/webm";
    state.lastMime = mime;
    state.lastBlob = new Blob(state.chunks, { type: mime });
    state.recordedBytes = state.lastBlob.size;
    state.chunks = [];
    state.recorderStream?.getTracks().forEach((track) => track.stop());
    state.recorderStream = null;
    state.recorder = null;
    stopMicrophone();
    setControlsLocked(false);
    ui.recordButton.disabled = false;
    ui.saveButton.disabled = false;
    ui.discardButton.disabled = false;
    ui.lastFormat.textContent = extensionForMime(mime).toUpperCase();
    ui.lastDuration.textContent = formatDuration(state.lastDurationMs);
    ui.lastSize.textContent = formatBytes(state.lastBlob.size);
    ui.lastFile.textContent = "Unsaved recording";
    ui.recordSize.textContent = formatBytes(state.lastBlob.size);
    setRecordState("Ready", "ready");
    ui.hudRecording.textContent = "Preview";
    if (ui.autoSave.checked) await saveLastRecording();
  }

  async function saveBlob(blob, suggestedName, extension) {
    const tauriApi = window.__TAURI__;
    if (tauriApi?.dialog?.save && tauriApi?.fs?.writeBinaryFile) {
      const path = await tauriApi.dialog.save({
        defaultPath: suggestedName,
        filters: filterForExtension(extension)
      });
      if (!path) return "";
      const bytes = new Uint8Array(await blob.arrayBuffer());
      await tauriApi.fs.writeBinaryFile(path, bytes);
      return path;
    }

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = suggestedName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    return suggestedName;
  }

  async function saveLastRecording() {
    if (!state.lastBlob) return;
    const extension = extensionForMime(state.lastMime);
    const filename = timestampName("junkpile-14-recording", extension);
    try {
      ui.saveButton.disabled = true;
      ui.saveButton.textContent = "Saving…";
      const path = await saveBlob(state.lastBlob, filename, extension);
      if (path) {
        state.lastSavedPath = path;
        ui.lastFile.textContent = path;
        setRecordState("Saved", "ready");
      }
    } catch (error) {
      console.error("Could not save recording", error);
      setRecordState("Save error", "error");
      window.alert(`Could not save recording:\n${error.message || error}`);
    } finally {
      ui.saveButton.disabled = !state.lastBlob;
      ui.saveButton.textContent = "Save recording";
    }
  }

  function discardRecording() {
    state.lastBlob = null;
    state.lastMime = "";
    state.lastDurationMs = 0;
    state.lastSavedPath = "";
    ui.saveButton.disabled = true;
    ui.discardButton.disabled = true;
    ui.lastFormat.textContent = "No capture";
    ui.lastDuration.textContent = "—";
    ui.lastSize.textContent = "—";
    ui.lastFile.textContent = "—";
    ui.recordSize.textContent = "0 B";
  }

  async function saveSnapshot() {
    try {
      ui.snapshotButton.disabled = true;
      ui.snapshotButton.textContent = "Rendering…";
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Canvas could not create a PNG blob")), "image/png");
      });
      const filename = timestampName("junkpile-14-frame", "png");
      const path = await saveBlob(blob, filename, "png");
      if (path) {
        ui.lastFile.textContent = path;
        setRecordState("PNG saved", "ready");
      }
    } catch (error) {
      console.error("Could not save PNG", error);
      setRecordState("Save error", "error");
      window.alert(`Could not save PNG:\n${error.message || error}`);
    } finally {
      ui.snapshotButton.disabled = false;
      ui.snapshotButton.textContent = "Save PNG";
    }
  }

  function applySelectedResolution() {
    if (state.recording || state.countdownActive) return;
    const value = ui.resolution.value;
    ui.customSizeRow.classList.toggle("hidden", value !== "custom");
    if (value === "custom") return;
    const [width, height] = value.split("x").map(Number);
    resizeCanvas(width, height);
  }

  function applyCustomResolution() {
    resizeCanvas(Number(ui.customWidth.value), Number(ui.customHeight.value));
    ui.customWidth.value = String(state.outputWidth);
    ui.customHeight.value = String(state.outputHeight);
  }

  function bindControls() {
    visualControls.forEach(([id, _digits, formatter]) => {
      const input = $(id);
      const output = $(`${id}-output`);
      const sync = () => { output.textContent = formatter(input.value); };
      input.addEventListener("input", sync);
      sync();
    });

    ui.visualMode.addEventListener("change", () => {
      ui.hudMode.textContent = modeNames[Number(ui.visualMode.value)] || modeNames[0];
    });
    ui.recordButton.addEventListener("click", startRecording);
    ui.pauseButton.addEventListener("click", togglePause);
    ui.stopButton.addEventListener("click", stopRecording);
    ui.saveButton.addEventListener("click", saveLastRecording);
    ui.discardButton.addEventListener("click", discardRecording);
    ui.snapshotButton.addEventListener("click", saveSnapshot);
    ui.resolution.addEventListener("change", applySelectedResolution);
    ui.applySize.addEventListener("click", applyCustomResolution);
    ui.videoBitrate.addEventListener("change", updateEstimate);
    ui.audioBitrate.addEventListener("change", updateEstimate);
    ui.includeMic.addEventListener("change", () => {
      ui.deviceSelect.disabled = !ui.includeMic.checked || state.recording;
      ui.audioBitrate.disabled = !ui.includeMic.checked || state.recording;
      ui.micState.textContent = ui.includeMic.checked ? "Ready" : "Off";
      state.chosenMime = chooseMimeType(ui.includeMic.checked);
      ui.codecLabel.textContent = state.chosenMime || "No supported codec";
      updateEstimate();
      if (ui.includeMic.checked) refreshMicrophones();
    });
    ui.refreshDevices.addEventListener("click", refreshMicrophones);
    navigator.mediaDevices?.addEventListener?.("devicechange", refreshMicrophones);
    window.addEventListener("beforeunload", () => {
      if (state.recorder && state.recorder.state !== "inactive") state.recorder.stop();
      stopMicrophone();
    });
  }

  function initializeCapabilityStatus() {
    const captureAvailable = typeof canvas.captureStream === "function";
    const recorderAvailable = typeof MediaRecorder !== "undefined";
    state.chosenMime = chooseMimeType();
    ui.codecLabel.textContent = state.chosenMime || "No supported codec";
    if (!captureAvailable || !recorderAvailable || !state.chosenMime) {
      unsupported.classList.remove("hidden");
      ui.recordButton.disabled = true;
      setRecordState("Unsupported", "error");
    } else {
      setRecordState("Ready", "ready");
    }
  }

  function initialize() {
    try {
      initializeWebGL();
      bindControls();
      initializeCapabilityStatus();
      updateEstimate();
      refreshMicrophones();
      ui.hudMode.textContent = modeNames[Number(ui.visualMode.value)];
      requestAnimationFrame(render);
    } catch (error) {
      console.error("Example 14 initialization failed", error);
      unsupported.classList.remove("hidden");
      unsupported.querySelector("h2").textContent = "Renderer initialization failed";
      unsupported.querySelector("p").textContent = error.message || String(error);
      setRecordState("Error", "error");
    }
  }

  initialize();
})();
