use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc::{sync_channel, Receiver, SyncSender, TrySendError},
        Arc, RwLock,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

type Reply<T> = SyncSender<Result<T, String>>;
const AUDIO_QUEUE_CAPACITY: usize = 32;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDeviceInfo {
    pub name: String,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MicCaptureStatus {
    pub active: bool,
    pub device_name: String,
    pub sample_rate: u32,
    pub channels: u16,
    pub sample_format: String,
    pub samples_written: u64,
    pub chunks_dropped: u64,
    pub elapsed_seconds: f64,
    pub temp_path: String,
    pub last_error: String,
}

#[derive(Debug, Clone)]
pub struct MicCaptureResult {
    pub path: PathBuf,
    pub sample_rate: u32,
    pub channels: u16,
    pub samples_written: u64,
    pub chunks_dropped: u64,
}

enum AudioCommand {
    Start {
        device_name: String,
        path: PathBuf,
        reply: Reply<()>,
    },
    Stop { reply: Reply<MicCaptureResult> },
    Shutdown,
}

#[derive(Clone)]
pub struct AudioCaptureHandle {
    tx: SyncSender<AudioCommand>,
    status: Arc<RwLock<MicCaptureStatus>>,
}

impl AudioCaptureHandle {
    pub fn start() -> Result<Self, String> {
        let (tx, rx) = sync_channel(8);
        let status = Arc::new(RwLock::new(MicCaptureStatus::default()));
        let thread_status = Arc::clone(&status);
        thread::Builder::new()
            .name("junkpile-av-audio-capture".into())
            .spawn(move || run_audio_worker(rx, thread_status))
            .map_err(|error| format!("could not start microphone recorder: {error}"))?;
        Ok(Self { tx, status })
    }

    pub fn status(&self) -> MicCaptureStatus {
        self.status.read().expect("mic status lock poisoned").clone()
    }

    pub fn start_capture(&self, device_name: String, path: PathBuf) -> Result<(), String> {
        let (reply, response) = sync_channel(1);
        self.tx
            .send(AudioCommand::Start {
                device_name,
                path,
                reply,
            })
            .map_err(|_| "microphone recorder worker is unavailable".to_string())?;
        response
            .recv_timeout(Duration::from_secs(5))
            .map_err(|_| "microphone recorder did not answer start request".to_string())?
    }

    pub fn stop_capture(&self) -> Result<MicCaptureResult, String> {
        let (reply, response) = sync_channel(1);
        self.tx
            .send(AudioCommand::Stop { reply })
            .map_err(|_| "microphone recorder worker is unavailable".to_string())?;
        response
            .recv_timeout(Duration::from_secs(8))
            .map_err(|_| "microphone recorder did not finalize in time".to_string())?
    }

    pub fn shutdown(&self) {
        let _ = self.tx.try_send(AudioCommand::Shutdown);
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
        .map_err(|error| format!("could not enumerate microphone inputs: {error}"))?;
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

struct ActiveCapture {
    stream: cpal::Stream,
    writer_tx: SyncSender<WriterMessage>,
    writer_thread: Option<JoinHandle<Result<WriterSummary, String>>>,
    path: PathBuf,
    sample_rate: u32,
    channels: u16,
    sample_format: String,
    dropped: Arc<AtomicU64>,
    started: Instant,
}

enum WriterMessage {
    Samples(Vec<f32>),
    Stop,
}

#[derive(Debug)]
struct WriterSummary {
    samples_written: u64,
}

fn run_audio_worker(rx: Receiver<AudioCommand>, status: Arc<RwLock<MicCaptureStatus>>) {
    let mut active: Option<ActiveCapture> = None;
    loop {
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(AudioCommand::Start {
                device_name,
                path,
                reply,
            }) => {
                if active.is_some() {
                    let _ = reply.send(Err("microphone capture is already active".into()));
                    continue;
                }
                match open_capture(&device_name, &path) {
                    Ok(capture) => {
                        {
                            let mut state = status.write().expect("mic status lock poisoned");
                            *state = MicCaptureStatus {
                                active: true,
                                device_name: device_name.clone(),
                                sample_rate: capture.sample_rate,
                                channels: capture.channels,
                                sample_format: capture.sample_format.clone(),
                                samples_written: 0,
                                chunks_dropped: 0,
                                elapsed_seconds: 0.0,
                                temp_path: capture.path.to_string_lossy().into_owned(),
                                last_error: String::new(),
                            };
                        }
                        active = Some(capture);
                        let _ = reply.send(Ok(()));
                    }
                    Err(error) => {
                        status.write().expect("mic status lock poisoned").last_error = error.clone();
                        let _ = reply.send(Err(error));
                    }
                }
            }
            Ok(AudioCommand::Stop { reply }) => {
                let result = match active.take() {
                    Some(capture) => finish_capture(capture),
                    None => Err("no microphone capture is active".into()),
                };
                match &result {
                    Ok(summary) => {
                        let mut state = status.write().expect("mic status lock poisoned");
                        state.active = false;
                        state.samples_written = summary.samples_written;
                        state.chunks_dropped = summary.chunks_dropped;
                        state.last_error.clear();
                    }
                    Err(error) => {
                        let mut state = status.write().expect("mic status lock poisoned");
                        state.active = false;
                        state.last_error = error.clone();
                    }
                }
                let _ = reply.send(result);
            }
            Ok(AudioCommand::Shutdown) => {
                if let Some(capture) = active.take() {
                    let _ = finish_capture(capture);
                }
                break;
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                if let Some(capture) = active.take() {
                    let _ = finish_capture(capture);
                }
                break;
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
        }

        if let Some(capture) = active.as_ref() {
            let mut state = status.write().expect("mic status lock poisoned");
            state.elapsed_seconds = capture.started.elapsed().as_secs_f64();
            state.chunks_dropped = capture.dropped.load(Ordering::Relaxed);
        }
    }
}

fn open_capture(device_name: &str, path: &Path) -> Result<ActiveCapture, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("could not create microphone temp directory: {error}"))?;
    }

    let host = cpal::default_host();
    let device = if device_name.trim().is_empty() {
        host.default_input_device()
            .ok_or_else(|| "no default microphone input is available".to_string())?
    } else {
        host.input_devices()
            .map_err(|error| format!("could not enumerate microphone inputs: {error}"))?
            .find(|device| device.name().map(|name| name == device_name).unwrap_or(false))
            .ok_or_else(|| format!("microphone input not found: {device_name}"))?
    };
    let actual_name = device.name().unwrap_or_else(|_| "Unknown input".into());
    let config = device
        .default_input_config()
        .map_err(|error| format!("could not read input format for {actual_name}: {error}"))?;
    let sample_rate = config.sample_rate().0;
    let channels = config.channels();
    let sample_format = format!("{:?}", config.sample_format());

    let spec = hound::WavSpec {
        channels,
        sample_rate,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };
    let wav = hound::WavWriter::create(path, spec)
        .map_err(|error| format!("could not create microphone WAV {}: {error}", path.display()))?;
    let (writer_tx, writer_rx) = sync_channel::<WriterMessage>(AUDIO_QUEUE_CAPACITY);
    let writer_thread = thread::Builder::new()
        .name("junkpile-av-wav-writer".into())
        .spawn(move || run_wav_writer(wav, writer_rx))
        .map_err(|error| format!("could not start microphone WAV writer: {error}"))?;

    let dropped = Arc::new(AtomicU64::new(0));
    let make_error_callback = || {
        move |error: cpal::StreamError| {
            eprintln!("microphone stream error: {error}");
        }
    };
    let stream_config: cpal::StreamConfig = config.clone().into();
    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => {
            let callback_tx = writer_tx.clone();
            let callback_dropped = Arc::clone(&dropped);
            device.build_input_stream(
                &stream_config,
                move |data: &[f32], _| send_audio_chunk(data.to_vec(), &callback_tx, &callback_dropped),
                make_error_callback(),
                None,
            )
        }
        cpal::SampleFormat::I16 => {
            let callback_tx = writer_tx.clone();
            let callback_dropped = Arc::clone(&dropped);
            device.build_input_stream(
                &stream_config,
                move |data: &[i16], _| {
                    send_audio_chunk(
                        data.iter().map(|value| *value as f32 / i16::MAX as f32).collect(),
                        &callback_tx,
                        &callback_dropped,
                    )
                },
                make_error_callback(),
                None,
            )
        }
        cpal::SampleFormat::U16 => {
            let callback_tx = writer_tx.clone();
            let callback_dropped = Arc::clone(&dropped);
            device.build_input_stream(
                &stream_config,
                move |data: &[u16], _| {
                    send_audio_chunk(
                        data.iter()
                            .map(|value| (*value as f32 / u16::MAX as f32) * 2.0 - 1.0)
                            .collect(),
                        &callback_tx,
                        &callback_dropped,
                    )
                },
                make_error_callback(),
                None,
            )
        }
        other => return Err(format!("unsupported microphone sample format: {other:?}")),
    }
    .map_err(|error| format!("could not open microphone stream for {actual_name}: {error}"))?;
    stream
        .play()
        .map_err(|error| format!("could not start microphone stream for {actual_name}: {error}"))?;

    Ok(ActiveCapture {
        stream,
        writer_tx,
        writer_thread: Some(writer_thread),
        path: path.to_path_buf(),
        sample_rate,
        channels,
        sample_format,
        dropped,
        started: Instant::now(),
    })
}

fn send_audio_chunk(samples: Vec<f32>, tx: &SyncSender<WriterMessage>, dropped: &AtomicU64) {
    match tx.try_send(WriterMessage::Samples(samples)) {
        Ok(()) => {}
        Err(TrySendError::Full(_)) | Err(TrySendError::Disconnected(_)) => {
            dropped.fetch_add(1, Ordering::Relaxed);
        }
    }
}

fn run_wav_writer(
    mut writer: hound::WavWriter<std::io::BufWriter<std::fs::File>>,
    rx: Receiver<WriterMessage>,
) -> Result<WriterSummary, String> {
    let mut samples_written = 0_u64;
    while let Ok(message) = rx.recv() {
        match message {
            WriterMessage::Samples(samples) => {
                for sample in samples {
                    writer
                        .write_sample(sample.clamp(-1.0, 1.0))
                        .map_err(|error| format!("could not write microphone WAV sample: {error}"))?;
                    samples_written = samples_written.saturating_add(1);
                }
            }
            WriterMessage::Stop => break,
        }
    }
    writer
        .finalize()
        .map_err(|error| format!("could not finalize microphone WAV: {error}"))?;
    Ok(WriterSummary { samples_written })
}

fn finish_capture(mut capture: ActiveCapture) -> Result<MicCaptureResult, String> {
    drop(capture.stream);
    let _ = capture.writer_tx.send(WriterMessage::Stop);
    let summary = capture
        .writer_thread
        .take()
        .ok_or_else(|| "microphone WAV writer thread is missing".to_string())?
        .join()
        .map_err(|_| "microphone WAV writer thread panicked".to_string())??;
    Ok(MicCaptureResult {
        path: capture.path,
        sample_rate: capture.sample_rate,
        channels: capture.channels,
        samples_written: summary.samples_written,
        chunks_dropped: capture.dropped.load(Ordering::Relaxed),
    })
}
