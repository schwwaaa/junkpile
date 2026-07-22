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

const HDR_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;

#[derive(Debug, Clone)]
pub enum RenderCommand {
    Resize(u32, u32),
    SetPreset(String),
    SetParam(String, f32),
    Reset,
    Shutdown,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RendererInfo {
    pub backend: String,
    pub adapter_name: String,
    pub window_width: u32,
    pub window_height: u32,
    pub internal_width: u32,
    pub internal_height: u32,
    pub preset: String,
    pub render_scale: f32,
    pub max_texture_dimension_2d: u32,
    pub megapixels: f64,
    pub target_megabytes: f64,
    pub pixel_rate_gigapixels: f64,
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
    pub fn send(&self, command: RenderCommand) { let _ = self.tx.try_send(command); }
    pub fn info(&self) -> RendererInfo { self.info.read().expect("renderer info poisoned").clone() }
}

pub fn start(window: tauri::Window) -> Result<RendererHandle, String> {
    let (tx, rx) = sync_channel(256);
    let alive = Arc::new(AtomicBool::new(true));
    let mut renderer = pollster::block_on(Renderer::new(window))?;
    let info = Arc::new(RwLock::new(renderer.info()));
    let thread_info = Arc::clone(&info);
    let thread_alive = Arc::clone(&alive);
    thread::Builder::new()
        .name("junkpile-wgpu-high-resolution".into())
        .spawn(move || renderer.run(rx, thread_info, thread_alive))
        .map_err(|e| format!("could not start renderer thread: {e}"))?;
    Ok(RendererHandle { tx, info })
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Uniforms {
    internal_time: [f32; 4],
    params: [f32; 4],
    window: [f32; 4],
    extras: [f32; 4],
}

struct HighResTarget {
    _texture: wgpu::Texture,
    view: wgpu::TextureView,
    sample_bind: wgpu::BindGroup,
    width: u32,
    height: u32,
}

fn create_target(
    device: &wgpu::Device,
    present_layout: &wgpu::BindGroupLayout,
    uniform: &wgpu::Buffer,
    sampler: &wgpu::Sampler,
    width: u32,
    height: u32,
) -> HighResTarget {
    let size = wgpu::Extent3d { width: width.max(1), height: height.max(1), depth_or_array_layers: 1 };
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("high resolution HDR target"),
        size,
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: HDR_FORMAT,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    let sample_bind = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("high resolution present bind group"),
        layout: present_layout,
        entries: &[
            wgpu::BindGroupEntry { binding: 0, resource: uniform.as_entire_binding() },
            wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(&view) },
            wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::Sampler(sampler) },
        ],
    });
    HighResTarget { _texture: texture, view, sample_bind, width: size.width, height: size.height }
}

struct Renderer {
    window_handle: tauri::Window,
    instance: wgpu::Instance,
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    adapter_info: wgpu::AdapterInfo,
    max_texture_dimension_2d: u32,
    present_layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
    source_pipeline: wgpu::RenderPipeline,
    present_pipeline: wgpu::RenderPipeline,
    uniform_buffer: wgpu::Buffer,
    uniform_bind: wgpu::BindGroup,
    uniforms: Uniforms,
    target: HighResTarget,
    window_width: u32,
    window_height: u32,
    preset: String,
    render_scale: f32,
    minimized: bool,
    started: Instant,
    frame_count: u64,
    measured_fps: f64,
    last_error: String,
}

impl Renderer {
    async fn new(window_handle: tauri::Window) -> Result<Self, String> {
        let size = window_handle.inner_size().map_err(|e| e.to_string())?;
        let window_width = size.width.max(1);
        let window_height = size.height.max(1);
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
            backends: wgpu::Backends::PRIMARY,
            ..wgpu::InstanceDescriptor::new_without_display_handle()
        });
        let surface = instance.create_surface(window_handle.clone()).map_err(|e| format!("could not create surface: {e}"))?;
        let adapter = instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            compatible_surface: Some(&surface),
            force_fallback_adapter: false,
        }).await.map_err(|e| format!("no compatible adapter: {e}"))?;
        let adapter_info = adapter.get_info();
        let adapter_limits = adapter.limits();
        let max_texture_dimension_2d = adapter_limits.max_texture_dimension_2d;
        let (device, queue) = adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("high resolution device"),
            required_features: wgpu::Features::empty(),
            required_limits: wgpu::Limits::default(),
            memory_hints: wgpu::MemoryHints::Performance,
            trace: wgpu::Trace::Off,
            ..Default::default()
        }).await.map_err(|e| format!("could not create device: {e}"))?;
        let mut config = surface.get_default_config(&adapter, window_width, window_height).ok_or_else(|| "surface config unavailable".to_string())?;
        config.present_mode = wgpu::PresentMode::Fifo;
        surface.configure(&device, &config);

        let uniforms = Uniforms {
            internal_time: [window_width as f32, window_height as f32, 0.0, 0.0],
            params: [6.0, 1.0, 1.0, 2.2],
            window: [window_width as f32, window_height as f32, 0.0, 0.0],
            extras: [0.0; 4],
        };
        let uniform_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("high resolution uniforms"),
            contents: bytemuck::bytes_of(&uniforms),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });
        let uniform_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("high resolution uniform layout"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: false, min_binding_size: None },
                count: None,
            }],
        });
        let present_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("high resolution present layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry { binding: 0, visibility: wgpu::ShaderStages::FRAGMENT, ty: wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: false, min_binding_size: None }, count: None },
                wgpu::BindGroupLayoutEntry { binding: 1, visibility: wgpu::ShaderStages::FRAGMENT, ty: wgpu::BindingType::Texture { sample_type: wgpu::TextureSampleType::Float { filterable: true }, view_dimension: wgpu::TextureViewDimension::D2, multisampled: false }, count: None },
                wgpu::BindGroupLayoutEntry { binding: 2, visibility: wgpu::ShaderStages::FRAGMENT, ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering), count: None },
            ],
        });
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("high resolution downsample sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::MipmapFilterMode::Nearest,
            ..Default::default()
        });
        let uniform_bind = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("high resolution uniform bind"),
            layout: &uniform_layout,
            entries: &[wgpu::BindGroupEntry { binding: 0, resource: uniform_buffer.as_entire_binding() }],
        });
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("high resolution WGSL"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shader.wgsl").into()),
        });
        let source_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("high resolution source layout"),
            bind_group_layouts: &[Some(&uniform_layout)],
            immediate_size: 0,
        });
        let present_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("high resolution present pipeline layout"),
            bind_group_layouts: &[Some(&present_layout)],
            immediate_size: 0,
        });
        let make_pipeline = |label: &'static str, entry: &'static str, format: wgpu::TextureFormat, layout: &wgpu::PipelineLayout| {
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some(label), layout: Some(layout),
                vertex: wgpu::VertexState { module: &shader, entry_point: Some("vs_main"), compilation_options: Default::default(), buffers: &[] },
                primitive: wgpu::PrimitiveState::default(), depth_stencil: None, multisample: wgpu::MultisampleState::default(),
                fragment: Some(wgpu::FragmentState { module: &shader, entry_point: Some(entry), compilation_options: Default::default(), targets: &[Some(wgpu::ColorTargetState { format, blend: Some(wgpu::BlendState::REPLACE), write_mask: wgpu::ColorWrites::ALL })] }),
                multiview_mask: None, cache: None,
            })
        };
        let source_pipeline = make_pipeline("high resolution source pipeline", "fs_source", HDR_FORMAT, &source_layout);
        let present_pipeline = make_pipeline("high resolution present pipeline", "fs_present", config.format, &present_pipeline_layout);
        let target = create_target(&device, &present_layout, &uniform_buffer, &sampler, window_width, window_height);
        Ok(Self {
            window_handle, instance, surface, device, queue, config, adapter_info, max_texture_dimension_2d,
            present_layout, sampler, source_pipeline, present_pipeline, uniform_buffer, uniform_bind, uniforms,
            target, window_width, window_height, preset: "window".into(), render_scale: 1.0,
            minimized: false, started: Instant::now(), frame_count: 0, measured_fps: 0.0, last_error: String::new(),
        })
    }

    fn desired_dimensions(&self, preset: &str, scale: f32) -> (u32, u32) {
        let (base_w, base_h) = match preset {
            "1080p" => (1920, 1080),
            "4k" => (3840, 2160),
            "8k" => (7680, 4320),
            _ => (self.window_width.max(1), self.window_height.max(1)),
        };
        (((base_w as f32 * scale).round() as u32).max(1), ((base_h as f32 * scale).round() as u32).max(1))
    }

    fn rebuild_target(&mut self, preset: String, scale: f32) {
        let scale = scale.clamp(0.125, 1.0);
        let (width, height) = self.desired_dimensions(&preset, scale);
        if width > self.max_texture_dimension_2d || height > self.max_texture_dimension_2d {
            self.last_error = format!("requested {width}×{height}, but adapter max_texture_dimension_2d is {}", self.max_texture_dimension_2d);
            return;
        }
        self.target = create_target(&self.device, &self.present_layout, &self.uniform_buffer, &self.sampler, width, height);
        self.preset = preset;
        self.render_scale = scale;
        self.last_error.clear();
    }

    fn info(&self) -> RendererInfo {
        let pixels = self.target.width as f64 * self.target.height as f64;
        RendererInfo {
            backend: format!("{:?}", self.adapter_info.backend),
            adapter_name: self.adapter_info.name.clone(),
            window_width: self.window_width,
            window_height: self.window_height,
            internal_width: self.target.width,
            internal_height: self.target.height,
            preset: self.preset.clone(),
            render_scale: self.render_scale,
            max_texture_dimension_2d: self.max_texture_dimension_2d,
            megapixels: pixels / 1_000_000.0,
            target_megabytes: pixels * 8.0 / 1_048_576.0,
            pixel_rate_gigapixels: pixels * self.measured_fps / 1_000_000_000.0,
            fps: self.measured_fps,
            frame_time_ms: if self.measured_fps > 0.0 { 1000.0 / self.measured_fps } else { 0.0 },
            frame_count: self.frame_count,
            running: true,
            last_error: self.last_error.clone(),
        }
    }

    fn render(&mut self) -> Result<(), String> {
        if self.minimized { return Ok(()); }
        self.uniforms.internal_time = [self.target.width as f32, self.target.height as f32, self.started.elapsed().as_secs_f32(), self.frame_count as f32];
        self.uniforms.window = [self.window_width as f32, self.window_height as f32, 0.0, 0.0];
        self.queue.write_buffer(&self.uniform_buffer, 0, bytemuck::bytes_of(&self.uniforms));
        let (frame, reconfigure) = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(frame) => (frame, false),
            wgpu::CurrentSurfaceTexture::Suboptimal(frame) => (frame, true),
            wgpu::CurrentSurfaceTexture::Timeout | wgpu::CurrentSurfaceTexture::Occluded => return Ok(()),
            wgpu::CurrentSurfaceTexture::Outdated => { self.surface.configure(&self.device, &self.config); return Ok(()); },
            wgpu::CurrentSurfaceTexture::Lost => { self.recreate_surface()?; return Ok(()); },
            wgpu::CurrentSurfaceTexture::Validation => return Err("surface validation error".into()),
        };
        let surface_view = frame.texture.create_view(&wgpu::TextureViewDescriptor::default());
        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("high resolution frame encoder") });
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("high resolution offscreen pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment { view: &self.target.view, depth_slice: None, resolve_target: None, ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::BLACK), store: wgpu::StoreOp::Store } })],
                depth_stencil_attachment: None, timestamp_writes: None, occlusion_query_set: None, multiview_mask: None,
            });
            pass.set_pipeline(&self.source_pipeline); pass.set_bind_group(0, &self.uniform_bind, &[]); pass.draw(0..3, 0..1);
        }
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("high resolution downsample pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment { view: &surface_view, depth_slice: None, resolve_target: None, ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::BLACK), store: wgpu::StoreOp::Store } })],
                depth_stencil_attachment: None, timestamp_writes: None, occlusion_query_set: None, multiview_mask: None,
            });
            pass.set_pipeline(&self.present_pipeline); pass.set_bind_group(0, &self.target.sample_bind, &[]); pass.draw(0..3, 0..1);
        }
        self.queue.submit([encoder.finish()]); frame.present();
        if reconfigure { self.surface.configure(&self.device, &self.config); }
        Ok(())
    }

    fn run(&mut self, rx: Receiver<RenderCommand>, shared: Arc<RwLock<RendererInfo>>, alive: Arc<AtomicBool>) {
        let mut metrics_started = Instant::now(); let mut metrics_frames = 0u64;
        while alive.load(Ordering::Relaxed) {
            let frame_started = Instant::now();
            loop {
                match rx.try_recv() {
                    Ok(RenderCommand::Resize(w, h)) => self.resize(w, h),
                    Ok(RenderCommand::SetPreset(preset)) => self.rebuild_target(preset, self.render_scale),
                    Ok(RenderCommand::SetParam(name, value)) => match name.as_str() {
                        "render_scale" => self.rebuild_target(self.preset.clone(), value),
                        "complexity" => self.uniforms.params[0] = value.clamp(1.0, 12.0).round(),
                        "speed" => self.uniforms.params[1] = value.clamp(0.0, 4.0),
                        "exposure" => self.uniforms.params[2] = value.clamp(0.0, 4.0),
                        "frequency" => self.uniforms.params[3] = value.clamp(0.2, 8.0),
                        _ => {}
                    },
                    Ok(RenderCommand::Reset) => { self.uniforms.params = [6.0, 1.0, 1.0, 2.2]; self.rebuild_target("window".into(), 1.0); },
                    Ok(RenderCommand::Shutdown) | Err(TryRecvError::Disconnected) => { alive.store(false, Ordering::Relaxed); break; },
                    Err(TryRecvError::Empty) => break,
                }
            }
            if !alive.load(Ordering::Relaxed) { break; }
            if let Err(e) = self.render() { self.last_error = e; thread::sleep(Duration::from_millis(100)); }
            metrics_frames += 1; self.frame_count += 1;
            let elapsed = metrics_started.elapsed();
            if elapsed >= Duration::from_millis(500) {
                self.measured_fps = metrics_frames as f64 / elapsed.as_secs_f64();
                if let Ok(mut info) = shared.write() { *info = self.info(); info.frame_time_ms = frame_started.elapsed().as_secs_f64() * 1000.0; }
                metrics_frames = 0; metrics_started = Instant::now();
            }
            let remaining = Duration::from_millis(16).saturating_sub(frame_started.elapsed());
            if !remaining.is_zero() { thread::sleep(remaining); }
        }
        if let Ok(mut info) = shared.write() { info.running = false; }
    }

    fn resize(&mut self, width: u32, height: u32) {
        self.window_width = width; self.window_height = height; self.minimized = width == 0 || height == 0;
        if !self.minimized {
            self.config.width = width; self.config.height = height; self.surface.configure(&self.device, &self.config);
            if self.preset == "window" { self.rebuild_target("window".into(), self.render_scale); }
        }
    }
    fn recreate_surface(&mut self) -> Result<(), String> {
        self.surface = self.instance.create_surface(self.window_handle.clone()).map_err(|e| e.to_string())?;
        self.surface.configure(&self.device, &self.config); Ok(())
    }
}
