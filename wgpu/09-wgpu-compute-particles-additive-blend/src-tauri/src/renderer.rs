use bytemuck::{Pod, Zeroable};
use serde::Serialize;
use std::{
    env,
    mem::size_of,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{sync_channel, Receiver, SyncSender, TryRecvError},
        Arc, RwLock,
    },
    thread,
    time::{Duration, Instant},
};
use wgpu::util::DeviceExt;

const WORKGROUP_SIZE: u32 = 256;
const HARD_MAX_PARTICLES: u32 = 1_000_000;
const DEFAULT_PARTICLES: u32 = 250_000;

const DEFAULT_FIELD_STRENGTH: f32 = 1.15;
const DEFAULT_TURBULENCE: f32 = 0.72;
const DEFAULT_DRAG: f32 = 0.965;
const DEFAULT_SPEED: f32 = 1.0;
const DEFAULT_PARTICLE_SIZE: f32 = 1.8;
const DEFAULT_EXPOSURE: f32 = 1.15;
const DEFAULT_SUBSTEPS: u32 = 2;

#[derive(Debug, Clone)]
pub enum RenderCommand {
    Resize(u32, u32),
    SetParam(String, f32),
    SetParticleCount(u32),
    SetPaused(bool),
    ResetParticles,
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
    pub active_particles: u32,
    pub max_particles: u32,
    pub particle_buffer_bytes: u64,
    pub dispatch_workgroups: u32,
    pub workgroup_size: u32,
    pub substeps: u32,
    pub field_strength: f32,
    pub turbulence: f32,
    pub drag: f32,
    pub speed: f32,
    pub particle_size: f32,
    pub exposure: f32,
    pub paused: bool,
    pub fps: f64,
    pub frame_time_ms: f64,
    pub particle_updates_per_second: f64,
    pub frame_count: u64,
    pub max_storage_buffer_binding_size: u64,
    pub max_buffer_size: u64,
    pub max_compute_workgroups_per_dimension: u32,
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
        .name("junkpile-wgpu-compute-particles".into())
        .spawn(move || renderer.run(rx, thread_info, thread_alive))
        .map_err(|error| format!("could not start renderer thread: {error}"))?;

    Ok(RendererHandle { tx, info })
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Uniforms {
    resolution_time: [f32; 4],
    simulation: [f32; 4],
    render: [f32; 4],
    counts: [u32; 4],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Particle {
    position: [f32; 2],
    velocity: [f32; 2],
    color: [f32; 4],
}

fn lcg_next(state: &mut u32) -> u32 {
    *state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
    *state
}

fn random_unit(state: &mut u32) -> f32 {
    let value = lcg_next(state) >> 8;
    value as f32 / 16_777_216.0
}

fn particle_data(count: u32, seed: u32) -> Vec<Particle> {
    let mut state = seed.max(1);
    let mut particles = Vec::with_capacity(count as usize);

    for index in 0..count {
        let angle = random_unit(&mut state) * std::f32::consts::TAU;
        let radius = random_unit(&mut state).sqrt() * 0.92;
        let jitter = (random_unit(&mut state) - 0.5) * 0.025;
        let position = [angle.cos() * radius, angle.sin() * radius];
        let tangent = [-angle.sin(), angle.cos()];
        let velocity_scale = 0.035 + random_unit(&mut state) * 0.055;
        let hue_phase = index as f32 / count.max(1) as f32;

        particles.push(Particle {
            position,
            velocity: [
                tangent[0] * velocity_scale + jitter,
                tangent[1] * velocity_scale - jitter,
            ],
            color: [
                0.20 + 0.80 * (hue_phase * std::f32::consts::TAU).sin().abs(),
                0.24 + 0.76 * ((hue_phase + 0.33) * std::f32::consts::TAU).sin().abs(),
                0.36 + 0.64 * ((hue_phase + 0.67) * std::f32::consts::TAU).sin().abs(),
                1.0,
            ],
        });
    }

    particles
}

struct Renderer {
    window: tauri::Window,
    instance: wgpu::Instance,
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    compute_pipeline: wgpu::ComputePipeline,
    render_pipeline: wgpu::RenderPipeline,
    uniform_buffer: wgpu::Buffer,
    particle_buffer: wgpu::Buffer,
    compute_bind_group: wgpu::BindGroup,
    render_bind_group: wgpu::BindGroup,
    uniforms: Uniforms,
    adapter_info: wgpu::AdapterInfo,
    width: u32,
    height: u32,
    minimized: bool,
    paused: bool,
    active_particles: u32,
    max_particles: u32,
    substeps: u32,
    reset_seed: u32,
    started: Instant,
    last_frame: Instant,
    frame_count: u64,
    measured_fps: f64,
    measured_frame_time_ms: f64,
    last_error: String,
    max_storage_buffer_binding_size: u64,
    max_buffer_size: u64,
    max_compute_workgroups_per_dimension: u32,
}

impl Renderer {
    async fn new(window: tauri::Window) -> Result<Self, String> {
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
        if adapters.is_empty() {
            return Err(format!(
                "no adapters were found for WGPU_BACKEND={}",
                env::var("WGPU_BACKEND").unwrap_or_else(|_| "automatic".into())
            ));
        }

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
                label: Some("junkpile compute particle device"),
                required_features: wgpu::Features::empty(),
                required_limits: wgpu::Limits::default(),
                memory_hints: wgpu::MemoryHints::Performance,
                trace: wgpu::Trace::Off,
                ..Default::default()
            })
            .await
            .map_err(|error| format!("could not create GPU device: {error}"))?;

        let capabilities = surface.get_capabilities(&adapter);
        let mut config = surface
            .get_default_config(&adapter, width, height)
            .ok_or_else(|| "adapter cannot produce a default surface configuration".to_string())?;
        config.present_mode = wgpu::PresentMode::Fifo;
        surface.configure(&device, &config);

        let limits = device.limits();
        let particle_stride = size_of::<Particle>() as u64;
        let max_by_storage = limits.max_storage_buffer_binding_size / particle_stride;
        let max_by_buffer = limits.max_buffer_size / particle_stride;
        let max_by_dispatch = limits.max_compute_workgroups_per_dimension as u64
            * WORKGROUP_SIZE as u64;
        let max_particles = HARD_MAX_PARTICLES
            .min(max_by_storage.min(max_by_buffer).min(max_by_dispatch) as u32)
            .max(1);
        let active_particles = DEFAULT_PARTICLES.min(max_particles);
        let reset_seed = 0x5eed_0009;
        let initial_particles = particle_data(max_particles, reset_seed);

        let uniforms = Uniforms {
            resolution_time: [width as f32, height as f32, 0.0, 0.0],
            simulation: [
                1.0 / 120.0,
                DEFAULT_FIELD_STRENGTH,
                DEFAULT_TURBULENCE,
                DEFAULT_DRAG,
            ],
            render: [
                DEFAULT_PARTICLE_SIZE,
                DEFAULT_EXPOSURE,
                DEFAULT_SPEED,
                0.0,
            ],
            counts: [active_particles, DEFAULT_SUBSTEPS, 0, reset_seed],
        };

        let uniform_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("compute particle uniform buffer"),
            contents: bytemuck::bytes_of(&uniforms),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });
        let particle_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("compute particle storage buffer"),
            contents: bytemuck::cast_slice(&initial_particles),
            usage: wgpu::BufferUsages::STORAGE
                | wgpu::BufferUsages::COPY_DST
                | wgpu::BufferUsages::COPY_SRC,
        });

        let compute_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("compute particle compute layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: false },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });
        let render_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("compute particle render layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::VERTEX,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: true },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });

        let compute_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("compute particle compute bind group"),
            layout: &compute_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: uniform_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: particle_buffer.as_entire_binding(),
                },
            ],
        });
        let render_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("compute particle render bind group"),
            layout: &render_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: uniform_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: particle_buffer.as_entire_binding(),
                },
            ],
        });

        let compute_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("compute particle simulation WGSL"),
            source: wgpu::ShaderSource::Wgsl(include_str!("compute.wgsl").into()),
        });
        let render_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("compute particle render WGSL"),
            source: wgpu::ShaderSource::Wgsl(include_str!("render.wgsl").into()),
        });

        let compute_pipeline_layout =
            device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("compute particle compute pipeline layout"),
                bind_group_layouts: &[Some(&compute_layout)],
                immediate_size: 0,
            });
        let compute_pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("compute particle compute pipeline"),
            layout: Some(&compute_pipeline_layout),
            module: &compute_shader,
            entry_point: Some("cs_main"),
            compilation_options: Default::default(),
            cache: None,
        });

        let render_pipeline_layout =
            device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("compute particle render pipeline layout"),
                bind_group_layouts: &[Some(&render_layout)],
                immediate_size: 0,
            });
        let render_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("compute particle render pipeline"),
            layout: Some(&render_pipeline_layout),
            vertex: wgpu::VertexState {
                module: &render_shader,
                entry_point: Some("vs_main"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                ..Default::default()
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            fragment: Some(wgpu::FragmentState {
                module: &render_shader,
                entry_point: Some("fs_main"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: config.format,
                    blend: Some(wgpu::BlendState {
                        color: wgpu::BlendComponent {
                            src_factor: wgpu::BlendFactor::One,
                            dst_factor: wgpu::BlendFactor::One,
                            operation: wgpu::BlendOperation::Add,
                        },
                        alpha: wgpu::BlendComponent {
                            src_factor: wgpu::BlendFactor::One,
                            dst_factor: wgpu::BlendFactor::One,
                            operation: wgpu::BlendOperation::Add,
                        },
                    }),
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
            compute_pipeline,
            render_pipeline,
            uniform_buffer,
            particle_buffer,
            compute_bind_group,
            render_bind_group,
            uniforms,
            adapter_info,
            width,
            height,
            minimized: false,
            paused: false,
            active_particles,
            max_particles,
            substeps: DEFAULT_SUBSTEPS,
            reset_seed,
            started: now,
            last_frame: now,
            frame_count: 0,
            measured_fps: 0.0,
            measured_frame_time_ms: 0.0,
            last_error: String::new(),
            max_storage_buffer_binding_size: limits.max_storage_buffer_binding_size,
            max_buffer_size: limits.max_buffer_size,
            max_compute_workgroups_per_dimension: limits.max_compute_workgroups_per_dimension,
        })
    }

    fn dispatch_workgroups(&self) -> u32 {
        self.active_particles.div_ceil(WORKGROUP_SIZE)
    }

    fn particle_buffer_bytes(&self) -> u64 {
        self.max_particles as u64 * size_of::<Particle>() as u64
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
            active_particles: self.active_particles,
            max_particles: self.max_particles,
            particle_buffer_bytes: self.particle_buffer_bytes(),
            dispatch_workgroups: self.dispatch_workgroups(),
            workgroup_size: WORKGROUP_SIZE,
            substeps: self.substeps,
            field_strength: self.uniforms.simulation[1],
            turbulence: self.uniforms.simulation[2],
            drag: self.uniforms.simulation[3],
            speed: self.uniforms.render[2],
            particle_size: self.uniforms.render[0],
            exposure: self.uniforms.render[1],
            paused: self.paused,
            fps: self.measured_fps,
            frame_time_ms: self.measured_frame_time_ms,
            particle_updates_per_second: self.active_particles as f64
                * self.substeps as f64
                * self.measured_fps,
            frame_count: self.frame_count,
            max_storage_buffer_binding_size: self.max_storage_buffer_binding_size,
            max_buffer_size: self.max_buffer_size,
            max_compute_workgroups_per_dimension: self.max_compute_workgroups_per_dimension,
            running: true,
            last_error: self.last_error.clone(),
        }
    }

    fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "field_strength" => self.uniforms.simulation[1] = value.clamp(0.0, 4.0),
            "turbulence" => self.uniforms.simulation[2] = value.clamp(0.0, 3.0),
            "drag" => self.uniforms.simulation[3] = value.clamp(0.80, 0.9995),
            "speed" => self.uniforms.render[2] = value.clamp(0.0, 4.0),
            "particle_size" => self.uniforms.render[0] = value.clamp(0.25, 8.0),
            "exposure" => self.uniforms.render[1] = value.clamp(0.0, 4.0),
            "substeps" => self.substeps = value.round().clamp(1.0, 8.0) as u32,
            _ => {}
        }
    }

    fn reset_params(&mut self) {
        self.uniforms.simulation[1] = DEFAULT_FIELD_STRENGTH;
        self.uniforms.simulation[2] = DEFAULT_TURBULENCE;
        self.uniforms.simulation[3] = DEFAULT_DRAG;
        self.uniforms.render[0] = DEFAULT_PARTICLE_SIZE;
        self.uniforms.render[1] = DEFAULT_EXPOSURE;
        self.uniforms.render[2] = DEFAULT_SPEED;
        self.substeps = DEFAULT_SUBSTEPS;
        self.paused = false;
    }

    fn reset_particles(&mut self) {
        self.reset_seed = self.reset_seed.wrapping_add(0x9e37_79b9);
        let particles = particle_data(self.max_particles, self.reset_seed);
        self.queue
            .write_buffer(&self.particle_buffer, 0, bytemuck::cast_slice(&particles));
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

    fn render(&mut self) -> Result<(), String> {
        if self.minimized {
            return Ok(());
        }

        let now = Instant::now();
        let raw_delta = now.duration_since(self.last_frame).as_secs_f32();
        self.last_frame = now;
        let frame_delta = raw_delta.clamp(1.0 / 500.0, 1.0 / 20.0);
        let simulation_delta = if self.paused {
            0.0
        } else {
            frame_delta / self.substeps.max(1) as f32
        };

        self.uniforms.resolution_time = [
            self.width as f32,
            self.height as f32,
            now.duration_since(self.started).as_secs_f32(),
            self.frame_count as f32,
        ];
        self.uniforms.simulation[0] = simulation_delta;
        self.uniforms.counts = [
            self.active_particles,
            self.substeps,
            self.frame_count as u32,
            self.reset_seed,
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
                label: Some("compute particle frame encoder"),
            });

        if !self.paused {
            let mut compute_pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("compute particle simulation pass"),
                timestamp_writes: None,
            });
            compute_pass.set_pipeline(&self.compute_pipeline);
            compute_pass.set_bind_group(0, &self.compute_bind_group, &[]);
            compute_pass.dispatch_workgroups(self.dispatch_workgroups(), 1, 1);
        }

        {
            let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("compute particle render pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color {
                            r: 0.002,
                            g: 0.004,
                            b: 0.012,
                            a: 1.0,
                        }),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            render_pass.set_pipeline(&self.render_pipeline);
            render_pass.set_bind_group(0, &self.render_bind_group, &[]);
            render_pass.draw(0..6, 0..self.active_particles);
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
                    Ok(RenderCommand::SetParam(name, value)) => self.set_param(&name, value),
                    Ok(RenderCommand::SetParticleCount(count)) => {
                        self.active_particles = count.clamp(1, self.max_particles);
                    }
                    Ok(RenderCommand::SetPaused(paused)) => self.paused = paused,
                    Ok(RenderCommand::ResetParticles) => self.reset_particles(),
                    Ok(RenderCommand::ResetParams) => self.reset_params(),
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
