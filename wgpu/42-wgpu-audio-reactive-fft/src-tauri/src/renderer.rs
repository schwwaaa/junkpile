use crate::{
    audio::{AudioAnalysisFrame, AudioShared, FFT_BINS, WAVE_BINS},
    config::PreviewScaleMode,
    preview::{PreviewSink, PreviewStatus},
};
use bytemuck::{Pod, Zeroable};
use serde::Serialize;
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{sync_channel, Receiver, SyncSender, TryRecvError, TrySendError},
        Arc, RwLock,
    },
    thread,
    time::{Duration, Instant},
};
use wgpu::util::DeviceExt;

const TARGET_FPS: u32 = 60;
const DEFAULT_WIDTH: u32 = 1920;
const DEFAULT_HEIGHT: u32 = 1080;
const AUTHORITATIVE_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8UnormSrgb;

type Reply<T> = SyncSender<Result<T, String>>;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolutionPreset {
    pub label: String,
    pub width: u32,
    pub height: u32,
    pub supported: bool,
    pub approximate_mebibytes: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RendererSnapshot {
    pub backend: String,
    pub adapter_name: String,
    pub device_type: String,
    pub driver: String,
    pub driver_info: String,
    pub surface_format: String,
    pub window_width: u32,
    pub window_height: u32,
    pub render_width: u32,
    pub render_height: u32,
    pub max_texture_dimension_2d: u32,
    pub fps: f64,
    pub frame_time_ms: f64,
    pub frame_count: u64,
    pub visual_mode: u32,
    pub visual_mode_name: String,
    pub reactivity: f32,
    pub spin_speed: f32,
    pub hue_shift: f32,
    pub demo_when_idle: bool,
    pub audio_source_live: bool,
    pub preview: PreviewStatus,
    pub resolution_presets: Vec<ResolutionPreset>,
    pub last_error: String,
}

pub enum RenderCommand {
    Resize(u32, u32),
    SetVisualMode { mode: u32, reply: Reply<()> },
    SetVisualParameter { name: String, value: f32, reply: Reply<()> },
    SetDemoWhenIdle { enabled: bool, reply: Reply<()> },
    SetResolution { width: u32, height: u32, reply: Reply<()> },
    SetPreviewMode { mode: PreviewScaleMode, reply: Reply<()> },
    ResetMetrics,
    Shutdown,
}

#[derive(Clone)]
pub struct RendererHandle {
    tx: SyncSender<RenderCommand>,
    snapshot: Arc<RwLock<RendererSnapshot>>,
}

impl RendererHandle {
    pub fn snapshot(&self) -> RendererSnapshot {
        self.snapshot.read().expect("renderer snapshot lock poisoned").clone()
    }

    pub fn send(&self, command: RenderCommand) -> Result<(), String> {
        self.tx.try_send(command).map_err(|error| match error {
            TrySendError::Full(_) => "renderer command queue is full".into(),
            TrySendError::Disconnected(_) => "renderer thread is unavailable".into(),
        })
    }

    fn request(&self, command: impl FnOnce(Reply<()>) -> RenderCommand) -> Result<(), String> {
        let (reply, response) = sync_channel(1);
        self.send(command(reply))?;
        response
            .recv_timeout(Duration::from_secs(8))
            .map_err(|_| "renderer did not answer the request".to_string())?
    }

    pub fn set_visual_mode(&self, mode: u32) -> Result<(), String> {
        self.request(|reply| RenderCommand::SetVisualMode { mode, reply })
    }

    pub fn set_visual_parameter(&self, name: String, value: f32) -> Result<(), String> {
        self.request(|reply| RenderCommand::SetVisualParameter { name, value, reply })
    }

    pub fn set_demo_when_idle(&self, enabled: bool) -> Result<(), String> {
        self.request(|reply| RenderCommand::SetDemoWhenIdle { enabled, reply })
    }

    pub fn set_resolution(&self, width: u32, height: u32) -> Result<(), String> {
        self.request(|reply| RenderCommand::SetResolution { width, height, reply })
    }

    pub fn set_preview_mode(&self, mode: PreviewScaleMode) -> Result<(), String> {
        self.request(|reply| RenderCommand::SetPreviewMode { mode, reply })
    }
}

pub fn start(window: tauri::Window, audio: AudioShared) -> Result<RendererHandle, String> {
    let (tx, rx) = sync_channel(128);
    let alive = Arc::new(AtomicBool::new(true));
    let mut renderer = pollster::block_on(Renderer::new(window, audio))?;
    let snapshot = Arc::new(RwLock::new(renderer.snapshot()));
    let thread_snapshot = Arc::clone(&snapshot);
    let thread_alive = Arc::clone(&alive);
    thread::Builder::new()
        .name("junkpile-wgpu-audio-reactive-fft-renderer".into())
        .spawn(move || renderer.run(rx, thread_snapshot, thread_alive))
        .map_err(|error| format!("could not start renderer thread: {error}"))?;
    Ok(RendererHandle { tx, snapshot })
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct VisualUniforms {
    time_params: [f32; 4],
    audio: [f32; 4],
    beat: [f32; 4],
    resolution: [f32; 4],
    mode: [u32; 4],
}

struct Renderer {
    window: tauri::Window,
    _instance: wgpu::Instance,
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    surface_config: wgpu::SurfaceConfiguration,
    adapter_info: wgpu::AdapterInfo,
    max_texture_dimension_2d: u32,
    source_pipeline: wgpu::RenderPipeline,
    source_bind_group_layout: wgpu::BindGroupLayout,
    source_bind_group: wgpu::BindGroup,
    uniform_buffer: wgpu::Buffer,
    audio_sampler: wgpu::Sampler,
    fft_texture: wgpu::Texture,
    fft_view: wgpu::TextureView,
    waveform_texture: wgpu::Texture,
    waveform_view: wgpu::TextureView,
    authoritative_texture: wgpu::Texture,
    authoritative_view: wgpu::TextureView,
    preview: PreviewSink,
    audio: AudioShared,
    width: u32,
    height: u32,
    render_width: u32,
    render_height: u32,
    minimized: bool,
    visual_mode: u32,
    reactivity: f32,
    spin_speed: f32,
    hue_shift: f32,
    demo_when_idle: bool,
    started: Instant,
    frame_count: u64,
    measured_fps: f64,
    frame_time_ms: f64,
    last_error: String,
}

impl Renderer {
    async fn new(window: tauri::Window, audio: AudioShared) -> Result<Self, String> {
        let size = window.inner_size().map_err(|error| error.to_string())?;
        let width = size.width.max(1);
        let height = size.height.max(1);
        let instance = wgpu::Instance::default();
        let surface = instance
            .create_surface(window.clone())
            .map_err(|error| format!("could not create GPU surface: {error}"))?;
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                force_fallback_adapter: false,
                compatible_surface: Some(&surface),
            })
            .await
            .map_err(|error| format!("could not select GPU adapter: {error}"))?;
        let adapter_info = adapter.get_info();
        let limits = adapter.limits();
        let max_texture_dimension_2d = limits.max_texture_dimension_2d;
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("audio reactive FFT device"),
                required_features: wgpu::Features::empty(),
                required_limits: wgpu::Limits::default(),
                memory_hints: wgpu::MemoryHints::Performance,
                trace: wgpu::Trace::Off,
                ..Default::default()
            })
            .await
            .map_err(|error| format!("could not create GPU device: {error}"))?;

        let mut surface_config = surface
            .get_default_config(&adapter, width, height)
            .ok_or_else(|| "adapter cannot present to this surface".to_string())?;
        surface_config.present_mode = wgpu::PresentMode::Fifo;
        let surface_format = surface_config.format;
        surface.configure(&device, &surface_config);

        let (authoritative_texture, authoritative_view) = create_authoritative_target(
            &device,
            DEFAULT_WIDTH.min(max_texture_dimension_2d),
            DEFAULT_HEIGHT.min(max_texture_dimension_2d),
        );
        let (fft_texture, fft_view) = create_audio_texture(&device, FFT_BINS as u32, "FFT spectrum texture");
        let (waveform_texture, waveform_view) =
            create_audio_texture(&device, WAVE_BINS as u32, "waveform texture");
        let audio_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("audio analysis sampler"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            ..Default::default()
        });

        let uniforms = VisualUniforms {
            time_params: [0.0, 0.35, 1.0, 0.0],
            audio: [0.0; 4],
            beat: [0.0; 4],
            resolution: [DEFAULT_WIDTH as f32, DEFAULT_HEIGHT as f32, FFT_BINS as f32, WAVE_BINS as f32],
            mode: [0, 0, 0, 0],
        };
        let uniform_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("audio reactive uniforms"),
            contents: bytemuck::bytes_of(&uniforms),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });
        let source_bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("audio reactive source layout"),
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
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 3,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });
        let source_bind_group = create_source_bind_group(
            &device,
            &source_bind_group_layout,
            &uniform_buffer,
            &fft_view,
            &waveform_view,
            &audio_sampler,
        );
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("audio reactive FFT WGSL"),
            source: wgpu::ShaderSource::Wgsl(include_str!("visuals.wgsl").into()),
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("audio reactive pipeline layout"),
            bind_group_layouts: &[Some(&source_bind_group_layout)],
            immediate_size: 0,
        });
        let source_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("audio reactive pipeline"),
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
                    format: AUTHORITATIVE_FORMAT,
                    blend: Some(wgpu::BlendState::REPLACE),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            multiview_mask: None,
            cache: None,
        });
        let preview = PreviewSink::new(
            &device,
            surface_format,
            &authoritative_view,
            width,
            height,
            DEFAULT_WIDTH.min(max_texture_dimension_2d),
            DEFAULT_HEIGHT.min(max_texture_dimension_2d),
            PreviewScaleMode::Fit,
            true,
        );

        Ok(Self {
            window,
            _instance: instance,
            surface,
            device,
            queue,
            surface_config,
            adapter_info,
            max_texture_dimension_2d,
            source_pipeline,
            source_bind_group_layout,
            source_bind_group,
            uniform_buffer,
            audio_sampler,
            fft_texture,
            fft_view,
            waveform_texture,
            waveform_view,
            authoritative_texture,
            authoritative_view,
            preview,
            audio,
            width,
            height,
            render_width: DEFAULT_WIDTH.min(max_texture_dimension_2d),
            render_height: DEFAULT_HEIGHT.min(max_texture_dimension_2d),
            minimized: false,
            visual_mode: 0,
            reactivity: 1.0,
            spin_speed: 0.35,
            hue_shift: 0.0,
            demo_when_idle: true,
            started: Instant::now(),
            frame_count: 0,
            measured_fps: 0.0,
            frame_time_ms: 0.0,
            last_error: String::new(),
        })
    }

    fn run(
        &mut self,
        rx: Receiver<RenderCommand>,
        snapshot: Arc<RwLock<RendererSnapshot>>,
        alive: Arc<AtomicBool>,
    ) {
        let frame_budget = Duration::from_secs_f64(1.0 / TARGET_FPS as f64);
        let mut fps_window = Instant::now();
        let mut fps_frames = 0_u64;
        while alive.load(Ordering::Relaxed) {
            let frame_started = Instant::now();
            loop {
                match rx.try_recv() {
                    Ok(command) => {
                        if !self.handle_command(command, &alive) {
                            break;
                        }
                    }
                    Err(TryRecvError::Empty) => break,
                    Err(TryRecvError::Disconnected) => {
                        alive.store(false, Ordering::Relaxed);
                        break;
                    }
                }
            }
            if !alive.load(Ordering::Relaxed) {
                break;
            }

            if let Err(error) = self.render_frame() {
                self.last_error = error;
            }
            self.frame_count = self.frame_count.saturating_add(1);
            fps_frames = fps_frames.saturating_add(1);
            if fps_window.elapsed() >= Duration::from_secs(1) {
                self.measured_fps = fps_frames as f64 / fps_window.elapsed().as_secs_f64();
                fps_frames = 0;
                fps_window = Instant::now();
            }
            self.frame_time_ms = frame_started.elapsed().as_secs_f64() * 1000.0;
            *snapshot.write().expect("renderer snapshot lock poisoned") = self.snapshot();

            let elapsed = frame_started.elapsed();
            if elapsed < frame_budget {
                thread::sleep(frame_budget - elapsed);
            }
        }
    }

    fn handle_command(&mut self, command: RenderCommand, alive: &Arc<AtomicBool>) -> bool {
        match command {
            RenderCommand::Resize(width, height) => self.resize(width, height),
            RenderCommand::SetVisualMode { mode, reply } => {
                self.visual_mode = mode.min(5);
                let _ = reply.send(Ok(()));
            }
            RenderCommand::SetVisualParameter { name, value, reply } => {
                let result = match name.as_str() {
                    "reactivity" => {
                        self.reactivity = value.clamp(0.0, 4.0);
                        Ok(())
                    }
                    "spin" => {
                        self.spin_speed = value.clamp(-4.0, 4.0);
                        Ok(())
                    }
                    "hue" => {
                        self.hue_shift = value.rem_euclid(1.0);
                        Ok(())
                    }
                    _ => Err(format!("unknown visual parameter '{name}'")),
                };
                let _ = reply.send(result);
            }
            RenderCommand::SetDemoWhenIdle { enabled, reply } => {
                self.demo_when_idle = enabled;
                let _ = reply.send(Ok(()));
            }
            RenderCommand::SetResolution { width, height, reply } => {
                let result = self.reconfigure_authoritative(width, height);
                let _ = reply.send(result);
            }
            RenderCommand::SetPreviewMode { mode, reply } => {
                self.preview.set_mode(mode);
                let _ = reply.send(Ok(()));
            }
            RenderCommand::ResetMetrics => {
                self.frame_count = 0;
                self.preview.reset_metrics();
            }
            RenderCommand::Shutdown => {
                alive.store(false, Ordering::Relaxed);
                return false;
            }
        }
        true
    }

    fn resize(&mut self, width: u32, height: u32) {
        if width == 0 || height == 0 {
            self.minimized = true;
            return;
        }
        self.minimized = false;
        self.width = width;
        self.height = height;
        self.surface_config.width = width;
        self.surface_config.height = height;
        self.surface.configure(&self.device, &self.surface_config);
        self.preview.resize(width, height);
    }

    fn reconfigure_authoritative(&mut self, width: u32, height: u32) -> Result<(), String> {
        if width == 0 || height == 0 {
            return Err("render resolution must be non-zero".into());
        }
        if width > self.max_texture_dimension_2d || height > self.max_texture_dimension_2d {
            return Err(format!(
                "{}x{} exceeds this adapter's max_texture_dimension_2d of {}",
                width, height, self.max_texture_dimension_2d
            ));
        }
        let (texture, view) = create_authoritative_target(&self.device, width, height);
        self.authoritative_texture = texture;
        self.authoritative_view = view;
        self.render_width = width;
        self.render_height = height;
        self.preview.update_source(&self.device, &self.authoritative_view, width, height);
        Ok(())
    }

    fn render_frame(&mut self) -> Result<(), String> {
        let elapsed = self.started.elapsed().as_secs_f32();
        let analysis = self.audio.frame();
        let effective = if analysis.running || !self.demo_when_idle {
            analysis
        } else {
            demo_analysis(elapsed)
        };
        self.upload_audio_textures(&effective);
        let uniforms = VisualUniforms {
            time_params: [elapsed, self.spin_speed, self.reactivity, self.hue_shift],
            audio: [effective.rms, effective.bass, effective.mid, effective.treble],
            beat: [effective.peak, effective.beat_pulse, if effective.running { 1.0 } else { 0.0 }, 0.0],
            resolution: [
                self.render_width as f32,
                self.render_height as f32,
                FFT_BINS as f32,
                WAVE_BINS as f32,
            ],
            mode: [self.visual_mode, 0, 0, 0],
        };
        self.queue.write_buffer(&self.uniform_buffer, 0, bytemuck::bytes_of(&uniforms));

        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("audio reactive frame encoder"),
        });
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("audio reactive authoritative pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &self.authoritative_view,
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
            pass.set_pipeline(&self.source_pipeline);
            pass.set_bind_group(0, &self.source_bind_group, &[]);
            pass.draw(0..3, 0..1);
        }

        if !self.minimized {
            match self.surface.get_current_texture() {
                wgpu::CurrentSurfaceTexture::Success(frame) => {
                    let target = frame.texture.create_view(&wgpu::TextureViewDescriptor::default());
                    self.preview.submit(&self.queue, &mut encoder, &target, self.frame_count);
                    self.queue.submit([encoder.finish()]);
                    frame.present();
                    self.last_error.clear();
                    return Ok(());
                }
                wgpu::CurrentSurfaceTexture::Suboptimal(frame) => {
                    let target = frame.texture.create_view(&wgpu::TextureViewDescriptor::default());
                    self.preview.submit(&self.queue, &mut encoder, &target, self.frame_count);
                    self.queue.submit([encoder.finish()]);
                    frame.present();
                    self.surface.configure(&self.device, &self.surface_config);
                    self.last_error.clear();
                    return Ok(());
                }
                wgpu::CurrentSurfaceTexture::Timeout
                | wgpu::CurrentSurfaceTexture::Occluded => {
                    // These are transient presentation states. Keep the authoritative
                    // offscreen renderer alive and simply skip this preview frame.
                    self.preview.mark_unavailable();
                }
                wgpu::CurrentSurfaceTexture::Outdated => {
                    self.surface.configure(&self.device, &self.surface_config);
                    self.preview.mark_unavailable();
                }
                wgpu::CurrentSurfaceTexture::Lost => {
                    // wgpu 29 requires a lost surface to be recreated rather than
                    // handled through the pre-wgpu-29 result-based surface path.
                    self.surface = self
                        ._instance
                        .create_surface(self.window.clone())
                        .map_err(|error| format!("could not recreate lost GPU surface: {error}"))?;
                    self.surface.configure(&self.device, &self.surface_config);
                    self.preview.mark_unavailable();
                }
                wgpu::CurrentSurfaceTexture::Validation => {
                    self.preview.mark_unavailable();
                    self.queue.submit([encoder.finish()]);
                    return Err("surface acquisition hit a wgpu validation error".into());
                }
            }
        } else {
            self.preview.mark_hidden();
        }
        self.queue.submit([encoder.finish()]);
        Ok(())
    }

    fn upload_audio_textures(&self, analysis: &AudioAnalysisFrame) {
        let fft_bytes = encode_spectrum(&analysis.spectrum, FFT_BINS);
        self.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &self.fft_texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &fft_bytes,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some((FFT_BINS * 4) as u32),
                rows_per_image: Some(1),
            },
            wgpu::Extent3d {
                width: FFT_BINS as u32,
                height: 1,
                depth_or_array_layers: 1,
            },
        );
        let waveform_bytes = encode_waveform(&analysis.waveform, WAVE_BINS);
        self.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &self.waveform_texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &waveform_bytes,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some((WAVE_BINS * 4) as u32),
                rows_per_image: Some(1),
            },
            wgpu::Extent3d {
                width: WAVE_BINS as u32,
                height: 1,
                depth_or_array_layers: 1,
            },
        );
    }

    fn snapshot(&self) -> RendererSnapshot {
        RendererSnapshot {
            backend: format!("{:?}", self.adapter_info.backend),
            adapter_name: self.adapter_info.name.clone(),
            device_type: format!("{:?}", self.adapter_info.device_type),
            driver: self.adapter_info.driver.clone(),
            driver_info: self.adapter_info.driver_info.clone(),
            surface_format: format!("{:?}", self.surface_config.format),
            window_width: self.width,
            window_height: self.height,
            render_width: self.render_width,
            render_height: self.render_height,
            max_texture_dimension_2d: self.max_texture_dimension_2d,
            fps: self.measured_fps,
            frame_time_ms: self.frame_time_ms,
            frame_count: self.frame_count,
            visual_mode: self.visual_mode,
            visual_mode_name: visual_mode_name(self.visual_mode).to_string(),
            reactivity: self.reactivity,
            spin_speed: self.spin_speed,
            hue_shift: self.hue_shift,
            demo_when_idle: self.demo_when_idle,
            audio_source_live: self.audio.frame().running,
            preview: self.preview.status(),
            resolution_presets: resolution_presets(self.max_texture_dimension_2d),
            last_error: self.last_error.clone(),
        }
    }
}

fn create_authoritative_target(device: &wgpu::Device, width: u32, height: u32) -> (wgpu::Texture, wgpu::TextureView) {
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("audio reactive authoritative texture"),
        size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: AUTHORITATIVE_FORMAT,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    (texture, view)
}

fn create_audio_texture(device: &wgpu::Device, width: u32, label: &'static str) -> (wgpu::Texture, wgpu::TextureView) {
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some(label),
        size: wgpu::Extent3d { width, height: 1, depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    (texture, view)
}

fn create_source_bind_group(
    device: &wgpu::Device,
    layout: &wgpu::BindGroupLayout,
    uniform_buffer: &wgpu::Buffer,
    fft_view: &wgpu::TextureView,
    waveform_view: &wgpu::TextureView,
    sampler: &wgpu::Sampler,
) -> wgpu::BindGroup {
    device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("audio reactive source bind group"),
        layout,
        entries: &[
            wgpu::BindGroupEntry { binding: 0, resource: uniform_buffer.as_entire_binding() },
            wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(fft_view) },
            wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::TextureView(waveform_view) },
            wgpu::BindGroupEntry { binding: 3, resource: wgpu::BindingResource::Sampler(sampler) },
        ],
    })
}

fn encode_spectrum(values: &[f32], count: usize) -> Vec<u8> {
    let mut bytes = vec![0_u8; count * 4];
    for index in 0..count {
        let value = values.get(index).copied().unwrap_or(0.0).clamp(0.0, 1.0);
        let encoded = (value * 255.0).round() as u8;
        let offset = index * 4;
        bytes[offset] = encoded;
        bytes[offset + 1] = encoded;
        bytes[offset + 2] = encoded;
        bytes[offset + 3] = 255;
    }
    bytes
}

fn encode_waveform(values: &[f32], count: usize) -> Vec<u8> {
    let mut bytes = vec![0_u8; count * 4];
    for index in 0..count {
        let value = values.get(index).copied().unwrap_or(0.0).clamp(-1.0, 1.0) * 0.5 + 0.5;
        let encoded = (value * 255.0).round() as u8;
        let offset = index * 4;
        bytes[offset] = encoded;
        bytes[offset + 1] = encoded;
        bytes[offset + 2] = encoded;
        bytes[offset + 3] = 255;
    }
    bytes
}

fn demo_analysis(time: f32) -> AudioAnalysisFrame {
    let mut spectrum = vec![0.0_f32; FFT_BINS];
    for (index, value) in spectrum.iter_mut().enumerate() {
        let x = index as f32 / (FFT_BINS - 1) as f32;
        let bass = (x * 7.0 - (time * 0.8).sin() * 0.7).sin().abs().powf(5.0) * (1.0 - x).powf(1.4);
        let harmonics = ((x * 31.0 - time * 1.7).sin() * 0.5 + 0.5).powf(8.0) * 0.35;
        *value = (bass + harmonics).clamp(0.0, 1.0);
    }
    let mut waveform = vec![0.0_f32; WAVE_BINS];
    for (index, value) in waveform.iter_mut().enumerate() {
        let x = index as f32 / WAVE_BINS as f32;
        *value = (x * std::f32::consts::TAU * 5.0 + time * 2.2).sin() * 0.42
            + (x * std::f32::consts::TAU * 13.0 - time * 1.1).sin() * 0.14;
    }
    let pulse = ((time * 2.2).sin() * 0.5 + 0.5).powf(12.0);
    AudioAnalysisFrame {
        spectrum,
        waveform,
        rms: 0.28 + 0.10 * (time * 1.3).sin(),
        peak: 0.55 + 0.25 * (time * 1.7).sin().abs(),
        bass: 0.32 + 0.24 * (time * 2.2).sin().abs(),
        mid: 0.26 + 0.18 * (time * 1.4).cos().abs(),
        treble: 0.20 + 0.14 * (time * 2.8).sin().abs(),
        beat_pulse: pulse,
        running: false,
    }
}

fn visual_mode_name(mode: u32) -> &'static str {
    match mode {
        0 => "Spectrum Tunnel",
        1 => "Radial Bloom",
        2 => "Wave Scope",
        3 => "Bass Lattice",
        4 => "Spectral Nebula",
        5 => "Frequency Mandala",
        _ => "Spectrum Tunnel",
    }
}

fn resolution_presets(max_dimension: u32) -> Vec<ResolutionPreset> {
    [
        ("720p", 1280, 720),
        ("1080p", 1920, 1080),
        ("1440p", 2560, 1440),
        ("4K", 3840, 2160),
        ("5K", 5120, 2880),
        ("8K", 7680, 4320),
    ]
    .into_iter()
    .map(|(label, width, height)| ResolutionPreset {
        label: label.into(),
        width,
        height,
        supported: width <= max_dimension && height <= max_dimension,
        approximate_mebibytes: width as f64 * height as f64 * 4.0 / 1024.0 / 1024.0,
    })
    .collect()
}
