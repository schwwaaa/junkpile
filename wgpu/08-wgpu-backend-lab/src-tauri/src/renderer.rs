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
pub enum RenderCommand {
    Resize(u32, u32),
    SetParam(String, f32),
    SetPaused(bool),
    Reset,
    Shutdown,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterReport {
    pub index: usize,
    pub name: String,
    pub backend: String,
    pub device_type: String,
    pub vendor_id: String,
    pub device_id: String,
    pub pci_bus_id: String,
    pub driver: String,
    pub driver_info: String,
    pub surface_supported: bool,
    pub selected: bool,
    pub max_texture_dimension_2d: u32,
    pub max_texture_dimension_3d: u32,
    pub max_bind_groups: u32,
    pub max_buffer_size: u64,
    pub max_storage_buffer_binding_size: u64,
    pub max_compute_invocations_per_workgroup: u32,
    pub max_compute_workgroup_size_x: u32,
    pub max_compute_workgroup_size_y: u32,
    pub max_compute_workgroup_size_z: u32,
    pub max_compute_workgroups_per_dimension: u32,
    pub timestamp_query: bool,
    pub timestamp_inside_encoders: bool,
    pub subgroup: bool,
    pub shader_f16: bool,
    pub compression_bc: bool,
    pub compression_etc2: bool,
    pub compression_astc: bool,
    pub features: String,
    pub downlevel_capabilities: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RendererInfo {
    pub requested_backends: String,
    pub compiled_backends: String,
    pub backend_environment: String,
    pub adapter_environment: String,
    pub active_backend: String,
    pub active_adapter: String,
    pub surface_format: String,
    pub surface_formats: Vec<String>,
    pub present_modes: Vec<String>,
    pub alpha_modes: Vec<String>,
    pub adapters: Vec<AdapterReport>,
    pub width: u32,
    pub height: u32,
    pub complexity: f32,
    pub speed: f32,
    pub layers: f32,
    pub exposure: f32,
    pub paused: bool,
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
        .name("junkpile-wgpu-backend-lab".into())
        .spawn(move || renderer.run(rx, thread_info, thread_alive))
        .map_err(|error| format!("could not start renderer thread: {error}"))?;

    Ok(RendererHandle { tx, info })
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Uniforms {
    resolution_time: [f32; 4],
    params: [f32; 4],
    backend_tint: [f32; 4],
}

fn backend_tint(backend: wgpu::Backend) -> [f32; 4] {
    match backend {
        wgpu::Backend::Metal => [0.30, 0.62, 1.20, 1.0],
        wgpu::Backend::Vulkan => [1.20, 0.42, 0.16, 1.0],
        wgpu::Backend::Dx12 => [0.22, 1.05, 0.55, 1.0],
        wgpu::Backend::Gl => [0.88, 0.54, 1.08, 1.0],
        wgpu::Backend::BrowserWebGpu => [0.34, 0.92, 1.00, 1.0],
        _ => [0.65, 0.65, 0.65, 1.0],
    }
}

fn report_adapter(
    index: usize,
    adapter: &wgpu::Adapter,
    surface: &wgpu::Surface<'_>,
    selected_index: usize,
) -> AdapterReport {
    let info = adapter.get_info();
    let limits = adapter.limits();
    let feature_text = format!("{:?}", adapter.features());
    let downlevel_text = format!("{:?}", adapter.get_downlevel_capabilities());

    AdapterReport {
        index,
        name: info.name,
        backend: format!("{:?}", info.backend),
        device_type: format!("{:?}", info.device_type),
        vendor_id: format!("0x{:04x}", info.vendor),
        device_id: format!("0x{:04x}", info.device),
        pci_bus_id: info.device_pci_bus_id,
        driver: info.driver,
        driver_info: info.driver_info,
        surface_supported: adapter.is_surface_supported(surface),
        selected: index == selected_index,
        max_texture_dimension_2d: limits.max_texture_dimension_2d,
        max_texture_dimension_3d: limits.max_texture_dimension_3d,
        max_bind_groups: limits.max_bind_groups,
        max_buffer_size: limits.max_buffer_size,
        max_storage_buffer_binding_size: limits.max_storage_buffer_binding_size,
        max_compute_invocations_per_workgroup: limits.max_compute_invocations_per_workgroup,
        max_compute_workgroup_size_x: limits.max_compute_workgroup_size_x,
        max_compute_workgroup_size_y: limits.max_compute_workgroup_size_y,
        max_compute_workgroup_size_z: limits.max_compute_workgroup_size_z,
        max_compute_workgroups_per_dimension: limits.max_compute_workgroups_per_dimension,
        timestamp_query: feature_text.contains("TIMESTAMP_QUERY"),
        timestamp_inside_encoders: feature_text.contains("TIMESTAMP_QUERY_INSIDE_ENCODERS"),
        subgroup: feature_text.contains("SUBGROUP"),
        shader_f16: feature_text.contains("SHADER_F16"),
        compression_bc: feature_text.contains("TEXTURE_COMPRESSION_BC"),
        compression_etc2: feature_text.contains("TEXTURE_COMPRESSION_ETC2"),
        compression_astc: feature_text.contains("TEXTURE_COMPRESSION_ASTC"),
        features: feature_text,
        downlevel_capabilities: downlevel_text,
    }
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
    uniform_bind_group: wgpu::BindGroup,
    uniforms: Uniforms,
    requested_backends: String,
    compiled_backends: String,
    backend_environment: String,
    adapter_environment: String,
    adapter_info: wgpu::AdapterInfo,
    adapter_reports: Vec<AdapterReport>,
    surface_formats: Vec<String>,
    present_modes: Vec<String>,
    alpha_modes: Vec<String>,
    width: u32,
    height: u32,
    minimized: bool,
    paused: bool,
    started: Instant,
    paused_at: Option<Instant>,
    accumulated_pause: Duration,
    frame_count: u64,
    measured_fps: f64,
    measured_frame_time_ms: f64,
    last_error: String,
}

impl Renderer {
    async fn new(window: tauri::Window) -> Result<Self, String> {
        let size = window.inner_size().map_err(|error| error.to_string())?;
        let width = size.width.max(1);
        let height = size.height.max(1);

        let backend_environment = env::var("WGPU_BACKEND").unwrap_or_else(|_| "not set".into());
        let adapter_environment = env::var("WGPU_ADAPTER_NAME").unwrap_or_else(|_| "not set".into());
        let requested = wgpu::Backends::from_env().unwrap_or(wgpu::Backends::PRIMARY);
        let compiled = wgpu::Instance::enabled_backend_features();

        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
            backends: requested,
            ..wgpu::InstanceDescriptor::new_without_display_handle()
        });
        let surface = instance
            .create_surface(window.clone())
            .map_err(|error| format!("could not create GPU surface: {error}"))?;

        let adapters = instance.enumerate_adapters(requested).await;
        if adapters.is_empty() {
            return Err(format!(
                "no adapters were found for requested backends {:?}; WGPU_BACKEND={backend_environment}",
                requested
            ));
        }

        let adapter_filter = env::var("WGPU_ADAPTER_NAME")
            .ok()
            .map(|value| value.trim().to_lowercase())
            .filter(|value| !value.is_empty());

        let selected_index = adapters
            .iter()
            .enumerate()
            .find(|(_, adapter)| {
                if !adapter.is_surface_supported(&surface) {
                    return false;
                }
                match &adapter_filter {
                    Some(filter) => adapter.get_info().name.to_lowercase().contains(filter),
                    None => true,
                }
            })
            .map(|(index, _)| index)
            .ok_or_else(|| {
                if let Some(filter) = &adapter_filter {
                    format!("no surface-compatible adapter matched WGPU_ADAPTER_NAME={filter}")
                } else {
                    "no enumerated adapter can present to the renderer surface".to_string()
                }
            })?;

        let adapter = adapters[selected_index].clone();
        let adapter_info = adapter.get_info();
        let adapter_reports = adapters
            .iter()
            .enumerate()
            .map(|(index, candidate)| report_adapter(index, candidate, &surface, selected_index))
            .collect::<Vec<_>>();

        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("junkpile backend lab device"),
                required_features: wgpu::Features::empty(),
                required_limits: wgpu::Limits::default(),
                memory_hints: wgpu::MemoryHints::Performance,
                trace: wgpu::Trace::Off,
                ..Default::default()
            })
            .await
            .map_err(|error| format!("could not create GPU device: {error}"))?;

        let capabilities = surface.get_capabilities(&adapter);
        let surface_formats = capabilities
            .formats
            .iter()
            .map(|value| format!("{value:?}"))
            .collect::<Vec<_>>();
        let present_modes = capabilities
            .present_modes
            .iter()
            .map(|value| format!("{value:?}"))
            .collect::<Vec<_>>();
        let alpha_modes = capabilities
            .alpha_modes
            .iter()
            .map(|value| format!("{value:?}"))
            .collect::<Vec<_>>();

        let mut config = surface
            .get_default_config(&adapter, width, height)
            .ok_or_else(|| "adapter cannot produce a default surface configuration".to_string())?;
        config.present_mode = wgpu::PresentMode::Fifo;
        surface.configure(&device, &config);

        let uniforms = Uniforms {
            resolution_time: [width as f32, height as f32, 0.0, 0.0],
            params: [6.0, 1.0, 4.0, 1.35],
            backend_tint: backend_tint(adapter_info.backend),
        };
        let uniform_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("backend lab uniform buffer"),
            contents: bytemuck::bytes_of(&uniforms),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });
        let uniform_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("backend lab uniform layout"),
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
        let uniform_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("backend lab uniform bind group"),
            layout: &uniform_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: uniform_buffer.as_entire_binding(),
            }],
        });
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("backend lab WGSL"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shader.wgsl").into()),
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("backend lab pipeline layout"),
            bind_group_layouts: &[Some(&uniform_layout)],
            immediate_size: 0,
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("backend lab render pipeline"),
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

        Ok(Self {
            window,
            instance,
            surface,
            device,
            queue,
            config,
            pipeline,
            uniform_buffer,
            uniform_bind_group,
            uniforms,
            requested_backends: format!("{requested:?}"),
            compiled_backends: format!("{compiled:?}"),
            backend_environment,
            adapter_environment,
            adapter_info,
            adapter_reports,
            surface_formats,
            present_modes,
            alpha_modes,
            width,
            height,
            minimized: false,
            paused: false,
            started: Instant::now(),
            paused_at: None,
            accumulated_pause: Duration::ZERO,
            frame_count: 0,
            measured_fps: 0.0,
            measured_frame_time_ms: 0.0,
            last_error: String::new(),
        })
    }

    fn animation_seconds(&self) -> f32 {
        let current = self.paused_at.unwrap_or_else(Instant::now);
        current
            .duration_since(self.started)
            .saturating_sub(self.accumulated_pause)
            .as_secs_f32()
    }

    fn set_paused(&mut self, paused: bool) {
        if paused == self.paused {
            return;
        }
        self.paused = paused;
        if paused {
            self.paused_at = Some(Instant::now());
        } else if let Some(paused_at) = self.paused_at.take() {
            self.accumulated_pause += paused_at.elapsed();
        }
    }

    fn info(&self) -> RendererInfo {
        RendererInfo {
            requested_backends: self.requested_backends.clone(),
            compiled_backends: self.compiled_backends.clone(),
            backend_environment: self.backend_environment.clone(),
            adapter_environment: self.adapter_environment.clone(),
            active_backend: format!("{:?}", self.adapter_info.backend),
            active_adapter: self.adapter_info.name.clone(),
            surface_format: format!("{:?}", self.config.format),
            surface_formats: self.surface_formats.clone(),
            present_modes: self.present_modes.clone(),
            alpha_modes: self.alpha_modes.clone(),
            adapters: self.adapter_reports.clone(),
            width: self.width,
            height: self.height,
            complexity: self.uniforms.params[0],
            speed: self.uniforms.params[1],
            layers: self.uniforms.params[2],
            exposure: self.uniforms.params[3],
            paused: self.paused,
            fps: self.measured_fps,
            frame_time_ms: self.measured_frame_time_ms,
            frame_count: self.frame_count,
            running: true,
            last_error: self.last_error.clone(),
        }
    }

    fn render(&mut self) -> Result<(), String> {
        if self.minimized {
            return Ok(());
        }

        self.uniforms.resolution_time = [
            self.width as f32,
            self.height as f32,
            self.animation_seconds(),
            self.frame_count as f32,
        ];
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
                label: Some("backend lab frame encoder"),
            });
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("backend lab render pass"),
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
            pass.set_bind_group(0, &self.uniform_bind_group, &[]);
            pass.draw(0..3, 0..1);
        }

        self.queue.submit([encoder.finish()]);
        frame.present();
        if reconfigure {
            self.surface.configure(&self.device, &self.config);
        }
        Ok(())
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

    fn reset(&mut self) {
        self.uniforms.params = [6.0, 1.0, 4.0, 1.35];
        self.set_paused(false);
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
                    Ok(RenderCommand::SetParam(name, value)) => match name.as_str() {
                        "complexity" => self.uniforms.params[0] = value.clamp(1.0, 12.0).round(),
                        "speed" => self.uniforms.params[1] = value.clamp(0.0, 4.0),
                        "layers" => self.uniforms.params[2] = value.clamp(1.0, 8.0).round(),
                        "exposure" => self.uniforms.params[3] = value.clamp(0.0, 4.0),
                        _ => {}
                    },
                    Ok(RenderCommand::SetPaused(paused)) => self.set_paused(paused),
                    Ok(RenderCommand::Reset) => self.reset(),
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

            metrics_frames += 1;
            self.frame_count += 1;
            let elapsed = metrics_started.elapsed();
            if elapsed >= Duration::from_millis(500) {
                self.measured_fps = metrics_frames as f64 / elapsed.as_secs_f64();
                self.measured_frame_time_ms = frame_started.elapsed().as_secs_f64() * 1000.0;
                if let Ok(mut info) = shared.write() {
                    *info = self.info();
                }
                metrics_frames = 0;
                metrics_started = Instant::now();
            }

            let remaining = Duration::from_millis(16).saturating_sub(frame_started.elapsed());
            if !remaining.is_zero() {
                thread::sleep(remaining);
            }
        }

        if let Ok(mut info) = shared.write() {
            info.running = false;
        }
    }
}
