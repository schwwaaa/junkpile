use crate::audio::{AudioSnapshot, SPECTRUM_BINS, WAVEFORM_SAMPLES};
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

const DEFAULT_SPECTRUM_GAIN: f32 = 1.8;
const DEFAULT_WAVEFORM_GAIN: f32 = 1.0;
const DEFAULT_EXPOSURE: f32 = 1.15;
const DEFAULT_HUE: f32 = 0.58;
const DEFAULT_LINE_WIDTH: f32 = 2.0;
const DEFAULT_ZOOM: f32 = 1.0;
const DEFAULT_ROTATION: f32 = 0.0;

#[derive(Debug, Clone)]
pub enum RenderCommand {
    Resize(u32, u32),
    SetParam(String, f32),
    SetMode(u32),
    ResetParams,
    Shutdown,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RendererInfo {
    pub backend: String,
    pub adapter: String,
    pub device_type: String,
    pub driver: String,
    pub surface_format: String,
    pub width: u32,
    pub height: u32,
    pub mode: u32,
    pub spectrum_gain: f32,
    pub waveform_gain: f32,
    pub exposure: f32,
    pub hue: f32,
    pub line_width: f32,
    pub zoom: f32,
    pub rotation: f32,
    pub audio_sequence: u64,
    pub fps: f64,
    pub frame_time_ms: f64,
    pub frame_count: u64,
    pub running: bool,
    pub last_error: String,
}

#[derive(Clone)]
pub struct RendererHandle {
    tx: SyncSender<RenderCommand>,
    info: Arc<RwLock<RendererInfo>>,
}

impl RendererHandle {
    pub fn send(&self, command: RenderCommand) {
        let _ = self.tx.try_send(command);
    }

    pub fn info(&self) -> RendererInfo {
        self.info.read().expect("renderer info poisoned").clone()
    }
}

pub fn start(
    window: tauri::Window,
    audio_snapshot: Arc<RwLock<AudioSnapshot>>,
) -> Result<RendererHandle, String> {
    let (tx, rx) = sync_channel(256);
    let alive = Arc::new(AtomicBool::new(true));
    let mut renderer = pollster::block_on(Renderer::new(window, audio_snapshot))?;
    let info = Arc::new(RwLock::new(renderer.info()));

    let thread_info = Arc::clone(&info);
    let thread_alive = Arc::clone(&alive);
    thread::Builder::new()
        .name("junkpile-wgpu-audio-spectrum".into())
        .spawn(move || renderer.run(rx, thread_info, thread_alive))
        .map_err(|error| format!("could not start renderer thread: {error}"))?;

    Ok(RendererHandle { tx, info })
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Uniforms {
    resolution_time: [f32; 4],
    levels: [f32; 4],
    bands: [f32; 4],
    visual: [f32; 4],
    transform: [f32; 4],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct AudioGpuData {
    spectrum: [f32; SPECTRUM_BINS],
    waveform: [f32; WAVEFORM_SAMPLES],
}

struct Renderer {
    window: tauri::Window,
    instance: wgpu::Instance,
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    pipeline: wgpu::RenderPipeline,
    uniform_buffer: wgpu::Buffer,
    audio_buffer: wgpu::Buffer,
    bind_group: wgpu::BindGroup,
    uniforms: Uniforms,
    audio_snapshot: Arc<RwLock<AudioSnapshot>>,
    adapter_info: wgpu::AdapterInfo,
    width: u32,
    height: u32,
    minimized: bool,
    mode: u32,
    audio_sequence: u64,
    started: Instant,
    last_frame: Instant,
    frame_count: u64,
    measured_fps: f64,
    measured_frame_time_ms: f64,
    last_error: String,
}

impl Renderer {
    async fn new(
        window: tauri::Window,
        audio_snapshot: Arc<RwLock<AudioSnapshot>>,
    ) -> Result<Self, String> {
        let size = window.inner_size().map_err(|error| error.to_string())?;
        let width = size.width.max(1);
        let height = size.height.max(1);

        let requested_backends = wgpu::Backends::from_env().unwrap_or(wgpu::Backends::PRIMARY);
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
            backends: requested_backends,
            ..wgpu::InstanceDescriptor::new_without_display_handle()
        });
        let surface = instance
            .create_surface(window.clone())
            .map_err(|error| format!("could not create GPU surface: {error}"))?;

        let adapters = instance.enumerate_adapters(requested_backends).await;
        let adapter_filter = env::var("WGPU_ADAPTER_NAME")
            .ok()
            .map(|value| value.trim().to_lowercase())
            .filter(|value| !value.is_empty());
        let adapter = adapters
            .into_iter()
            .find(|candidate| {
                if !candidate.is_surface_supported(&surface) {
                    return false;
                }
                match &adapter_filter {
                    Some(filter) => candidate.get_info().name.to_lowercase().contains(filter),
                    None => true,
                }
            })
            .ok_or_else(|| "no surface-compatible adapter matched the requested backend/device".to_string())?;
        let adapter_info = adapter.get_info();

        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("junkpile audio spectrum device"),
                required_features: wgpu::Features::empty(),
                required_limits: wgpu::Limits::default(),
                memory_hints: wgpu::MemoryHints::Performance,
                trace: wgpu::Trace::Off,
                ..Default::default()
            })
            .await
            .map_err(|error| format!("could not create GPU device: {error}"))?;

        let mut config = surface
            .get_default_config(&adapter, width, height)
            .ok_or_else(|| "adapter cannot produce a default surface configuration".to_string())?;
        config.present_mode = wgpu::PresentMode::Fifo;
        surface.configure(&device, &config);

        let uniforms = Uniforms {
            resolution_time: [width as f32, height as f32, 0.0, 0.0],
            levels: [0.0; 4],
            bands: [0.0; 4],
            visual: [DEFAULT_SPECTRUM_GAIN, DEFAULT_WAVEFORM_GAIN, DEFAULT_EXPOSURE, 0.0],
            transform: [DEFAULT_HUE, DEFAULT_LINE_WIDTH, DEFAULT_ZOOM, DEFAULT_ROTATION],
        };
        let audio_data = AudioGpuData {
            spectrum: [0.0; SPECTRUM_BINS],
            waveform: [0.0; WAVEFORM_SAMPLES],
        };

        let uniform_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("audio spectrum uniform buffer"),
            contents: bytemuck::bytes_of(&uniforms),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });
        let audio_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("audio spectrum storage buffer"),
            contents: bytemuck::bytes_of(&audio_data),
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
        });

        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("audio spectrum bind group layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: true },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("audio spectrum bind group"),
            layout: &bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: uniform_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: audio_buffer.as_entire_binding(),
                },
            ],
        });

        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("audio reactive spectrum WGSL"),
            source: wgpu::ShaderSource::Wgsl(include_str!("audio.wgsl").into()),
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("audio spectrum pipeline layout"),
            bind_group_layouts: &[Some(&bind_group_layout)],
            immediate_size: 0,
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("audio spectrum pipeline"),
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
                    format: config.format,
                    blend: Some(wgpu::BlendState::REPLACE),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            multiview_mask: None,
            cache: None,
        });

        let now = Instant::now();
        Ok(Self {
            window,
            instance,
            surface,
            device,
            queue,
            config,
            pipeline,
            uniform_buffer,
            audio_buffer,
            bind_group,
            uniforms,
            audio_snapshot,
            adapter_info,
            width,
            height,
            minimized: false,
            mode: 0,
            audio_sequence: 0,
            started: now,
            last_frame: now,
            frame_count: 0,
            measured_fps: 0.0,
            measured_frame_time_ms: 0.0,
            last_error: String::new(),
        })
    }

    fn info(&self) -> RendererInfo {
        RendererInfo {
            backend: format!("{:?}", self.adapter_info.backend),
            adapter: self.adapter_info.name.clone(),
            device_type: format!("{:?}", self.adapter_info.device_type),
            driver: if self.adapter_info.driver_info.is_empty() {
                self.adapter_info.driver.clone()
            } else {
                format!("{} · {}", self.adapter_info.driver, self.adapter_info.driver_info)
            },
            surface_format: format!("{:?}", self.config.format),
            width: self.width,
            height: self.height,
            mode: self.mode,
            spectrum_gain: self.uniforms.visual[0],
            waveform_gain: self.uniforms.visual[1],
            exposure: self.uniforms.visual[2],
            hue: self.uniforms.transform[0],
            line_width: self.uniforms.transform[1],
            zoom: self.uniforms.transform[2],
            rotation: self.uniforms.transform[3],
            audio_sequence: self.audio_sequence,
            fps: self.measured_fps,
            frame_time_ms: self.measured_frame_time_ms,
            frame_count: self.frame_count,
            running: true,
            last_error: self.last_error.clone(),
        }
    }

    fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "spectrum_gain" => self.uniforms.visual[0] = value.clamp(0.1, 8.0),
            "waveform_gain" => self.uniforms.visual[1] = value.clamp(0.1, 5.0),
            "exposure" => self.uniforms.visual[2] = value.clamp(0.1, 4.0),
            "hue" => self.uniforms.transform[0] = value.rem_euclid(1.0),
            "line_width" => self.uniforms.transform[1] = value.clamp(0.5, 12.0),
            "zoom" => self.uniforms.transform[2] = value.clamp(0.4, 3.0),
            "rotation" => self.uniforms.transform[3] = value,
            _ => {}
        }
    }

    fn reset_params(&mut self) {
        self.uniforms.visual = [DEFAULT_SPECTRUM_GAIN, DEFAULT_WAVEFORM_GAIN, DEFAULT_EXPOSURE, self.mode as f32];
        self.uniforms.transform = [DEFAULT_HUE, DEFAULT_LINE_WIDTH, DEFAULT_ZOOM, DEFAULT_ROTATION];
    }

    fn resize(&mut self, width: u32, height: u32) {
        self.width = width.max(1);
        self.height = height.max(1);
        self.minimized = width == 0 || height == 0;
        if !self.minimized {
            self.config.width = self.width;
            self.config.height = self.height;
            self.surface.configure(&self.device, &self.config);
        }
    }

    fn handle_commands(&mut self, rx: &Receiver<RenderCommand>) -> bool {
        loop {
            match rx.try_recv() {
                Ok(RenderCommand::Resize(width, height)) => self.resize(width, height),
                Ok(RenderCommand::SetParam(name, value)) => self.set_param(&name, value),
                Ok(RenderCommand::SetMode(mode)) => {
                    self.mode = mode.min(3);
                    self.uniforms.visual[3] = self.mode as f32;
                }
                Ok(RenderCommand::ResetParams) => self.reset_params(),
                Ok(RenderCommand::Shutdown) => return false,
                Err(TryRecvError::Empty) => return true,
                Err(TryRecvError::Disconnected) => return false,
            }
        }
    }

    fn render(&mut self) -> Result<(), String> {
        let now = Instant::now();
        let delta = now.duration_since(self.last_frame).as_secs_f64();
        self.last_frame = now;
        if delta > 0.0 {
            self.measured_fps = 1.0 / delta;
            self.measured_frame_time_ms = delta * 1000.0;
        }

        let snapshot = self
            .audio_snapshot
            .read()
            .expect("audio snapshot poisoned")
            .clone();
        self.audio_sequence = snapshot.sequence;
        self.uniforms.resolution_time = [
            self.width as f32,
            self.height as f32,
            self.started.elapsed().as_secs_f32(),
            self.frame_count as f32,
        ];
        self.uniforms.levels = [
            snapshot.rms,
            snapshot.peak,
            snapshot.transient,
            snapshot.centroid_normalized,
        ];
        self.uniforms.bands = [
            snapshot.bass,
            snapshot.low_mid,
            snapshot.high_mid,
            snapshot.treble,
        ];
        self.uniforms.visual[3] = self.mode as f32;

        let audio_data = AudioGpuData {
            spectrum: snapshot.spectrum,
            waveform: snapshot.waveform,
        };
        self.queue
            .write_buffer(&self.uniform_buffer, 0, bytemuck::bytes_of(&self.uniforms));
        self.queue
            .write_buffer(&self.audio_buffer, 0, bytemuck::bytes_of(&audio_data));

        let (frame, reconfigure_after_present) = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(frame) => (frame, false),
            wgpu::CurrentSurfaceTexture::Suboptimal(frame) => (frame, true),
            wgpu::CurrentSurfaceTexture::Timeout | wgpu::CurrentSurfaceTexture::Occluded => {
                return Ok(());
            }
            wgpu::CurrentSurfaceTexture::Outdated => {
                self.surface.configure(&self.device, &self.config);
                return Ok(());
            }
            wgpu::CurrentSurfaceTexture::Lost => {
                self.recreate_surface()?;
                return Ok(());
            }
            wgpu::CurrentSurfaceTexture::Validation => {
                return Err("surface validation error while acquiring the next frame".into());
            }
        };
        let view = frame.texture.create_view(&wgpu::TextureViewDescriptor::default());
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("audio spectrum command encoder"),
            });
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("audio spectrum render pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    depth_slice: None,
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
            pass.set_bind_group(0, &self.bind_group, &[]);
            pass.draw(0..3, 0..1);
        }
        self.queue.submit([encoder.finish()]);
        frame.present();
        if reconfigure_after_present {
            self.surface.configure(&self.device, &self.config);
        }
        self.frame_count = self.frame_count.wrapping_add(1);
        Ok(())
    }

    fn recreate_surface(&mut self) -> Result<(), String> {
        self.surface = self
            .instance
            .create_surface(self.window.clone())
            .map_err(|error| format!("could not recreate GPU surface: {error}"))?;
        self.surface.configure(&self.device, &self.config);
        Ok(())
    }

    fn run(
        &mut self,
        rx: Receiver<RenderCommand>,
        info: Arc<RwLock<RendererInfo>>,
        alive: Arc<AtomicBool>,
    ) {
        while alive.load(Ordering::Relaxed) {
            if !self.handle_commands(&rx) {
                break;
            }
            if self.minimized {
                thread::sleep(Duration::from_millis(16));
                continue;
            }

            match self.render() {
                Ok(()) => self.last_error.clear(),
                Err(error) => {
                    self.last_error = error;
                    thread::sleep(Duration::from_millis(16));
                }
            }

            *info.write().expect("renderer info poisoned") = self.info();
        }
        alive.store(false, Ordering::Relaxed);
    }
}
