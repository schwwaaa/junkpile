use crate::gesture::{GesturePoint, GestureSnapshot, MAX_POINTS};
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

#[derive(Debug, Clone)]
pub enum RenderCommand { Resize(u32, u32), Shutdown }

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
    pub gesture_sequence: u64,
    pub active_points: u32,
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

pub fn start(window: tauri::Window, snapshot: Arc<RwLock<GestureSnapshot>>) -> Result<RendererHandle, String> {
    let (tx, rx) = sync_channel(128);
    let alive = Arc::new(AtomicBool::new(true));
    let mut renderer = pollster::block_on(Renderer::new(window, snapshot))?;
    let info = Arc::new(RwLock::new(renderer.info()));
    let thread_info = Arc::clone(&info);
    let thread_alive = Arc::clone(&alive);
    thread::Builder::new().name("junkpile-wgpu-gesture-field".into())
        .spawn(move || renderer.run(rx, thread_info, thread_alive))
        .map_err(|error| format!("could not start renderer thread: {error}"))?;
    Ok(RendererHandle { tx, info })
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Uniforms {
    resolution_time: [f32; 4],
    controls0: [f32; 4],
    controls1: [f32; 4],
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

struct Renderer {
    window: tauri::Window,
    instance: wgpu::Instance,
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    pipeline: wgpu::RenderPipeline,
    uniform_buffer: wgpu::Buffer,
    gesture_buffer: wgpu::Buffer,
    bind_group: wgpu::BindGroup,
    snapshot: Arc<RwLock<GestureSnapshot>>,
    uniforms: Uniforms,
    adapter_info: wgpu::AdapterInfo,
    width: u32,
    height: u32,
    minimized: bool,
    started: Instant,
    last_frame: Instant,
    frame_count: u64,
    measured_fps: f64,
    measured_frame_time_ms: f64,
    gesture_sequence: u64,
    active_points: u32,
    last_error: String,
}

impl Renderer {
    async fn new(window: tauri::Window, snapshot: Arc<RwLock<GestureSnapshot>>) -> Result<Self, String> {
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
            .find(|candidate| candidate.is_surface_supported(&surface) && adapter_filter.as_ref()
                .map(|filter| candidate.get_info().name.to_lowercase().contains(filter)).unwrap_or(true))
            .ok_or_else(|| "no compatible adapter found".to_string())?;
        let adapter_info = adapter.get_info();
        let (device, queue) = adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("gesture field device"),
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

        let initial = snapshot.read().expect("gesture snapshot poisoned").clone();
        let uniforms = Uniforms {
            resolution_time: [width as f32, height as f32, 0.0, initial.count as f32],
            controls0: [initial.brush_radius, initial.force, initial.decay, initial.mode],
            controls1: [initial.depth, initial.exposure, 0.0, 0.0],
        };
        let uniform_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("gesture uniform buffer"), contents: bytemuck::bytes_of(&uniforms),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });
        let empty_points = GpuGestureData { points: [GpuPoint::zeroed(); MAX_POINTS] };
        let gesture_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("gesture point storage buffer"), contents: bytemuck::bytes_of(&empty_points),
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
        });
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("gesture bind group layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry { binding: 0, visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: false, min_binding_size: None }, count: None },
                wgpu::BindGroupLayoutEntry { binding: 1, visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Storage { read_only: true }, has_dynamic_offset: false, min_binding_size: None }, count: None },
            ],
        });
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("gesture bind group"), layout: &layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: uniform_buffer.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 1, resource: gesture_buffer.as_entire_binding() },
            ],
        });
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("gesture field WGSL"), source: wgpu::ShaderSource::Wgsl(include_str!("gesture.wgsl").into()),
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("gesture pipeline layout"), bind_group_layouts: &[Some(&layout)], immediate_size: 0,
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("gesture pipeline"), layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState { module: &shader, entry_point: Some("vs_main"), compilation_options: Default::default(), buffers: &[] },
            primitive: wgpu::PrimitiveState::default(), depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            fragment: Some(wgpu::FragmentState {
                module: &shader, entry_point: Some("fs_main"), compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState { format: config.format, blend: Some(wgpu::BlendState::REPLACE), write_mask: wgpu::ColorWrites::ALL })],
            }), multiview_mask: None, cache: None,
        });
        let now = Instant::now();
        Ok(Self { window, instance, surface, device, queue, config, pipeline, uniform_buffer, gesture_buffer,
            bind_group, snapshot, uniforms, adapter_info, width, height, minimized: false, started: now,
            last_frame: now, frame_count: 0, measured_fps: 0.0, measured_frame_time_ms: 0.0,
            gesture_sequence: 0, active_points: 0, last_error: String::new() })
    }

    fn info(&self) -> RendererInfo {
        RendererInfo {
            backend: format!("{:?}", self.adapter_info.backend), adapter: self.adapter_info.name.clone(),
            driver: if self.adapter_info.driver_info.is_empty() { self.adapter_info.driver.clone() }
                else { format!("{} · {}", self.adapter_info.driver, self.adapter_info.driver_info) },
            surface_format: format!("{:?}", self.config.format), width: self.width, height: self.height,
            fps: self.measured_fps, frame_time_ms: self.measured_frame_time_ms, frame_count: self.frame_count,
            gesture_sequence: self.gesture_sequence, active_points: self.active_points, running: true,
            last_error: self.last_error.clone(),
        }
    }

    fn resize(&mut self, width: u32, height: u32) {
        self.minimized = width == 0 || height == 0;
        self.width = width.max(1); self.height = height.max(1);
        if !self.minimized { self.config.width = self.width; self.config.height = self.height; self.surface.configure(&self.device, &self.config); }
    }

    fn handle_commands(&mut self, rx: &Receiver<RenderCommand>) -> bool {
        loop { match rx.try_recv() {
            Ok(RenderCommand::Resize(w,h)) => self.resize(w,h), Ok(RenderCommand::Shutdown) => return false,
            Err(TryRecvError::Empty) => return true, Err(TryRecvError::Disconnected) => return false,
        }}
    }

    fn upload_state(&mut self) {
        let snapshot = self.snapshot.read().expect("gesture snapshot poisoned").clone();
        self.gesture_sequence = snapshot.sequence;
        self.active_points = snapshot.count;
        self.uniforms.resolution_time = [self.width as f32, self.height as f32, self.started.elapsed().as_secs_f32(), snapshot.count as f32];
        self.uniforms.controls0 = [snapshot.brush_radius, snapshot.force, snapshot.decay, snapshot.mode];
        self.uniforms.controls1 = [snapshot.depth, snapshot.exposure, 0.0, 0.0];
        let mut gpu = GpuGestureData { points: [GpuPoint::zeroed(); MAX_POINTS] };
        for (index, point) in snapshot.points.iter().enumerate() {
            gpu.points[index] = GpuPoint {
                position_velocity: [point.x, point.y, point.velocity_x, point.velocity_y],
                pressure_age_tool_active: [point.pressure, point.age, point.tool, point.active],
            };
        }
        self.queue.write_buffer(&self.uniform_buffer, 0, bytemuck::bytes_of(&self.uniforms));
        self.queue.write_buffer(&self.gesture_buffer, 0, bytemuck::bytes_of(&gpu));
    }

    fn render(&mut self) -> Result<(), String> {
        let now = Instant::now(); let delta = now.duration_since(self.last_frame).as_secs_f64(); self.last_frame = now;
        if delta > 0.0 { self.measured_fps = 1.0 / delta; self.measured_frame_time_ms = delta * 1000.0; }
        self.upload_state();
        let (frame, reconfigure) = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(frame) => (frame, false),
            wgpu::CurrentSurfaceTexture::Suboptimal(frame) => (frame, true),
            wgpu::CurrentSurfaceTexture::Timeout | wgpu::CurrentSurfaceTexture::Occluded => return Ok(()),
            wgpu::CurrentSurfaceTexture::Outdated => { self.surface.configure(&self.device, &self.config); return Ok(()); }
            wgpu::CurrentSurfaceTexture::Lost => { self.recreate_surface()?; return Ok(()); }
            wgpu::CurrentSurfaceTexture::Validation => return Err("surface validation error".into()),
        };
        let view = frame.texture.create_view(&Default::default());
        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("gesture encoder") });
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("gesture render pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment { view: &view, resolve_target: None, depth_slice: None,
                    ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::BLACK), store: wgpu::StoreOp::Store } })],
                depth_stencil_attachment: None, timestamp_writes: None, occlusion_query_set: None, multiview_mask: None,
            });
            pass.set_pipeline(&self.pipeline); pass.set_bind_group(0, &self.bind_group, &[]); pass.draw(0..3, 0..1);
        }
        self.queue.submit([encoder.finish()]); frame.present();
        if reconfigure { self.surface.configure(&self.device, &self.config); }
        self.frame_count = self.frame_count.wrapping_add(1); Ok(())
    }

    fn recreate_surface(&mut self) -> Result<(), String> {
        self.surface = self.instance.create_surface(self.window.clone()).map_err(|error| format!("could not recreate surface: {error}"))?;
        self.surface.configure(&self.device, &self.config); Ok(())
    }

    fn run(&mut self, rx: Receiver<RenderCommand>, info: Arc<RwLock<RendererInfo>>, alive: Arc<AtomicBool>) {
        while alive.load(Ordering::Relaxed) {
            if !self.handle_commands(&rx) { break; }
            if self.minimized { thread::sleep(Duration::from_millis(16)); continue; }
            match self.render() { Ok(()) => self.last_error.clear(), Err(error) => { self.last_error = error; thread::sleep(Duration::from_millis(16)); } }
            *info.write().expect("renderer info poisoned") = self.info();
        }
        alive.store(false, Ordering::Relaxed);
    }
}
