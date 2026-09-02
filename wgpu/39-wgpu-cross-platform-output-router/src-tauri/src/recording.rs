use crate::{
    frame::FrameDescriptor,
    output::{FrameSink, SinkContext, SubmitResult},
};
use serde::Serialize;
use std::{
    collections::VecDeque,
    env,
    fs,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc::{channel, sync_channel, Receiver, Sender, SyncSender, TryRecvError, TrySendError},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const STANDARD_READBACK_SLOT_COUNT: usize = 2;
const HIGH_RES_READBACK_SLOT_COUNT: usize = 3;
const WORKER_QUEUE_CAPACITY: usize = 2;
const CPU_BUFFER_POOL_COUNT: usize = WORKER_QUEUE_CAPACITY + 1;
const PACKER_QUEUE_CAPACITY: usize = HIGH_RES_READBACK_SLOT_COUNT;
const TIMING_WINDOW_CAPACITY: usize = 240;
const BYTES_PER_PIXEL: u32 = 4;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RecordingProfile {
    H264,
    ProRes,
}

impl RecordingProfile {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value.to_ascii_lowercase().as_str() {
            "h264" | "mp4" => Ok(Self::H264),
            "prores" | "mov" => Ok(Self::ProRes),
            _ => Err(format!("unknown recording profile: {value}")),
        }
    }

    fn extension(self) -> &'static str {
        match self {
            Self::H264 => "mp4",
            Self::ProRes => "mov",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::H264 => "H.264 / MP4",
            Self::ProRes => "ProRes 422 HQ / MOV",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RecordingState {
    Idle,
    Recording,
    Finalizing,
    Complete,
    Error,
}

#[derive(Debug, Clone, Copy, Default)]
struct TimingStats {
    average_ms: f64,
    p50_ms: f64,
    p95_ms: f64,
    maximum_ms: f64,
}

#[derive(Default)]
struct TimingWindow {
    samples: VecDeque<f64>,
}

impl TimingWindow {
    fn clear(&mut self) {
        self.samples.clear();
    }

    fn push(&mut self, value_ms: f64) {
        if !value_ms.is_finite() || value_ms < 0.0 {
            return;
        }
        if self.samples.len() >= TIMING_WINDOW_CAPACITY {
            self.samples.pop_front();
        }
        self.samples.push_back(value_ms);
    }

    fn stats(&self) -> TimingStats {
        if self.samples.is_empty() {
            return TimingStats::default();
        }
        let mut values: Vec<f64> = self.samples.iter().copied().collect();
        values.sort_by(|a, b| a.total_cmp(b));
        let percentile = |ratio: f64| -> f64 {
            let index = ((values.len().saturating_sub(1)) as f64 * ratio).round() as usize;
            values[index.min(values.len() - 1)]
        };
        TimingStats {
            average_ms: values.iter().sum::<f64>() / values.len() as f64,
            p50_ms: percentile(0.50),
            p95_ms: percentile(0.95),
            maximum_ms: *values.last().unwrap_or(&0.0),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegInfo {
    pub available: bool,
    pub executable: String,
    pub version: String,
    pub error: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingStatus {
    pub id: String,
    pub name: String,
    pub state: RecordingState,
    pub profile: String,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub stage_frames: u64,
    pub capture_requests: u64,
    pub readbacks_completed: u64,
    pub encoded_frames: u64,
    pub dropped_gpu: u64,
    pub dropped_worker: u64,
    pub dropped_total: u64,
    pub pending_worker: u64,
    pub readback_slots_busy: u64,
    pub raw_bytes_written: u64,
    pub output_bytes: u64,
    pub elapsed_seconds: f64,
    pub output_path: String,
    pub ffmpeg_log: String,
    pub verification: String,
    pub last_error: String,
    pub worker_delay_ms: u64,
    pub readback_slot_count: u64,
    pub worker_queue_capacity: u64,
    pub packed_frame_bytes: u64,
    pub padded_frame_bytes: u64,
    pub estimated_gpu_bytes: u64,
    pub estimated_cpu_queue_bytes: u64,
    pub estimated_peak_bytes: u64,
    pub raw_megabytes_per_second: f64,
    pub output_directory: String,
    pub wall_elapsed_seconds: f64,
    pub output_timeline_seconds: f64,
    pub expected_capture_frames: u64,
    pub schedule_shortfall_frames: u64,
    pub capture_rate_fps: f64,
    pub readback_rate_fps: f64,
    pub encode_rate_fps: f64,
    pub actual_raw_megabytes_per_second: f64,
    pub queue_utilization_percent: f64,
    pub drop_rate_percent: f64,
    pub delivery_percent: f64,
    pub diagnostic_state: String,
    pub diagnostic_detail: String,
    pub dropped_packer: u64,
    pub cpu_buffers_available: u64,
    pub cpu_buffer_pool_count: u64,
    pub capture_interval_average_ms: f64,
    pub capture_interval_p50_ms: f64,
    pub capture_interval_p95_ms: f64,
    pub capture_interval_max_ms: f64,
    pub capture_jitter_p95_ms: f64,
    pub map_latency_average_ms: f64,
    pub map_latency_p95_ms: f64,
    pub map_latency_max_ms: f64,
    pub pack_latency_average_ms: f64,
    pub pack_latency_p95_ms: f64,
    pub pack_latency_max_ms: f64,
    pub ffmpeg_write_average_ms: f64,
    pub ffmpeg_write_p95_ms: f64,
    pub ffmpeg_write_max_ms: f64,
}

#[derive(Clone)]
struct ReadbackMeta {
    session_id: u64,
    frame_index: u64,
    timestamp_ns: u64,
    map_started_at: Instant,
}

enum ReadbackState {
    Idle,
    Mapping(ReadbackMeta),
    Packing(ReadbackMeta),
}

struct ReadbackSlot {
    buffer: Arc<wgpu::Buffer>,
    state: ReadbackState,
}

struct MapCompletion {
    slot_index: usize,
    result: Result<(), String>,
    completed_at: Instant,
}

struct FramePacket {
    bytes: Vec<u8>,
    frame_index: u64,
    timestamp_ns: u64,
}

struct PackingJob {
    slot_index: usize,
    buffer: Arc<wgpu::Buffer>,
    metadata: ReadbackMeta,
    map_completed_at: Instant,
    packed_row_bytes: usize,
    padded_row_bytes: usize,
    height: usize,
    packed_frame_bytes: usize,
}

struct PackingResult {
    slot_index: usize,
    metadata: ReadbackMeta,
    packet: Option<FramePacket>,
    map_latency_ms: f64,
    pack_latency_ms: f64,
    error: String,
    pool_starved: bool,
}

fn return_cpu_buffer(
    recycle_tx: &SyncSender<Vec<u8>>,
    available_buffers: &AtomicU64,
    bytes: Vec<u8>,
) {
    available_buffers.fetch_add(1, Ordering::Relaxed);
    if recycle_tx.try_send(bytes).is_err() {
        available_buffers.fetch_sub(1, Ordering::Relaxed);
    }
}

struct PackingPipeline {
    job_tx: Option<SyncSender<PackingJob>>,
    result_rx: Receiver<PackingResult>,
    recycle_tx: SyncSender<Vec<u8>>,
    available_buffers: Arc<AtomicU64>,
    pool_count: usize,
    thread: Option<JoinHandle<()>>,
}

impl PackingPipeline {
    fn new(packed_frame_bytes: usize) -> Result<Self, String> {
        let (job_tx, job_rx) = sync_channel::<PackingJob>(PACKER_QUEUE_CAPACITY);
        let (result_tx, result_rx) = channel::<PackingResult>();
        let (recycle_tx, recycle_rx) = sync_channel::<Vec<u8>>(CPU_BUFFER_POOL_COUNT);
        let available_buffers = Arc::new(AtomicU64::new(CPU_BUFFER_POOL_COUNT as u64));

        for _ in 0..CPU_BUFFER_POOL_COUNT {
            let buffer = vec![0_u8; packed_frame_bytes];
            recycle_tx
                .send(buffer)
                .map_err(|_| "could not initialize reusable CPU frame buffers".to_string())?;
        }

        let worker_available = Arc::clone(&available_buffers);
        let thread = thread::Builder::new()
            .name("junkpile-frame-packer".into())
            .spawn(move || run_packing_worker(job_rx, result_tx, recycle_rx, worker_available))
            .map_err(|error| format!("could not start frame-packing thread: {error}"))?;

        Ok(Self {
            job_tx: Some(job_tx),
            result_rx,
            recycle_tx,
            available_buffers,
            pool_count: CPU_BUFFER_POOL_COUNT,
            thread: Some(thread),
        })
    }

    fn submit(&self, job: PackingJob) -> Result<(), TrySendError<PackingJob>> {
        let Some(tx) = self.job_tx.as_ref() else {
            return Err(TrySendError::Disconnected(job));
        };
        tx.try_send(job)
    }

    fn try_recv(&self) -> Result<PackingResult, TryRecvError> {
        self.result_rx.try_recv()
    }

    fn recycle(&self, bytes: Vec<u8>) {
        return_cpu_buffer(&self.recycle_tx, &self.available_buffers, bytes);
    }

    fn recycle_sender(&self) -> SyncSender<Vec<u8>> {
        self.recycle_tx.clone()
    }

    fn available_counter(&self) -> Arc<AtomicU64> {
        Arc::clone(&self.available_buffers)
    }

    fn available(&self) -> u64 {
        self.available_buffers.load(Ordering::Relaxed)
    }

    fn shutdown(&mut self) {
        self.job_tx.take();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl Drop for PackingPipeline {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[derive(Default)]
struct WorkerText {
    last_error: String,
    last_log: String,
    verification: String,
}

struct WorkerSignals {
    pending: AtomicU64,
    encoded: AtomicU64,
    raw_bytes: AtomicU64,
    output_bytes: AtomicU64,
    last_frame: AtomicU64,
    finished: AtomicBool,
    success: AtomicBool,
    text: Mutex<WorkerText>,
    write_timing: Mutex<TimingWindow>,
}

impl WorkerSignals {
    fn new() -> Self {
        Self {
            pending: AtomicU64::new(0),
            encoded: AtomicU64::new(0),
            raw_bytes: AtomicU64::new(0),
            output_bytes: AtomicU64::new(0),
            last_frame: AtomicU64::new(0),
            finished: AtomicBool::new(false),
            success: AtomicBool::new(false),
            text: Mutex::new(WorkerText::default()),
            write_timing: Mutex::new(TimingWindow::default()),
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

    fn set_verification(&self, message: impl Into<String>) {
        if let Ok(mut text) = self.text.lock() {
            text.verification = message.into();
        }
    }
}

struct RecordingWorker {
    tx: Option<SyncSender<FramePacket>>,
    signals: Arc<WorkerSignals>,
}

impl RecordingWorker {
    fn spawn(
        ffmpeg_executable: String,
        profile: RecordingProfile,
        width: u32,
        height: u32,
        fps: u32,
        output_path: PathBuf,
        worker_delay_ms: u64,
        recycle_tx: SyncSender<Vec<u8>>,
        recycle_available: Arc<AtomicU64>,
    ) -> Result<Self, String> {
        let (tx, rx) = sync_channel::<FramePacket>(WORKER_QUEUE_CAPACITY);
        let signals = Arc::new(WorkerSignals::new());
        let worker_signals = Arc::clone(&signals);

        thread::Builder::new()
            .name("junkpile-ffmpeg-record-worker".into())
            .spawn(move || {
                run_ffmpeg_worker(
                    rx,
                    worker_signals,
                    &ffmpeg_executable,
                    profile,
                    width,
                    height,
                    fps,
                    &output_path,
                    worker_delay_ms,
                    recycle_tx,
                    recycle_available,
                )
            })
            .map_err(|error| format!("could not start FFmpeg worker thread: {error}"))?;

        Ok(Self {
            tx: Some(tx),
            signals,
        })
    }

    fn try_send(&self, packet: FramePacket) -> Result<(), TrySendError<FramePacket>> {
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
    }

    fn is_finished(&self) -> bool {
        self.signals.finished.load(Ordering::Relaxed)
    }
}

pub struct FfmpegRecordingSink {
    id: String,
    name: String,
    pipeline: wgpu::RenderPipeline,
    source_layout: wgpu::BindGroupLayout,
    source_sampler: wgpu::Sampler,
    source_bind_group: wgpu::BindGroup,
    target_texture: wgpu::Texture,
    target_view: wgpu::TextureView,
    descriptor: FrameDescriptor,
    readback_slots: Vec<ReadbackSlot>,
    padded_bytes_per_row: u32,
    map_tx: Sender<MapCompletion>,
    map_rx: Receiver<MapCompletion>,
    packing: PackingPipeline,
    ffmpeg: FfmpegInfo,
    worker: Option<RecordingWorker>,
    profile: RecordingProfile,
    output_directory: PathBuf,
    output_path: PathBuf,
    active: bool,
    stop_requested: bool,
    session_id: u64,
    next_capture_deadline: Option<Instant>,
    worker_delay_ms: u64,
    stage_frames: u64,
    capture_requests: u64,
    readbacks_completed: u64,
    dropped_gpu: u64,
    dropped_packer: u64,
    dropped_worker: u64,
    last_frame: u64,
    last_error: String,
    session_started: Option<Instant>,
    capture_ended_elapsed: Option<Duration>,
    last_capture_at: Option<Instant>,
    capture_intervals: TimingWindow,
    map_latencies: TimingWindow,
    pack_latencies: TimingWindow,
}

impl FfmpegRecordingSink {
    pub fn new(
        device: &wgpu::Device,
        source_view: &wgpu::TextureView,
        width: u32,
        height: u32,
        fps: u32,
        format: wgpu::TextureFormat,
        output_directory: PathBuf,
    ) -> Self {
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("ffmpeg recording scale shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("scale.wgsl").into()),
        });
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("ffmpeg recording scale sampler"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("ffmpeg recording scale bind group layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });
        let source_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("ffmpeg recording scale bind group"),
            layout: &layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(source_view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(&sampler),
                },
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("ffmpeg recording scale pipeline layout"),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("ffmpeg recording scale pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: Some(wgpu::BlendState::REPLACE),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            multiview_mask: None,
            cache: None,
        });
        let (target_texture, target_view) = create_target(device, width, height, format);
        let (readback_slots, padded_bytes_per_row) = create_readback_slots(device, width, height);
        let packed_frame_bytes = packed_frame_size(width, height);
        let packing = PackingPipeline::new(packed_frame_bytes)
            .expect("could not initialize reusable CPU frame-packing pipeline");
        let (map_tx, map_rx) = channel();

        Self {
            id: "ffmpeg-record".into(),
            name: "FFmpeg File Recorder".into(),
            pipeline,
            source_layout: layout,
            source_sampler: sampler,
            source_bind_group,
            target_texture,
            target_view,
            descriptor: FrameDescriptor::rgba_srgb(width, height, fps, 1),
            readback_slots,
            padded_bytes_per_row,
            map_tx,
            map_rx,
            packing,
            ffmpeg: detect_ffmpeg(),
            worker: None,
            profile: RecordingProfile::H264,
            output_directory,
            output_path: PathBuf::new(),
            active: false,
            stop_requested: false,
            session_id: 0,
            next_capture_deadline: None,
            worker_delay_ms: 0,
            stage_frames: 0,
            capture_requests: 0,
            readbacks_completed: 0,
            dropped_gpu: 0,
            dropped_packer: 0,
            dropped_worker: 0,
            last_frame: 0,
            last_error: String::new(),
            session_started: None,
            capture_ended_elapsed: None,
            last_capture_at: None,
            capture_intervals: TimingWindow::default(),
            map_latencies: TimingWindow::default(),
            pack_latencies: TimingWindow::default(),
        }
    }

    pub fn update_source_view(
        &mut self,
        device: &wgpu::Device,
        source_view: &wgpu::TextureView,
    ) {
        self.source_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("I/O profile recording source bind group"),
            layout: &self.source_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(source_view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(&self.source_sampler),
                },
            ],
        });
    }

    pub fn view(&self) -> &wgpu::TextureView {
        &self.target_view
    }

    pub fn descriptor(&self) -> FrameDescriptor {
        self.descriptor.clone()
    }

    pub fn ffmpeg_info(&self) -> FfmpegInfo {
        self.ffmpeg.clone()
    }

    pub fn set_output_directory(&mut self, output_directory: PathBuf) -> Result<(), String> {
        if self.active || self.stop_requested {
            return Err("stop and finalize the current recording before changing the output folder".into());
        }
        if self.worker.as_ref().is_some_and(|worker| !worker.is_finished()) {
            return Err("the previous FFmpeg process is still finalizing".into());
        }
        crate::output_directory::ensure_writable_directory(&output_directory)?;
        self.output_directory = output_directory;
        self.last_error.clear();
        Ok(())
    }

    pub fn reconfigure(
        &mut self,
        device: &wgpu::Device,
        width: u32,
        height: u32,
        fps: u32,
        format: wgpu::TextureFormat,
    ) -> Result<(), String> {
        validate_settings(width, height, fps)?;
        if self.active || self.stop_requested {
            return Err("stop and finalize the current recording before changing format".into());
        }
        if self.readback_slots.iter().any(|slot| !matches!(slot.state, ReadbackState::Idle)) {
            return Err("GPU readback slots are still completing; try again in a moment".into());
        }
        if self.worker.as_ref().is_some_and(|worker| !worker.is_finished()) {
            return Err("the previous FFmpeg process is still finalizing".into());
        }

        let (target_texture, target_view) = create_target(device, width, height, format);
        let (readback_slots, padded_bytes_per_row) = create_readback_slots(device, width, height);
        self.packing.shutdown();
        let new_packing = PackingPipeline::new(packed_frame_size(width, height))?;
        self.target_texture = target_texture;
        self.target_view = target_view;
        self.readback_slots = readback_slots;
        self.padded_bytes_per_row = padded_bytes_per_row;
        self.packing = new_packing;
        self.descriptor = FrameDescriptor::rgba_srgb(width, height, fps, 1);
        self.last_error.clear();
        Ok(())
    }

    pub fn start(
        &mut self,
        profile: RecordingProfile,
        worker_delay_ms: u64,
    ) -> Result<String, String> {
        if !self.ffmpeg.available {
            return Err(self.ffmpeg.error.clone());
        }
        if self.active || self.stop_requested {
            return Err("recording is already active or finalizing".into());
        }
        if self.worker.as_ref().is_some_and(|worker| !worker.is_finished()) {
            return Err("the previous FFmpeg process is still finalizing".into());
        }

        crate::output_directory::ensure_writable_directory(&self.output_directory)?;
        let output_path = self.output_directory.join(output_filename(
            profile,
            self.descriptor.width,
            self.descriptor.height,
            self.descriptor.nominal_fps.numerator,
        ));
        let worker = RecordingWorker::spawn(
            self.ffmpeg.executable.clone(),
            profile,
            self.descriptor.width,
            self.descriptor.height,
            self.descriptor.nominal_fps.numerator,
            output_path.clone(),
            worker_delay_ms.min(500),
            self.packing.recycle_sender(),
            self.packing.available_counter(),
        )?;

        self.worker = Some(worker);
        self.profile = profile;
        self.output_path = output_path;
        self.active = true;
        self.stop_requested = false;
        self.session_id = self.session_id.wrapping_add(1).max(1);
        self.next_capture_deadline = Some(Instant::now());
        self.worker_delay_ms = worker_delay_ms.min(500);
        self.capture_requests = 0;
        self.readbacks_completed = 0;
        self.dropped_gpu = 0;
        self.dropped_packer = 0;
        self.dropped_worker = 0;
        self.last_frame = 0;
        self.last_error.clear();
        self.session_started = Some(Instant::now());
        self.capture_ended_elapsed = None;
        self.last_capture_at = None;
        self.capture_intervals.clear();
        self.map_latencies.clear();
        self.pack_latencies.clear();
        Ok(self.output_path.to_string_lossy().into_owned())
    }

    pub fn stop(&mut self) -> Result<(), String> {
        if !self.active {
            return Err("no recording is active".into());
        }
        self.finish_capture_clock();
        self.active = false;
        self.next_capture_deadline = None;
        self.stop_requested = true;
        self.maybe_close_worker();
        Ok(())
    }

    pub fn force_close(&mut self) {
        self.finish_capture_clock();
        self.active = false;
        self.next_capture_deadline = None;
        self.stop_requested = false;
        if let Some(worker) = self.worker.as_mut() {
            worker.close();
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
                    self.last_error = "GPU map completion channel disconnected".into();
                    break;
                }
            }
        }
        loop {
            match self.packing.try_recv() {
                Ok(result) => self.handle_packing_result(result),
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => {
                    self.last_error = "frame-packing result channel disconnected".into();
                    break;
                }
            }
        }
        if self.active && self.worker.as_ref().is_some_and(|worker| worker.is_finished()) {
            self.finish_capture_clock();
            self.active = false;
            self.next_capture_deadline = None;
            self.stop_requested = false;
            if let Some(worker) = self.worker.as_mut() {
                worker.close();
            }
        }
        self.maybe_close_worker();
    }

    pub fn status(&self) -> RecordingStatus {
        let mut encoded_frames = 0;
        let mut pending_worker = 0;
        let mut raw_bytes_written = 0;
        let mut output_bytes = 0;
        let mut ffmpeg_log = String::new();
        let mut verification = String::new();
        let mut worker_error = String::new();
        let mut worker_finished = false;
        let mut worker_success = false;
        let mut write_timing = TimingStats::default();

        if let Some(worker) = &self.worker {
            encoded_frames = worker.signals.encoded.load(Ordering::Relaxed);
            pending_worker = worker.signals.pending.load(Ordering::Relaxed);
            raw_bytes_written = worker.signals.raw_bytes.load(Ordering::Relaxed);
            output_bytes = worker.signals.output_bytes.load(Ordering::Relaxed);
            worker_finished = worker.signals.finished.load(Ordering::Relaxed);
            worker_success = worker.signals.success.load(Ordering::Relaxed);
            if let Ok(text) = worker.signals.text.lock() {
                ffmpeg_log = text.last_log.clone();
                verification = text.verification.clone();
                worker_error = text.last_error.clone();
            }
            if let Ok(timing) = worker.signals.write_timing.lock() {
                write_timing = timing.stats();
            }
        }

        let state = if !worker_error.is_empty() || !self.last_error.is_empty() {
            RecordingState::Error
        } else if self.active {
            RecordingState::Recording
        } else if self.stop_requested || self.worker.as_ref().is_some_and(|worker| !worker.is_finished()) {
            RecordingState::Finalizing
        } else if worker_finished && worker_success {
            RecordingState::Complete
        } else {
            RecordingState::Idle
        };
        let readback_slots_busy = self
            .readback_slots
            .iter()
            .filter(|slot| !matches!(slot.state, ReadbackState::Idle))
            .count() as u64;
        let fps = self.descriptor.nominal_fps.numerator.max(1);
        let last_error = if !self.last_error.is_empty() {
            self.last_error.clone()
        } else {
            worker_error
        };

        let packed_frame_bytes = u64::from(self.descriptor.width)
            .saturating_mul(u64::from(self.descriptor.height))
            .saturating_mul(u64::from(BYTES_PER_PIXEL));
        let padded_frame_bytes = u64::from(self.padded_bytes_per_row)
            .saturating_mul(u64::from(self.descriptor.height));
        let stage_texture_bytes = packed_frame_bytes.saturating_mul(2);
        let estimated_gpu_bytes = stage_texture_bytes.saturating_add(
            padded_frame_bytes.saturating_mul(self.readback_slots.len() as u64),
        );
        let estimated_cpu_queue_bytes = packed_frame_bytes
            .saturating_mul(self.packing.pool_count as u64);
        let estimated_peak_bytes = estimated_gpu_bytes
            .saturating_add(estimated_cpu_queue_bytes)
            .saturating_add(packed_frame_bytes);
        let raw_megabytes_per_second = packed_frame_bytes as f64 * fps as f64
            / (1024.0 * 1024.0);

        let wall_elapsed_seconds = self
            .capture_ended_elapsed
            .or_else(|| self.session_started.as_ref().map(|started| started.elapsed()))
            .map(|elapsed| elapsed.as_secs_f64())
            .unwrap_or(0.0);
        let expected_capture_frames = if wall_elapsed_seconds > 0.0 {
            (wall_elapsed_seconds * fps as f64).floor() as u64
        } else {
            0
        };
        let schedule_shortfall_frames = expected_capture_frames.saturating_sub(self.capture_requests);
        let denominator = wall_elapsed_seconds.max(0.000_001);
        let capture_rate_fps = self.capture_requests as f64 / denominator;
        let readback_rate_fps = self.readbacks_completed as f64 / denominator;
        let encode_rate_fps = encoded_frames as f64 / denominator;
        let actual_raw_megabytes_per_second = raw_bytes_written as f64
            / denominator
            / (1024.0 * 1024.0);
        let queue_utilization_percent = if WORKER_QUEUE_CAPACITY > 0 {
            (pending_worker as f64 / WORKER_QUEUE_CAPACITY as f64 * 100.0).min(100.0)
        } else {
            0.0
        };
        let dropped_total = self.dropped_gpu + self.dropped_packer + self.dropped_worker;
        let drop_rate_percent = if self.capture_requests > 0 {
            dropped_total as f64 / self.capture_requests as f64 * 100.0
        } else {
            0.0
        };
        let delivery_percent = if expected_capture_frames > 0 {
            (encoded_frames as f64 / expected_capture_frames as f64 * 100.0).min(100.0)
        } else {
            0.0
        };
        let output_timeline_seconds = encoded_frames as f64 / fps as f64;
        let capture_timing = self.capture_intervals.stats();
        let map_timing = self.map_latencies.stats();
        let pack_timing = self.pack_latencies.stats();
        let target_interval_ms = 1000.0 / fps as f64;
        let capture_jitter_p95_ms = timing_jitter_p95(&self.capture_intervals, target_interval_ms);
        let cpu_buffers_available = self.packing.available();

        let (diagnostic_state, diagnostic_detail) = if !last_error.is_empty() {
            (
                "error".to_string(),
                format!("The recording pipeline reported an error: {last_error}"),
            )
        } else if matches!(state, RecordingState::Idle) && self.session_started.is_none() {
            (
                "idle".to_string(),
                "Start a file route to measure capture cadence, readback pressure, FFmpeg ingest, and dropped frames.".to_string(),
            )
        } else if dropped_total > 0 {
            (
                "dropping".to_string(),
                format!(
                    "{} frame(s) were dropped after capture was requested: {} at GPU scheduling/readback, {} while packing into reusable CPU buffers, and {} at the FFmpeg queue.",
                    dropped_total, self.dropped_gpu, self.dropped_packer, self.dropped_worker
                ),
            )
        } else if schedule_shortfall_frames > (fps as u64 / 2).max(1) && wall_elapsed_seconds >= 2.0 {
            (
                "cadence-limited".to_string(),
                format!(
                    "The recorder scheduled {} fewer capture request(s) than the nominal {} fps timeline. The render loop or capture clock did not sustain the selected cadence.",
                    schedule_shortfall_frames, fps
                ),
            )
        } else if capture_jitter_p95_ms > target_interval_ms * 0.20
            && wall_elapsed_seconds >= 2.0
        {
            (
                "jitter-limited".to_string(),
                format!(
                    "Capture requests are arriving unevenly even though exact drop counters remain at zero. The rolling p95 interval jitter is {:.2} ms against a {:.2} ms target interval.",
                    capture_jitter_p95_ms, target_interval_ms
                ),
            )
        } else if queue_utilization_percent >= 100.0
            || readback_slots_busy as usize == self.readback_slots.len()
            || cpu_buffers_available == 0
            || pack_timing.p95_ms > target_interval_ms * 0.75
            || write_timing.p95_ms > target_interval_ms
        {
            (
                "pressure".to_string(),
                "The bounded pipeline is full. No frames have been dropped yet, but the next slow stage can cause drops.".to_string(),
            )
        } else if wall_elapsed_seconds >= 1.0 {
            (
                "stable".to_string(),
                format!(
                    "No pipeline drops detected. Capture {:.1} fps, GPU readback {:.1} fps, FFmpeg ingest {:.1} fps. Capture jitter p95 {:.2} ms; pack p95 {:.2} ms; FFmpeg write p95 {:.2} ms.",
                    capture_rate_fps,
                    readback_rate_fps,
                    encode_rate_fps,
                    capture_jitter_p95_ms,
                    pack_timing.p95_ms,
                    write_timing.p95_ms
                ),
            )
        } else {
            (
                "warming-up".to_string(),
                "Collecting enough frames to evaluate the selected format.".to_string(),
            )
        };

        RecordingStatus {
            id: self.id.clone(),
            name: self.name.clone(),
            state,
            profile: self.profile.label().into(),
            width: self.descriptor.width,
            height: self.descriptor.height,
            fps,
            stage_frames: self.stage_frames,
            capture_requests: self.capture_requests,
            readbacks_completed: self.readbacks_completed,
            encoded_frames,
            dropped_gpu: self.dropped_gpu,
            dropped_worker: self.dropped_worker,
            dropped_total,
            pending_worker,
            readback_slots_busy,
            raw_bytes_written,
            output_bytes,
            elapsed_seconds: output_timeline_seconds,
            output_path: self.output_path.to_string_lossy().into_owned(),
            ffmpeg_log,
            verification,
            last_error,
            worker_delay_ms: self.worker_delay_ms,
            readback_slot_count: self.readback_slots.len() as u64,
            worker_queue_capacity: WORKER_QUEUE_CAPACITY as u64,
            packed_frame_bytes,
            padded_frame_bytes,
            estimated_gpu_bytes,
            estimated_cpu_queue_bytes,
            estimated_peak_bytes,
            raw_megabytes_per_second,
            output_directory: self.output_directory.to_string_lossy().into_owned(),
            wall_elapsed_seconds,
            output_timeline_seconds,
            expected_capture_frames,
            schedule_shortfall_frames,
            capture_rate_fps,
            readback_rate_fps,
            encode_rate_fps,
            actual_raw_megabytes_per_second,
            queue_utilization_percent,
            drop_rate_percent,
            delivery_percent,
            diagnostic_state,
            diagnostic_detail,
            dropped_packer: self.dropped_packer,
            cpu_buffers_available,
            cpu_buffer_pool_count: self.packing.pool_count as u64,
            capture_interval_average_ms: capture_timing.average_ms,
            capture_interval_p50_ms: capture_timing.p50_ms,
            capture_interval_p95_ms: capture_timing.p95_ms,
            capture_interval_max_ms: capture_timing.maximum_ms,
            capture_jitter_p95_ms,
            map_latency_average_ms: map_timing.average_ms,
            map_latency_p95_ms: map_timing.p95_ms,
            map_latency_max_ms: map_timing.maximum_ms,
            pack_latency_average_ms: pack_timing.average_ms,
            pack_latency_p95_ms: pack_timing.p95_ms,
            pack_latency_max_ms: pack_timing.maximum_ms,
            ffmpeg_write_average_ms: write_timing.average_ms,
            ffmpeg_write_p95_ms: write_timing.p95_ms,
            ffmpeg_write_max_ms: write_timing.maximum_ms,
        }
    }

    fn finish_capture_clock(&mut self) {
        if self.capture_ended_elapsed.is_none() {
            self.capture_ended_elapsed = self.session_started.as_ref().map(|started| started.elapsed());
        }
    }

    fn should_capture(&mut self) -> bool {
        let fps = self.descriptor.nominal_fps.numerator.max(1);
        let interval = Duration::from_secs_f64(1.0 / fps as f64);
        let now = Instant::now();
        let deadline = self.next_capture_deadline.get_or_insert(now);

        if now < *deadline {
            return false;
        }

        // Advance from the previous deadline instead of from `now` so the
        // requested cadence does not drift with render-loop jitter. If the
        // renderer stalls, skip missed deadlines rather than bursting several
        // copies of the same rendered frame into the recorder.
        loop {
            *deadline += interval;
            if *deadline > now {
                break;
            }
        }
        if let Some(previous) = self.last_capture_at.replace(now) {
            self.capture_intervals
                .push(now.duration_since(previous).as_secs_f64() * 1000.0);
        }
        true
    }

    fn handle_map_completion(&mut self, completion: MapCompletion) {
        let Some(slot) = self.readback_slots.get_mut(completion.slot_index) else {
            self.last_error = format!("invalid readback slot completion: {}", completion.slot_index);
            return;
        };
        let metadata = match &slot.state {
            ReadbackState::Mapping(metadata) => metadata.clone(),
            ReadbackState::Idle | ReadbackState::Packing(_) => {
                self.last_error = format!(
                    "readback slot {} completed outside the mapping state",
                    completion.slot_index
                );
                return;
            }
        };

        if let Err(error) = completion.result {
            slot.buffer.unmap();
            slot.state = ReadbackState::Idle;
            self.last_error = format!("GPU readback mapping failed: {error}");
            return;
        }

        let job = PackingJob {
            slot_index: completion.slot_index,
            buffer: Arc::clone(&slot.buffer),
            metadata: metadata.clone(),
            map_completed_at: completion.completed_at,
            packed_row_bytes: (self.descriptor.width * BYTES_PER_PIXEL) as usize,
            padded_row_bytes: self.padded_bytes_per_row as usize,
            height: self.descriptor.height as usize,
            packed_frame_bytes: packed_frame_size(self.descriptor.width, self.descriptor.height),
        };
        slot.state = ReadbackState::Packing(metadata);

        match self.packing.submit(job) {
            Ok(()) => {}
            Err(TrySendError::Full(job)) => {
                job.buffer.unmap();
                if let Some(slot) = self.readback_slots.get_mut(job.slot_index) {
                    slot.state = ReadbackState::Idle;
                }
                self.dropped_packer += 1;
            }
            Err(TrySendError::Disconnected(job)) => {
                job.buffer.unmap();
                if let Some(slot) = self.readback_slots.get_mut(job.slot_index) {
                    slot.state = ReadbackState::Idle;
                }
                self.dropped_packer += 1;
                self.last_error = "frame-packing worker disconnected".into();
            }
        }
    }

    fn handle_packing_result(&mut self, mut result: PackingResult) {
        let Some(slot) = self.readback_slots.get_mut(result.slot_index) else {
            if let Some(packet) = result.packet.take() {
                self.packing.recycle(packet.bytes);
            }
            self.last_error = format!("invalid packed-frame slot completion: {}", result.slot_index);
            return;
        };
        match &slot.state {
            ReadbackState::Packing(metadata)
                if metadata.session_id == result.metadata.session_id
                    && metadata.frame_index == result.metadata.frame_index => {}
            _ => {
                if let Some(packet) = result.packet.take() {
                    self.packing.recycle(packet.bytes);
                }
                slot.state = ReadbackState::Idle;
                self.last_error = format!(
                    "readback slot {} returned a stale packed frame",
                    result.slot_index
                );
                return;
            }
        }
        slot.state = ReadbackState::Idle;
        self.map_latencies.push(result.map_latency_ms);
        self.pack_latencies.push(result.pack_latency_ms);

        if result.pool_starved {
            self.dropped_packer += 1;
        }
        if !result.error.is_empty() {
            if !result.pool_starved {
                self.dropped_packer += 1;
            }
            if let Some(packet) = result.packet.take() {
                self.packing.recycle(packet.bytes);
            }
            self.last_error = result.error;
            self.maybe_close_worker();
            return;
        }

        let Some(packet) = result.packet.take() else {
            self.maybe_close_worker();
            return;
        };
        self.readbacks_completed += 1;

        if result.metadata.session_id != self.session_id || (!self.active && !self.stop_requested) {
            self.packing.recycle(packet.bytes);
            self.maybe_close_worker();
            return;
        }

        let Some(worker) = self.worker.as_ref() else {
            self.dropped_worker += 1;
            self.packing.recycle(packet.bytes);
            self.last_error = "FFmpeg worker was unavailable".into();
            return;
        };
        match worker.try_send(packet) {
            Ok(()) => {
                self.last_frame = result.metadata.frame_index;
            }
            Err(TrySendError::Full(packet)) => {
                self.dropped_worker += 1;
                self.packing.recycle(packet.bytes);
            }
            Err(TrySendError::Disconnected(packet)) => {
                self.dropped_worker += 1;
                self.packing.recycle(packet.bytes);
                self.last_error = "FFmpeg worker channel disconnected".into();
            }
        }
        self.maybe_close_worker();
    }

    fn maybe_close_worker(&mut self) {
        if !self.stop_requested {
            return;
        }
        let readbacks_busy = self
            .readback_slots
            .iter()
            .any(|slot| !matches!(slot.state, ReadbackState::Idle));
        if !readbacks_busy {
            if let Some(worker) = self.worker.as_mut() {
                worker.close();
            }
            self.stop_requested = false;
        }
    }
}

impl FrameSink for FfmpegRecordingSink {
    fn id(&self) -> &str {
        &self.id
    }

    fn submit(&mut self, context: &mut SinkContext<'_>) -> SubmitResult {
        {
            let mut pass = context.encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("ffmpeg recording scale pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &self.target_view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &self.source_bind_group, &[]);
            pass.draw(0..3, 0..1);
        }
        self.stage_frames += 1;

        if !self.active || !self.should_capture() {
            return SubmitResult::Skipped;
        }
        self.capture_requests += 1;
        let Some(slot_index) = self
            .readback_slots
            .iter()
            .position(|slot| matches!(slot.state, ReadbackState::Idle))
        else {
            self.dropped_gpu += 1;
            return SubmitResult::Dropped;
        };

        let slot = &mut self.readback_slots[slot_index];
        context.encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture: &self.target_texture,
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
        context.encoder.map_buffer_on_submit(
            &slot.buffer,
            wgpu::MapMode::Read,
            ..,
            move |result| {
                let _ = tx.send(MapCompletion {
                    slot_index,
                    result: result.map_err(|error| format!("{error:?}")),
                    completed_at: Instant::now(),
                });
            },
        );
        slot.state = ReadbackState::Mapping(ReadbackMeta {
            session_id: self.session_id,
            frame_index: context.frame.frame_index,
            timestamp_ns: context.frame.timestamp_ns,
            map_started_at: Instant::now(),
        });
        SubmitResult::Submitted
    }
}

fn create_target(
    device: &wgpu::Device,
    width: u32,
    height: u32,
    format: wgpu::TextureFormat,
) -> (wgpu::Texture, wgpu::TextureView) {
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("ffmpeg recording target texture"),
        size: wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT
            | wgpu::TextureUsages::TEXTURE_BINDING
            | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    (texture, view)
}

fn packed_frame_size(width: u32, height: u32) -> usize {
    (width as usize)
        .saturating_mul(height as usize)
        .saturating_mul(BYTES_PER_PIXEL as usize)
}

fn readback_slot_count(width: u32, height: u32) -> usize {
    if width >= 5120 || height >= 2880 {
        HIGH_RES_READBACK_SLOT_COUNT
    } else {
        STANDARD_READBACK_SLOT_COUNT
    }
}

fn timing_jitter_p95(window: &TimingWindow, target_ms: f64) -> f64 {
    if window.samples.is_empty() {
        return 0.0;
    }
    let mut deviations: Vec<f64> = window
        .samples
        .iter()
        .map(|value| (value - target_ms).abs())
        .collect();
    deviations.sort_by(|a, b| a.total_cmp(b));
    let index = ((deviations.len().saturating_sub(1)) as f64 * 0.95).round() as usize;
    deviations[index.min(deviations.len() - 1)]
}

fn run_packing_worker(
    rx: Receiver<PackingJob>,
    result_tx: Sender<PackingResult>,
    recycle_rx: Receiver<Vec<u8>>,
    available_buffers: Arc<AtomicU64>,
) {
    while let Ok(job) = rx.recv() {
        let map_latency_ms = job
            .map_completed_at
            .duration_since(job.metadata.map_started_at)
            .as_secs_f64()
            * 1000.0;
        let pack_started = Instant::now();

        let mut bytes = match recycle_rx.try_recv() {
            Ok(bytes) => {
                available_buffers.fetch_sub(1, Ordering::Relaxed);
                bytes
            }
            Err(TryRecvError::Empty) => {
                job.buffer.unmap();
                let _ = result_tx.send(PackingResult {
                    slot_index: job.slot_index,
                    metadata: job.metadata,
                    packet: None,
                    map_latency_ms,
                    pack_latency_ms: 0.0,
                    error: String::new(),
                    pool_starved: true,
                });
                continue;
            }
            Err(TryRecvError::Disconnected) => {
                job.buffer.unmap();
                let _ = result_tx.send(PackingResult {
                    slot_index: job.slot_index,
                    metadata: job.metadata,
                    packet: None,
                    map_latency_ms,
                    pack_latency_ms: 0.0,
                    error: "reusable CPU frame-buffer pool disconnected".into(),
                    pool_starved: false,
                });
                break;
            }
        };

        if bytes.len() != job.packed_frame_bytes {
            bytes.resize(job.packed_frame_bytes, 0);
        }

        let copy_result = {
            let mapped = job.buffer.slice(..).get_mapped_range();
            if job.packed_row_bytes == job.padded_row_bytes {
                let source = mapped.get(..job.packed_frame_bytes);
                match source {
                    Some(source) => {
                        bytes.copy_from_slice(source);
                        Ok(())
                    }
                    None => Err("mapped GPU buffer was smaller than the packed frame".to_string()),
                }
            } else {
                let mut result = Ok(());
                for row in 0..job.height {
                    let source_start = row.saturating_mul(job.padded_row_bytes);
                    let source_end = source_start.saturating_add(job.packed_row_bytes);
                    let target_start = row.saturating_mul(job.packed_row_bytes);
                    let target_end = target_start.saturating_add(job.packed_row_bytes);
                    match (mapped.get(source_start..source_end), bytes.get_mut(target_start..target_end)) {
                        (Some(source), Some(target)) => target.copy_from_slice(source),
                        _ => {
                            result = Err("mapped GPU row did not match the expected frame layout".to_string());
                            break;
                        }
                    }
                }
                result
            }
        };
        job.buffer.unmap();
        let pack_latency_ms = pack_started.elapsed().as_secs_f64() * 1000.0;

        match copy_result {
            Ok(()) => {
                let packet = FramePacket {
                    bytes,
                    frame_index: job.metadata.frame_index,
                    timestamp_ns: job.metadata.timestamp_ns,
                };
                let _ = result_tx.send(PackingResult {
                    slot_index: job.slot_index,
                    metadata: job.metadata,
                    packet: Some(packet),
                    map_latency_ms,
                    pack_latency_ms,
                    error: String::new(),
                    pool_starved: false,
                });
            }
            Err(error) => {
                let _ = result_tx.send(PackingResult {
                    slot_index: job.slot_index,
                    metadata: job.metadata,
                    packet: Some(FramePacket {
                        bytes,
                        frame_index: 0,
                        timestamp_ns: 0,
                    }),
                    map_latency_ms,
                    pack_latency_ms,
                    error,
                    pool_starved: false,
                });
            }
        }
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
    let slots = (0..readback_slot_count(width, height))
        .map(|index| ReadbackSlot {
            buffer: Arc::new(device.create_buffer(&wgpu::BufferDescriptor {
                label: Some(&format!("ffmpeg recording readback slot {index}")),
                size: buffer_size,
                usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
                mapped_at_creation: false,
            })),
            state: ReadbackState::Idle,
        })
        .collect();
    (slots, padded_bytes_per_row)
}

fn validate_settings(width: u32, height: u32, fps: u32) -> Result<(), String> {
    if width < 16 || height < 16 {
        return Err("recording dimensions must be at least 16 × 16".into());
    }
    if width > 7680 || height > 4320 {
        return Err("this teaching example is limited to 7680 × 4320".into());
    }
    if width >= 7680 && fps > 30 {
        return Err("8K recording is limited to 24 or 30 fps in this example".into());
    }
    if width % 2 != 0 || height % 2 != 0 {
        return Err("recording width and height must be even".into());
    }
    if !matches!(fps, 24 | 30 | 60) {
        return Err("recording FPS must be 24, 30, or 60".into());
    }
    Ok(())
}

fn detect_ffmpeg() -> FfmpegInfo {
    let executable = env::var("FFMPEG_PATH").unwrap_or_else(|_| "ffmpeg".into());
    match Command::new(&executable).arg("-version").output() {
        Ok(output) if output.status.success() => {
            let version = String::from_utf8_lossy(&output.stdout)
                .lines()
                .next()
                .unwrap_or("FFmpeg detected")
                .trim()
                .to_string();
            FfmpegInfo {
                available: true,
                executable,
                version,
                error: String::new(),
            }
        }
        Ok(output) => FfmpegInfo {
            available: false,
            executable,
            version: String::new(),
            error: format!(
                "FFmpeg returned exit code {:?}: {}",
                output.status.code(),
                String::from_utf8_lossy(&output.stderr).trim()
            ),
        },
        Err(error) => FfmpegInfo {
            available: false,
            executable,
            version: String::new(),
            error: format!(
                "FFmpeg was not found. Install FFmpeg or set FFMPEG_PATH. System error: {error}"
            ),
        },
    }
}

fn output_filename(profile: RecordingProfile, width: u32, height: u32, fps: u32) -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!(
        "junkpile-31-{}-{}x{}-{}fps-{millis}.{}",
        match profile {
            RecordingProfile::H264 => "h264",
            RecordingProfile::ProRes => "prores",
        },
        width,
        height,
        fps,
        profile.extension()
    )
}

#[allow(clippy::too_many_arguments)]
fn run_ffmpeg_worker(
    rx: Receiver<FramePacket>,
    signals: Arc<WorkerSignals>,
    ffmpeg_executable: &str,
    profile: RecordingProfile,
    width: u32,
    height: u32,
    fps: u32,
    output_path: &Path,
    worker_delay_ms: u64,
    recycle_tx: SyncSender<Vec<u8>>,
    recycle_available: Arc<AtomicU64>,
) {
    let size = format!("{width}x{height}");
    let fps_text = fps.to_string();
    let mut command = Command::new(ffmpeg_executable);
    command.args([
        "-hide_banner",
        "-loglevel",
        "warning",
        "-y",
        "-f",
        "rawvideo",
        "-pixel_format",
        "rgba",
        "-video_size",
        &size,
        "-framerate",
        &fps_text,
        "-i",
        "-",
        "-an",
    ]);
    match profile {
        RecordingProfile::H264 => {
            command.args([
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "18",
                "-pix_fmt",
                "yuv420p",
                "-movflags",
                "+faststart",
            ]);
        }
        RecordingProfile::ProRes => {
            command.args([
                "-c:v",
                "prores_ks",
                "-profile:v",
                "3",
                "-pix_fmt",
                "yuv422p10le",
            ]);
        }
    }
    command
        .arg(output_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            signals.set_error(format!("could not start FFmpeg: {error}"));
            signals.finished.store(true, Ordering::Relaxed);
            return;
        }
    };
    let mut stdin = match child.stdin.take() {
        Some(stdin) => stdin,
        None => {
            signals.set_error("FFmpeg stdin was unavailable");
            let _ = child.kill();
            signals.finished.store(true, Ordering::Relaxed);
            return;
        }
    };

    if let Some(stderr) = child.stderr.take() {
        let log_signals = Arc::clone(&signals);
        let _ = thread::Builder::new()
            .name("junkpile-ffmpeg-stderr".into())
            .spawn(move || {
                for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                    if !line.trim().is_empty() {
                        log_signals.set_log(line);
                    }
                }
            });
    }

    while let Ok(packet) = rx.recv() {
        signals.pending.fetch_sub(1, Ordering::Relaxed);
        if worker_delay_ms > 0 {
            thread::sleep(Duration::from_millis(worker_delay_ms));
        }
        let write_started = Instant::now();
        let write_result = stdin.write_all(&packet.bytes);
        let write_latency_ms = write_started.elapsed().as_secs_f64() * 1000.0;
        if let Ok(mut timing) = signals.write_timing.lock() {
            timing.push(write_latency_ms);
        }
        let byte_count = packet.bytes.len() as u64;
        let frame_index = packet.frame_index;
        let _timestamp_contract = packet.timestamp_ns;
        return_cpu_buffer(&recycle_tx, &recycle_available, packet.bytes);

        if let Err(error) = write_result {
            signals.set_error(format!("could not write frame {frame_index} to FFmpeg: {error}"));
            break;
        }
        signals.encoded.fetch_add(1, Ordering::Relaxed);
        signals.raw_bytes.fetch_add(byte_count, Ordering::Relaxed);
        signals.last_frame.store(frame_index, Ordering::Relaxed);
    }

    while let Ok(packet) = rx.try_recv() {
        signals.pending.fetch_sub(1, Ordering::Relaxed);
        return_cpu_buffer(&recycle_tx, &recycle_available, packet.bytes);
    }

    drop(stdin);
    match child.wait() {
        Ok(status) if status.success() => {
            let output_bytes = fs::metadata(output_path).map(|meta| meta.len()).unwrap_or(0);
            signals.output_bytes.store(output_bytes, Ordering::Relaxed);
            if output_bytes == 0 {
                signals.set_error("FFmpeg exited successfully but the output file is empty");
            } else {
                signals.set_verification(verify_output(output_path));
                signals.success.store(true, Ordering::Relaxed);
            }
        }
        Ok(status) => {
            signals.set_error(format!("FFmpeg exited with status {status}"));
        }
        Err(error) => {
            signals.set_error(format!("could not wait for FFmpeg to finish: {error}"));
        }
    }
    signals.pending.store(0, Ordering::Relaxed);
    signals.finished.store(true, Ordering::Relaxed);
}

fn verify_output(output_path: &Path) -> String {
    let ffprobe = env::var("FFPROBE_PATH").unwrap_or_else(|_| "ffprobe".into());
    match Command::new(ffprobe)
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=codec_name,width,height,avg_frame_rate,nb_frames:format=duration,size",
            "-of",
            "default=noprint_wrappers=1",
        ])
        .arg(output_path)
        .output()
    {
        Ok(output) if output.status.success() => {
            let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if text.is_empty() {
                "Output file exists and is non-empty; ffprobe returned no details.".into()
            } else {
                text
            }
        }
        _ => "Output file exists and is non-empty; ffprobe was unavailable or returned an error."
            .into(),
    }
}
