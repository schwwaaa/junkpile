use crate::{
    frame::{FrameDescriptor, VideoFrame},
    output::{FrameSink, SinkContext, SubmitResult},
};
use serde::Serialize;
use std::{
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
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const READBACK_SLOT_COUNT: usize = 2;
const WORKER_QUEUE_CAPACITY: usize = 2;
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
}

#[derive(Clone)]
struct ReadbackMeta {
    session_id: u64,
    frame_index: u64,
    timestamp_ns: u64,
}

enum ReadbackState {
    Idle,
    Mapping(ReadbackMeta),
}

struct ReadbackSlot {
    buffer: wgpu::Buffer,
    state: ReadbackState,
}

struct MapCompletion {
    slot_index: usize,
    result: Result<(), String>,
}

struct FramePacket {
    bytes: Vec<u8>,
    frame_index: u64,
    timestamp_ns: u64,
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
    ffmpeg: FfmpegInfo,
    worker: Option<RecordingWorker>,
    profile: RecordingProfile,
    output_path: PathBuf,
    active: bool,
    stop_requested: bool,
    session_id: u64,
    capture_accumulator: u32,
    worker_delay_ms: u64,
    stage_frames: u64,
    capture_requests: u64,
    readbacks_completed: u64,
    dropped_gpu: u64,
    dropped_worker: u64,
    last_frame: u64,
    last_error: String,
}

impl FfmpegRecordingSink {
    pub fn new(
        device: &wgpu::Device,
        source_view: &wgpu::TextureView,
        width: u32,
        height: u32,
        fps: u32,
        format: wgpu::TextureFormat,
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
            descriptor: FrameDescriptor::rgba_srgb(width, height, fps),
            readback_slots,
            padded_bytes_per_row,
            map_tx,
            map_rx,
            ffmpeg: detect_ffmpeg(),
            worker: None,
            profile: RecordingProfile::H264,
            output_path: PathBuf::new(),
            active: false,
            stop_requested: false,
            session_id: 0,
            capture_accumulator: 0,
            worker_delay_ms: 0,
            stage_frames: 0,
            capture_requests: 0,
            readbacks_completed: 0,
            dropped_gpu: 0,
            dropped_worker: 0,
            last_frame: 0,
            last_error: String::new(),
        }
    }

    pub fn update_source_view(
        &mut self,
        device: &wgpu::Device,
        source_view: &wgpu::TextureView,
    ) {
        self.source_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("high-resolution recording source bind group"),
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
        self.target_texture = target_texture;
        self.target_view = target_view;
        self.readback_slots = readback_slots;
        self.padded_bytes_per_row = padded_bytes_per_row;
        self.descriptor = FrameDescriptor::rgba_srgb(width, height, fps);
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

        let output_dir = env::current_dir()
            .map_err(|error| format!("could not resolve the project directory: {error}"))?
            .join("recordings");
        fs::create_dir_all(&output_dir)
            .map_err(|error| format!("could not create recordings directory: {error}"))?;
        let output_path = output_dir.join(output_filename(
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
        )?;

        self.worker = Some(worker);
        self.profile = profile;
        self.output_path = output_path;
        self.active = true;
        self.stop_requested = false;
        self.session_id = self.session_id.wrapping_add(1).max(1);
        self.capture_accumulator = 60u32.saturating_sub(self.descriptor.nominal_fps.numerator);
        self.worker_delay_ms = worker_delay_ms.min(500);
        self.capture_requests = 0;
        self.readbacks_completed = 0;
        self.dropped_gpu = 0;
        self.dropped_worker = 0;
        self.last_frame = 0;
        self.last_error.clear();
        Ok(self.output_path.to_string_lossy().into_owned())
    }

    pub fn stop(&mut self) -> Result<(), String> {
        if !self.active {
            return Err("no recording is active".into());
        }
        self.active = false;
        self.stop_requested = true;
        self.maybe_close_worker();
        Ok(())
    }

    pub fn force_close(&mut self) {
        self.active = false;
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
        if self.active && self.worker.as_ref().is_some_and(|worker| worker.is_finished()) {
            self.active = false;
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
            padded_frame_bytes.saturating_mul(READBACK_SLOT_COUNT as u64),
        );
        let estimated_cpu_queue_bytes = packed_frame_bytes
            .saturating_mul(WORKER_QUEUE_CAPACITY as u64);
        let estimated_peak_bytes = estimated_gpu_bytes
            .saturating_add(estimated_cpu_queue_bytes)
            .saturating_add(packed_frame_bytes);
        let raw_megabytes_per_second = packed_frame_bytes as f64 * fps as f64
            / (1024.0 * 1024.0);

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
            dropped_total: self.dropped_gpu + self.dropped_worker,
            pending_worker,
            readback_slots_busy,
            raw_bytes_written,
            output_bytes,
            elapsed_seconds: encoded_frames as f64 / fps as f64,
            output_path: self.output_path.to_string_lossy().into_owned(),
            ffmpeg_log,
            verification,
            last_error,
            worker_delay_ms: self.worker_delay_ms,
            readback_slot_count: READBACK_SLOT_COUNT as u64,
            worker_queue_capacity: WORKER_QUEUE_CAPACITY as u64,
            packed_frame_bytes,
            padded_frame_bytes,
            estimated_gpu_bytes,
            estimated_cpu_queue_bytes,
            estimated_peak_bytes,
            raw_megabytes_per_second,
        }
    }

    fn should_capture(&mut self) -> bool {
        let fps = self.descriptor.nominal_fps.numerator.min(60);
        self.capture_accumulator = self.capture_accumulator.saturating_add(fps);
        if self.capture_accumulator >= 60 {
            self.capture_accumulator -= 60;
            true
        } else {
            false
        }
    }

    fn handle_map_completion(&mut self, completion: MapCompletion) {
        let Some(slot) = self.readback_slots.get_mut(completion.slot_index) else {
            self.last_error = format!("invalid readback slot completion: {}", completion.slot_index);
            return;
        };
        let metadata = match &slot.state {
            ReadbackState::Mapping(metadata) => metadata.clone(),
            ReadbackState::Idle => {
                self.last_error = format!("readback slot {} completed while idle", completion.slot_index);
                return;
            }
        };

        if let Err(error) = completion.result {
            slot.state = ReadbackState::Idle;
            self.last_error = format!("GPU readback mapping failed: {error}");
            return;
        }

        let packed = {
            let mapped = slot.buffer.slice(..).get_mapped_range();
            let packed_row_bytes = (self.descriptor.width * BYTES_PER_PIXEL) as usize;
            let padded_row_bytes = self.padded_bytes_per_row as usize;
            let mut bytes = Vec::with_capacity(
                packed_row_bytes.saturating_mul(self.descriptor.height as usize),
            );
            for row in 0..self.descriptor.height as usize {
                let start = row.saturating_mul(padded_row_bytes);
                let end = start.saturating_add(packed_row_bytes);
                bytes.extend_from_slice(&mapped[start..end]);
            }
            drop(mapped);
            bytes
        };
        slot.buffer.unmap();
        slot.state = ReadbackState::Idle;
        self.readbacks_completed += 1;

        if metadata.session_id != self.session_id || (!self.active && !self.stop_requested) {
            self.maybe_close_worker();
            return;
        }
        let packet = FramePacket {
            bytes: packed,
            frame_index: metadata.frame_index,
            timestamp_ns: metadata.timestamp_ns,
        };
        let Some(worker) = self.worker.as_ref() else {
            self.dropped_worker += 1;
            self.last_error = "FFmpeg worker was unavailable".into();
            return;
        };
        match worker.try_send(packet) {
            Ok(()) => {
                self.last_frame = metadata.frame_index;
            }
            Err(TrySendError::Full(_)) => {
                self.dropped_worker += 1;
            }
            Err(TrySendError::Disconnected(_)) => {
                self.dropped_worker += 1;
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
                });
            },
        );
        slot.state = ReadbackState::Mapping(ReadbackMeta {
            session_id: self.session_id,
            frame_index: context.frame.frame_index,
            timestamp_ns: context.frame.timestamp_ns,
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
            buffer: device.create_buffer(&wgpu::BufferDescriptor {
                label: Some(&format!("ffmpeg recording readback slot {index}")),
                size: buffer_size,
                usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
                mapped_at_creation: false,
            }),
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
        "junkpile-30-{}-{}x{}-{}fps-{millis}.{}",
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
        if let Err(error) = stdin.write_all(&packet.bytes) {
            signals.set_error(format!("could not write frame {} to FFmpeg: {error}", packet.frame_index));
            break;
        }
        let _timestamp_contract = packet.timestamp_ns;
        signals.encoded.fetch_add(1, Ordering::Relaxed);
        signals
            .raw_bytes
            .fetch_add(packet.bytes.len() as u64, Ordering::Relaxed);
        signals.last_frame.store(packet.frame_index, Ordering::Relaxed);
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
            "stream=codec_name,width,height,avg_frame_rate:format=duration,size",
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
