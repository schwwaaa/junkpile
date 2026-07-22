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

#[derive(Debug, Clone)]
pub enum RenderCommand {
    Resize(u32, u32),

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
    pub width: u32,
    pub height: u32,
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

pub fn start(window: tauri::Window) -> Result<RendererHandle, String> {
    let (tx, rx) = sync_channel(256);
    let alive = Arc::new(AtomicBool::new(true));
    let mut renderer = pollster::block_on(Renderer::new(window))?;
    let info = Arc::new(RwLock::new(renderer.info()));

    let thread_info = Arc::clone(&info);
    let thread_alive = Arc::clone(&alive);
    thread::Builder::new()
        .name("junkpile-wgpu-renderer".into())
        .spawn(move || renderer.run(rx, thread_info, thread_alive))
        .map_err(|error| format!("could not start renderer thread: {error}"))?;

    Ok(RendererHandle { tx, info })
}

use bytemuck::{Pod, Zeroable};
use wgpu::util::DeviceExt;

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Uniforms {
    data: [f32; 4],
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
    time_offset: f32,
    paused_at: Option<f32>,
    frame_count: u64,
    last_error: String,
}

impl Renderer {
    async fn new(window: tauri::Window) -> Result<Self, String> {
        let size = window.inner_size().map_err(|error| error.to_string())?;
        let width = size.width.max(1);
        let height = size.height.max(1);
        let instance = wgpu::Instance::default();
        let surface = instance.create_surface(window.clone()).map_err(|error| format!("could not create GPU surface: {error}"))?;
        let adapter = instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            compatible_surface: Some(&surface), force_fallback_adapter: false,
        }).await.map_err(|error| format!("no compatible GPU adapter: {error}"))?;
        let adapter_info = adapter.get_info();
        let (device, queue) = adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("junkpile native shader device"),
            required_features: wgpu::Features::empty(), required_limits: wgpu::Limits::default(),
            memory_hints: wgpu::MemoryHints::Performance, trace: wgpu::Trace::Off,
            ..Default::default()
        }).await.map_err(|error| format!("could not create GPU device: {error}"))?;
        let mut config = surface.get_default_config(&adapter, width, height).ok_or_else(|| "adapter cannot present to this surface".to_string())?;
        config.present_mode = wgpu::PresentMode::Fifo;
        surface.configure(&device, &config);

        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("junkpile WGSL shader"), source: wgpu::ShaderSource::Wgsl(include_str!("shader.wgsl").into()),
        });
        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("uniform bind group layout"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0, visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: false, min_binding_size: None },
                count: None,
            }],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("native shader pipeline layout"), bind_group_layouts: &[Some(&bind_group_layout)], immediate_size: 0,
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("native shader pipeline"), layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState { module: &shader, entry_point: Some("vs_main"), compilation_options: Default::default(), buffers: &[] },
            primitive: wgpu::PrimitiveState::default(), depth_stencil: None, multisample: wgpu::MultisampleState::default(),
            fragment: Some(wgpu::FragmentState {
                module: &shader, entry_point: Some("fs_main"), compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState { format: config.format, blend: Some(wgpu::BlendState::REPLACE), write_mask: wgpu::ColorWrites::ALL })],
            }),
            multiview_mask: None, cache: None,
        });
        let uniforms = Uniforms { data: [0.0, width as f32, height as f32, 0.0] };
        let uniform_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("native shader uniforms"), contents: bytemuck::bytes_of(&uniforms), usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("native shader bind group"), layout: &bind_group_layout,
            entries: &[wgpu::BindGroupEntry { binding: 0, resource: uniform_buffer.as_entire_binding() }],
        });
        Ok(Self { window, instance, surface, device, queue, config, adapter_info, pipeline, uniform_buffer, bind_group, uniforms,
            width, height, minimized: false, started: Instant::now(), time_offset: 0.0, paused_at: None,
            frame_count: 0, last_error: String::new() })
    }

    fn info(&self) -> RendererInfo {
        RendererInfo { backend: format!("{:?}", self.adapter_info.backend), adapter_name: self.adapter_info.name.clone(),
            device_type: format!("{:?}", self.adapter_info.device_type), driver: self.adapter_info.driver.clone(), driver_info: self.adapter_info.driver_info.clone(),
            surface_format: format!("{:?}", self.config.format), width: self.width, height: self.height, fps: 0.0, frame_time_ms: 0.0,
            frame_count: self.frame_count, running: true, last_error: self.last_error.clone() }
    }

    fn current_time(&self) -> f32 {
        self.paused_at.unwrap_or_else(|| self.started.elapsed().as_secs_f32() + self.time_offset)
    }

    fn render(&mut self) -> Result<(), String> {
        if self.minimized { return Ok(()); }
        self.uniforms.data = [self.current_time(), self.width as f32, self.height as f32, 0.0];
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
        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("native shader encoder") });
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("native shader pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view, depth_slice: None, resolve_target: None,
                    ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::BLACK), store: wgpu::StoreOp::Store },
                })], depth_stencil_attachment: None, timestamp_writes: None, occlusion_query_set: None, multiview_mask: None,
            });
            pass.set_pipeline(&self.pipeline); pass.set_bind_group(0, &self.bind_group, &[]); pass.draw(0..3, 0..1);
        }
        self.queue.submit([encoder.finish()]);
        frame.present();
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
                    
                    Ok(RenderCommand::Shutdown) | Err(TryRecvError::Disconnected) => { alive.store(false, Ordering::Relaxed); break; }
                    Err(TryRecvError::Empty) => break,
                }
            }
            if !alive.load(Ordering::Relaxed) { break; }
            if let Err(error) = self.render() { self.last_error = error; thread::sleep(Duration::from_millis(100)); }
            self.update_metrics(&shared, &mut metrics_started, &mut metrics_frames, frame_started);
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
                info.running = true;
                info.last_error = self.last_error.clone();
            }
            *metrics_frames = 0;
            *metrics_started = Instant::now();
        }
    }

}
