use crate::mesh::{FeedbackMesh, FeedbackVertex};
use bytemuck::{Pod, Zeroable};
use glam::{Mat4, Vec3};
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

const DEPTH_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Depth32Float;
const WORKGROUP_SIZE: u32 = 128;

const DEFAULT_YAW: f32 = 31.0;
const DEFAULT_PITCH: f32 = 15.0;
const DEFAULT_DISTANCE: f32 = 3.65;
const DEFAULT_FOV: f32 = 48.0;
const DEFAULT_AUTO_ORBIT: f32 = 4.0;

const DEFAULT_SIMULATION_SPEED: f32 = 1.0;
const DEFAULT_FEEDBACK: f32 = 0.985;
const DEFAULT_DAMPING: f32 = 0.985;
const DEFAULT_SPRING: f32 = 0.72;
const DEFAULT_SMOOTHING: f32 = 0.055;
const DEFAULT_DRIVE: f32 = 0.72;
const DEFAULT_NOISE_SCALE: f32 = 2.4;
const DEFAULT_NOISE_SPEED: f32 = 0.42;
const DEFAULT_TWIST: f32 = 0.32;
const DEFAULT_CURL: f32 = 0.78;
const DEFAULT_PULSE: f32 = 0.24;
const DEFAULT_GRAVITY: f32 = 0.0;
const DEFAULT_MAX_DISPLACEMENT: f32 = 1.15;
const DEFAULT_IMPULSE_STRENGTH: f32 = 8.0;
const DEFAULT_IMPULSE_RADIUS: f32 = 0.58;
const DEFAULT_AUTO_IMPULSE_INTERVAL: f32 = 4.5;

const DEFAULT_EXPOSURE: f32 = 1.28;
const DEFAULT_ROUGHNESS: f32 = 0.28;
const DEFAULT_LIGHT_AZIMUTH: f32 = 42.0;
const DEFAULT_LIGHT_ELEVATION: f32 = 36.0;
const DEFAULT_LIGHT_INTENSITY: f32 = 1.35;
const DEFAULT_BACKGROUND: f32 = 0.022;

#[derive(Debug, Clone)]
pub enum RenderCommand {
    Resize(u32, u32),
    SetParam(String, f32),
    SetToggle(String, bool),
    SetViewMode(String),
    ApplyPreset(String),
    TriggerImpulse,
    ResetSimulation,
    Reset,
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
    pub depth_format: String,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub frame_time_ms: f64,
    pub frame_count: u64,
    pub simulation_step: u64,
    pub vertex_count: usize,
    pub triangle_count: usize,
    pub latitude_segments: u32,
    pub longitude_segments: u32,
    pub dispatch_groups: u32,
    pub storage_bytes: u64,
    pub active_buffer: String,
    pub impulse_count: u64,
    pub camera_yaw_degrees: f32,
    pub camera_pitch_degrees: f32,
    pub camera_distance: f32,
    pub camera_fov_degrees: f32,
    pub auto_orbit_degrees: f32,
    pub simulation_speed: f32,
    pub feedback: f32,
    pub damping: f32,
    pub spring: f32,
    pub smoothing: f32,
    pub drive: f32,
    pub noise_scale: f32,
    pub noise_speed: f32,
    pub twist: f32,
    pub curl: f32,
    pub pulse: f32,
    pub gravity: f32,
    pub max_displacement: f32,
    pub impulse_strength: f32,
    pub impulse_radius: f32,
    pub auto_impulse_interval: f32,
    pub paused: bool,
    pub auto_impulse: bool,
    pub exposure: f32,
    pub roughness: f32,
    pub light_azimuth_degrees: f32,
    pub light_elevation_degrees: f32,
    pub light_intensity: f32,
    pub background: f32,
    pub view_mode: String,
    pub backface_culling: bool,
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
    let (tx, rx) = sync_channel(128);
    let alive = Arc::new(AtomicBool::new(true));
    let mut renderer = pollster::block_on(Renderer::new(window))?;
    let info = Arc::new(RwLock::new(renderer.info()));
    let thread_info = Arc::clone(&info);
    let thread_alive = Arc::clone(&alive);

    thread::Builder::new()
        .name("junkpile-wgpu-mesh-feedback-deformer".into())
        .spawn(move || renderer.run(rx, thread_info, thread_alive))
        .map_err(|error| format!("could not start renderer thread: {error}"))?;

    Ok(RendererHandle { tx, info })
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct ComputeUniforms {
    time_delta: [f32; 4],
    forces: [f32; 4],
    dynamics: [f32; 4],
    field: [f32; 4],
    impulse: [f32; 4],
    topology: [u32; 4],
}

// Five vec4<f32> values plus one vec4<u32> = 96 bytes.
const _: [(); 96] = [(); size_of::<ComputeUniforms>()];

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct SceneUniforms {
    view_projection: [f32; 16],
    model: [f32; 16],
    camera_position: [f32; 4],
    light_direction_intensity: [f32; 4],
    render_params: [f32; 4],
    base_color: [f32; 4],
    accent_color: [f32; 4],
}

// Two mat4 values plus five vec4 values = 208 bytes.
const _: [(); 208] = [(); size_of::<SceneUniforms>()];

struct DepthTarget {
    _texture: wgpu::Texture,
    view: wgpu::TextureView,
}

struct Renderer {
    window: tauri::Window,
    instance: wgpu::Instance,
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    depth_target: DepthTarget,
    compute_pipeline: wgpu::ComputePipeline,
    cull_pipeline: wgpu::RenderPipeline,
    double_sided_pipeline: wgpu::RenderPipeline,
    compute_uniform_buffer: wgpu::Buffer,
    scene_uniform_buffer: wgpu::Buffer,
    state_buffers: [wgpu::Buffer; 2],
    compute_bind_groups: [wgpu::BindGroup; 2],
    render_bind_groups: [wgpu::BindGroup; 2],
    index_buffer: wgpu::Buffer,
    initial_state: Vec<FeedbackVertex>,
    index_count: u32,
    vertex_count: usize,
    triangle_count: usize,
    latitude_segments: u32,
    longitude_segments: u32,
    dispatch_groups: u32,
    storage_bytes: u64,
    active_buffer: usize,
    adapter_info: wgpu::AdapterInfo,
    width: u32,
    height: u32,
    minimized: bool,

    yaw_degrees: f32,
    pitch_degrees: f32,
    distance: f32,
    fov_degrees: f32,
    auto_orbit_degrees: f32,

    simulation_speed: f32,
    feedback: f32,
    damping: f32,
    spring: f32,
    smoothing: f32,
    drive: f32,
    noise_scale: f32,
    noise_speed: f32,
    twist: f32,
    curl: f32,
    pulse: f32,
    gravity: f32,
    max_displacement: f32,
    impulse_strength: f32,
    impulse_radius: f32,
    auto_impulse_interval: f32,
    paused: bool,
    auto_impulse: bool,
    impulse_pending: bool,
    impulse_count: u64,
    simulation_step: u64,
    last_auto_impulse: Instant,

    exposure: f32,
    roughness: f32,
    light_azimuth_degrees: f32,
    light_elevation_degrees: f32,
    light_intensity: f32,
    background: f32,
    view_mode: String,
    backface_culling: bool,

    started: Instant,
    last_frame: Instant,
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
                candidate.is_surface_supported(&surface)
                    && adapter_filter.as_ref().map_or(true, |filter| {
                        candidate.get_info().name.to_lowercase().contains(filter)
                    })
            })
            .ok_or_else(|| "no surface-compatible GPU adapter was found".to_string())?;
        let adapter_info = adapter.get_info();

        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("junkpile mesh feedback device"),
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

        let mesh = FeedbackMesh::sphere(128, 192);
        if mesh.vertices.len() > u32::MAX as usize || mesh.indices.len() > u32::MAX as usize {
            return Err("feedback mesh is too large for u32 indexing".into());
        }
        let vertex_count = mesh.vertices.len();
        let triangle_count = mesh.indices.len() / 3;
        let latitude_segments = mesh.latitude_segments;
        let longitude_segments = mesh.longitude_segments;
        let index_count = mesh.indices.len() as u32;
        let dispatch_groups = (vertex_count as u32 + WORKGROUP_SIZE - 1) / WORKGROUP_SIZE;
        let storage_bytes = (vertex_count * size_of::<FeedbackVertex>() * 2) as u64;
        let initial_state = mesh.vertices;

        let state_a = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("mesh feedback state A"),
            contents: bytemuck::cast_slice(&initial_state),
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
        });
        let state_b = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("mesh feedback state B"),
            contents: bytemuck::cast_slice(&initial_state),
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
        });
        let state_buffers = [state_a, state_b];

        let index_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("mesh feedback index buffer"),
            contents: bytemuck::cast_slice(&mesh.indices),
            usage: wgpu::BufferUsages::INDEX,
        });

        let initial_compute_uniforms = ComputeUniforms {
            time_delta: [0.0, 0.0, DEFAULT_SIMULATION_SPEED, 0.0],
            forces: [
                DEFAULT_FEEDBACK,
                DEFAULT_DRIVE,
                DEFAULT_NOISE_SCALE,
                DEFAULT_NOISE_SPEED,
            ],
            dynamics: [
                DEFAULT_DAMPING,
                DEFAULT_SPRING,
                DEFAULT_SMOOTHING,
                DEFAULT_MAX_DISPLACEMENT,
            ],
            field: [DEFAULT_TWIST, DEFAULT_CURL, DEFAULT_PULSE, DEFAULT_GRAVITY],
            impulse: [
                DEFAULT_IMPULSE_STRENGTH,
                DEFAULT_IMPULSE_RADIUS,
                0.0,
                0.0,
            ],
            topology: [
                vertex_count as u32,
                latitude_segments + 1,
                longitude_segments + 1,
                0,
            ],
        };
        let compute_uniform_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("mesh feedback compute uniforms"),
            contents: bytemuck::bytes_of(&initial_compute_uniforms),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });

        let initial_scene_uniforms = SceneUniforms {
            view_projection: Mat4::IDENTITY.to_cols_array(),
            model: Mat4::IDENTITY.to_cols_array(),
            camera_position: [0.0, 0.0, DEFAULT_DISTANCE, 1.0],
            light_direction_intensity: [0.0, -1.0, -1.0, DEFAULT_LIGHT_INTENSITY],
            render_params: [DEFAULT_EXPOSURE, DEFAULT_ROUGHNESS, 0.0, 0.0],
            base_color: [0.025, 0.32, 0.78, 1.0],
            accent_color: [0.12, 0.95, 0.66, 1.0],
        };
        let scene_uniform_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("mesh feedback scene uniforms"),
            contents: bytemuck::bytes_of(&initial_scene_uniforms),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });

        let compute_bind_group_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("mesh feedback compute bind group layout"),
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
                            ty: wgpu::BufferBindingType::Storage { read_only: true },
                            has_dynamic_offset: false,
                            min_binding_size: None,
                        },
                        count: None,
                    },
                    wgpu::BindGroupLayoutEntry {
                        binding: 2,
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

        let compute_bind_group_a_to_b = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("mesh feedback compute A to B"),
            layout: &compute_bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: compute_uniform_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: state_buffers[0].as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: state_buffers[1].as_entire_binding(),
                },
            ],
        });
        let compute_bind_group_b_to_a = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("mesh feedback compute B to A"),
            layout: &compute_bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: compute_uniform_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: state_buffers[1].as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: state_buffers[0].as_entire_binding(),
                },
            ],
        });
        let compute_bind_groups = [compute_bind_group_a_to_b, compute_bind_group_b_to_a];

        let render_bind_group_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("mesh feedback render bind group layout"),
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

        let render_bind_group_a = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("mesh feedback render state A"),
            layout: &render_bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: scene_uniform_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: state_buffers[0].as_entire_binding(),
                },
            ],
        });
        let render_bind_group_b = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("mesh feedback render state B"),
            layout: &render_bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: scene_uniform_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: state_buffers[1].as_entire_binding(),
                },
            ],
        });
        let render_bind_groups = [render_bind_group_a, render_bind_group_b];

        let compute_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("mesh feedback compute WGSL"),
            source: wgpu::ShaderSource::Wgsl(include_str!("feedback_compute.wgsl").into()),
        });
        let render_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("mesh feedback render WGSL"),
            source: wgpu::ShaderSource::Wgsl(include_str!("feedback_render.wgsl").into()),
        });

        let compute_pipeline_layout =
            device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("mesh feedback compute pipeline layout"),
                bind_group_layouts: &[Some(&compute_bind_group_layout)],
                immediate_size: 0,
            });
        let compute_pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("mesh feedback compute pipeline"),
            layout: Some(&compute_pipeline_layout),
            module: &compute_shader,
            entry_point: Some("cs_main"),
            compilation_options: Default::default(),
            cache: None,
        });

        let render_pipeline_layout =
            device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("mesh feedback render pipeline layout"),
                bind_group_layouts: &[Some(&render_bind_group_layout)],
                immediate_size: 0,
            });
        let cull_pipeline = create_render_pipeline(
            &device,
            &render_shader,
            &render_pipeline_layout,
            config.format,
            Some(wgpu::Face::Back),
            "mesh feedback culling pipeline",
        );
        let double_sided_pipeline = create_render_pipeline(
            &device,
            &render_shader,
            &render_pipeline_layout,
            config.format,
            None,
            "mesh feedback double-sided pipeline",
        );

        let depth_target = create_depth_target(&device, width, height);
        let now = Instant::now();

        Ok(Self {
            window,
            instance,
            surface,
            device,
            queue,
            config,
            depth_target,
            compute_pipeline,
            cull_pipeline,
            double_sided_pipeline,
            compute_uniform_buffer,
            scene_uniform_buffer,
            state_buffers,
            compute_bind_groups,
            render_bind_groups,
            index_buffer,
            initial_state,
            index_count,
            vertex_count,
            triangle_count,
            latitude_segments,
            longitude_segments,
            dispatch_groups,
            storage_bytes,
            active_buffer: 0,
            adapter_info,
            width,
            height,
            minimized: false,
            yaw_degrees: DEFAULT_YAW,
            pitch_degrees: DEFAULT_PITCH,
            distance: DEFAULT_DISTANCE,
            fov_degrees: DEFAULT_FOV,
            auto_orbit_degrees: DEFAULT_AUTO_ORBIT,
            simulation_speed: DEFAULT_SIMULATION_SPEED,
            feedback: DEFAULT_FEEDBACK,
            damping: DEFAULT_DAMPING,
            spring: DEFAULT_SPRING,
            smoothing: DEFAULT_SMOOTHING,
            drive: DEFAULT_DRIVE,
            noise_scale: DEFAULT_NOISE_SCALE,
            noise_speed: DEFAULT_NOISE_SPEED,
            twist: DEFAULT_TWIST,
            curl: DEFAULT_CURL,
            pulse: DEFAULT_PULSE,
            gravity: DEFAULT_GRAVITY,
            max_displacement: DEFAULT_MAX_DISPLACEMENT,
            impulse_strength: DEFAULT_IMPULSE_STRENGTH,
            impulse_radius: DEFAULT_IMPULSE_RADIUS,
            auto_impulse_interval: DEFAULT_AUTO_IMPULSE_INTERVAL,
            paused: false,
            auto_impulse: false,
            impulse_pending: false,
            impulse_count: 0,
            simulation_step: 0,
            last_auto_impulse: now,
            exposure: DEFAULT_EXPOSURE,
            roughness: DEFAULT_ROUGHNESS,
            light_azimuth_degrees: DEFAULT_LIGHT_AZIMUTH,
            light_elevation_degrees: DEFAULT_LIGHT_ELEVATION,
            light_intensity: DEFAULT_LIGHT_INTENSITY,
            background: DEFAULT_BACKGROUND,
            view_mode: "lit".into(),
            backface_culling: true,
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
            depth_format: format!("{:?}", DEPTH_FORMAT),
            width: self.width,
            height: self.height,
            fps: self.measured_fps,
            frame_time_ms: self.measured_frame_time_ms,
            frame_count: self.frame_count,
            simulation_step: self.simulation_step,
            vertex_count: self.vertex_count,
            triangle_count: self.triangle_count,
            latitude_segments: self.latitude_segments,
            longitude_segments: self.longitude_segments,
            dispatch_groups: self.dispatch_groups,
            storage_bytes: self.storage_bytes,
            active_buffer: if self.active_buffer == 0 { "A" } else { "B" }.into(),
            impulse_count: self.impulse_count,
            camera_yaw_degrees: self.yaw_degrees,
            camera_pitch_degrees: self.pitch_degrees,
            camera_distance: self.distance,
            camera_fov_degrees: self.fov_degrees,
            auto_orbit_degrees: self.auto_orbit_degrees,
            simulation_speed: self.simulation_speed,
            feedback: self.feedback,
            damping: self.damping,
            spring: self.spring,
            smoothing: self.smoothing,
            drive: self.drive,
            noise_scale: self.noise_scale,
            noise_speed: self.noise_speed,
            twist: self.twist,
            curl: self.curl,
            pulse: self.pulse,
            gravity: self.gravity,
            max_displacement: self.max_displacement,
            impulse_strength: self.impulse_strength,
            impulse_radius: self.impulse_radius,
            auto_impulse_interval: self.auto_impulse_interval,
            paused: self.paused,
            auto_impulse: self.auto_impulse,
            exposure: self.exposure,
            roughness: self.roughness,
            light_azimuth_degrees: self.light_azimuth_degrees,
            light_elevation_degrees: self.light_elevation_degrees,
            light_intensity: self.light_intensity,
            background: self.background,
            view_mode: self.view_mode.clone(),
            backface_culling: self.backface_culling,
            running: true,
            last_error: self.last_error.clone(),
        }
    }

    fn resize(&mut self, width: u32, height: u32) {
        self.minimized = width == 0 || height == 0;
        self.width = width.max(1);
        self.height = height.max(1);
        if !self.minimized {
            self.config.width = self.width;
            self.config.height = self.height;
            self.surface.configure(&self.device, &self.config);
            self.depth_target = create_depth_target(&self.device, self.width, self.height);
        }
    }

    fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "camera_yaw" => self.yaw_degrees = value.clamp(-360.0, 360.0),
            "camera_pitch" => self.pitch_degrees = value.clamp(-88.0, 88.0),
            "camera_distance" => self.distance = value.clamp(1.25, 12.0),
            "camera_fov" => self.fov_degrees = value.clamp(18.0, 110.0),
            "auto_orbit" => self.auto_orbit_degrees = value.clamp(-90.0, 90.0),
            "simulation_speed" => self.simulation_speed = value.clamp(0.0, 3.0),
            "feedback" => self.feedback = value.clamp(0.0, 1.025),
            "damping" => self.damping = value.clamp(0.80, 1.0),
            "spring" => self.spring = value.clamp(0.0, 6.0),
            "smoothing" => self.smoothing = value.clamp(0.0, 0.5),
            "drive" => self.drive = value.clamp(0.0, 3.0),
            "noise_scale" => self.noise_scale = value.clamp(0.1, 10.0),
            "noise_speed" => self.noise_speed = value.clamp(0.0, 4.0),
            "twist" => self.twist = value.clamp(-4.0, 4.0),
            "curl" => self.curl = value.clamp(-3.0, 3.0),
            "pulse" => self.pulse = value.clamp(0.0, 3.0),
            "gravity" => self.gravity = value.clamp(-3.0, 3.0),
            "max_displacement" => self.max_displacement = value.clamp(0.05, 3.0),
            "impulse_strength" => self.impulse_strength = value.clamp(0.0, 30.0),
            "impulse_radius" => self.impulse_radius = value.clamp(0.05, 2.0),
            "auto_impulse_interval" => self.auto_impulse_interval = value.clamp(0.5, 20.0),
            "exposure" => self.exposure = value.clamp(0.1, 5.0),
            "roughness" => self.roughness = value.clamp(0.02, 1.0),
            "light_azimuth" => self.light_azimuth_degrees = value.clamp(-180.0, 180.0),
            "light_elevation" => self.light_elevation_degrees = value.clamp(-89.0, 89.0),
            "light_intensity" => self.light_intensity = value.clamp(0.0, 5.0),
            "background" => self.background = value.clamp(0.0, 0.35),
            _ => {}
        }
    }

    fn set_toggle(&mut self, name: &str, enabled: bool) {
        match name {
            "paused" => self.paused = enabled,
            "auto_impulse" => {
                self.auto_impulse = enabled;
                self.last_auto_impulse = Instant::now();
            }
            "backface_culling" => self.backface_culling = enabled,
            _ => {}
        }
    }

    fn apply_preset(&mut self, preset: &str) {
        match preset {
            "breath" => {
                self.feedback = 0.94;
                self.damping = 0.965;
                self.spring = 2.4;
                self.smoothing = 0.12;
                self.drive = 0.16;
                self.noise_scale = 1.35;
                self.noise_speed = 0.18;
                self.twist = 0.0;
                self.curl = 0.12;
                self.pulse = 1.15;
                self.gravity = 0.0;
                self.max_displacement = 0.52;
                self.auto_impulse = false;
            }
            "liquid" => {
                self.feedback = DEFAULT_FEEDBACK;
                self.damping = DEFAULT_DAMPING;
                self.spring = DEFAULT_SPRING;
                self.smoothing = DEFAULT_SMOOTHING;
                self.drive = DEFAULT_DRIVE;
                self.noise_scale = DEFAULT_NOISE_SCALE;
                self.noise_speed = DEFAULT_NOISE_SPEED;
                self.twist = DEFAULT_TWIST;
                self.curl = DEFAULT_CURL;
                self.pulse = DEFAULT_PULSE;
                self.gravity = DEFAULT_GRAVITY;
                self.max_displacement = DEFAULT_MAX_DISPLACEMENT;
                self.auto_impulse = false;
            }
            "storm" => {
                self.feedback = 1.004;
                self.damping = 0.993;
                self.spring = 0.34;
                self.smoothing = 0.018;
                self.drive = 1.72;
                self.noise_scale = 4.4;
                self.noise_speed = 1.35;
                self.twist = 1.45;
                self.curl = 1.62;
                self.pulse = 0.72;
                self.gravity = -0.10;
                self.max_displacement = 1.85;
                self.impulse_strength = 12.5;
                self.auto_impulse_interval = 2.2;
                self.auto_impulse = true;
            }
            "taffy" => {
                self.feedback = 0.998;
                self.damping = 0.992;
                self.spring = 0.42;
                self.smoothing = 0.095;
                self.drive = 0.54;
                self.noise_scale = 1.8;
                self.noise_speed = 0.31;
                self.twist = 2.25;
                self.curl = 0.38;
                self.pulse = 0.10;
                self.gravity = -0.18;
                self.max_displacement = 1.55;
                self.auto_impulse = false;
            }
            "sculpture" => {
                self.feedback = 0.72;
                self.damping = 0.91;
                self.spring = 3.8;
                self.smoothing = 0.22;
                self.drive = 0.36;
                self.noise_scale = 5.8;
                self.noise_speed = 0.04;
                self.twist = -0.52;
                self.curl = 0.18;
                self.pulse = 0.0;
                self.gravity = 0.0;
                self.max_displacement = 0.72;
                self.auto_impulse = false;
            }
            _ => return,
        }
        self.paused = false;
        self.reset_simulation();
    }

    fn reset_controls(&mut self) {
        self.yaw_degrees = DEFAULT_YAW;
        self.pitch_degrees = DEFAULT_PITCH;
        self.distance = DEFAULT_DISTANCE;
        self.fov_degrees = DEFAULT_FOV;
        self.auto_orbit_degrees = DEFAULT_AUTO_ORBIT;
        self.simulation_speed = DEFAULT_SIMULATION_SPEED;
        self.feedback = DEFAULT_FEEDBACK;
        self.damping = DEFAULT_DAMPING;
        self.spring = DEFAULT_SPRING;
        self.smoothing = DEFAULT_SMOOTHING;
        self.drive = DEFAULT_DRIVE;
        self.noise_scale = DEFAULT_NOISE_SCALE;
        self.noise_speed = DEFAULT_NOISE_SPEED;
        self.twist = DEFAULT_TWIST;
        self.curl = DEFAULT_CURL;
        self.pulse = DEFAULT_PULSE;
        self.gravity = DEFAULT_GRAVITY;
        self.max_displacement = DEFAULT_MAX_DISPLACEMENT;
        self.impulse_strength = DEFAULT_IMPULSE_STRENGTH;
        self.impulse_radius = DEFAULT_IMPULSE_RADIUS;
        self.auto_impulse_interval = DEFAULT_AUTO_IMPULSE_INTERVAL;
        self.paused = false;
        self.auto_impulse = false;
        self.exposure = DEFAULT_EXPOSURE;
        self.roughness = DEFAULT_ROUGHNESS;
        self.light_azimuth_degrees = DEFAULT_LIGHT_AZIMUTH;
        self.light_elevation_degrees = DEFAULT_LIGHT_ELEVATION;
        self.light_intensity = DEFAULT_LIGHT_INTENSITY;
        self.background = DEFAULT_BACKGROUND;
        self.view_mode = "lit".into();
        self.backface_culling = true;
        self.last_error.clear();
        self.reset_simulation();
    }

    fn reset_simulation(&mut self) {
        let bytes = bytemuck::cast_slice(&self.initial_state);
        self.queue.write_buffer(&self.state_buffers[0], 0, bytes);
        self.queue.write_buffer(&self.state_buffers[1], 0, bytes);
        self.active_buffer = 0;
        self.simulation_step = 0;
        self.impulse_pending = false;
        self.last_auto_impulse = Instant::now();
    }

    fn trigger_impulse(&mut self) {
        self.impulse_count = self.impulse_count.saturating_add(1);
        self.impulse_pending = true;
        self.last_auto_impulse = Instant::now();
    }

    fn view_mode_index(&self) -> f32 {
        match self.view_mode.as_str() {
            "normals" => 1.0,
            "velocity" => 2.0,
            "displacement" => 3.0,
            "grid" => 4.0,
            _ => 0.0,
        }
    }

    fn update_scene_uniforms(&mut self, elapsed: f32) {
        let orbit_yaw = self.yaw_degrees + elapsed * self.auto_orbit_degrees;
        let yaw = orbit_yaw.to_radians();
        let pitch = self.pitch_degrees.to_radians();
        let horizontal = pitch.cos();
        let eye = Vec3::new(
            yaw.sin() * horizontal,
            pitch.sin(),
            yaw.cos() * horizontal,
        ) * self.distance;
        let view = Mat4::look_at_rh(eye, Vec3::ZERO, Vec3::Y);
        let aspect = self.width.max(1) as f32 / self.height.max(1) as f32;
        let projection = Mat4::perspective_rh(
            self.fov_degrees.to_radians(),
            aspect.max(0.001),
            0.05,
            100.0,
        );

        let light_azimuth = self.light_azimuth_degrees.to_radians();
        let light_elevation = self.light_elevation_degrees.to_radians();
        let light_direction = Vec3::new(
            light_azimuth.sin() * light_elevation.cos(),
            light_elevation.sin(),
            light_azimuth.cos() * light_elevation.cos(),
        )
        .normalize_or_zero();

        let uniforms = SceneUniforms {
            view_projection: (projection * view).to_cols_array(),
            model: Mat4::IDENTITY.to_cols_array(),
            camera_position: [eye.x, eye.y, eye.z, 1.0],
            light_direction_intensity: [
                light_direction.x,
                light_direction.y,
                light_direction.z,
                self.light_intensity,
            ],
            render_params: [
                self.exposure,
                self.roughness,
                self.view_mode_index(),
                elapsed,
            ],
            base_color: [0.025, 0.32, 0.78, 1.0],
            accent_color: [0.12, 0.95, 0.66, 1.0],
        };
        self.queue
            .write_buffer(&self.scene_uniform_buffer, 0, bytemuck::bytes_of(&uniforms));
    }

    fn update_compute_uniforms(&mut self, elapsed: f32, delta: f32) {
        if self.auto_impulse
            && !self.paused
            && self.last_auto_impulse.elapsed().as_secs_f32() >= self.auto_impulse_interval
        {
            self.trigger_impulse();
        }

        let impulse_active = if self.impulse_pending { 1.0 } else { 0.0 };
        let impulse_phase = self.impulse_count as f32 * 1.618_034 + elapsed * 0.07;
        let uniforms = ComputeUniforms {
            time_delta: [elapsed, delta, self.simulation_speed, 0.0],
            forces: [self.feedback, self.drive, self.noise_scale, self.noise_speed],
            dynamics: [
                self.damping,
                self.spring,
                self.smoothing,
                self.max_displacement,
            ],
            field: [self.twist, self.curl, self.pulse, self.gravity],
            impulse: [
                self.impulse_strength,
                self.impulse_radius,
                impulse_active,
                impulse_phase,
            ],
            topology: [
                self.vertex_count as u32,
                self.latitude_segments + 1,
                self.longitude_segments + 1,
                self.simulation_step as u32,
            ],
        };
        self.queue
            .write_buffer(&self.compute_uniform_buffer, 0, bytemuck::bytes_of(&uniforms));
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

        let frame_started = Instant::now();
        let raw_delta = frame_started.duration_since(self.last_frame).as_secs_f32();
        self.last_frame = frame_started;
        let delta = raw_delta.clamp(0.0, 0.1);
        let elapsed = self.started.elapsed().as_secs_f32();
        self.update_scene_uniforms(elapsed);
        self.update_compute_uniforms(elapsed, delta);

        let (frame, reconfigure_after_present) = match self.surface.get_current_texture() {
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
                return Err("surface validation error while acquiring the next frame".into())
            }
        };

        let view = frame
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("mesh feedback frame encoder"),
            });

        if !self.paused && self.simulation_speed > 0.0 {
            {
                let mut compute_pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                    label: Some("mesh feedback compute pass"),
                    timestamp_writes: None,
                });
                compute_pass.set_pipeline(&self.compute_pipeline);
                compute_pass.set_bind_group(0, &self.compute_bind_groups[self.active_buffer], &[]);
                compute_pass.dispatch_workgroups(self.dispatch_groups, 1, 1);
            }
            self.active_buffer = 1 - self.active_buffer;
            self.simulation_step = self.simulation_step.saturating_add(1);
            self.impulse_pending = false;
        }

        {
            let background = self.background as f64;
            let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("mesh feedback render pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color {
                            r: background * 0.28,
                            g: background * 0.54,
                            b: background,
                            a: 1.0,
                        }),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &self.depth_target.view,
                    depth_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Clear(1.0),
                        store: wgpu::StoreOp::Store,
                    }),
                    stencil_ops: None,
                }),
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            render_pass.set_pipeline(if self.backface_culling {
                &self.cull_pipeline
            } else {
                &self.double_sided_pipeline
            });
            render_pass.set_bind_group(0, &self.render_bind_groups[self.active_buffer], &[]);
            render_pass.set_index_buffer(self.index_buffer.slice(..), wgpu::IndexFormat::Uint32);
            render_pass.draw_indexed(0..self.index_count, 0, 0..1);
        }

        self.queue.submit([encoder.finish()]);
        frame.present();
        if reconfigure_after_present {
            self.surface.configure(&self.device, &self.config);
        }

        self.frame_count = self.frame_count.saturating_add(1);
        self.measured_frame_time_ms = frame_started.elapsed().as_secs_f64() * 1000.0;
        Ok(())
    }

    fn run(
        &mut self,
        rx: Receiver<RenderCommand>,
        shared: Arc<RwLock<RendererInfo>>,
        alive: Arc<AtomicBool>,
    ) {
        let mut metric_started = Instant::now();
        let mut metric_frames = 0u64;

        while alive.load(Ordering::Relaxed) {
            loop {
                match rx.try_recv() {
                    Ok(RenderCommand::Resize(width, height)) => self.resize(width, height),
                    Ok(RenderCommand::SetParam(name, value)) => self.set_param(&name, value),
                    Ok(RenderCommand::SetToggle(name, enabled)) => {
                        self.set_toggle(&name, enabled)
                    }
                    Ok(RenderCommand::SetViewMode(mode)) => {
                        if matches!(
                            mode.as_str(),
                            "lit" | "normals" | "velocity" | "displacement" | "grid"
                        ) {
                            self.view_mode = mode;
                        }
                    }
                    Ok(RenderCommand::ApplyPreset(preset)) => self.apply_preset(&preset),
                    Ok(RenderCommand::TriggerImpulse) => self.trigger_impulse(),
                    Ok(RenderCommand::ResetSimulation) => self.reset_simulation(),
                    Ok(RenderCommand::Reset) => self.reset_controls(),
                    Ok(RenderCommand::Shutdown) => {
                        alive.store(false, Ordering::Relaxed);
                        break;
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

            match self.render() {
                Ok(()) => self.last_error.clear(),
                Err(error) => {
                    self.last_error = error;
                    thread::sleep(Duration::from_millis(100));
                }
            }
            metric_frames = metric_frames.saturating_add(1);

            let elapsed = metric_started.elapsed();
            if elapsed >= Duration::from_millis(500) {
                self.measured_fps = metric_frames as f64 / elapsed.as_secs_f64();
                metric_frames = 0;
                metric_started = Instant::now();
                if let Ok(mut info) = shared.write() {
                    *info = self.info();
                }
            }

            thread::sleep(Duration::from_millis(1));
        }
    }
}

fn create_render_pipeline(
    device: &wgpu::Device,
    shader: &wgpu::ShaderModule,
    layout: &wgpu::PipelineLayout,
    surface_format: wgpu::TextureFormat,
    cull_mode: Option<wgpu::Face>,
    label: &str,
) -> wgpu::RenderPipeline {
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some(label),
        layout: Some(layout),
        vertex: wgpu::VertexState {
            module: shader,
            entry_point: Some("vs_main"),
            compilation_options: Default::default(),
            buffers: &[],
        },
        primitive: wgpu::PrimitiveState {
            topology: wgpu::PrimitiveTopology::TriangleList,
            front_face: wgpu::FrontFace::Ccw,
            cull_mode,
            ..Default::default()
        },
        depth_stencil: Some(wgpu::DepthStencilState {
            format: DEPTH_FORMAT,
            depth_write_enabled: Some(true),
            depth_compare: Some(wgpu::CompareFunction::Less),
            stencil: wgpu::StencilState::default(),
            bias: wgpu::DepthBiasState::default(),
        }),
        multisample: wgpu::MultisampleState::default(),
        fragment: Some(wgpu::FragmentState {
            module: shader,
            entry_point: Some("fs_main"),
            compilation_options: Default::default(),
            targets: &[Some(wgpu::ColorTargetState {
                format: surface_format,
                blend: Some(wgpu::BlendState::REPLACE),
                write_mask: wgpu::ColorWrites::ALL,
            })],
        }),
        multiview_mask: None,
        cache: None,
    })
}

fn create_depth_target(device: &wgpu::Device, width: u32, height: u32) -> DepthTarget {
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("mesh feedback depth target"),
        size: wgpu::Extent3d {
            width: width.max(1),
            height: height.max(1),
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: DEPTH_FORMAT,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    DepthTarget {
        _texture: texture,
        view,
    }
}
