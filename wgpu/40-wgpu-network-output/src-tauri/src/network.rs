use crate::frame::{FrameDescriptor, VideoFrame};
use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    io::{BufRead, BufReader, Read, Write},
    net::{TcpStream, ToSocketAddrs, UdpSocket},
    process::{Child, ChildStderr, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering},
        mpsc::{channel, sync_channel, Receiver, Sender as MpscSender, SyncSender, TryRecvError, TrySendError},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

const BYTES_PER_PIXEL: u32 = 4;
const READBACK_SLOT_COUNT: usize = 3;
const CPU_BUFFER_POOL_COUNT: usize = 3;
const WORKER_QUEUE_CAPACITY: usize = 2;
const DIAGNOSTIC_LINE_LIMIT: usize = 28;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NetworkProtocol {
    UdpMpegTs,
    Rtsp,
    Rtmp,
}

impl NetworkProtocol {
    fn label(self) -> &'static str {
        match self {
            Self::UdpMpegTs => "UDP / MPEG-TS",
            Self::Rtsp => "RTSP / TCP",
            Self::Rtmp => "RTMP / FLV",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NetworkConfig {
    pub protocol: NetworkProtocol,
    pub url: String,
    pub ffmpeg_path: String,
    pub fps: u32,
    pub width: u32,
    pub height: u32,
    pub bitrate_kbps: u32,
    pub gop: u32,
    pub vflip: bool,
    pub startup_probe_ms: u64,
}

impl Default for NetworkConfig {
    fn default() -> Self {
        Self {
            protocol: NetworkProtocol::UdpMpegTs,
            url: "udp://127.0.0.1:23000?pkt_size=1316&buffer_size=1048576".into(),
            ffmpeg_path: "ffmpeg".into(),
            fps: 30,
            width: 1280,
            height: 720,
            bitrate_kbps: 8000,
            gop: 60,
            vflip: false,
            startup_probe_ms: 700,
        }
    }
}

impl NetworkConfig {
    pub fn validate(&self, max_texture_dimension_2d: u32) -> Result<(), String> {
        if self.url.trim().is_empty() {
            return Err("network destination URL cannot be empty".into());
        }
        if self.ffmpeg_path.trim().is_empty() {
            return Err("FFmpeg executable cannot be empty".into());
        }
        if self.width < 16 || self.height < 16 || self.width % 2 != 0 || self.height % 2 != 0 {
            return Err("network dimensions must be even and at least 16 × 16".into());
        }
        if self.width > max_texture_dimension_2d || self.height > max_texture_dimension_2d {
            return Err(format!(
                "{} × {} exceeds this GPU's maximum 2D texture dimension of {}",
                self.width, self.height, max_texture_dimension_2d
            ));
        }
        if !(1..=120).contains(&self.fps) {
            return Err("network frame rate must be between 1 and 120 fps".into());
        }
        if !(250..=200_000).contains(&self.bitrate_kbps) {
            return Err("video bitrate must be between 250 and 200000 kbps".into());
        }
        if self.gop == 0 || self.gop > self.fps.saturating_mul(10) {
            return Err("GOP must be greater than zero and no more than ten seconds".into());
        }
        let url = self.url.to_ascii_lowercase();
        let valid_scheme = match self.protocol {
            NetworkProtocol::UdpMpegTs => url.starts_with("udp://"),
            NetworkProtocol::Rtsp => url.starts_with("rtsp://") || url.starts_with("rtsps://"),
            NetworkProtocol::Rtmp => url.starts_with("rtmp://") || url.starts_with("rtmps://"),
        };
        if !valid_scheme {
            return Err(format!("destination URL does not match {}", self.protocol.label()));
        }
        Ok(())
    }

    pub fn receiver_url(&self) -> String {
        match self.protocol {
            NetworkProtocol::UdpMpegTs => udp_receiver_url(&self.url).unwrap_or_else(|| "udp://@:23000".into()),
            NetworkProtocol::Rtsp | NetworkProtocol::Rtmp => self.url.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkStatus {
    pub active: bool,
    pub state: String,
    pub protocol: String,
    pub publisher_url: String,
    pub receiver_url: String,
    pub server_required: bool,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub bitrate_kbps: u32,
    pub gop: u32,
    pub vflip: bool,
    pub capture_requests: u64,
    pub readbacks_completed: u64,
    pub frames_written: u64,
    pub dropped_gpu: u64,
    pub dropped_cpu_pool: u64,
    pub dropped_worker: u64,
    pub pending_worker: u64,
    pub cpu_buffers_available: u64,
    pub readback_slots_busy: u64,
    pub raw_megabytes_per_second: f64,
    pub encoded_megabytes_written: f64,
    pub ffmpeg_pid: i64,
    pub ffmpeg_exit_code: i64,
    pub last_error: String,
    pub diagnostics: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreflightReport {
    pub success: bool,
    pub protocol: String,
    pub ffmpeg_version: String,
    pub server_reachable: bool,
    pub publisher_url: String,
    pub receiver_url: String,
    pub message: String,
    pub diagnostics: String,
}

#[derive(Debug, Clone)]
struct ReadbackMeta {
    frame_index: u64,
    timestamp_ns: u64,
}

#[derive(Debug)]
enum ReadbackState {
    Idle,
    Mapping(ReadbackMeta),
}

struct ReadbackSlot {
    buffer: Arc<wgpu::Buffer>,
    state: ReadbackState,
}

struct MapCompletion {
    slot_index: usize,
    result: Result<(), String>,
}

struct NetworkFramePacket {
    rgba: Vec<u8>,
    frame_index: u64,
    timestamp_ns: u64,
}

#[derive(Default)]
struct WorkerText {
    error: String,
    lines: VecDeque<String>,
}

impl WorkerText {
    fn push(&mut self, line: impl Into<String>) {
        self.lines.push_back(line.into());
        while self.lines.len() > DIAGNOSTIC_LINE_LIMIT {
            self.lines.pop_front();
        }
    }
    fn joined(&self) -> String {
        self.lines.iter().cloned().collect::<Vec<_>>().join("\n")
    }
}

struct WorkerSignals {
    pending: AtomicU64,
    written: AtomicU64,
    raw_bytes: AtomicU64,
    last_frame: AtomicU64,
    running: AtomicBool,
    finished: AtomicBool,
    pid: AtomicI64,
    exit_code: AtomicI64,
    text: Mutex<WorkerText>,
}

impl WorkerSignals {
    fn new() -> Self {
        Self {
            pending: AtomicU64::new(0),
            written: AtomicU64::new(0),
            raw_bytes: AtomicU64::new(0),
            last_frame: AtomicU64::new(0),
            running: AtomicBool::new(false),
            finished: AtomicBool::new(false),
            pid: AtomicI64::new(-1),
            exit_code: AtomicI64::new(-1),
            text: Mutex::new(WorkerText::default()),
        }
    }
    fn push(&self, line: impl Into<String>) {
        if let Ok(mut text) = self.text.lock() { text.push(line); }
    }
    fn set_error(&self, message: impl Into<String>) {
        let message = message.into();
        if let Ok(mut text) = self.text.lock() {
            text.error = message.clone();
            text.push(message);
        }
    }
}

struct NetworkWorker {
    tx: Option<SyncSender<NetworkFramePacket>>,
    signals: Arc<WorkerSignals>,
    child: Arc<Mutex<Child>>,
    thread: Option<JoinHandle<()>>,
}

impl NetworkWorker {
    fn spawn(
        config: NetworkConfig,
        recycle_tx: SyncSender<Vec<u8>>,
        available_buffers: Arc<AtomicU64>,
    ) -> Result<Self, String> {
        let args = ffmpeg_live_args(&config);
        let signals = Arc::new(WorkerSignals::new());
        signals.push(format!("FFmpeg command: {} {}", config.ffmpeg_path, redact_args(&args).join(" ")));
        let mut command = Command::new(&config.ffmpeg_path);
        command.args(&args).stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::piped());
        let mut child = command.spawn().map_err(|error| format!(
            "could not start FFmpeg '{}': {error}", config.ffmpeg_path
        ))?;
        signals.pid.store(child.id() as i64, Ordering::Relaxed);
        let stderr = child.stderr.take().ok_or_else(|| "could not capture FFmpeg stderr".to_string())?;
        spawn_stderr_reader(stderr, Arc::clone(&signals));
        let mut stdin = child.stdin.take().ok_or_else(|| "could not open FFmpeg frame pipe".to_string())?;
        let child = Arc::new(Mutex::new(child));

        // One bootstrap frame forces FFmpeg to create the output header now. This
        // catches missing servers, authentication failures, occupied paths and
        // malformed URLs before the renderer reports an active stream.
        let bootstrap = vec![0_u8; packed_frame_bytes(config.width, config.height)];
        stdin.write_all(&bootstrap).map_err(|error| format!("FFmpeg bootstrap write failed: {error}"))?;
        stdin.flush().map_err(|error| format!("FFmpeg bootstrap flush failed: {error}"))?;
        thread::sleep(Duration::from_millis(config.startup_probe_ms.clamp(150, 3000)));
        if let Some(status) = child.lock().map_err(|_| "FFmpeg process lock poisoned".to_string())?
            .try_wait().map_err(|error| format!("could not inspect FFmpeg startup: {error}"))? {
            signals.exit_code.store(status.code().unwrap_or(-1) as i64, Ordering::Relaxed);
            let diagnostics = worker_diagnostics(&signals);
            return Err(format!("FFmpeg rejected the destination during startup ({status}). {diagnostics}"));
        }

        let (tx, rx) = sync_channel::<NetworkFramePacket>(WORKER_QUEUE_CAPACITY);
        let worker_signals = Arc::clone(&signals);
        let worker_child = Arc::clone(&child);
        let thread = thread::Builder::new()
            .name("junkpile-network-output-worker".into())
            .spawn(move || run_worker(rx, stdin, worker_child, recycle_tx, available_buffers, worker_signals))
            .map_err(|error| format!("could not start network writer thread: {error}"))?;
        signals.running.store(true, Ordering::Relaxed);
        signals.push(format!("{} active: {}", config.protocol.label(), config.url));
        Ok(Self { tx: Some(tx), signals, child, thread: Some(thread) })
    }

    fn try_send(&self, packet: NetworkFramePacket) -> Result<(), TrySendError<NetworkFramePacket>> {
        let Some(tx) = self.tx.as_ref() else { return Err(TrySendError::Disconnected(packet)); };
        self.signals.pending.fetch_add(1, Ordering::Relaxed);
        match tx.try_send(packet) {
            Ok(()) => Ok(()),
            Err(error) => {
                self.signals.pending.fetch_sub(1, Ordering::Relaxed);
                Err(error)
            }
        }
    }

    fn close(&mut self) {
        self.tx.take();
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
        }
        if let Some(thread) = self.thread.take() { let _ = thread.join(); }
        if let Ok(mut child) = self.child.lock() { let _ = child.wait(); }
        self.signals.running.store(false, Ordering::Relaxed);
    }
}

impl Drop for NetworkWorker { fn drop(&mut self) { self.close(); } }

fn run_worker(
    rx: Receiver<NetworkFramePacket>,
    mut stdin: impl Write,
    child: Arc<Mutex<Child>>,
    recycle_tx: SyncSender<Vec<u8>>,
    available_buffers: Arc<AtomicU64>,
    signals: Arc<WorkerSignals>,
) {
    while let Ok(packet) = rx.recv() {
        let exited = child.lock().ok().and_then(|mut value| value.try_wait().ok().flatten());
        if let Some(status) = exited {
            signals.exit_code.store(status.code().unwrap_or(-1) as i64, Ordering::Relaxed);
            signals.set_error(format!("FFmpeg exited before frame {} with {status}", packet.frame_index));
            recycle(packet.rgba, &recycle_tx, &available_buffers);
            signals.pending.fetch_sub(1, Ordering::Relaxed);
            break;
        }
        match stdin.write_all(&packet.rgba) {
            Ok(()) => {
                signals.written.fetch_add(1, Ordering::Relaxed);
                signals.raw_bytes.fetch_add(packet.rgba.len() as u64, Ordering::Relaxed);
                signals.last_frame.store(packet.frame_index, Ordering::Relaxed);
                let _ = packet.timestamp_ns;
            }
            Err(error) => {
                signals.set_error(format!("FFmpeg frame pipe failed at frame {}: {error}", packet.frame_index));
                recycle(packet.rgba, &recycle_tx, &available_buffers);
                signals.pending.fetch_sub(1, Ordering::Relaxed);
                break;
            }
        }
        recycle(packet.rgba, &recycle_tx, &available_buffers);
        signals.pending.fetch_sub(1, Ordering::Relaxed);
    }
    signals.running.store(false, Ordering::Relaxed);
    signals.finished.store(true, Ordering::Relaxed);
    signals.push("network writer stopped");
}

fn recycle(bytes: Vec<u8>, recycle_tx: &SyncSender<Vec<u8>>, available: &AtomicU64) {
    available.fetch_add(1, Ordering::Relaxed);
    if recycle_tx.try_send(bytes).is_err() { available.fetch_sub(1, Ordering::Relaxed); }
}

pub struct NetworkOutputSink {
    config: NetworkConfig,
    descriptor: FrameDescriptor,
    readback_slots: Vec<ReadbackSlot>,
    padded_bytes_per_row: u32,
    map_tx: MpscSender<MapCompletion>,
    map_rx: Receiver<MapCompletion>,
    recycle_tx: SyncSender<Vec<u8>>,
    recycle_rx: Receiver<Vec<u8>>,
    available_buffers: Arc<AtomicU64>,
    worker: Option<NetworkWorker>,
    active: bool,
    next_capture_deadline: Option<Instant>,
    capture_requests: u64,
    readbacks_completed: u64,
    dropped_gpu: u64,
    dropped_cpu_pool: u64,
    dropped_worker: u64,
    last_error: String,
}

impl NetworkOutputSink {
    pub fn new(device: &wgpu::Device, config: NetworkConfig) -> Self {
        let descriptor = FrameDescriptor::rgba_srgb(config.width, config.height, config.fps, 1);
        let (readback_slots, padded_bytes_per_row) = create_readback_slots(device, config.width, config.height);
        let (map_tx, map_rx) = channel();
        let (recycle_tx, recycle_rx) = sync_channel(CPU_BUFFER_POOL_COUNT);
        let available_buffers = Arc::new(AtomicU64::new(CPU_BUFFER_POOL_COUNT as u64));
        for _ in 0..CPU_BUFFER_POOL_COUNT {
            recycle_tx.send(vec![0_u8; packed_frame_bytes(config.width, config.height)])
                .expect("could not initialize network CPU frame buffers");
        }
        Self { config, descriptor, readback_slots, padded_bytes_per_row, map_tx, map_rx,
            recycle_tx, recycle_rx, available_buffers, worker: None, active: false,
            next_capture_deadline: None, capture_requests: 0, readbacks_completed: 0,
            dropped_gpu: 0, dropped_cpu_pool: 0, dropped_worker: 0, last_error: String::new() }
    }

    pub fn descriptor(&self) -> FrameDescriptor { self.descriptor.clone() }
    pub fn is_active(&self) -> bool { self.active }

    pub fn reconfigure(&mut self, device: &wgpu::Device, config: NetworkConfig) -> Result<(), String> {
        if self.active { return Err("stop network output before changing configuration".into()); }
        if self.readback_slots.iter().any(|slot| !matches!(slot.state, ReadbackState::Idle)) {
            return Err("wait for the final GPU readback before reconfiguring network output".into());
        }
        self.worker.take();
        self.config = config;
        self.descriptor = FrameDescriptor::rgba_srgb(self.config.width, self.config.height, self.config.fps, 1);
        let (slots, padded) = create_readback_slots(device, self.config.width, self.config.height);
        self.readback_slots = slots;
        self.padded_bytes_per_row = padded;
        let (recycle_tx, recycle_rx) = sync_channel(CPU_BUFFER_POOL_COUNT);
        let available = Arc::new(AtomicU64::new(CPU_BUFFER_POOL_COUNT as u64));
        for _ in 0..CPU_BUFFER_POOL_COUNT {
            recycle_tx.send(vec![0_u8; packed_frame_bytes(self.config.width, self.config.height)])
                .map_err(|_| "could not recreate network CPU buffer pool".to_string())?;
        }
        self.recycle_tx = recycle_tx;
        self.recycle_rx = recycle_rx;
        self.available_buffers = available;
        self.reset_metrics();
        Ok(())
    }

    pub fn start(&mut self) -> Result<(), String> {
        if self.active { return Err("network output is already active".into()); }
        // A previous FFmpeg process may have exited on its own. Tear it down
        // before starting a replacement so the old process cannot retain the
        // publish path or its stderr reader.
        if let Some(mut previous) = self.worker.take() {
            previous.close();
        }
        let worker = NetworkWorker::spawn(self.config.clone(), self.recycle_tx.clone(), Arc::clone(&self.available_buffers))?;
        self.worker = Some(worker);
        self.active = true;
        self.next_capture_deadline = Some(Instant::now());
        self.last_error.clear();
        Ok(())
    }

    pub fn stop(&mut self) {
        self.active = false;
        self.next_capture_deadline = None;
        if let Some(mut worker) = self.worker.take() { worker.close(); }
    }

    pub fn reset_metrics(&mut self) {
        self.capture_requests = 0;
        self.readbacks_completed = 0;
        self.dropped_gpu = 0;
        self.dropped_cpu_pool = 0;
        self.dropped_worker = 0;
        self.last_error.clear();
        if let Some(worker) = &self.worker {
            worker.signals.written.store(0, Ordering::Relaxed);
            worker.signals.raw_bytes.store(0, Ordering::Relaxed);
            worker.signals.last_frame.store(0, Ordering::Relaxed);
        }
    }

    pub fn poll_completed(&mut self, device: &wgpu::Device) {
        if let Err(error) = device.poll(wgpu::PollType::Poll) { self.last_error = format!("GPU poll failed: {error}"); }
        loop {
            match self.map_rx.try_recv() {
                Ok(completion) => self.handle_map_completion(completion),
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => { self.last_error = "network GPU map completion channel disconnected".into(); break; }
            }
        }
        if self.active && self.worker.as_ref().is_some_and(|worker| worker.signals.finished.load(Ordering::Relaxed)) {
            self.active = false;
            self.next_capture_deadline = None;
        }
    }

    pub fn submit(&mut self, frame: &VideoFrame<'_>, encoder: &mut wgpu::CommandEncoder) {
        if !self.active || !self.should_capture() { return; }
        self.capture_requests += 1;
        let Some(slot_index) = self.readback_slots.iter().position(|slot| matches!(slot.state, ReadbackState::Idle)) else {
            self.dropped_gpu += 1; return;
        };
        let slot = &mut self.readback_slots[slot_index];
        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo { texture: frame.texture, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
            wgpu::TexelCopyBufferInfo { buffer: &slot.buffer, layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(self.padded_bytes_per_row), rows_per_image: Some(self.descriptor.height) } },
            wgpu::Extent3d { width: self.descriptor.width, height: self.descriptor.height, depth_or_array_layers: 1 },
        );
        let tx = self.map_tx.clone();
        encoder.map_buffer_on_submit(&slot.buffer, wgpu::MapMode::Read, .., move |result| {
            let _ = tx.send(MapCompletion { slot_index, result: result.map_err(|error| format!("{error:?}")) });
        });
        slot.state = ReadbackState::Mapping(ReadbackMeta { frame_index: frame.frame_index, timestamp_ns: frame.timestamp_ns });
    }

    pub fn status(&self) -> NetworkStatus {
        let mut pending = 0;
        let mut written = 0;
        let mut raw_bytes = 0;
        let mut running = false;
        let mut pid = -1;
        let mut exit_code = -1;
        let mut error = String::new();
        let mut diagnostics = String::new();
        if let Some(worker) = &self.worker {
            pending = worker.signals.pending.load(Ordering::Relaxed);
            written = worker.signals.written.load(Ordering::Relaxed);
            raw_bytes = worker.signals.raw_bytes.load(Ordering::Relaxed);
            running = worker.signals.running.load(Ordering::Relaxed);
            pid = worker.signals.pid.load(Ordering::Relaxed);
            exit_code = worker.signals.exit_code.load(Ordering::Relaxed);
            if let Ok(text) = worker.signals.text.lock() { error = text.error.clone(); diagnostics = text.joined(); }
        }
        if !self.last_error.is_empty() { error = self.last_error.clone(); }
        let state = if !error.is_empty() { "error" } else if self.active && running { "sending" } else if self.active { "starting" } else { "idle" };
        NetworkStatus {
            active: self.active,
            state: state.into(),
            protocol: self.config.protocol.label().into(),
            publisher_url: redact_url(&self.config.url),
            receiver_url: redact_url(&self.config.receiver_url()),
            server_required: !matches!(self.config.protocol, NetworkProtocol::UdpMpegTs),
            width: self.config.width,
            height: self.config.height,
            fps: self.config.fps,
            bitrate_kbps: self.config.bitrate_kbps,
            gop: self.config.gop,
            vflip: self.config.vflip,
            capture_requests: self.capture_requests,
            readbacks_completed: self.readbacks_completed,
            frames_written: written,
            dropped_gpu: self.dropped_gpu,
            dropped_cpu_pool: self.dropped_cpu_pool,
            dropped_worker: self.dropped_worker,
            pending_worker: pending,
            cpu_buffers_available: self.available_buffers.load(Ordering::Relaxed),
            readback_slots_busy: self.readback_slots.iter().filter(|slot| !matches!(slot.state, ReadbackState::Idle)).count() as u64,
            raw_megabytes_per_second: packed_frame_bytes(self.config.width, self.config.height) as f64 * self.config.fps as f64 / (1024.0 * 1024.0),
            encoded_megabytes_written: raw_bytes as f64 / (1024.0 * 1024.0),
            ffmpeg_pid: pid,
            ffmpeg_exit_code: exit_code,
            last_error: error,
            diagnostics,
        }
    }

    fn should_capture(&mut self) -> bool {
        let now = Instant::now();
        let interval = Duration::from_secs_f64(1.0 / self.config.fps.max(1) as f64);
        match self.next_capture_deadline {
            None => { self.next_capture_deadline = Some(now + interval); true }
            Some(deadline) if now < deadline => false,
            Some(mut deadline) => { while deadline <= now { deadline += interval; } self.next_capture_deadline = Some(deadline); true }
        }
    }

    fn handle_map_completion(&mut self, completion: MapCompletion) {
        let Some(slot) = self.readback_slots.get_mut(completion.slot_index) else { self.last_error = format!("invalid network readback slot {}", completion.slot_index); return; };
        let metadata = match &slot.state {
            ReadbackState::Mapping(metadata) => metadata.clone(),
            ReadbackState::Idle => { self.last_error = format!("network readback slot {} completed while idle", completion.slot_index); return; }
        };
        if let Err(error) = completion.result {
            slot.state = ReadbackState::Idle;
            self.dropped_gpu += 1;
            self.last_error = format!("network GPU readback failed: {error}");
            return;
        }
        let mut rgba = match self.recycle_rx.try_recv() {
            Ok(buffer) => { self.available_buffers.fetch_sub(1, Ordering::Relaxed); buffer }
            Err(_) => { slot.buffer.unmap(); slot.state = ReadbackState::Idle; self.dropped_cpu_pool += 1; return; }
        };
        let mapped = slot.buffer.slice(..).get_mapped_range();
        pack_rgba(&mapped, &mut rgba, self.config.width, self.config.height, self.padded_bytes_per_row, self.config.vflip);
        drop(mapped);
        slot.buffer.unmap();
        slot.state = ReadbackState::Idle;
        self.readbacks_completed += 1;
        if !self.active { recycle(rgba, &self.recycle_tx, &self.available_buffers); return; }
        let packet = NetworkFramePacket { rgba, frame_index: metadata.frame_index, timestamp_ns: metadata.timestamp_ns };
        let Some(worker) = self.worker.as_ref() else { self.dropped_worker += 1; recycle(packet.rgba, &self.recycle_tx, &self.available_buffers); self.last_error = "network worker unavailable".into(); return; };
        match worker.try_send(packet) {
            Ok(()) => {}
            Err(TrySendError::Full(packet)) => { self.dropped_worker += 1; recycle(packet.rgba, &self.recycle_tx, &self.available_buffers); }
            Err(TrySendError::Disconnected(packet)) => { self.dropped_worker += 1; recycle(packet.rgba, &self.recycle_tx, &self.available_buffers); self.last_error = format!("network worker stopped. {}", worker_diagnostics(&worker.signals)); self.active = false; }
        }
    }
}

impl Drop for NetworkOutputSink { fn drop(&mut self) { self.stop(); } }

pub fn preflight(config: &NetworkConfig) -> PreflightReport {
    if let Err(error) = config.validate(u32::MAX) {
        return PreflightReport {
            success: false,
            protocol: config.protocol.label().into(),
            ffmpeg_version: String::new(),
            server_reachable: false,
            publisher_url: redact_url(&config.url),
            receiver_url: redact_url(&config.receiver_url()),
            message: "configuration validation failed".into(),
            diagnostics: error,
        };
    }
    let version = ffmpeg_version(&config.ffmpeg_path);
    if let Err(error) = &version {
        return PreflightReport { success: false, protocol: config.protocol.label().into(), ffmpeg_version: String::new(), server_reachable: false, publisher_url: redact_url(&config.url), receiver_url: redact_url(&config.receiver_url()), message: "FFmpeg preflight failed".into(), diagnostics: error.clone() };
    }
    match config.protocol {
        NetworkProtocol::UdpMpegTs => preflight_udp(config, version.unwrap_or_default()),
        NetworkProtocol::Rtsp | NetworkProtocol::Rtmp => preflight_server(config, version.unwrap_or_default()),
    }
}

fn preflight_udp(config: &NetworkConfig, version: String) -> PreflightReport {
    let receiver = config.receiver_url();
    let port = udp_port(&config.url).unwrap_or(23000);
    let listener = UdpSocket::bind(("127.0.0.1", port));
    let Ok(listener) = listener else {
        return PreflightReport { success: false, protocol: config.protocol.label().into(), ffmpeg_version: version, server_reachable: false, publisher_url: redact_url(&config.url), receiver_url: receiver, message: "UDP loopback port is already occupied; close the current receiver or choose another port".into(), diagnostics: format!("could not bind UDP receiver on 127.0.0.1:{port}") };
    };
    let _ = listener.set_read_timeout(Some(Duration::from_secs(4)));
    let sender_url = format!("udp://127.0.0.1:{port}?pkt_size=1316&buffer_size=1048576");
    let args = ffmpeg_test_args(config, &sender_url);
    let mut child = match Command::new(&config.ffmpeg_path).args(&args).stdout(Stdio::null()).stderr(Stdio::piped()).spawn() {
        Ok(child) => child,
        Err(error) => return PreflightReport { success: false, protocol: config.protocol.label().into(), ffmpeg_version: version, server_reachable: false, publisher_url: redact_url(&config.url), receiver_url: receiver, message: "could not start UDP preflight".into(), diagnostics: error.to_string() },
    };
    let mut packet = [0_u8; 2048];
    let received = listener.recv_from(&mut packet).map(|(size, _)| size).unwrap_or(0);
    let _ = child.kill(); let output = child.wait_with_output().ok();
    let diagnostics = output.map(|value| String::from_utf8_lossy(&value.stderr).into_owned()).unwrap_or_default();
    let success = received > 0;
    PreflightReport { success, protocol: config.protocol.label().into(), ffmpeg_version: version, server_reachable: success, publisher_url: redact_url(&config.url), receiver_url: receiver, message: if success { format!("UDP loopback received {received} bytes; sender and local socket path are working") } else { "UDP loopback did not receive a packet".into() }, diagnostics }
}

fn preflight_server(config: &NetworkConfig, version: String) -> PreflightReport {
    let authority = parse_authority(&config.url, match config.protocol { NetworkProtocol::Rtsp => 554, NetworkProtocol::Rtmp => 1935, _ => 0 });
    let (host, port) = match authority {
        Ok(value) => value,
        Err(error) => return PreflightReport { success: false, protocol: config.protocol.label().into(), ffmpeg_version: version, server_reachable: false, publisher_url: redact_url(&config.url), receiver_url: redact_url(&config.receiver_url()), message: "destination URL could not be parsed".into(), diagnostics: error },
    };
    let address = format!("{host}:{port}");
    let reachable = address.to_socket_addrs().ok().and_then(|mut values| values.next()).and_then(|addr| TcpStream::connect_timeout(&addr, Duration::from_secs(2)).ok()).is_some();
    if !reachable {
        return PreflightReport { success: false, protocol: config.protocol.label().into(), ffmpeg_version: version, server_reachable: false, publisher_url: redact_url(&config.url), receiver_url: redact_url(&config.receiver_url()), message: format!("no server accepted a TCP connection at {address}"), diagnostics: "Start the RTSP/RTMP server before publishing. VLC is a reader, not the ingest server.".into() };
    }
    let args = ffmpeg_test_args(config, &config.url);
    let (success, diagnostics) = run_with_timeout(&config.ffmpeg_path, &args, Duration::from_secs(7));
    if success {
        // Give the server a brief moment to retire the synthetic publisher
        // before the real sender claims the same path.
        thread::sleep(Duration::from_millis(300));
    }
    PreflightReport { success, protocol: config.protocol.label().into(), ffmpeg_version: version, server_reachable: true, publisher_url: redact_url(&config.url), receiver_url: redact_url(&config.receiver_url()), message: if success { "FFmpeg published a short synthetic stream successfully; the endpoint is ready".into() } else { "server accepted TCP but rejected the FFmpeg publish request".into() }, diagnostics }
}

pub fn launch_vlc(config: &NetworkConfig) -> Result<String, String> {
    let url = config.receiver_url();
    #[cfg(target_os = "macos")]
    {
        Command::new("open").args(["-na", "VLC", "--args", "--network-caching=120", "--clock-jitter=0", &url]).spawn().map_err(|error| format!("could not launch VLC: {error}"))?;
    }
    #[cfg(target_os = "windows")]
    {
        let candidates = [r"C:\Program Files\VideoLAN\VLC\vlc.exe", r"C:\Program Files (x86)\VideoLAN\VLC\vlc.exe"];
        let path = candidates
            .iter()
            .copied()
            .find(|path| std::path::Path::new(path).exists())
            .ok_or_else(|| "VLC executable was not found in Program Files".to_string())?;
        Command::new(path).args(["--network-caching=120", &url]).spawn().map_err(|error| format!("could not launch VLC: {error}"))?;
    }
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        Command::new("vlc").args(["--network-caching=120", &url]).spawn().map_err(|error| format!("could not launch VLC: {error}"))?;
    }
    Ok(url)
}

fn ffmpeg_live_args(config: &NetworkConfig) -> Vec<String> {
    let mut args = vec![
        "-hide_banner".into(),
        "-loglevel".into(),
        "warning".into(),
        "-f".into(),
        "rawvideo".into(),
        "-pix_fmt".into(),
        "rgba".into(),
        "-video_size".into(),
        format!("{}x{}", config.width, config.height),
        "-framerate".into(),
        config.fps.to_string(),
        "-i".into(),
        "pipe:0".into(),
    ];
    if config.vflip {
        args.extend(["-vf".into(), "vflip".into()]);
    }
    args.extend([
        "-an".into(),
        "-c:v".into(),
        "libx264".into(),
        "-preset".into(),
        "veryfast".into(),
        "-tune".into(),
        "zerolatency".into(),
        "-pix_fmt".into(),
        "yuv420p".into(),
        "-bf".into(),
        "0".into(),
        "-flags".into(),
        "+low_delay".into(),
        "-g".into(),
        config.gop.to_string(),
        "-keyint_min".into(),
        config.gop.to_string(),
        "-sc_threshold".into(),
        "0".into(),
        "-b:v".into(),
        format!("{}k", config.bitrate_kbps),
        "-maxrate".into(),
        format!("{}k", config.bitrate_kbps),
        "-bufsize".into(),
        format!("{}k", config.bitrate_kbps.saturating_div(2).max(250)),
    ]);
    match config.protocol {
        NetworkProtocol::UdpMpegTs => args.extend([
            "-flush_packets".into(),
            "1".into(),
            "-muxdelay".into(),
            "0".into(),
            "-muxpreload".into(),
            "0".into(),
            "-mpegts_flags".into(),
            "+resend_headers".into(),
            "-f".into(),
            "mpegts".into(),
            config.url.clone(),
        ]),
        NetworkProtocol::Rtsp => args.extend([
            "-f".into(),
            "rtsp".into(),
            "-rtsp_transport".into(),
            "tcp".into(),
            "-muxdelay".into(),
            "0.1".into(),
            config.url.clone(),
        ]),
        NetworkProtocol::Rtmp => args.extend([
            "-f".into(),
            "flv".into(),
            config.url.clone(),
        ]),
    }
    args
}

fn ffmpeg_test_args(config: &NetworkConfig, url: &str) -> Vec<String> {
    let mut args = vec![
        "-hide_banner".into(),
        "-loglevel".into(),
        "warning".into(),
        "-f".into(),
        "lavfi".into(),
        "-i".into(),
        "color=c=black:s=320x180:r=10".into(),
        "-t".into(),
        "0.8".into(),
        "-an".into(),
        "-c:v".into(),
        "libx264".into(),
        "-preset".into(),
        "ultrafast".into(),
        "-tune".into(),
        "zerolatency".into(),
        "-pix_fmt".into(),
        "yuv420p".into(),
        "-bf".into(),
        "0".into(),
        "-flags".into(),
        "+low_delay".into(),
        "-g".into(),
        "10".into(),
    ];
    match config.protocol {
        NetworkProtocol::UdpMpegTs => args.extend([
            "-flush_packets".into(),
            "1".into(),
            "-muxdelay".into(),
            "0".into(),
            "-muxpreload".into(),
            "0".into(),
            "-mpegts_flags".into(),
            "+resend_headers".into(),
            "-f".into(),
            "mpegts".into(),
            url.into(),
        ]),
        NetworkProtocol::Rtsp => args.extend([
            "-f".into(),
            "rtsp".into(),
            "-rtsp_transport".into(),
            "tcp".into(),
            "-muxdelay".into(),
            "0.1".into(),
            url.into(),
        ]),
        NetworkProtocol::Rtmp => args.extend([
            "-f".into(),
            "flv".into(),
            url.into(),
        ]),
    }
    args
}

fn run_with_timeout(executable: &str, args: &[String], timeout: Duration) -> (bool, String) {
    let mut child = match Command::new(executable).args(args).stdout(Stdio::null()).stderr(Stdio::piped()).spawn() {
        Ok(child) => child,
        Err(error) => return (false, error.to_string()),
    };
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let mut diagnostics = String::new();
                if let Some(mut stderr) = child.stderr.take() { let _ = stderr.read_to_string(&mut diagnostics); }
                return (status.success(), diagnostics);
            }
            Ok(None) if started.elapsed() < timeout => thread::sleep(Duration::from_millis(50)),
            Ok(None) => {
                let _ = child.kill(); let _ = child.wait();
                return (false, "FFmpeg preflight timed out".into());
            }
            Err(error) => return (false, error.to_string()),
        }
    }
}

fn spawn_stderr_reader(stderr: ChildStderr, signals: Arc<WorkerSignals>) {
    let _ = thread::Builder::new().name("junkpile-network-ffmpeg-stderr".into()).spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            signals.push(line);
        }
    });
}

fn worker_diagnostics(signals: &WorkerSignals) -> String {
    signals.text.lock().map(|text| text.joined()).unwrap_or_else(|_| "FFmpeg diagnostics unavailable".into())
}

fn ffmpeg_version(executable: &str) -> Result<String, String> {
    let output = Command::new(executable).arg("-version").output().map_err(|error| format!("could not launch FFmpeg: {error}"))?;
    if !output.status.success() { return Err(format!("FFmpeg installation is broken: {}", String::from_utf8_lossy(&output.stderr))); }
    Ok(String::from_utf8_lossy(&output.stdout).lines().next().unwrap_or("FFmpeg available").to_string())
}

fn create_readback_slots(device: &wgpu::Device, width: u32, height: u32) -> (Vec<ReadbackSlot>, u32) {
    let packed = width.saturating_mul(BYTES_PER_PIXEL);
    let alignment = wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
    let padded = packed.div_ceil(alignment) * alignment;
    let size = u64::from(padded) * u64::from(height);
    let slots = (0..READBACK_SLOT_COUNT).map(|index| ReadbackSlot {
        buffer: Arc::new(device.create_buffer(&wgpu::BufferDescriptor { label: Some(&format!("network readback slot {index}")), size, usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ, mapped_at_creation: false })),
        state: ReadbackState::Idle,
    }).collect();
    (slots, padded)
}

fn pack_rgba(source: &[u8], destination: &mut [u8], width: u32, height: u32, padded: u32, vflip: bool) {
    let row = width as usize * 4;
    for y in 0..height as usize {
        let sy = if vflip { height as usize - 1 - y } else { y };
        let src = &source[sy * padded as usize..sy * padded as usize + row];
        destination[y * row..(y + 1) * row].copy_from_slice(src);
    }
}

fn packed_frame_bytes(width: u32, height: u32) -> usize { width as usize * height as usize * BYTES_PER_PIXEL as usize }

fn udp_port(url: &str) -> Option<u16> {
    let authority = url.split("//").nth(1)?.split(['/', '?']).next()?;
    authority.rsplit_once(':')?.1.parse().ok()
}
fn udp_receiver_url(url: &str) -> Option<String> { Some(format!("udp://@:{}", udp_port(url)?)) }

fn parse_authority(url: &str, default_port: u16) -> Result<(String, u16), String> {
    let after_scheme = url.split_once("//").map(|(_, value)| value).ok_or_else(|| "URL is missing //".to_string())?;
    let authority = after_scheme.split('/').next().unwrap_or(after_scheme);
    let authority = authority.rsplit('@').next().unwrap_or(authority);
    if authority.starts_with('[') {
        let end = authority.find(']').ok_or_else(|| "invalid IPv6 URL".to_string())?;
        let host = authority[1..end].to_string();
        let port = authority[end + 1..].strip_prefix(':').and_then(|value| value.parse().ok()).unwrap_or(default_port);
        return Ok((host, port));
    }
    if let Some((host, port)) = authority.rsplit_once(':') {
        if let Ok(port) = port.parse() { return Ok((host.to_string(), port)); }
    }
    Ok((authority.to_string(), default_port))
}

fn redact_url(url: &str) -> String {
    if let Some((scheme, rest)) = url.split_once("//") {
        if let Some((_, tail)) = rest.split_once('@') { return format!("{scheme}//***@{tail}"); }
    }
    url.to_string()
}
fn redact_args(args: &[String]) -> Vec<String> { args.iter().map(|value| if value.contains("://") { redact_url(value) } else { value.clone() }).collect() }
