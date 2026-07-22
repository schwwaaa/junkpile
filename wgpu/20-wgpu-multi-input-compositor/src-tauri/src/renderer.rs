use crate::{
    audio::AudioSnapshot,
    camera::{CameraFrame, SharedCameraFrame},
    gesture::{GesturePoint, GestureSnapshot, MAX_POINTS},
    midi::MidiSnapshot,
    osc::OscSnapshot,
    video::{SharedVideoFrame, VideoFrame},
};
use bytemuck::{Pod, Zeroable};
use serde::Serialize;
use std::{
    env,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{sync_channel, Receiver, SyncSender, TryRecvError},
        Arc, RwLock,
    },
    thread,
    time::{Duration, Instant},
};
use wgpu::util::DeviceExt;

const SIGNAL_COUNT: usize = 160;
const HDR_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;

#[derive(Clone)]
pub struct InputSources {
    pub camera: SharedCameraFrame,
    pub video: SharedVideoFrame,
    pub audio: Arc<RwLock<AudioSnapshot>>,
    pub midi: Arc<RwLock<MidiSnapshot>>,
    pub osc: Arc<RwLock<OscSnapshot>>,
    pub gesture: Arc<RwLock<GestureSnapshot>>,
}

#[derive(Debug, Clone)]
pub enum RenderCommand {
    Resize(u32, u32),
    SetParam(String, f32),
    SetMode(String),
    Reset,
    Shutdown,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RendererInfo {
    pub backend: String,
    pub adapter: String,
    pub driver: String,
    pub surface_format: String,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub frame_time_ms: f64,
    pub frame_count: u64,
    pub camera_width: u32,
    pub camera_height: u32,
    pub camera_uploads: u64,
    pub video_width: u32,
    pub video_height: u32,
    pub video_uploads: u64,
    pub audio_sequence: u64,
    pub midi_sequence: u64,
    pub osc_sequence: u64,
    pub gesture_sequence: u64,
    pub active_gesture_points: u32,
    pub source_mix: f32,
    pub feedback: f32,
    pub mode: String,
    pub running: bool,
    pub last_error: String,
}

#[derive(Clone)]
pub struct RendererHandle {
    tx: SyncSender<RenderCommand>,
    info: Arc<RwLock<RendererInfo>>,
}

impl RendererHandle {
    pub fn send(&self, command: RenderCommand) { let _ = self.tx.try_send(command); }
    pub fn info(&self) -> RendererInfo { self.info.read().expect("renderer info poisoned").clone() }
}

pub fn start(window: tauri::Window, sources: InputSources) -> Result<RendererHandle, String> {
    let (tx, rx) = sync_channel(128);
    let alive = Arc::new(AtomicBool::new(true));
    let mut renderer = pollster::block_on(Renderer::new(window, sources))?;
    let info = Arc::new(RwLock::new(renderer.info()));
    let thread_info = Arc::clone(&info);
    let thread_alive = Arc::clone(&alive);
    thread::Builder::new()
        .name("junkpile-wgpu-multi-input-compositor".into())
        .spawn(move || renderer.run(rx, thread_info, thread_alive))
        .map_err(|error| format!("could not start renderer thread: {error}"))?;
    Ok(RendererHandle { tx, info })
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Uniforms {
    resolution_time: [f32; 4],
    source_dimensions: [f32; 4],
    source_state: [f32; 4],
    controls0: [f32; 4],
    controls1: [f32; 4],
    audio0: [f32; 4],
    input0: [f32; 4],
    network0: [f32; 4],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct GpuPoint {
    position_velocity: [f32; 4],
    pressure_age_tool_active: [f32; 4],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct GpuGestureData { points: [GpuPoint; MAX_POINTS] }

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct GpuSignals { values: [f32; SIGNAL_COUNT] }

struct SourceTexture {
    texture: wgpu::Texture,
    view: wgpu::TextureView,
    width: u32,
    height: u32,
    sequence: u64,
}

struct OffscreenTargets {
    _composite: wgpu::Texture,
    composite_view: wgpu::TextureView,
    _feedback_a: wgpu::Texture,
    feedback_a_view: wgpu::TextureView,
    _feedback_b: wgpu::Texture,
    feedback_b_view: wgpu::TextureView,
    feedback_bind_a: wgpu::BindGroup,
    feedback_bind_b: wgpu::BindGroup,
    present_bind_a: wgpu::BindGroup,
    present_bind_b: wgpu::BindGroup,
}

struct Renderer {
    window: tauri::Window,
    instance: wgpu::Instance,
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    adapter_info: wgpu::AdapterInfo,

    composite_pipeline: wgpu::RenderPipeline,
    feedback_pipeline: wgpu::RenderPipeline,
    present_pipeline: wgpu::RenderPipeline,
    uniform_buffer: wgpu::Buffer,
    gesture_buffer: wgpu::Buffer,
    signals_buffer: wgpu::Buffer,
    global_bind: wgpu::BindGroup,
    source_layout: wgpu::BindGroupLayout,
    feedback_layout: wgpu::BindGroupLayout,
    present_layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
    source_bind: wgpu::BindGroup,
    camera_texture: SourceTexture,
    video_texture: SourceTexture,
    targets: OffscreenTargets,
    write_a: bool,

    sources: InputSources,
    uniforms: Uniforms,
    mode_name: String,
    source_mix: f32,
    feedback: f32,
    displacement: f32,
    chroma: f32,
    exposure: f32,
    contrast: f32,
    audio_gain: f32,
    gesture_gain: f32,

    width: u32,
    height: u32,
    minimized: bool,
    started: Instant,
    last_frame: Instant,
    frame_count: u64,
    measured_fps: f64,
    measured_frame_time_ms: f64,
    camera_uploads: u64,
    video_uploads: u64,
    camera_age_ms: f64,
    video_age_ms: f64,
    audio_sequence: u64,
    midi_sequence: u64,
    osc_sequence: u64,
    gesture_sequence: u64,
    active_gesture_points: u32,
    last_error: String,
}

impl Renderer {
    async fn new(window: tauri::Window, sources: InputSources) -> Result<Self, String> {
        let size = window.inner_size().map_err(|error| error.to_string())?;
        let width = size.width.max(1);
        let height = size.height.max(1);
        let requested_backends = wgpu::Backends::from_env().unwrap_or(wgpu::Backends::PRIMARY);
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
            backends: requested_backends,
            ..wgpu::InstanceDescriptor::new_without_display_handle()
        });
        let surface = instance.create_surface(window.clone())
            .map_err(|error| format!("could not create GPU surface: {error}"))?;
        let adapter_filter = env::var("WGPU_ADAPTER_NAME").ok().map(|value| value.to_lowercase());
        let adapter = instance.enumerate_adapters(requested_backends).await.into_iter()
            .find(|candidate| {
                candidate.is_surface_supported(&surface)
                    && adapter_filter.as_ref().map(|filter| candidate.get_info().name.to_lowercase().contains(filter)).unwrap_or(true)
            })
            .ok_or_else(|| "no compatible adapter found".to_string())?;
        let adapter_info = adapter.get_info();
        let (device, queue) = adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("multi-input compositor device"),
            required_features: wgpu::Features::empty(),
            required_limits: wgpu::Limits::default(),
            memory_hints: wgpu::MemoryHints::Performance,
            trace: wgpu::Trace::Off,
            ..Default::default()
        }).await.map_err(|error| format!("could not create GPU device: {error}"))?;

        let mut config = surface.get_default_config(&adapter, width, height)
            .ok_or_else(|| "adapter cannot produce a default surface configuration".to_string())?;
        config.present_mode = wgpu::PresentMode::Fifo;
        surface.configure(&device, &config);

        let uniforms = Uniforms {
            resolution_time: [width as f32, height as f32, 0.0, 0.0],
            source_dimensions: [2.0, 2.0, 2.0, 2.0],
            source_state: [0.0; 4],
            controls0: [0.5, 0.72, 0.035, 0.006],
            controls1: [1.2, 1.05, 1.0, 1.0],
            audio0: [0.0; 4],
            input0: [0.0; 4],
            network0: [0.0; 4],
        };
        let uniform_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("multi-input uniform buffer"),
            contents: bytemuck::bytes_of(&uniforms),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });
        let empty_gestures = GpuGestureData { points: [GpuPoint::zeroed(); MAX_POINTS] };
        let gesture_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("multi-input gesture storage"),
            contents: bytemuck::bytes_of(&empty_gestures),
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
        });
        let empty_signals = GpuSignals { values: [0.0; SIGNAL_COUNT] };
        let signals_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("multi-input signal storage"),
            contents: bytemuck::bytes_of(&empty_signals),
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
        });

        let global_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("multi-input global layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: false, min_binding_size: None },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Storage { read_only: true }, has_dynamic_offset: false, min_binding_size: None },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Storage { read_only: true }, has_dynamic_offset: false, min_binding_size: None },
                    count: None,
                },
            ],
        });
        let global_bind = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("multi-input global bind group"),
            layout: &global_layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: uniform_buffer.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 1, resource: gesture_buffer.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 2, resource: signals_buffer.as_entire_binding() },
            ],
        });

        let source_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("multi-input source layout"),
            entries: &[
                texture_layout_entry(0),
                texture_layout_entry(1),
                sampler_layout_entry(2),
            ],
        });
        let feedback_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("multi-input feedback layout"),
            entries: &[
                texture_layout_entry(0),
                texture_layout_entry(1),
                sampler_layout_entry(2),
            ],
        });
        let present_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("multi-input present layout"),
            entries: &[texture_layout_entry(0), sampler_layout_entry(1)],
        });
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("multi-input linear sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::MipmapFilterMode::Nearest,
            ..Default::default()
        });

        let camera_texture = create_source_texture(&device, &queue, "camera source texture", [24, 28, 40, 255, 56, 66, 88, 255, 56, 66, 88, 255, 24, 28, 40, 255]);
        let video_texture = create_source_texture(&device, &queue, "video source texture", [35, 20, 48, 255, 88, 44, 70, 255, 88, 44, 70, 255, 35, 20, 48, 255]);
        let source_bind = create_source_bind(&device, &source_layout, &camera_texture.view, &video_texture.view, &sampler);

        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("multi-input compositor WGSL"),
            source: wgpu::ShaderSource::Wgsl(include_str!("compositor.wgsl").into()),
        });
        let composite_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("multi-input composite pipeline layout"),
            bind_group_layouts: &[Some(&global_layout), Some(&source_layout), None, None],
            immediate_size: 0,
        });
        let feedback_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("multi-input feedback pipeline layout"),
            bind_group_layouts: &[Some(&global_layout), None, Some(&feedback_layout), None],
            immediate_size: 0,
        });
        let present_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("multi-input present pipeline layout"),
            bind_group_layouts: &[Some(&global_layout), None, None, Some(&present_layout)],
            immediate_size: 0,
        });

        let composite_pipeline = create_pipeline(&device, &shader, &composite_layout, "multi-input composite pipeline", "fs_composite", HDR_FORMAT);
        let feedback_pipeline = create_pipeline(&device, &shader, &feedback_pipeline_layout, "multi-input feedback pipeline", "fs_feedback", HDR_FORMAT);
        let present_pipeline = create_pipeline(&device, &shader, &present_pipeline_layout, "multi-input present pipeline", "fs_present", config.format);
        let targets = create_targets(&device, width, height, &feedback_layout, &present_layout, &sampler);

        let now = Instant::now();
        Ok(Self {
            window, instance, surface, device, queue, config, adapter_info,
            composite_pipeline, feedback_pipeline, present_pipeline,
            uniform_buffer, gesture_buffer, signals_buffer, global_bind,
            source_layout, feedback_layout, present_layout, sampler, source_bind,
            camera_texture, video_texture, targets, write_a: true,
            sources, uniforms, mode_name: "blend".into(),
            source_mix: 0.5, feedback: 0.72, displacement: 0.035, chroma: 0.006,
            exposure: 1.2, contrast: 1.05, audio_gain: 1.0, gesture_gain: 1.0,
            width, height, minimized: false, started: now, last_frame: now,
            frame_count: 0, measured_fps: 0.0, measured_frame_time_ms: 0.0,
            camera_uploads: 0, video_uploads: 0, camera_age_ms: 0.0, video_age_ms: 0.0,
            audio_sequence: 0, midi_sequence: 0, osc_sequence: 0, gesture_sequence: 0,
            active_gesture_points: 0, last_error: String::new(),
        })
    }

    fn info(&self) -> RendererInfo {
        RendererInfo {
            backend: format!("{:?}", self.adapter_info.backend),
            adapter: self.adapter_info.name.clone(),
            driver: if self.adapter_info.driver_info.is_empty() { self.adapter_info.driver.clone() }
                else { format!("{} · {}", self.adapter_info.driver, self.adapter_info.driver_info) },
            surface_format: format!("{:?}", self.config.format),
            width: self.width, height: self.height,
            fps: self.measured_fps, frame_time_ms: self.measured_frame_time_ms,
            frame_count: self.frame_count,
            camera_width: self.camera_texture.width, camera_height: self.camera_texture.height,
            camera_uploads: self.camera_uploads,
            video_width: self.video_texture.width, video_height: self.video_texture.height,
            video_uploads: self.video_uploads,
            audio_sequence: self.audio_sequence, midi_sequence: self.midi_sequence,
            osc_sequence: self.osc_sequence, gesture_sequence: self.gesture_sequence,
            active_gesture_points: self.active_gesture_points,
            source_mix: self.source_mix, feedback: self.feedback, mode: self.mode_name.clone(),
            running: true, last_error: self.last_error.clone(),
        }
    }

    fn resize(&mut self, width: u32, height: u32) {
        self.minimized = width == 0 || height == 0;
        self.width = width.max(1);
        self.height = height.max(1);
        if !self.minimized {
            self.config.width = self.width;
            self.config.height = self.height;
            self.surface.configure(&self.device, &self.config);
            self.targets = create_targets(&self.device, self.width, self.height, &self.feedback_layout, &self.present_layout, &self.sampler);
            self.write_a = true;
        }
    }

    fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "sourceMix" => self.source_mix = value.clamp(0.0, 1.0),
            "feedback" => self.feedback = value.clamp(0.0, 0.995),
            "displacement" => self.displacement = value.clamp(0.0, 0.25),
            "chroma" => self.chroma = value.clamp(0.0, 0.05),
            "exposure" => self.exposure = value.clamp(0.1, 5.0),
            "contrast" => self.contrast = value.clamp(0.25, 2.5),
            "audioGain" => self.audio_gain = value.clamp(0.0, 4.0),
            "gestureGain" => self.gesture_gain = value.clamp(0.0, 4.0),
            _ => {}
        }
    }

    fn set_mode(&mut self, mode: String) {
        self.mode_name = mode;
    }

    fn reset(&mut self) {
        self.mode_name = "blend".into();
        self.source_mix = 0.5;
        self.feedback = 0.72;
        self.displacement = 0.035;
        self.chroma = 0.006;
        self.exposure = 1.2;
        self.contrast = 1.05;
        self.audio_gain = 1.0;
        self.gesture_gain = 1.0;
        self.targets = create_targets(&self.device, self.width, self.height, &self.feedback_layout, &self.present_layout, &self.sampler);
        self.write_a = true;
    }

    fn handle_commands(&mut self, rx: &Receiver<RenderCommand>) -> bool {
        loop {
            match rx.try_recv() {
                Ok(RenderCommand::Resize(width, height)) => self.resize(width, height),
                Ok(RenderCommand::SetParam(name, value)) => self.set_param(&name, value),
                Ok(RenderCommand::SetMode(mode)) => self.set_mode(mode),
                Ok(RenderCommand::Reset) => self.reset(),
                Ok(RenderCommand::Shutdown) => return false,
                Err(TryRecvError::Empty) => return true,
                Err(TryRecvError::Disconnected) => return false,
            }
        }
    }

    fn upload_camera(&mut self) {
        let latest = self.sources.camera.read().expect("camera frame poisoned").clone();
        let Some(frame) = latest else { return; };
        if frame.sequence == self.camera_texture.sequence { return; }
        self.ensure_camera_texture(&frame);
        self.queue.write_texture(
            wgpu::TexelCopyTextureInfo { texture: &self.camera_texture.texture, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
            &frame.rgba,
            wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(frame.width * 4), rows_per_image: Some(frame.height) },
            wgpu::Extent3d { width: frame.width, height: frame.height, depth_or_array_layers: 1 },
        );
        self.camera_texture.sequence = frame.sequence;
        self.camera_uploads = self.camera_uploads.wrapping_add(1);
        self.camera_age_ms = frame.captured_at.elapsed().as_secs_f64() * 1000.0;
    }

    fn upload_video(&mut self) {
        let latest = self.sources.video.read().expect("video frame poisoned").clone();
        let Some(frame) = latest else { return; };
        if frame.sequence == self.video_texture.sequence { return; }
        self.ensure_video_texture(&frame);
        self.queue.write_texture(
            wgpu::TexelCopyTextureInfo { texture: &self.video_texture.texture, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
            &frame.bgra,
            wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(frame.width * 4), rows_per_image: Some(frame.height) },
            wgpu::Extent3d { width: frame.width, height: frame.height, depth_or_array_layers: 1 },
        );
        self.video_texture.sequence = frame.sequence;
        self.video_uploads = self.video_uploads.wrapping_add(1);
        self.video_age_ms = frame.presented_at.elapsed().as_secs_f64() * 1000.0;
    }

    fn ensure_camera_texture(&mut self, frame: &CameraFrame) {
        if frame.width == self.camera_texture.width && frame.height == self.camera_texture.height { return; }
        self.camera_texture = create_empty_source_texture(&self.device, "camera source texture", frame.width, frame.height);
        self.rebuild_source_bind();
    }

    fn ensure_video_texture(&mut self, frame: &VideoFrame) {
        if frame.width == self.video_texture.width && frame.height == self.video_texture.height { return; }
        self.video_texture = create_empty_source_texture(&self.device, "video source texture", frame.width, frame.height);
        self.rebuild_source_bind();
    }

    fn rebuild_source_bind(&mut self) {
        self.source_bind = create_source_bind(&self.device, &self.source_layout, &self.camera_texture.view, &self.video_texture.view, &self.sampler);
    }

    fn upload_state(&mut self, delta_seconds: f32) {
        let audio = self.sources.audio.read().expect("audio snapshot poisoned").clone();
        let midi = self.sources.midi.read().expect("MIDI snapshot poisoned").clone();
        let osc = self.sources.osc.read().expect("OSC snapshot poisoned").clone();
        let gesture = self.sources.gesture.read().expect("gesture snapshot poisoned").clone();

        self.audio_sequence = audio.sequence;
        self.midi_sequence = midi.sequence;
        self.osc_sequence = osc.sequence;
        self.gesture_sequence = gesture.sequence;
        self.active_gesture_points = gesture.count;

        let mode = match self.mode_name.as_str() {
            "difference" => 1.0,
            "multiply" => 2.0,
            "lumaKey" => 3.0,
            _ => 0.0,
        };
        self.uniforms.resolution_time = [self.width as f32, self.height as f32, self.started.elapsed().as_secs_f32(), delta_seconds];
        self.uniforms.source_dimensions = [self.camera_texture.width as f32, self.camera_texture.height as f32, self.video_texture.width as f32, self.video_texture.height as f32];
        self.uniforms.source_state = [
            if self.camera_texture.sequence > 0 { 1.0 } else { 0.0 },
            if self.video_texture.sequence > 0 { 1.0 } else { 0.0 },
            (self.camera_age_ms as f32 * 0.001).min(10.0),
            (self.video_age_ms as f32 * 0.001).min(10.0),
        ];
        let trail_modulation = (midi.parameters[5] + osc.parameters[5]) * 0.5;
        let field_modulation = (midi.parameters[3] + osc.parameters[3]) * 0.5;
        let turbulence_modulation = (midi.parameters[4] + osc.parameters[4]) * 0.5;
        let exposure_modulation = (midi.parameters[6] + osc.parameters[6]) * 0.5;
        self.uniforms.controls0 = [
            self.source_mix,
            (self.feedback * 0.65 + trail_modulation * 0.35).clamp(0.0, 0.995),
            (self.displacement + field_modulation * 0.035).clamp(0.0, 0.25),
            (self.chroma + turbulence_modulation * 0.012).clamp(0.0, 0.05),
        ];
        self.uniforms.controls1 = [
            self.exposure * (0.65 + exposure_modulation * 0.7),
            self.contrast,
            self.audio_gain,
            self.gesture_gain,
        ];
        self.uniforms.audio0 = [audio.rms, audio.bass, audio.treble, audio.transient];
        self.uniforms.input0 = [midi.pulse, osc.pulse, gesture.count as f32, mode];
        self.uniforms.network0 = [midi.parameters[0], osc.parameters[0], midi.parameters[2], osc.parameters[2]];

        let mut gpu_gestures = GpuGestureData { points: [GpuPoint::zeroed(); MAX_POINTS] };
        for (index, point) in gesture.points.iter().enumerate() {
            gpu_gestures.points[index] = GpuPoint {
                position_velocity: [point.x, point.y, point.velocity_x, point.velocity_y],
                pressure_age_tool_active: [point.pressure, point.age, point.tool, point.active],
            };
        }
        let mut gpu_signals = GpuSignals { values: [0.0; SIGNAL_COUNT] };
        gpu_signals.values[..128].copy_from_slice(&midi.notes);
        gpu_signals.values[128..160].copy_from_slice(&osc.signals);

        self.queue.write_buffer(&self.uniform_buffer, 0, bytemuck::bytes_of(&self.uniforms));
        self.queue.write_buffer(&self.gesture_buffer, 0, bytemuck::bytes_of(&gpu_gestures));
        self.queue.write_buffer(&self.signals_buffer, 0, bytemuck::bytes_of(&gpu_signals));
    }

    fn render(&mut self) -> Result<(), String> {
        let now = Instant::now();
        let delta = now.duration_since(self.last_frame).as_secs_f64();
        self.last_frame = now;
        if delta > 0.0 {
            self.measured_fps = 1.0 / delta;
            self.measured_frame_time_ms = delta * 1000.0;
        }
        self.upload_camera();
        self.upload_video();
        self.upload_state(delta as f32);

        let (frame, reconfigure) = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(frame) => (frame, false),
            wgpu::CurrentSurfaceTexture::Suboptimal(frame) => (frame, true),
            wgpu::CurrentSurfaceTexture::Timeout | wgpu::CurrentSurfaceTexture::Occluded => return Ok(()),
            wgpu::CurrentSurfaceTexture::Outdated => { self.surface.configure(&self.device, &self.config); return Ok(()); }
            wgpu::CurrentSurfaceTexture::Lost => { self.recreate_surface()?; return Ok(()); }
            wgpu::CurrentSurfaceTexture::Validation => return Err("surface validation error".into()),
        };
        let surface_view = frame.texture.create_view(&wgpu::TextureViewDescriptor::default());
        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("multi-input encoder") });

        begin_fullscreen_pass(
            &mut encoder, "source compositor pass", &self.targets.composite_view,
            &self.composite_pipeline, &self.global_bind, 1, &self.source_bind,
            wgpu::Color::BLACK,
        );

        let (feedback_view, feedback_bind, present_bind) = if self.write_a {
            (&self.targets.feedback_a_view, &self.targets.feedback_bind_a, &self.targets.present_bind_a)
        } else {
            (&self.targets.feedback_b_view, &self.targets.feedback_bind_b, &self.targets.present_bind_b)
        };
        begin_fullscreen_pass(
            &mut encoder, "feedback pass", feedback_view,
            &self.feedback_pipeline, &self.global_bind, 2, feedback_bind,
            wgpu::Color::BLACK,
        );
        begin_fullscreen_pass(
            &mut encoder, "presentation pass", &surface_view,
            &self.present_pipeline, &self.global_bind, 3, present_bind,
            wgpu::Color::BLACK,
        );

        self.queue.submit([encoder.finish()]);
        frame.present();
        if reconfigure { self.surface.configure(&self.device, &self.config); }
        self.write_a = !self.write_a;
        self.frame_count = self.frame_count.wrapping_add(1);
        Ok(())
    }

    fn recreate_surface(&mut self) -> Result<(), String> {
        self.surface = self.instance.create_surface(self.window.clone())
            .map_err(|error| format!("could not recreate surface: {error}"))?;
        self.surface.configure(&self.device, &self.config);
        Ok(())
    }

    fn run(&mut self, rx: Receiver<RenderCommand>, info: Arc<RwLock<RendererInfo>>, alive: Arc<AtomicBool>) {
        while alive.load(Ordering::Relaxed) {
            if !self.handle_commands(&rx) { break; }
            if self.minimized { thread::sleep(Duration::from_millis(16)); continue; }
            match self.render() {
                Ok(()) => self.last_error.clear(),
                Err(error) => { self.last_error = error; thread::sleep(Duration::from_millis(16)); }
            }
            *info.write().expect("renderer info poisoned") = self.info();
        }
        alive.store(false, Ordering::Relaxed);
    }
}

fn texture_layout_entry(binding: u32) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility: wgpu::ShaderStages::FRAGMENT,
        ty: wgpu::BindingType::Texture {
            sample_type: wgpu::TextureSampleType::Float { filterable: true },
            view_dimension: wgpu::TextureViewDimension::D2,
            multisampled: false,
        },
        count: None,
    }
}

fn sampler_layout_entry(binding: u32) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility: wgpu::ShaderStages::FRAGMENT,
        ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
        count: None,
    }
}

fn create_pipeline(
    device: &wgpu::Device,
    shader: &wgpu::ShaderModule,
    layout: &wgpu::PipelineLayout,
    label: &str,
    fragment_entry: &str,
    format: wgpu::TextureFormat,
) -> wgpu::RenderPipeline {
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some(label),
        layout: Some(layout),
        vertex: wgpu::VertexState {
            module: shader,
            entry_point: Some("vs_fullscreen"),
            compilation_options: Default::default(),
            buffers: &[],
        },
        primitive: wgpu::PrimitiveState::default(),
        depth_stencil: None,
        multisample: wgpu::MultisampleState::default(),
        fragment: Some(wgpu::FragmentState {
            module: shader,
            entry_point: Some(fragment_entry),
            compilation_options: Default::default(),
            targets: &[Some(wgpu::ColorTargetState {
                format,
                blend: Some(wgpu::BlendState::REPLACE),
                write_mask: wgpu::ColorWrites::ALL,
            })],
        }),
        multiview_mask: None,
        cache: None,
    })
}

fn create_empty_source_texture(device: &wgpu::Device, label: &str, width: u32, height: u32) -> SourceTexture {
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some(label),
        size: wgpu::Extent3d { width: width.max(1), height: height.max(1), depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Bgra8UnormSrgb,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    SourceTexture { texture, view, width: width.max(1), height: height.max(1), sequence: 0 }
}

fn create_source_texture(device: &wgpu::Device, queue: &wgpu::Queue, label: &str, pixels: [u8; 16]) -> SourceTexture {
    let source = create_empty_source_texture(device, label, 2, 2);
    queue.write_texture(
        wgpu::TexelCopyTextureInfo { texture: &source.texture, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
        &pixels,
        wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(8), rows_per_image: Some(2) },
        wgpu::Extent3d { width: 2, height: 2, depth_or_array_layers: 1 },
    );
    source
}

fn create_source_bind(
    device: &wgpu::Device,
    layout: &wgpu::BindGroupLayout,
    camera: &wgpu::TextureView,
    video: &wgpu::TextureView,
    sampler: &wgpu::Sampler,
) -> wgpu::BindGroup {
    device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("multi-input source bind group"),
        layout,
        entries: &[
            wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(camera) },
            wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(video) },
            wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::Sampler(sampler) },
        ],
    })
}

fn create_hdr_texture(device: &wgpu::Device, label: &str, width: u32, height: u32) -> (wgpu::Texture, wgpu::TextureView) {
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some(label),
        size: wgpu::Extent3d { width: width.max(1), height: height.max(1), depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: HDR_FORMAT,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::RENDER_ATTACHMENT,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    (texture, view)
}

fn create_targets(
    device: &wgpu::Device,
    width: u32,
    height: u32,
    feedback_layout: &wgpu::BindGroupLayout,
    present_layout: &wgpu::BindGroupLayout,
    sampler: &wgpu::Sampler,
) -> OffscreenTargets {
    let (composite, composite_view) = create_hdr_texture(device, "multi-input composite target", width, height);
    let (feedback_a, feedback_a_view) = create_hdr_texture(device, "multi-input feedback A", width, height);
    let (feedback_b, feedback_b_view) = create_hdr_texture(device, "multi-input feedback B", width, height);

    let feedback_bind_a = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("feedback bind A"), layout: feedback_layout,
        entries: &[
            wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&composite_view) },
            wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(&feedback_b_view) },
            wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::Sampler(sampler) },
        ],
    });
    let feedback_bind_b = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("feedback bind B"), layout: feedback_layout,
        entries: &[
            wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&composite_view) },
            wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(&feedback_a_view) },
            wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::Sampler(sampler) },
        ],
    });
    let present_bind_a = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("present bind A"), layout: present_layout,
        entries: &[
            wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&feedback_a_view) },
            wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(sampler) },
        ],
    });
    let present_bind_b = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("present bind B"), layout: present_layout,
        entries: &[
            wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&feedback_b_view) },
            wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(sampler) },
        ],
    });

    OffscreenTargets {
        _composite: composite, composite_view,
        _feedback_a: feedback_a, feedback_a_view,
        _feedback_b: feedback_b, feedback_b_view,
        feedback_bind_a, feedback_bind_b, present_bind_a, present_bind_b,
    }
}

fn begin_fullscreen_pass(
    encoder: &mut wgpu::CommandEncoder,
    label: &str,
    view: &wgpu::TextureView,
    pipeline: &wgpu::RenderPipeline,
    global_bind: &wgpu::BindGroup,
    second_index: u32,
    second_bind: &wgpu::BindGroup,
    clear: wgpu::Color,
) {
    let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
        label: Some(label),
        color_attachments: &[Some(wgpu::RenderPassColorAttachment {
            view,
            resolve_target: None,
            depth_slice: None,
            ops: wgpu::Operations { load: wgpu::LoadOp::Clear(clear), store: wgpu::StoreOp::Store },
        })],
        depth_stencil_attachment: None,
        timestamp_writes: None,
        occlusion_query_set: None,
        multiview_mask: None,
    });
    pass.set_pipeline(pipeline);
    pass.set_bind_group(0, global_bind, &[]);
    pass.set_bind_group(second_index, second_bind, &[]);
    pass.draw(0..3, 0..1);
}
