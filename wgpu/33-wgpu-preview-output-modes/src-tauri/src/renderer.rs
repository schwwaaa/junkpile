use crate::{
    config::{PreviewConfig, PreviewScaleMode},
    frame::FrameDescriptor,
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

const RENDER_TARGET_FPS: u32 = 60;
const AUTHORITATIVE_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8UnormSrgb;

type Reply<T> = SyncSender<Result<T, String>>;

pub enum RenderCommand {
    Resize(u32, u32),
    SetMode {
        mode: PreviewScaleMode,
        reply: Reply<()>,
    },
    SetEnabled {
        enabled: bool,
        reply: Reply<()>,
    },
    SetSourceResolution {
        width: u32,
        height: u32,
        reply: Reply<()>,
    },
    ApplyConfig {
        config: PreviewConfig,
        reply: Reply<()>,
    },
    ResetMetrics,
    Shutdown,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RendererInfo {
    pub backend: String,
    pub adapter_name: String,
    pub device_type: String,
    pub driver: String,
    pub driver_info: String,
    pub surface_format: String,
    pub window_width: u32,
    pub window_height: u32,
    pub fps: f64,
    pub frame_time_ms: f64,
    pub frame_count: u64,
    pub target_fps: u32,
    pub max_texture_dimension_2d: u32,
    pub running: bool,
    pub last_error: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSnapshot {
    pub renderer: RendererInfo,
    pub frame: FrameDescriptor,
    pub preview: PreviewStatus,
    pub contract_summary: String,
}

#[derive(Clone)]
pub struct RendererHandle {
    tx: SyncSender<RenderCommand>,
    snapshot: Arc<RwLock<RuntimeSnapshot>>,
}

impl RendererHandle {
    pub fn snapshot(&self) -> RuntimeSnapshot {
        self.snapshot
            .read()
            .expect("renderer snapshot poisoned")
            .clone()
    }

    pub fn send(&self, command: RenderCommand) -> Result<(), String> {
        self.tx.try_send(command).map_err(|error| match error {
            TrySendError::Full(_) => "renderer command queue is full".into(),
            TrySendError::Disconnected(_) => "renderer command queue is disconnected".into(),
        })
    }

    fn request(&self, command: impl FnOnce(Reply<()>) -> RenderCommand) -> Result<(), String> {
        let (reply, response) = sync_channel(1);
        self.send(command(reply))?;
        response
            .recv_timeout(Duration::from_secs(5))
            .map_err(|_| "renderer did not answer the request".to_string())?
    }

    pub fn set_mode(&self, mode: PreviewScaleMode) -> Result<(), String> {
        self.request(|reply| RenderCommand::SetMode { mode, reply })
    }

    pub fn set_enabled(&self, enabled: bool) -> Result<(), String> {
        self.request(|reply| RenderCommand::SetEnabled { enabled, reply })
    }

    pub fn set_source_resolution(&self, width: u32, height: u32) -> Result<(), String> {
        self.request(|reply| RenderCommand::SetSourceResolution {
            width,
            height,
            reply,
        })
    }

    pub fn apply_config(&self, config: PreviewConfig) -> Result<(), String> {
        self.request(|reply| RenderCommand::ApplyConfig { config, reply })
    }
}

pub fn start(window: tauri::Window, initial_config: PreviewConfig) -> Result<RendererHandle, String> {
    let (tx, rx) = sync_channel(128);
    let alive = Arc::new(AtomicBool::new(true));
    let mut renderer = pollster::block_on(Renderer::new(window, initial_config))?;
    let snapshot = Arc::new(RwLock::new(renderer.snapshot()));
    let thread_snapshot = Arc::clone(&snapshot);
    let thread_alive = Arc::clone(&alive);

    thread::Builder::new()
        .name("junkpile-wgpu-preview-output-modes".into())
        .spawn(move || renderer.run(rx, thread_snapshot, thread_alive))
        .map_err(|error| format!("could not start renderer thread: {error}"))?;

    Ok(RendererHandle { tx, snapshot })
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct SourceUniforms {
    timing: [f32; 4],
    resolution: [f32; 4],
}

struct Renderer {
    window: tauri::Window,
    instance: wgpu::Instance,
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    surface_config: wgpu::SurfaceConfiguration,
    adapter_info: wgpu::AdapterInfo,
    source_pipeline: wgpu::RenderPipeline,
    source_uniform_buffer: wgpu::Buffer,
    source_bind_group: wgpu::BindGroup,
    source_uniforms: SourceUniforms,
    authoritative_texture: wgpu::Texture,
    authoritative_view: wgpu::TextureView,
    frame_descriptor: FrameDescriptor,
    preview: PreviewSink,
    width: u32,
    height: u32,
    minimized: bool,
    started: Instant,
    frame_count: u64,
    measured_fps: f64,
    frame_time_ms: f64,
    last_error: String,
    max_texture_dimension_2d: u32,
}

impl Renderer {
    async fn new(window: tauri::Window, config: PreviewConfig) -> Result<Self, String> {
        config.validate()?;
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
                compatible_surface: Some(&surface),
                force_fallback_adapter: false,
            })
            .await
            .map_err(|error| format!("no compatible GPU adapter: {error}"))?;
        let adapter_info = adapter.get_info();
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("junkpile preview output modes device"),
                required_features: wgpu::Features::empty(),
                required_limits: wgpu::Limits::default(),
                memory_hints: wgpu::MemoryHints::Performance,
                trace: wgpu::Trace::Off,
                ..Default::default()
            })
            .await
            .map_err(|error| format!("could not create GPU device: {error}"))?;

        let max_texture_dimension_2d = device.limits().max_texture_dimension_2d;
        validate_source_dimensions(
            config.source.width,
            config.source.height,
            max_texture_dimension_2d,
        )?;

        let mut surface_config = surface
            .get_default_config(&adapter, width, height)
            .ok_or_else(|| "adapter cannot present to this surface".to_string())?;
        surface_config.present_mode = wgpu::PresentMode::Fifo;
        surface.configure(&device, &surface_config);

        let (authoritative_texture, authoritative_view) = create_authoritative_target(
            &device,
            config.source.width,
            config.source.height,
        );

        let source_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("preview modes diagnostic source shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("source.wgsl").into()),
        });
        let source_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("preview modes source bind group layout"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            }],
        });
        let source_uniforms = SourceUniforms {
            timing: [0.0; 4],
            resolution: [
                config.source.width as f32,
                config.source.height as f32,
                0.0,
                0.0,
            ],
        };
        let source_uniform_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("preview modes source uniforms"),
            contents: bytemuck::bytes_of(&source_uniforms),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });
        let source_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("preview modes source bind group"),
            layout: &source_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: source_uniform_buffer.as_entire_binding(),
            }],
        });
        let source_pipeline_layout =
            device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("preview modes source pipeline layout"),
                bind_group_layouts: &[Some(&source_layout)],
                immediate_size: 0,
            });
        let source_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("preview modes source pipeline"),
            layout: Some(&source_pipeline_layout),
            vertex: wgpu::VertexState {
                module: &source_shader,
                entry_point: Some("vs_main"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            fragment: Some(wgpu::FragmentState {
                module: &source_shader,
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
            surface_config.format,
            &authoritative_view,
            width,
            height,
            config.source.width,
            config.source.height,
            config.scale_mode,
            config.enabled,
        );

        Ok(Self {
            window,
            instance,
            surface,
            device,
            queue,
            surface_config,
            adapter_info,
            source_pipeline,
            source_uniform_buffer,
            source_bind_group,
            source_uniforms,
            authoritative_texture,
            authoritative_view,
            frame_descriptor: FrameDescriptor::rgba_srgb(
                config.source.width,
                config.source.height,
                RENDER_TARGET_FPS,
            ),
            preview,
            width,
            height,
            minimized: false,
            started: Instant::now(),
            frame_count: 0,
            measured_fps: 0.0,
            frame_time_ms: 0.0,
            last_error: String::new(),
            max_texture_dimension_2d,
        })
    }

    fn renderer_info(&self) -> RendererInfo {
        RendererInfo {
            backend: format!("{:?}", self.adapter_info.backend),
            adapter_name: self.adapter_info.name.clone(),
            device_type: format!("{:?}", self.adapter_info.device_type),
            driver: self.adapter_info.driver.clone(),
            driver_info: self.adapter_info.driver_info.clone(),
            surface_format: format!("{:?}", self.surface_config.format),
            window_width: self.width,
            window_height: self.height,
            fps: self.measured_fps,
            frame_time_ms: self.frame_time_ms,
            frame_count: self.frame_count,
            target_fps: RENDER_TARGET_FPS,
            max_texture_dimension_2d: self.max_texture_dimension_2d,
            running: true,
            last_error: self.last_error.clone(),
        }
    }

    fn snapshot(&self) -> RuntimeSnapshot {
        RuntimeSnapshot {
            renderer: self.renderer_info(),
            frame: self.frame_descriptor.clone(),
            preview: self.preview.status(),
            contract_summary: "The renderer always draws one authoritative offscreen wgpu texture. The preview is an independent presentation sink that may fit, fill, stretch, display at exact 1:1 pixels, or be disabled without changing the source texture or stopping rendering.".into(),
        }
    }

    fn set_source_resolution(&mut self, width: u32, height: u32) -> Result<(), String> {
        validate_source_dimensions(width, height, self.max_texture_dimension_2d)?;
        if self.frame_descriptor.width == width && self.frame_descriptor.height == height {
            return Ok(());
        }
        let (texture, view) = create_authoritative_target(&self.device, width, height);
        self.authoritative_texture = texture;
        self.authoritative_view = view;
        self.frame_descriptor = FrameDescriptor::rgba_srgb(width, height, RENDER_TARGET_FPS);
        self.source_uniforms.resolution = [width as f32, height as f32, 0.0, 0.0];
        self.queue.write_buffer(
            &self.source_uniform_buffer,
            0,
            bytemuck::bytes_of(&self.source_uniforms),
        );
        self.preview
            .update_source(&self.device, &self.authoritative_view, width, height);
        Ok(())
    }

    fn apply_config(&mut self, config: PreviewConfig) -> Result<(), String> {
        config.validate()?;
        self.set_source_resolution(config.source.width, config.source.height)?;
        self.preview.set_mode(config.scale_mode);
        self.preview.set_enabled(config.enabled);
        Ok(())
    }

    fn render(&mut self) -> Result<(), String> {
        self.source_uniforms.timing[0] = self.started.elapsed().as_secs_f32();
        self.source_uniforms.timing[1] = self.frame_count as f32;
        self.queue.write_buffer(
            &self.source_uniform_buffer,
            0,
            bytemuck::bytes_of(&self.source_uniforms),
        );

        let surface_output = if !self.preview.is_enabled() {
            self.preview.mark_hidden();
            None
        } else if self.minimized {
            self.preview.mark_unavailable();
            None
        } else {
            match self.surface.get_current_texture() {
                wgpu::CurrentSurfaceTexture::Success(frame) => Some((frame, false)),
                wgpu::CurrentSurfaceTexture::Suboptimal(frame) => Some((frame, true)),
                wgpu::CurrentSurfaceTexture::Timeout | wgpu::CurrentSurfaceTexture::Occluded => {
                    self.preview.mark_unavailable();
                    None
                }
                wgpu::CurrentSurfaceTexture::Outdated => {
                    self.surface.configure(&self.device, &self.surface_config);
                    self.preview.mark_unavailable();
                    None
                }
                wgpu::CurrentSurfaceTexture::Lost => {
                    self.recreate_surface()?;
                    self.preview.mark_unavailable();
                    None
                }
                wgpu::CurrentSurfaceTexture::Validation => {
                    self.preview.mark_unavailable();
                    self.last_error =
                        "preview surface validation error; offscreen rendering continues".into();
                    None
                }
            }
        };

        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("preview output modes frame encoder"),
            });

        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("preview modes authoritative render pass"),
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

        if let Some((surface_frame, reconfigure)) = surface_output {
            let surface_view = surface_frame
                .texture
                .create_view(&wgpu::TextureViewDescriptor::default());
            self.preview.submit(
                &self.queue,
                &mut encoder,
                &surface_view,
                self.frame_count,
            );
            self.queue.submit([encoder.finish()]);
            surface_frame.present();
            if reconfigure {
                self.surface.configure(&self.device, &self.surface_config);
            }
        } else {
            self.queue.submit([encoder.finish()]);
        }
        Ok(())
    }

    fn run(
        &mut self,
        rx: Receiver<RenderCommand>,
        shared: Arc<RwLock<RuntimeSnapshot>>,
        alive: Arc<AtomicBool>,
    ) {
        let mut metrics_started = Instant::now();
        let mut metrics_frames = 0u64;

        while alive.load(Ordering::Relaxed) {
            let frame_started = Instant::now();
            loop {
                match rx.try_recv() {
                    Ok(RenderCommand::Resize(width, height)) => self.resize(width, height),
                    Ok(RenderCommand::SetMode { mode, reply }) => {
                        self.preview.set_mode(mode);
                        let _ = reply.send(Ok(()));
                    }
                    Ok(RenderCommand::SetEnabled { enabled, reply }) => {
                        self.preview.set_enabled(enabled);
                        let _ = reply.send(Ok(()));
                    }
                    Ok(RenderCommand::SetSourceResolution {
                        width,
                        height,
                        reply,
                    }) => {
                        let _ = reply.send(self.set_source_resolution(width, height));
                    }
                    Ok(RenderCommand::ApplyConfig { config, reply }) => {
                        let _ = reply.send(self.apply_config(config));
                    }
                    Ok(RenderCommand::ResetMetrics) => self.preview.reset_metrics(),
                    Ok(RenderCommand::Shutdown) | Err(TryRecvError::Disconnected) => {
                        alive.store(false, Ordering::Relaxed);
                        break;
                    }
                    Err(TryRecvError::Empty) => break,
                }
            }

            if !alive.load(Ordering::Relaxed) {
                break;
            }
            if let Err(error) = self.render() {
                self.last_error = error;
                thread::sleep(Duration::from_millis(100));
            } else {
                self.last_error.clear();
            }

            self.frame_count = self.frame_count.saturating_add(1);
            metrics_frames = metrics_frames.saturating_add(1);
            self.frame_time_ms = frame_started.elapsed().as_secs_f64() * 1000.0;
            let elapsed = metrics_started.elapsed();
            if elapsed >= Duration::from_millis(400) {
                self.measured_fps = metrics_frames as f64 / elapsed.as_secs_f64();
                if let Ok(mut snapshot) = shared.write() {
                    *snapshot = self.snapshot();
                }
                metrics_frames = 0;
                metrics_started = Instant::now();
            }

            let frame_budget = Duration::from_secs_f64(1.0 / RENDER_TARGET_FPS as f64);
            let remaining = frame_budget.saturating_sub(frame_started.elapsed());
            if !remaining.is_zero() {
                thread::sleep(remaining);
            }
        }

        if let Ok(mut snapshot) = shared.write() {
            snapshot.renderer.running = false;
        }
    }

    fn resize(&mut self, width: u32, height: u32) {
        self.width = width;
        self.height = height;
        self.minimized = width == 0 || height == 0;
        if !self.minimized {
            self.surface_config.width = width;
            self.surface_config.height = height;
            self.surface.configure(&self.device, &self.surface_config);
            self.preview.resize(width, height);
        }
    }

    fn recreate_surface(&mut self) -> Result<(), String> {
        self.surface = self
            .instance
            .create_surface(self.window.clone())
            .map_err(|error| format!("could not recreate GPU surface: {error}"))?;
        self.surface.configure(&self.device, &self.surface_config);
        Ok(())
    }
}

fn validate_source_dimensions(width: u32, height: u32, maximum: u32) -> Result<(), String> {
    if width < 16 || height < 16 {
        return Err("source width and height must both be at least 16 pixels".into());
    }
    if width > maximum || height > maximum {
        return Err(format!(
            "requested source {width}×{height} exceeds this GPU's maximum 2D texture dimension of {maximum}"
        ));
    }
    Ok(())
}

fn create_authoritative_target(
    device: &wgpu::Device,
    width: u32,
    height: u32,
) -> (wgpu::Texture, wgpu::TextureView) {
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("preview modes authoritative texture"),
        size: wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: AUTHORITATIVE_FORMAT,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    (texture, view)
}
