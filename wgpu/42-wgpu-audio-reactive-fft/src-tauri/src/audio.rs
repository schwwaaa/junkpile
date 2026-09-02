use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use rustfft::{num_complex::Complex, FftPlanner};
use serde::Serialize;
use std::{
    collections::VecDeque,
    sync::{
        mpsc::{sync_channel, Receiver, SyncSender, TrySendError},
        Arc, Mutex, RwLock,
    },
    thread,
    time::{Duration, Instant},
};

pub const FFT_SIZE: usize = 2048;
pub const FFT_BINS: usize = 256;
pub const WAVE_BINS: usize = 512;
const RING_CAPACITY: usize = 192_000;
const ANALYSIS_INTERVAL: Duration = Duration::from_millis(16);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDeviceInfo {
    pub name: String,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioSnapshot {
    pub running: bool,
    pub device_name: String,
    pub sample_rate: u32,
    pub channels: u16,
    pub sample_format: String,
    pub analysis_fps: f64,
    pub rms: f32,
    pub peak: f32,
    pub bass: f32,
    pub mid: f32,
    pub treble: f32,
    pub beat_pulse: f32,
    pub beat_count: u64,
    pub gain: f32,
    pub smoothing: f32,
    pub beat_threshold: f32,
    pub beat_hold_ms: u32,
    pub samples_buffered: usize,
    pub callback_errors: u64,
    pub last_error: String,
}

impl Default for AudioSnapshot {
    fn default() -> Self {
        Self {
            running: false,
            device_name: "No active microphone".into(),
            sample_rate: 0,
            channels: 0,
            sample_format: "—".into(),
            analysis_fps: 0.0,
            rms: 0.0,
            peak: 0.0,
            bass: 0.0,
            mid: 0.0,
            treble: 0.0,
            beat_pulse: 0.0,
            beat_count: 0,
            gain: 1.0,
            smoothing: 0.72,
            beat_threshold: 1.45,
            beat_hold_ms: 180,
            samples_buffered: 0,
            callback_errors: 0,
            last_error: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioAnalysisFrame {
    pub spectrum: Vec<f32>,
    pub waveform: Vec<f32>,
    pub rms: f32,
    pub peak: f32,
    pub bass: f32,
    pub mid: f32,
    pub treble: f32,
    pub beat_pulse: f32,
    pub running: bool,
}

impl Default for AudioAnalysisFrame {
    fn default() -> Self {
        Self {
            spectrum: vec![0.0; FFT_BINS],
            waveform: vec![0.0; WAVE_BINS],
            rms: 0.0,
            peak: 0.0,
            bass: 0.0,
            mid: 0.0,
            treble: 0.0,
            beat_pulse: 0.0,
            running: false,
        }
    }
}

#[derive(Clone)]
pub struct AudioShared {
    frame: Arc<RwLock<AudioAnalysisFrame>>,
}

impl AudioShared {
    pub fn frame(&self) -> AudioAnalysisFrame {
        self.frame.read().expect("audio frame lock poisoned").clone()
    }
}

enum AudioCommand {
    Start { device_name: String },
    Stop,
    SetGain(f32),
    SetSmoothing(f32),
    SetBeatThreshold(f32),
    SetBeatHold(u32),
    ResetMetrics,
    Shutdown,
}

#[derive(Clone)]
pub struct AudioHandle {
    tx: SyncSender<AudioCommand>,
    snapshot: Arc<RwLock<AudioSnapshot>>,
    shared: AudioShared,
}

impl AudioHandle {
    pub fn start() -> Result<Self, String> {
        let (tx, rx) = sync_channel(32);
        let snapshot = Arc::new(RwLock::new(AudioSnapshot::default()));
        let shared = AudioShared {
            frame: Arc::new(RwLock::new(AudioAnalysisFrame::default())),
        };
        let thread_snapshot = Arc::clone(&snapshot);
        let thread_shared = shared.clone();
        thread::Builder::new()
            .name("junkpile-audio-analysis".into())
            .spawn(move || run_audio_worker(rx, thread_snapshot, thread_shared))
            .map_err(|error| format!("could not start audio worker: {error}"))?;
        Ok(Self { tx, snapshot, shared })
    }

    pub fn snapshot(&self) -> AudioSnapshot {
        self.snapshot.read().expect("audio snapshot lock poisoned").clone()
    }

    pub fn shared(&self) -> AudioShared {
        self.shared.clone()
    }

    pub fn analysis_frame(&self) -> AudioAnalysisFrame {
        self.shared.frame()
    }

    fn send(&self, command: AudioCommand) -> Result<(), String> {
        self.tx.try_send(command).map_err(|error| match error {
            TrySendError::Full(_) => "audio command queue is full".into(),
            TrySendError::Disconnected(_) => "audio worker is unavailable".into(),
        })
    }

    pub fn start_input(&self, device_name: String) -> Result<(), String> {
        self.send(AudioCommand::Start { device_name })
    }

    pub fn stop_input(&self) -> Result<(), String> {
        self.send(AudioCommand::Stop)
    }

    pub fn set_gain(&self, value: f32) -> Result<(), String> {
        self.send(AudioCommand::SetGain(value.clamp(0.0, 8.0)))
    }

    pub fn set_smoothing(&self, value: f32) -> Result<(), String> {
        self.send(AudioCommand::SetSmoothing(value.clamp(0.0, 0.98)))
    }

    pub fn set_beat_threshold(&self, value: f32) -> Result<(), String> {
        self.send(AudioCommand::SetBeatThreshold(value.clamp(1.01, 4.0)))
    }

    pub fn set_beat_hold(&self, value: u32) -> Result<(), String> {
        self.send(AudioCommand::SetBeatHold(value.clamp(50, 1000)))
    }

    pub fn reset_metrics(&self) -> Result<(), String> {
        self.send(AudioCommand::ResetMetrics)
    }

    pub fn shutdown(&self) -> Result<(), String> {
        self.send(AudioCommand::Shutdown)
    }
}

impl Drop for AudioHandle {
    fn drop(&mut self) {
        if Arc::strong_count(&self.snapshot) <= 2 {
            let _ = self.tx.try_send(AudioCommand::Shutdown);
        }
    }
}

pub fn list_input_devices() -> Result<Vec<AudioDeviceInfo>, String> {
    let host = cpal::default_host();
    let default_name = host
        .default_input_device()
        .and_then(|device| device.name().ok())
        .unwrap_or_default();
    let devices = host
        .input_devices()
        .map_err(|error| format!("could not enumerate audio inputs: {error}"))?;
    let mut out = Vec::new();
    for device in devices {
        if let Ok(name) = device.name() {
            out.push(AudioDeviceInfo {
                is_default: name == default_name,
                name,
            });
        }
    }
    out.sort_by(|a, b| b.is_default.cmp(&a.is_default).then_with(|| a.name.cmp(&b.name)));
    Ok(out)
}

fn run_audio_worker(
    rx: Receiver<AudioCommand>,
    snapshot: Arc<RwLock<AudioSnapshot>>,
    shared: AudioShared,
) {
    let ring = Arc::new(Mutex::new(VecDeque::<f32>::with_capacity(RING_CAPACITY)));
    let callback_error = Arc::new(Mutex::new(String::new()));
    let callback_errors = Arc::new(Mutex::new(0_u64));
    let mut stream: Option<cpal::Stream> = None;
    let mut gain = 1.0_f32;
    let mut smoothing = 0.72_f32;
    let mut beat_threshold = 1.45_f32;
    let mut beat_hold_ms = 180_u32;
    let mut sample_rate = 48_000_u32;
    let mut previous_spectrum = vec![0.0_f32; FFT_BINS];
    let mut beat_floor = 0.04_f32;
    let mut beat_count = 0_u64;
    let mut beat_pulse = 0.0_f32;
    let mut last_beat = Instant::now() - Duration::from_secs(2);
    let mut last_analysis = Instant::now();
    let mut analysis_counter = 0_u64;
    let mut analysis_window = Instant::now();
    let mut measured_analysis_fps = 0.0_f64;
    let mut fft_planner = FftPlanner::<f32>::new();
    let fft = fft_planner.plan_fft_forward(FFT_SIZE);
    let mut fft_buffer = vec![Complex::new(0.0, 0.0); FFT_SIZE];
    let hann: Vec<f32> = (0..FFT_SIZE)
        .map(|index| {
            let phase = std::f32::consts::TAU * index as f32 / (FFT_SIZE.saturating_sub(1)) as f32;
            0.5 - 0.5 * phase.cos()
        })
        .collect();

    loop {
        match rx.recv_timeout(Duration::from_millis(4)) {
            Ok(AudioCommand::Start { device_name }) => {
                stream = None;
                match open_input_stream(
                    &device_name,
                    Arc::clone(&ring),
                    Arc::clone(&callback_error),
                    Arc::clone(&callback_errors),
                ) {
                    Ok(opened) => {
                        sample_rate = opened.sample_rate;
                        if let Ok(mut ring) = ring.lock() {
                            ring.clear();
                        }
                        previous_spectrum.fill(0.0);
                        beat_floor = 0.04;
                        beat_pulse = 0.0;
                        let mut state = snapshot.write().expect("audio snapshot lock poisoned");
                        state.running = true;
                        state.device_name = opened.device_name;
                        state.sample_rate = opened.sample_rate;
                        state.channels = opened.channels;
                        state.sample_format = opened.sample_format;
                        state.last_error.clear();
                        stream = Some(opened.stream);
                    }
                    Err(error) => {
                        let mut state = snapshot.write().expect("audio snapshot lock poisoned");
                        state.running = false;
                        state.last_error = error;
                    }
                }
            }
            Ok(AudioCommand::Stop) => {
                stream = None;
                let mut state = snapshot.write().expect("audio snapshot lock poisoned");
                state.running = false;
                state.device_name = "No active microphone".into();
            }
            Ok(AudioCommand::SetGain(value)) => {
                gain = value;
                snapshot.write().expect("audio snapshot lock poisoned").gain = value;
            }
            Ok(AudioCommand::SetSmoothing(value)) => {
                smoothing = value;
                snapshot.write().expect("audio snapshot lock poisoned").smoothing = value;
            }
            Ok(AudioCommand::SetBeatThreshold(value)) => {
                beat_threshold = value;
                snapshot.write().expect("audio snapshot lock poisoned").beat_threshold = value;
            }
            Ok(AudioCommand::SetBeatHold(value)) => {
                beat_hold_ms = value;
                snapshot.write().expect("audio snapshot lock poisoned").beat_hold_ms = value;
            }
            Ok(AudioCommand::ResetMetrics) => {
                beat_count = 0;
                if let Ok(mut count) = callback_errors.lock() {
                    *count = 0;
                }
                let mut state = snapshot.write().expect("audio snapshot lock poisoned");
                state.beat_count = 0;
                state.callback_errors = 0;
            }
            Ok(AudioCommand::Shutdown) => break,
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
        }

        if stream.is_some() && last_analysis.elapsed() >= ANALYSIS_INTERVAL {
            last_analysis = Instant::now();
            analysis_counter = analysis_counter.saturating_add(1);
            if analysis_window.elapsed() >= Duration::from_secs(1) {
                measured_analysis_fps = analysis_counter as f64 / analysis_window.elapsed().as_secs_f64();
                analysis_counter = 0;
                analysis_window = Instant::now();
            }

            let (window, buffered) = latest_samples(&ring, FFT_SIZE);
            if !window.is_empty() {
                let (frame, new_floor, new_pulse, beat) = analyze(
                    &window,
                    sample_rate,
                    gain,
                    smoothing,
                    beat_threshold,
                    beat_hold_ms,
                    &hann,
                    &fft,
                    &mut fft_buffer,
                    &mut previous_spectrum,
                    beat_floor,
                    beat_pulse,
                    last_beat,
                );
                beat_floor = new_floor;
                beat_pulse = new_pulse;
                if beat {
                    beat_count = beat_count.saturating_add(1);
                    last_beat = Instant::now();
                }
                *shared.frame.write().expect("audio frame lock poisoned") = frame.clone();
                let callback_error_text = callback_error.lock().map(|value| value.clone()).unwrap_or_default();
                let callback_error_count = callback_errors.lock().map(|value| *value).unwrap_or(0);
                let mut state = snapshot.write().expect("audio snapshot lock poisoned");
                state.analysis_fps = measured_analysis_fps;
                state.rms = frame.rms;
                state.peak = frame.peak;
                state.bass = frame.bass;
                state.mid = frame.mid;
                state.treble = frame.treble;
                state.beat_pulse = frame.beat_pulse;
                state.beat_count = beat_count;
                state.samples_buffered = buffered;
                state.callback_errors = callback_error_count;
                if !callback_error_text.is_empty() {
                    state.last_error = callback_error_text;
                }
            }
        } else if stream.is_none() {
            let mut frame = shared.frame.write().expect("audio frame lock poisoned");
            frame.running = false;
            frame.beat_pulse *= 0.92;
        }
    }
}

struct OpenedStream {
    stream: cpal::Stream,
    device_name: String,
    sample_rate: u32,
    channels: u16,
    sample_format: String,
}

fn open_input_stream(
    requested_name: &str,
    ring: Arc<Mutex<VecDeque<f32>>>,
    callback_error: Arc<Mutex<String>>,
    callback_errors: Arc<Mutex<u64>>,
) -> Result<OpenedStream, String> {
    let host = cpal::default_host();
    let device = if requested_name.trim().is_empty() || requested_name == "__default__" {
        host.default_input_device()
            .ok_or_else(|| "no default microphone is available".to_string())?
    } else {
        host.input_devices()
            .map_err(|error| format!("could not enumerate audio inputs: {error}"))?
            .find(|device| device.name().map(|name| name == requested_name).unwrap_or(false))
            .ok_or_else(|| format!("microphone '{requested_name}' is no longer available"))?
    };
    let device_name = device.name().unwrap_or_else(|_| "Unknown microphone".into());
    let supported = device
        .default_input_config()
        .map_err(|error| format!("could not query '{device_name}' input format: {error}"))?;
    let sample_format = supported.sample_format();
    let config: cpal::StreamConfig = supported.clone().into();
    let channels = config.channels.max(1);
    let sample_rate = config.sample_rate.0;

    let make_error_callback = || {
        let err_state = Arc::clone(&callback_error);
        let err_count = Arc::clone(&callback_errors);
        move |error: cpal::StreamError| {
            if let Ok(mut text) = err_state.lock() {
                *text = format!("microphone stream error: {error}");
            }
            if let Ok(mut count) = err_count.lock() {
                *count = count.saturating_add(1);
            }
        }
    };

    let stream = match sample_format {
        cpal::SampleFormat::F32 => {
            let ring = Arc::clone(&ring);
            device.build_input_stream(
                &config,
                move |data: &[f32], _| push_interleaved_f32(data, channels as usize, &ring),
                make_error_callback(),
                None,
            )
        }
        cpal::SampleFormat::I16 => {
            let ring = Arc::clone(&ring);
            device.build_input_stream(
                &config,
                move |data: &[i16], _| push_interleaved_i16(data, channels as usize, &ring),
                make_error_callback(),
                None,
            )
        }
        cpal::SampleFormat::U16 => {
            let ring = Arc::clone(&ring);
            device.build_input_stream(
                &config,
                move |data: &[u16], _| push_interleaved_u16(data, channels as usize, &ring),
                make_error_callback(),
                None,
            )
        }
        other => return Err(format!("unsupported microphone sample format: {other:?}")),
    }
    .map_err(|error| format!("could not create '{device_name}' input stream: {error}"))?;

    stream
        .play()
        .map_err(|error| format!("could not start '{device_name}' microphone: {error}"))?;

    Ok(OpenedStream {
        stream,
        device_name,
        sample_rate,
        channels,
        sample_format: format!("{sample_format:?}"),
    })
}

fn push_interleaved_f32(data: &[f32], channels: usize, ring: &Arc<Mutex<VecDeque<f32>>>) {
    let mut mono = Vec::with_capacity(data.len() / channels.max(1));
    for frame in data.chunks(channels.max(1)) {
        let sum: f32 = frame.iter().copied().sum();
        mono.push(sum / frame.len().max(1) as f32);
    }
    push_mono(&mono, ring);
}

fn push_interleaved_i16(data: &[i16], channels: usize, ring: &Arc<Mutex<VecDeque<f32>>>) {
    let scale = i16::MAX as f32;
    let mut mono = Vec::with_capacity(data.len() / channels.max(1));
    for frame in data.chunks(channels.max(1)) {
        let sum: f32 = frame.iter().map(|sample| *sample as f32 / scale).sum();
        mono.push(sum / frame.len().max(1) as f32);
    }
    push_mono(&mono, ring);
}

fn push_interleaved_u16(data: &[u16], channels: usize, ring: &Arc<Mutex<VecDeque<f32>>>) {
    let mut mono = Vec::with_capacity(data.len() / channels.max(1));
    for frame in data.chunks(channels.max(1)) {
        let sum: f32 = frame
            .iter()
            .map(|sample| (*sample as f32 / u16::MAX as f32) * 2.0 - 1.0)
            .sum();
        mono.push(sum / frame.len().max(1) as f32);
    }
    push_mono(&mono, ring);
}

fn push_mono(samples: &[f32], ring: &Arc<Mutex<VecDeque<f32>>>) {
    if let Ok(mut target) = ring.lock() {
        let overflow = target.len().saturating_add(samples.len()).saturating_sub(RING_CAPACITY);
        for _ in 0..overflow {
            target.pop_front();
        }
        target.extend(samples.iter().copied());
    }
}

fn latest_samples(ring: &Arc<Mutex<VecDeque<f32>>>, count: usize) -> (Vec<f32>, usize) {
    let Ok(ring) = ring.lock() else {
        return (Vec::new(), 0);
    };
    let buffered = ring.len();
    let start = buffered.saturating_sub(count);
    let mut samples: Vec<f32> = ring.iter().skip(start).copied().collect();
    if samples.len() < count {
        let mut padded = vec![0.0; count - samples.len()];
        padded.append(&mut samples);
        samples = padded;
    }
    (samples, buffered)
}

#[allow(clippy::too_many_arguments)]
fn analyze(
    samples: &[f32],
    sample_rate: u32,
    gain: f32,
    smoothing: f32,
    beat_threshold: f32,
    beat_hold_ms: u32,
    hann: &[f32],
    fft: &Arc<dyn rustfft::Fft<f32>>,
    fft_buffer: &mut [Complex<f32>],
    previous_spectrum: &mut [f32],
    beat_floor: f32,
    previous_beat_pulse: f32,
    last_beat: Instant,
) -> (AudioAnalysisFrame, f32, f32, bool) {
    let mut rms_accum = 0.0_f32;
    let mut peak = 0.0_f32;
    for (index, sample) in samples.iter().copied().enumerate().take(FFT_SIZE) {
        let sample = (sample * gain).clamp(-1.5, 1.5);
        rms_accum += sample * sample;
        peak = peak.max(sample.abs());
        fft_buffer[index] = Complex::new(sample * hann[index], 0.0);
    }
    let rms = (rms_accum / FFT_SIZE as f32).sqrt();
    fft.process(fft_buffer);

    let half = FFT_SIZE / 2;
    let mut raw = vec![0.0_f32; half];
    for index in 1..half {
        let magnitude = fft_buffer[index].norm() * (2.0 / FFT_SIZE as f32);
        raw[index] = (magnitude * 3.5).sqrt().clamp(0.0, 1.0);
    }

    let nyquist = sample_rate as f32 * 0.5;
    let bass = band_energy(&raw, sample_rate, 30.0, 220.0);
    let mid = band_energy(&raw, sample_rate, 220.0, 2200.0);
    let treble = band_energy(&raw, sample_rate, 2200.0, nyquist.min(12_000.0));

    let mut spectrum = vec![0.0_f32; FFT_BINS];
    for (index, value) in spectrum.iter_mut().enumerate() {
        let normalized = index as f32 / (FFT_BINS - 1) as f32;
        let warped = normalized.powf(2.15);
        let source_index = (1.0 + warped * (half.saturating_sub(2)) as f32) as usize;
        let current = raw[source_index.min(half - 1)];
        let smoothed = previous_spectrum[index] * smoothing + current * (1.0 - smoothing);
        previous_spectrum[index] = smoothed;
        *value = smoothed.clamp(0.0, 1.0);
    }

    let mut waveform = vec![0.0_f32; WAVE_BINS];
    let stride = (FFT_SIZE / WAVE_BINS).max(1);
    for (index, value) in waveform.iter_mut().enumerate() {
        let sample_index = (index * stride).min(FFT_SIZE - 1);
        *value = (samples[sample_index] * gain).clamp(-1.0, 1.0);
    }

    let new_floor = if beat_floor <= 0.0001 {
        bass.max(0.0001)
    } else {
        beat_floor * 0.985 + bass * 0.015
    };
    let hold_ready = last_beat.elapsed() >= Duration::from_millis(beat_hold_ms as u64);
    let beat = hold_ready && bass > new_floor.max(0.015) * beat_threshold && bass > 0.035;
    let beat_pulse = if beat { 1.0 } else { previous_beat_pulse * 0.88 };

    (
        AudioAnalysisFrame {
            spectrum,
            waveform,
            rms,
            peak,
            bass,
            mid,
            treble,
            beat_pulse,
            running: true,
        },
        new_floor,
        beat_pulse,
        beat,
    )
}

fn band_energy(spectrum: &[f32], sample_rate: u32, low_hz: f32, high_hz: f32) -> f32 {
    let bin_hz = sample_rate as f32 / FFT_SIZE as f32;
    let start = (low_hz / bin_hz).floor().max(1.0) as usize;
    let end = (high_hz / bin_hz).ceil().min((spectrum.len() - 1) as f32) as usize;
    if end <= start {
        return 0.0;
    }
    let sum: f32 = spectrum[start..=end].iter().copied().sum();
    (sum / (end - start + 1) as f32).clamp(0.0, 1.0)
}
