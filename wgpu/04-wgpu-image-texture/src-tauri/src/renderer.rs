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
    SetParam(String, f32),
    SetFilter(String),
    SetFit(String),
    Reset,
    Shutdown,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RendererInfo {
    pub backend: String,
    pub adapter_name: String,
    pub surface_format: String,
    pub width: u32,
    pub height: u32,
    pub source_width: u32,
    pub source_height: u32,
    pub filter_mode: String,
    pub fit_mode: String,
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
        .name("junkpile-wgpu-image-texture".into())
        .spawn(move || renderer.run(rx, thread_info, thread_alive))
        .map_err(|e| format!("could not start renderer thread: {e}"))?;
    Ok(RendererHandle { tx, info })
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Uniforms {
    viewport_source: [f32; 4],
    transform: [f32; 4],
    look: [f32; 4],
    extras: [f32; 4],
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
    bind_linear: wgpu::BindGroup,
    bind_nearest: wgpu::BindGroup,
    _source_texture: wgpu::Texture,
    uniforms: Uniforms,
    width: u32,
    height: u32,
    source_width: u32,
    source_height: u32,
    minimized: bool,
    linear_filter: bool,
    fit_mode: String,
    started: Instant,
    frame_count: u64,
    last_error: String,
}

impl Renderer {
    async fn new(window: tauri::Window) -> Result<Self, String> {
        let size = window.inner_size().map_err(|e| e.to_string())?;
        let width = size.width.max(1);
        let height = size.height.max(1);
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
            backends: wgpu::Backends::PRIMARY,
            ..wgpu::InstanceDescriptor::new_without_display_handle()
        });
        let surface = instance.create_surface(window.clone()).map_err(|e| format!("could not create GPU surface: {e}"))?;
        let adapter = instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            compatible_surface: Some(&surface),
            force_fallback_adapter: false,
        }).await.map_err(|e| format!("no compatible GPU adapter: {e}"))?;
        let adapter_info = adapter.get_info();
        let (device, queue) = adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("junkpile image texture device"),
            required_features: wgpu::Features::empty(),
            required_limits: wgpu::Limits::default(),
            memory_hints: wgpu::MemoryHints::Performance,
            trace: wgpu::Trace::Off,
            ..Default::default()
        }).await.map_err(|e| format!("could not create GPU device: {e}"))?;
        let mut config = surface.get_default_config(&adapter, width, height).ok_or_else(|| "adapter cannot present to this surface".to_string())?;
        config.present_mode = wgpu::PresentMode::Fifo;
        surface.configure(&device, &config);

        let decoded = image::load_from_memory(include_bytes!("../assets/source.png"))
            .map_err(|e| format!("could not decode embedded image: {e}"))?
            .to_rgba8();
        let source_width = decoded.width();
        let source_height = decoded.height();
        let source_size = wgpu::Extent3d { width: source_width, height: source_height, depth_or_array_layers: 1 };
        let source_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("embedded source texture"),
            size: source_size,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8UnormSrgb,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &source_texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            decoded.as_raw(),
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(4 * source_width),
                rows_per_image: Some(source_height),
            },
            source_size,
        );
        let source_view = source_texture.create_view(&wgpu::TextureViewDescriptor::default());
        let linear_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("linear sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::MipmapFilterMode::Nearest,
            ..Default::default()
        });
        let nearest_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("nearest sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Nearest,
            min_filter: wgpu::FilterMode::Nearest,
            mipmap_filter: wgpu::MipmapFilterMode::Nearest,
            ..Default::default()
        });

        let uniforms = Uniforms {
            viewport_source: [width as f32, height as f32, source_width as f32, source_height as f32],
            transform: [1.0, 0.0, 0.0, 0.0],
            look: [1.0, 1.0, 1.0, 0.0],
            extras: [0.0; 4],
        };
        let uniform_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("image texture uniforms"),
            contents: bytemuck::bytes_of(&uniforms),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("image texture bind group layout"),
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
                    ty: wgpu::BindingType::Texture { sample_type: wgpu::TextureSampleType::Float { filterable: true }, view_dimension: wgpu::TextureViewDimension::D2, multisampled: false },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });
        let make_bind = |label: &'static str, sampler: &wgpu::Sampler| device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some(label),
            layout: &layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: uniform_buffer.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(&source_view) },
                wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::Sampler(sampler) },
            ],
        });
        let bind_linear = make_bind("linear image bind group", &linear_sampler);
        let bind_nearest = make_bind("nearest image bind group", &nearest_sampler);
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("image texture WGSL"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shader.wgsl").into()),
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("image texture pipeline layout"),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("image texture pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState { module: &shader, entry_point: Some("vs_main"), compilation_options: Default::default(), buffers: &[] },
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState { format: config.format, blend: Some(wgpu::BlendState::REPLACE), write_mask: wgpu::ColorWrites::ALL })],
            }),
            multiview_mask: None,
            cache: None,
        });

        Ok(Self {
            window, instance, surface, device, queue, config, adapter_info, pipeline, uniform_buffer,
            bind_linear, bind_nearest, _source_texture: source_texture, uniforms,
            width, height, source_width, source_height, minimized: false, linear_filter: true,
            fit_mode: "contain".into(), started: Instant::now(), frame_count: 0, last_error: String::new(),
        })
    }

    fn info(&self) -> RendererInfo {
        RendererInfo {
            backend: format!("{:?}", self.adapter_info.backend),
            adapter_name: self.adapter_info.name.clone(),
            surface_format: format!("{:?}", self.config.format),
            width: self.width,
            height: self.height,
            source_width: self.source_width,
            source_height: self.source_height,
            filter_mode: if self.linear_filter { "linear" } else { "nearest" }.into(),
            fit_mode: self.fit_mode.clone(),
            fps: 0.0,
            frame_time_ms: 0.0,
            frame_count: self.frame_count,
            running: true,
            last_error: self.last_error.clone(),
        }
    }

    fn render(&mut self) -> Result<(), String> {
        if self.minimized { return Ok(()); }
        self.uniforms.viewport_source[0] = self.width as f32;
        self.uniforms.viewport_source[1] = self.height as f32;
        self.uniforms.transform[3] = self.started.elapsed().as_secs_f32();
        self.queue.write_buffer(&self.uniform_buffer, 0, bytemuck::bytes_of(&self.uniforms));
        let (frame, reconfigure) = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(frame) => (frame, false),
            wgpu::CurrentSurfaceTexture::Suboptimal(frame) => (frame, true),
            wgpu::CurrentSurfaceTexture::Timeout | wgpu::CurrentSurfaceTexture::Occluded => return Ok(()),
            wgpu::CurrentSurfaceTexture::Outdated => { self.surface.configure(&self.device, &self.config); return Ok(()); }
            wgpu::CurrentSurfaceTexture::Lost => { self.recreate_surface()?; return Ok(()); }
            wgpu::CurrentSurfaceTexture::Validation => return Err("surface validation error".into()),
        };
        let view = frame.texture.create_view(&wgpu::TextureViewDescriptor::default());
        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("image texture encoder") });
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("image texture pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view, depth_slice: None, resolve_target: None,
                    ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color { r: 0.008, g: 0.01, b: 0.016, a: 1.0 }), store: wgpu::StoreOp::Store },
                })],
                depth_stencil_attachment: None, timestamp_writes: None, occlusion_query_set: None, multiview_mask: None,
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, if self.linear_filter { &self.bind_linear } else { &self.bind_nearest }, &[]);
            pass.draw(0..3, 0..1);
        }
        self.queue.submit([encoder.finish()]);
        frame.present();
        if reconfigure { self.surface.configure(&self.device, &self.config); }
        Ok(())
    }

    fn run(&mut self, rx: Receiver<RenderCommand>, shared: Arc<RwLock<RendererInfo>>, alive: Arc<AtomicBool>) {
        let mut metrics_started = Instant::now();
        let mut metrics_frames = 0u64;
        while alive.load(Ordering::Relaxed) {
            let frame_started = Instant::now();
            loop {
                match rx.try_recv() {
                    Ok(RenderCommand::Resize(w, h)) => self.resize(w, h),
                    Ok(RenderCommand::SetParam(name, value)) => match name.as_str() {
                        "zoom" => self.uniforms.transform[0] = value.clamp(0.1, 8.0),
                        "rotation" => self.uniforms.transform[1] = value,
                        "exposure" => self.uniforms.look[0] = value.clamp(0.0, 4.0),
                        "gamma" => self.uniforms.look[1] = value.clamp(0.25, 3.0),
                        "saturation" => self.uniforms.look[2] = value.clamp(0.0, 2.0),
                        _ => {}
                    },
                    Ok(RenderCommand::SetFilter(mode)) => self.linear_filter = mode == "linear",
                    Ok(RenderCommand::SetFit(mode)) => {
                        self.fit_mode = mode.clone();
                        self.uniforms.transform[2] = match mode.as_str() { "cover" => 1.0, "stretch" => 2.0, _ => 0.0 };
                    }
                    Ok(RenderCommand::Reset) => {
                        self.uniforms.transform = [1.0, 0.0, 0.0, self.uniforms.transform[3]];
                        self.uniforms.look = [1.0, 1.0, 1.0, 0.0];
                        self.linear_filter = true;
                        self.fit_mode = "contain".into();
                    }
                    Ok(RenderCommand::Shutdown) | Err(TryRecvError::Disconnected) => { alive.store(false, Ordering::Relaxed); break; }
                    Err(TryRecvError::Empty) => break,
                }
            }
            if !alive.load(Ordering::Relaxed) { break; }
            if let Err(e) = self.render() { self.last_error = e; thread::sleep(Duration::from_millis(100)); }
            metrics_frames += 1;
            self.frame_count += 1;
            let elapsed = metrics_started.elapsed();
            if elapsed >= Duration::from_millis(500) {
                let fps = metrics_frames as f64 / elapsed.as_secs_f64();
                if let Ok(mut info) = shared.write() {
                    *info = self.info();
                    info.fps = fps;
                    info.frame_time_ms = frame_started.elapsed().as_secs_f64() * 1000.0;
                }
                metrics_frames = 0;
                metrics_started = Instant::now();
            }
            let remaining = Duration::from_millis(16).saturating_sub(frame_started.elapsed());
            if !remaining.is_zero() { thread::sleep(remaining); }
        }
        if let Ok(mut info) = shared.write() { info.running = false; }
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
        self.surface = self.instance.create_surface(self.window.clone()).map_err(|e| format!("could not recreate GPU surface: {e}"))?;
        self.surface.configure(&self.device, &self.config);
        Ok(())
    }
}
