use crate::frame::{FrameDescriptor, VideoFrame};
use serde::{Deserialize, Serialize};
use std::{
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NdiConfig {
    pub name: String,
    pub groups: Option<String>,
    pub clock_video: bool,
    pub fps_n: u32,
    pub fps_d: u32,
    pub width: u32,
    pub height: u32,
    pub vflip: bool,
}

impl Default for NdiConfig {
    fn default() -> Self {
        Self {
            name: "Junkpile 32".into(),
            groups: None,
            clock_video: true,
            fps_n: 60,
            fps_d: 1,
            width: 1920,
            height: 1080,
            vflip: false,
        }
    }
}

impl NdiConfig {
    pub fn validate(&self, max_texture_dimension_2d: u32) -> Result<(), String> {
        if self.name.trim().is_empty() {
            return Err("NDI source name cannot be empty".into());
        }
        if self.width < 16 || self.height < 16 {
            return Err("NDI dimensions must be at least 16 × 16".into());
        }
        if self.width % 2 != 0 {
            return Err("NDI frame width must be divisible by two".into());
        }
        if self.width > max_texture_dimension_2d || self.height > max_texture_dimension_2d {
            return Err(format!(
                "{} × {} exceeds this GPU's maximum 2D texture dimension of {}",
                self.width, self.height, max_texture_dimension_2d
            ));
        }
        if self.fps_n == 0 || self.fps_d == 0 {
            return Err("NDI frame-rate numerator and denominator must be greater than zero".into());
        }
        let fps = self.fps();
        if !(1.0..=120.0).contains(&fps) {
            return Err("NDI frame rate must be between 1 and 120 fps".into());
        }
        Ok(())
    }

    pub fn fps(&self) -> f64 {
        self.fps_n as f64 / self.fps_d.max(1) as f64
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NdiStatus {
    pub feature_enabled: bool,
    pub active: bool,
    pub state: String,
    pub name: String,
    pub groups: String,
    pub clock_video: bool,
    pub vflip: bool,
    pub width: u32,
    pub height: u32,
    pub fps_n: u32,
    pub fps_d: u32,
    pub capture_requests: u64,
    pub readbacks_completed: u64,
    pub frames_sent: u64,
    pub dropped_gpu: u64,
    pub dropped_cpu_pool: u64,
    pub dropped_worker: u64,
    pub pending_worker: u64,
    pub cpu_buffers_available: u64,
    pub readback_slots_busy: u64,
    pub last_frame: u64,
    pub raw_megabytes_per_second: f64,
    pub last_error: String,
    pub last_log: String,
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

struct NdiFramePacket {
    bgra: Vec<u8>,
    frame_index: u64,
    timestamp_ns: u64,
}

#[derive(Default)]
struct WorkerText {
    last_error: String,
    last_log: String,
}

struct WorkerSignals {
    pending: AtomicU64,
    sent: AtomicU64,
    raw_bytes: AtomicU64,
    last_frame: AtomicU64,
    running: AtomicBool,
    finished: AtomicBool,
    text: Mutex<WorkerText>,
}

impl WorkerSignals {
    fn new() -> Self {
        Self {
            pending: AtomicU64::new(0),
            sent: AtomicU64::new(0),
            raw_bytes: AtomicU64::new(0),
            last_frame: AtomicU64::new(0),
            running: AtomicBool::new(false),
            finished: AtomicBool::new(false),
            text: Mutex::new(WorkerText::default()),
        }
    }

    fn set_error(&self, message: impl Into<String>) {
        if let Ok(mut text) = self.text.lock() {
            text.last_error = message.into();
        }
    }

    fn set_log(&self, message: impl Into<String>) {
        if let Ok(mut text) = self.text.lock() {
            text.last_log = message.into();
        }
    }
}

struct NdiWorker {
    tx: Option<SyncSender<NdiFramePacket>>,
    signals: Arc<WorkerSignals>,
    thread: Option<JoinHandle<()>>,
}

impl NdiWorker {
    fn spawn(
        config: NdiConfig,
        recycle_tx: SyncSender<Vec<u8>>,
        available_buffers: Arc<AtomicU64>,
    ) -> Result<Self, String> {
        #[cfg(feature = "ndi")]
        {
            let (tx, rx) = sync_channel::<NdiFramePacket>(WORKER_QUEUE_CAPACITY);
            let (startup_tx, startup_rx) = sync_channel::<Result<(), String>>(1);
            let signals = Arc::new(WorkerSignals::new());
            let worker_signals = Arc::clone(&signals);
            let thread = thread::Builder::new()
                .name("junkpile-ndi-sender".into())
                .spawn(move || {
                    run_ndi_worker(
                        rx,
                        config,
                        recycle_tx,
                        available_buffers,
                        worker_signals,
                        startup_tx,
                    )
                })
                .map_err(|error| format!("could not start NDI worker thread: {error}"))?;
            startup_rx
                .recv_timeout(Duration::from_secs(8))
                .map_err(|_| "NDI worker did not finish runtime initialization".to_string())??;
            Ok(Self {
                tx: Some(tx),
                signals,
                thread: Some(thread),
            })
        }

        #[cfg(not(feature = "ndi"))]
        {
            let _ = (config, recycle_tx, available_buffers);
            Err("this build does not include NDI; run `npm run dev` or build with Cargo feature `ndi`".into())
        }
    }

    fn try_send(&self, packet: NdiFramePacket) -> Result<(), TrySendError<NdiFramePacket>> {
        let Some(tx) = self.tx.as_ref() else {
            return Err(TrySendError::Disconnected(packet));
        };
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
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl Drop for NdiWorker {
    fn drop(&mut self) {
        self.close();
    }
}

#[cfg(feature = "ndi")]
fn run_ndi_worker(
    rx: Receiver<NdiFramePacket>,
    config: NdiConfig,
    recycle_tx: SyncSender<Vec<u8>>,
    available_buffers: Arc<AtomicU64>,
    signals: Arc<WorkerSignals>,
    startup_tx: SyncSender<Result<(), String>>,
) {
    use grafton_ndi::{
        LineStrideOrSize, NDI, PixelFormat, ScanType, Sender, SenderOptions, VideoFrame,
    };

    let ndi = match NDI::new() {
        Ok(value) => value,
        Err(error) => {
            let message = format!("failed to initialize NDI runtime: {error:?}");
            signals.set_error(&message);
            signals.finished.store(true, Ordering::Relaxed);
            let _ = startup_tx.send(Err(message));
            return;
        }
    };

    let sender_name = config.name.trim().to_string();
    let mut builder = SenderOptions::builder(&sender_name);
    if let Some(groups) = config.groups.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        builder = builder.groups(groups);
    }
    builder = builder.clock_video(config.clock_video);
    let options = builder.build();
    let sender = match Sender::new(&ndi, &options) {
        Ok(sender) => sender,
        Err(error) => {
            let message = format!("failed to create NDI sender: {error:?}");
            signals.set_error(&message);
            signals.finished.store(true, Ordering::Relaxed);
            let _ = startup_tx.send(Err(message));
            return;
        }
    };

    let mut frame = match VideoFrame::builder()
        .resolution(config.width as i32, config.height as i32)
        .pixel_format(PixelFormat::BGRA)
        .frame_rate(config.fps_n as i32, config.fps_d as i32)
        .aspect_ratio(config.width as f32 / config.height.max(1) as f32)
        .scan_type(ScanType::Progressive)
        .build()
    {
        Ok(frame) => frame,
        Err(error) => {
            let message = format!("could not build NDI video frame: {error:?}");
            signals.set_error(&message);
            signals.finished.store(true, Ordering::Relaxed);
            let _ = startup_tx.send(Err(message));
            return;
        }
    };

    signals.running.store(true, Ordering::Relaxed);
    signals.set_log(format!(
        "NDI source '{}' started at {} × {} · {}/{} fps · BGRA progressive",
        config.name, config.width, config.height, config.fps_n, config.fps_d
    ));
    let _ = startup_tx.send(Ok(()));

    while let Ok(packet) = rx.recv() {
        frame.data = packet.bgra;
        frame.line_stride_or_size =
            LineStrideOrSize::LineStrideBytes((config.width as i32).saturating_mul(4));
        sender.send_video(&frame);
        signals.pending.fetch_sub(1, Ordering::Relaxed);
        signals.sent.fetch_add(1, Ordering::Relaxed);
        signals
            .raw_bytes
            .fetch_add(frame.data.len() as u64, Ordering::Relaxed);
        signals.last_frame.store(packet.frame_index, Ordering::Relaxed);
        let _timestamp_ns = packet.timestamp_ns;
        let bytes = std::mem::take(&mut frame.data);
        available_buffers.fetch_add(1, Ordering::Relaxed);
        if recycle_tx.try_send(bytes).is_err() {
            available_buffers.fetch_sub(1, Ordering::Relaxed);
        }
    }

    signals.running.store(false, Ordering::Relaxed);
    signals.finished.store(true, Ordering::Relaxed);
    signals.set_log(format!("NDI source '{}' stopped", config.name));
}

pub struct NdiOutputSink {
    config: NdiConfig,
    descriptor: FrameDescriptor,
    readback_slots: Vec<ReadbackSlot>,
    padded_bytes_per_row: u32,
    map_tx: MpscSender<MapCompletion>,
    map_rx: Receiver<MapCompletion>,
    recycle_tx: SyncSender<Vec<u8>>,
    recycle_rx: Receiver<Vec<u8>>,
    available_buffers: Arc<AtomicU64>,
    worker: Option<NdiWorker>,
    active: bool,
    next_capture_deadline: Option<Instant>,
    capture_requests: u64,
    readbacks_completed: u64,
    dropped_gpu: u64,
    dropped_cpu_pool: u64,
    dropped_worker: u64,
    last_frame: u64,
    last_error: String,
}

impl NdiOutputSink {
    pub fn new(device: &wgpu::Device, config: NdiConfig) -> Self {
        let descriptor = FrameDescriptor::rgba_srgb(
            config.width,
            config.height,
            config.fps_n,
            config.fps_d,
        );
        let (readback_slots, padded_bytes_per_row) =
            create_readback_slots(device, config.width, config.height);
        let (map_tx, map_rx) = channel();
        let (recycle_tx, recycle_rx) = sync_channel(CPU_BUFFER_POOL_COUNT);
        let available_buffers = Arc::new(AtomicU64::new(CPU_BUFFER_POOL_COUNT as u64));
        for _ in 0..CPU_BUFFER_POOL_COUNT {
            recycle_tx
                .send(vec![0_u8; packed_frame_bytes(config.width, config.height)])
                .expect("could not initialize NDI CPU frame buffers");
        }
        Self {
            config,
            descriptor,
            readback_slots,
            padded_bytes_per_row,
            map_tx,
            map_rx,
            recycle_tx,
            recycle_rx,
            available_buffers,
            worker: None,
            active: false,
            next_capture_deadline: None,
            capture_requests: 0,
            readbacks_completed: 0,
            dropped_gpu: 0,
            dropped_cpu_pool: 0,
            dropped_worker: 0,
            last_frame: 0,
            last_error: String::new(),
        }
    }

    pub fn config(&self) -> NdiConfig {
        self.config.clone()
    }

    pub fn descriptor(&self) -> FrameDescriptor {
        self.descriptor.clone()
    }

    pub fn is_active(&self) -> bool {
        self.active
    }

    pub fn reconfigure(&mut self, device: &wgpu::Device, config: NdiConfig) -> Result<(), String> {
        if self.active {
            return Err("stop the NDI sender before changing its configuration".into());
        }
        if self
            .readback_slots
            .iter()
            .any(|slot| !matches!(slot.state, ReadbackState::Idle))
        {
            return Err("wait for the final GPU readback before changing NDI configuration".into());
        }
        self.worker.take();
        self.config = config;
        self.descriptor = FrameDescriptor::rgba_srgb(
            self.config.width,
            self.config.height,
            self.config.fps_n,
            self.config.fps_d,
        );
        let (slots, padded) =
            create_readback_slots(device, self.config.width, self.config.height);
        self.readback_slots = slots;
        self.padded_bytes_per_row = padded;
        let (recycle_tx, recycle_rx) = sync_channel(CPU_BUFFER_POOL_COUNT);
        let available = Arc::new(AtomicU64::new(CPU_BUFFER_POOL_COUNT as u64));
        for _ in 0..CPU_BUFFER_POOL_COUNT {
            recycle_tx
                .send(vec![0_u8; packed_frame_bytes(self.config.width, self.config.height)])
                .map_err(|_| "could not recreate NDI CPU buffer pool".to_string())?;
        }
        self.recycle_tx = recycle_tx;
        self.recycle_rx = recycle_rx;
        self.available_buffers = available;
        self.reset_metrics();
        Ok(())
    }

    pub fn start(&mut self) -> Result<(), String> {
        if self.active {
            return Err("NDI sender is already active".into());
        }
        let worker = NdiWorker::spawn(
            self.config.clone(),
            self.recycle_tx.clone(),
            Arc::clone(&self.available_buffers),
        )?;
        self.worker = Some(worker);
        self.active = true;
        self.next_capture_deadline = Some(Instant::now());
        self.last_error.clear();
        Ok(())
    }

    pub fn stop(&mut self) {
        self.active = false;
        self.next_capture_deadline = None;
        if let Some(mut worker) = self.worker.take() {
            worker.close();
        }
    }

    pub fn reset_metrics(&mut self) {
        self.capture_requests = 0;
        self.readbacks_completed = 0;
        self.dropped_gpu = 0;
        self.dropped_cpu_pool = 0;
        self.dropped_worker = 0;
        self.last_frame = 0;
        self.last_error.clear();
        if let Some(worker) = &self.worker {
            worker.signals.sent.store(0, Ordering::Relaxed);
            worker.signals.raw_bytes.store(0, Ordering::Relaxed);
            worker.signals.last_frame.store(0, Ordering::Relaxed);
        }
    }

    pub fn poll_completed(&mut self, device: &wgpu::Device) {
        if let Err(error) = device.poll(wgpu::PollType::Poll) {
            self.last_error = format!("GPU poll failed: {error}");
        }
        loop {
            match self.map_rx.try_recv() {
                Ok(completion) => self.handle_map_completion(completion),
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => {
                    self.last_error = "NDI GPU map completion channel disconnected".into();
                    break;
                }
            }
        }
        if self.active
            && self
                .worker
                .as_ref()
                .is_some_and(|worker| worker.signals.finished.load(Ordering::Relaxed))
        {
            self.active = false;
            self.next_capture_deadline = None;
        }
    }

    pub fn submit(&mut self, frame: &VideoFrame<'_>, encoder: &mut wgpu::CommandEncoder) {
        if !self.active || !self.should_capture() {
            return;
        }
        self.capture_requests += 1;
        let Some(slot_index) = self
            .readback_slots
            .iter()
            .position(|slot| matches!(slot.state, ReadbackState::Idle))
        else {
            self.dropped_gpu += 1;
            return;
        };
        let slot = &mut self.readback_slots[slot_index];
        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture: frame.texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer: &slot.buffer,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(self.padded_bytes_per_row),
                    rows_per_image: Some(self.descriptor.height),
                },
            },
            wgpu::Extent3d {
                width: self.descriptor.width,
                height: self.descriptor.height,
                depth_or_array_layers: 1,
            },
        );
        let tx = self.map_tx.clone();
        encoder.map_buffer_on_submit(&slot.buffer, wgpu::MapMode::Read, .., move |result| {
            let _ = tx.send(MapCompletion {
                slot_index,
                result: result.map_err(|error| format!("{error:?}")),
            });
        });
        slot.state = ReadbackState::Mapping(ReadbackMeta {
            frame_index: frame.frame_index,
            timestamp_ns: frame.timestamp_ns,
        });
    }

    pub fn status(&self) -> NdiStatus {
        let mut pending_worker = 0;
        let mut frames_sent = 0;
        let mut last_worker_frame = 0;
        let mut worker_running = false;
        let mut worker_error = String::new();
        let mut worker_log = String::new();
        if let Some(worker) = &self.worker {
            pending_worker = worker.signals.pending.load(Ordering::Relaxed);
            frames_sent = worker.signals.sent.load(Ordering::Relaxed);
            last_worker_frame = worker.signals.last_frame.load(Ordering::Relaxed);
            worker_running = worker.signals.running.load(Ordering::Relaxed);
            if let Ok(text) = worker.signals.text.lock() {
                worker_error = text.last_error.clone();
                worker_log = text.last_log.clone();
            }
        }
        let readback_slots_busy = self
            .readback_slots
            .iter()
            .filter(|slot| !matches!(slot.state, ReadbackState::Idle))
            .count() as u64;
        let raw_megabytes_per_second = packed_frame_bytes(self.config.width, self.config.height)
            as f64
            * self.config.fps()
            / (1024.0 * 1024.0);
        let last_error = if self.last_error.is_empty() {
            worker_error
        } else {
            self.last_error.clone()
        };
        let state = if !last_error.is_empty() {
            "error"
        } else if self.active && worker_running {
            "sending"
        } else if self.active {
            "starting"
        } else {
            "idle"
        };
        NdiStatus {
            feature_enabled: cfg!(feature = "ndi"),
            active: self.active,
            state: state.into(),
            name: self.config.name.clone(),
            groups: self.config.groups.clone().unwrap_or_default(),
            clock_video: self.config.clock_video,
            vflip: self.config.vflip,
            width: self.config.width,
            height: self.config.height,
            fps_n: self.config.fps_n,
            fps_d: self.config.fps_d,
            capture_requests: self.capture_requests,
            readbacks_completed: self.readbacks_completed,
            frames_sent,
            dropped_gpu: self.dropped_gpu,
            dropped_cpu_pool: self.dropped_cpu_pool,
            dropped_worker: self.dropped_worker,
            pending_worker,
            cpu_buffers_available: self.available_buffers.load(Ordering::Relaxed),
            readback_slots_busy,
            last_frame: last_worker_frame.max(self.last_frame),
            raw_megabytes_per_second,
            last_error,
            last_log: worker_log,
        }
    }

    fn should_capture(&mut self) -> bool {
        let now = Instant::now();
        let interval = Duration::from_secs_f64(1.0 / self.config.fps().max(1.0));
        match self.next_capture_deadline {
            None => {
                self.next_capture_deadline = Some(now + interval);
                true
            }
            Some(deadline) if now < deadline => false,
            Some(mut deadline) => {
                while deadline <= now {
                    deadline += interval;
                }
                self.next_capture_deadline = Some(deadline);
                true
            }
        }
    }

    fn handle_map_completion(&mut self, completion: MapCompletion) {
        let Some(slot) = self.readback_slots.get_mut(completion.slot_index) else {
            self.last_error = format!("invalid NDI readback slot {}", completion.slot_index);
            return;
        };
        let metadata = match &slot.state {
            ReadbackState::Mapping(metadata) => metadata.clone(),
            ReadbackState::Idle => {
                self.last_error = format!(
                    "NDI readback slot {} completed without a pending map",
                    completion.slot_index
                );
                return;
            }
        };
        if let Err(error) = completion.result {
            slot.state = ReadbackState::Idle;
            self.dropped_gpu += 1;
            self.last_error = format!("NDI GPU readback failed: {error}");
            return;
        }

        let mut bgra = match self.recycle_rx.try_recv() {
            Ok(buffer) => {
                self.available_buffers.fetch_sub(1, Ordering::Relaxed);
                buffer
            }
            Err(_) => {
                slot.buffer.unmap();
                slot.state = ReadbackState::Idle;
                self.dropped_cpu_pool += 1;
                return;
            }
        };
        let mapped = slot.buffer.slice(..).get_mapped_range();
        pack_rgba_to_bgra(
            &mapped,
            &mut bgra,
            self.config.width,
            self.config.height,
            self.padded_bytes_per_row,
            self.config.vflip,
        );
        drop(mapped);
        slot.buffer.unmap();
        slot.state = ReadbackState::Idle;
        self.readbacks_completed += 1;

        if !self.active {
            self.recycle_buffer(bgra);
            return;
        }
        let packet = NdiFramePacket {
            bgra,
            frame_index: metadata.frame_index,
            timestamp_ns: metadata.timestamp_ns,
        };
        let Some(worker) = self.worker.as_ref() else {
            self.dropped_worker += 1;
            self.recycle_buffer(packet.bgra);
            self.last_error = "NDI worker is unavailable".into();
            return;
        };
        match worker.try_send(packet) {
            Ok(()) => {
                self.last_frame = metadata.frame_index;
            }
            Err(TrySendError::Full(packet)) => {
                self.dropped_worker += 1;
                self.recycle_buffer(packet.bgra);
            }
            Err(TrySendError::Disconnected(packet)) => {
                self.dropped_worker += 1;
                self.recycle_buffer(packet.bgra);
                self.last_error = "NDI worker channel disconnected".into();
                self.active = false;
            }
        }
    }

    fn recycle_buffer(&self, bytes: Vec<u8>) {
        self.available_buffers.fetch_add(1, Ordering::Relaxed);
        if self.recycle_tx.try_send(bytes).is_err() {
            self.available_buffers.fetch_sub(1, Ordering::Relaxed);
        }
    }
}

impl Drop for NdiOutputSink {
    fn drop(&mut self) {
        self.stop();
    }
}

fn create_readback_slots(
    device: &wgpu::Device,
    width: u32,
    height: u32,
) -> (Vec<ReadbackSlot>, u32) {
    let packed_bytes_per_row = width.saturating_mul(BYTES_PER_PIXEL);
    let alignment = wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
    let padded_bytes_per_row = packed_bytes_per_row.div_ceil(alignment) * alignment;
    let buffer_size = u64::from(padded_bytes_per_row) * u64::from(height);
    let slots = (0..READBACK_SLOT_COUNT)
        .map(|index| ReadbackSlot {
            buffer: Arc::new(device.create_buffer(&wgpu::BufferDescriptor {
                label: Some(&format!("NDI readback slot {index}")),
                size: buffer_size,
                usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
                mapped_at_creation: false,
            })),
            state: ReadbackState::Idle,
        })
        .collect();
    (slots, padded_bytes_per_row)
}

fn packed_frame_bytes(width: u32, height: u32) -> usize {
    width as usize * height as usize * BYTES_PER_PIXEL as usize
}

fn pack_rgba_to_bgra(
    source: &[u8],
    destination: &mut [u8],
    width: u32,
    height: u32,
    padded_bytes_per_row: u32,
    vflip: bool,
) {
    let width = width as usize;
    let height = height as usize;
    let source_stride = padded_bytes_per_row as usize;
    let destination_stride = width * 4;
    for destination_y in 0..height {
        let source_y = if vflip {
            height - 1 - destination_y
        } else {
            destination_y
        };
        let source_row = &source[source_y * source_stride..source_y * source_stride + destination_stride];
        let destination_row = &mut destination
            [destination_y * destination_stride..(destination_y + 1) * destination_stride];
        for x in 0..width {
            let offset = x * 4;
            destination_row[offset] = source_row[offset + 2];
            destination_row[offset + 1] = source_row[offset + 1];
            destination_row[offset + 2] = source_row[offset];
            destination_row[offset + 3] = source_row[offset + 3];
        }
    }
}
