use bytemuck::{Pod, Zeroable};
use serde::Serialize;
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{sync_channel, Receiver, SyncSender, TryRecvError},
        Arc, RwLock,
    },
    thread,
    time::{Duration, Instant},
};
use wgpu::util::DeviceExt;

#[derive(Debug, Clone)]
pub enum RenderCommand {
    Resize(u32, u32),
    ApplyConfig(RendererConfigSnapshot),
    Shutdown,
}

#[derive(Debug, Clone)]
pub struct RendererConfigSnapshot {
    pub generation: u64,
    pub target_fps: u32,
    pub render_width: u32,
    pub render_height: u32,
    pub preview_width: u32,
    pub preview_height: u32,
    pub preview_enabled: bool,
    pub preview_scaling: f32,
    pub recording_width: u32,
    pub recording_height: u32,
    pub recording_enabled: bool,
    pub recording_fps: u32,
    pub streaming_width: u32,
    pub streaming_height: u32,
    pub streaming_enabled: bool,
    pub streaming_fps: u32,
    pub ndi_enabled: bool,
    pub shared_texture_enabled: bool,
    pub shared_texture_backend: f32,
}

impl Default for RendererConfigSnapshot {
    fn default() -> Self {
        Self {
            generation: 0,
            target_fps: 60,
            render_width: 1920,
            render_height: 1080,
            preview_width: 1280,
            preview_height: 720,
            preview_enabled: true,
            preview_scaling: 0.0,
            recording_width: 1920,
            recording_height: 1080,
            recording_enabled: false,
            recording_fps: 60,
            streaming_width: 1280,
            streaming_height: 720,
            streaming_enabled: false,
            streaming_fps: 30,
            ndi_enabled: false,
            shared_texture_enabled: false,
            shared_texture_backend: 0.0,
        }
    }
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
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub frame_time_ms: f64,
    pub frame_count: u64,
    pub target_fps: u32,
    pub config_generation: u64,
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
        self.info
            .read()
            .expect("renderer info poisoned")
            .clone()
    }
}

pub fn start(window: tauri::Window) -> Result<RendererHandle, String> {
    let (tx, rx) = sync_channel(256);
    let alive = Arc::new(AtomicBool::new(true));
    let mut renderer = pollster::block_on(Renderer::new(window))?;
    let info = Arc::new(RwLock::new(renderer.info()));
    let thread_info = Arc::clone(&info);
    let thread_alive = Arc::clone(&alive);

    thread::Builder::new()
        .name("junkpile-wgpu-io-config-renderer".into())
        .spawn(move || renderer.run(rx, thread_info, thread_alive))
        .map_err(|error| format!("could not start renderer thread: {error}"))?;

    Ok(RendererHandle { tx, info })
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Uniforms {
    timing: [f32; 4],
    render: [f32; 4],
    preview: [f32; 4],
    recording: [f32; 4],
    streaming: [f32; 4],
    outputs: [f32; 4],
}

struct Renderer {
    window: tauri::Window,
    instance: wgpu::Instance,
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    adapter_info: wgpu::AdapterInfo,
    pipeline: wgpu::RenderPipeline,
    uniform_buffer: wgpu::Buffer,
    bind_group: wgpu::BindGroup,
    uniforms: Uniforms,
    width: u32,
    height: u32,
    minimized: bool,
    started: Instant,
    frame_count: u64,
    target_fps: u32,
    config_generation: u64,
    last_error: String,
}

impl Renderer {
    async fn new(window: tauri::Window) -> Result<Self, String> {
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
                label: Some("junkpile I/O config foundation device"),
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
            .ok_or_else(|| "adapter cannot present to this surface".to_string())?;
        config.present_mode = wgpu::PresentMode::Fifo;
        surface.configure(&device, &config);

        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("junkpile I/O config diagnostic shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shader.wgsl").into()),
        });
        let bind_group_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("I/O config uniform bind group layout"),
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
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("I/O config diagnostic pipeline layout"),
            bind_group_layouts: &[Some(&bind_group_layout)],
            immediate_size: 0,
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("I/O config diagnostic pipeline"),
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

        let snapshot = RendererConfigSnapshot::default();
        let uniforms = uniforms_from_snapshot(&snapshot, width, height, 0.0, 0.0);
        let uniform_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("I/O config diagnostic uniforms"),
            contents: bytemuck::bytes_of(&uniforms),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("I/O config diagnostic bind group"),
            layout: &bind_group_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: uniform_buffer.as_entire_binding(),
            }],
        });

        Ok(Self {
            window,
            instance,
            surface,
            device,
            queue,
            config,
            adapter_info,
            pipeline,
            uniform_buffer,
            bind_group,
            uniforms,
            width,
            height,
            minimized: false,
            started: Instant::now(),
            frame_count: 0,
            target_fps: snapshot.target_fps,
            config_generation: snapshot.generation,
            last_error: String::new(),
        })
    }

    fn info(&self) -> RendererInfo {
        RendererInfo {
            backend: format!("{:?}", self.adapter_info.backend),
            adapter_name: self.adapter_info.name.clone(),
            device_type: format!("{:?}", self.adapter_info.device_type),
            driver: self.adapter_info.driver.clone(),
            driver_info: self.adapter_info.driver_info.clone(),
            surface_format: format!("{:?}", self.config.format),
            width: self.width,
            height: self.height,
            fps: 0.0,
            frame_time_ms: 0.0,
            frame_count: self.frame_count,
            target_fps: self.target_fps,
            config_generation: self.config_generation,
            running: true,
            last_error: self.last_error.clone(),
        }
    }

    fn apply_config(&mut self, snapshot: RendererConfigSnapshot) {
        self.target_fps = snapshot.target_fps.clamp(1, 240);
        self.config_generation = snapshot.generation;
        self.uniforms = uniforms_from_snapshot(
            &snapshot,
            self.width,
            self.height,
            self.started.elapsed().as_secs_f32(),
            self.frame_count as f32,
        );
        self.last_error.clear();
    }

    fn render(&mut self) -> Result<(), String> {
        if self.minimized {
            return Ok(());
        }

        self.uniforms.timing[0] = self.started.elapsed().as_secs_f32();
        self.uniforms.timing[1] = self.target_fps as f32;
        self.uniforms.timing[2] = self.config_generation as f32;
        self.uniforms.timing[3] = self.frame_count as f32;
        self.uniforms.render[2] = self.width as f32;
        self.uniforms.render[3] = self.height as f32;
        self.queue
            .write_buffer(&self.uniform_buffer, 0, bytemuck::bytes_of(&self.uniforms));

        let (frame, reconfigure) = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(frame) => (frame, false),
            wgpu::CurrentSurfaceTexture::Suboptimal(frame) => (frame, true),
            wgpu::CurrentSurfaceTexture::Timeout | wgpu::CurrentSurfaceTexture::Occluded => {
                return Ok(())
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
                return Err("surface validation error".into())
            }
        };

        let view = frame
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("I/O config diagnostic encoder"),
            });
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("I/O config diagnostic pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
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
            pass.set_bind_group(0, &self.bind_group, &[]);
            pass.draw(0..3, 0..1);
        }
        self.queue.submit([encoder.finish()]);
        frame.present();
        if reconfigure {
            self.surface.configure(&self.device, &self.config);
        }
        Ok(())
    }

    fn run(
        &mut self,
        rx: Receiver<RenderCommand>,
        shared: Arc<RwLock<RendererInfo>>,
        alive: Arc<AtomicBool>,
    ) {
        let mut metrics_started = Instant::now();
        let mut metrics_frames = 0u64;

        while alive.load(Ordering::Relaxed) {
            let frame_started = Instant::now();
            loop {
                match rx.try_recv() {
                    Ok(RenderCommand::Resize(width, height)) => self.resize(width, height),
                    Ok(RenderCommand::ApplyConfig(snapshot)) => self.apply_config(snapshot),
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
            }
            self.update_metrics(
                &shared,
                &mut metrics_started,
                &mut metrics_frames,
                frame_started,
            );

            let frame_budget = Duration::from_secs_f64(1.0 / self.target_fps.max(1) as f64);
            let remaining = frame_budget.saturating_sub(frame_started.elapsed());
            if !remaining.is_zero() {
                thread::sleep(remaining);
            }
        }

        if let Ok(mut info) = shared.write() {
            info.running = false;
        }
    }

    fn resize(&mut self, width: u32, height: u32) {
        self.width = width;
        self.height = height;
        self.minimized = width == 0 || height == 0;
        if !self.minimized {
            self.config.width = width;
            self.config.height = height;
            self.surface.configure(&self.device, &self.config);
        }
    }

    fn recreate_surface(&mut self) -> Result<(), String> {
        self.surface = self
            .instance
            .create_surface(self.window.clone())
            .map_err(|error| format!("could not recreate GPU surface: {error}"))?;
        self.surface.configure(&self.device, &self.config);
        Ok(())
    }

    fn update_metrics(
        &mut self,
        shared: &Arc<RwLock<RendererInfo>>,
        metrics_started: &mut Instant,
        metrics_frames: &mut u64,
        last_frame: Instant,
    ) {
        *metrics_frames += 1;
        self.frame_count += 1;
        let elapsed = metrics_started.elapsed();
        if elapsed >= Duration::from_millis(500) {
            let fps = *metrics_frames as f64 / elapsed.as_secs_f64();
            let frame_time_ms = last_frame.elapsed().as_secs_f64() * 1000.0;
            if let Ok(mut info) = shared.write() {
                info.width = self.width;
                info.height = self.height;
                info.fps = fps;
                info.frame_time_ms = frame_time_ms;
                info.frame_count = self.frame_count;
                info.target_fps = self.target_fps;
                info.config_generation = self.config_generation;
                info.running = true;
                info.last_error = self.last_error.clone();
            }
            *metrics_frames = 0;
            *metrics_started = Instant::now();
        }
    }
}

fn uniforms_from_snapshot(
    snapshot: &RendererConfigSnapshot,
    surface_width: u32,
    surface_height: u32,
    time: f32,
    frame_count: f32,
) -> Uniforms {
    Uniforms {
        timing: [
            time,
            snapshot.target_fps as f32,
            snapshot.generation as f32,
            frame_count,
        ],
        render: [
            snapshot.render_width as f32,
            snapshot.render_height as f32,
            surface_width as f32,
            surface_height as f32,
        ],
        preview: [
            snapshot.preview_width as f32,
            snapshot.preview_height as f32,
            if snapshot.preview_enabled { 1.0 } else { 0.0 },
            snapshot.preview_scaling,
        ],
        recording: [
            snapshot.recording_width as f32,
            snapshot.recording_height as f32,
            if snapshot.recording_enabled { 1.0 } else { 0.0 },
            snapshot.recording_fps as f32,
        ],
        streaming: [
            snapshot.streaming_width as f32,
            snapshot.streaming_height as f32,
            if snapshot.streaming_enabled { 1.0 } else { 0.0 },
            snapshot.streaming_fps as f32,
        ],
        outputs: [
            if snapshot.ndi_enabled { 1.0 } else { 0.0 },
            if snapshot.shared_texture_enabled { 1.0 } else { 0.0 },
            snapshot.shared_texture_backend,
            0.0,
        ],
    }
}
