use crate::mesh::{MorphMesh, MorphVertex};
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
const DEFAULT_YAW: f32 = 30.0;
const DEFAULT_PITCH: f32 = 16.0;
const DEFAULT_DISTANCE: f32 = 3.65;
const DEFAULT_FOV: f32 = 48.0;
const DEFAULT_AUTO_ORBIT: f32 = 5.0;
const DEFAULT_CUBE_WEIGHT: f32 = 0.10;
const DEFAULT_TORUS_WEIGHT: f32 = 0.18;
const DEFAULT_BLOOM_WEIGHT: f32 = 0.32;
const DEFAULT_AUTO_AMOUNT: f32 = 0.82;
const DEFAULT_AUTO_SPEED: f32 = 0.42;
const DEFAULT_DISPLACEMENT_SCALE: f32 = 1.0;
const DEFAULT_EXPOSURE: f32 = 1.28;
const DEFAULT_ROUGHNESS: f32 = 0.30;
const DEFAULT_LIGHT_AZIMUTH: f32 = 42.0;
const DEFAULT_LIGHT_ELEVATION: f32 = 35.0;
const DEFAULT_LIGHT_INTENSITY: f32 = 1.35;
const DEFAULT_BACKGROUND: f32 = 0.025;

#[derive(Debug, Clone)]
pub enum RenderCommand {
    Resize(u32, u32),
    SetParam(String, f32),
    SetToggle(String, bool),
    SetBlendMode(String),
    SetViewMode(String),
    ApplyPreset(String),
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
    pub vertex_count: usize,
    pub triangle_count: usize,
    pub latitude_segments: u32,
    pub longitude_segments: u32,
    pub camera_yaw_degrees: f32,
    pub camera_pitch_degrees: f32,
    pub camera_distance: f32,
    pub camera_fov_degrees: f32,
    pub auto_orbit_degrees: f32,
    pub cube_weight: f32,
    pub torus_weight: f32,
    pub bloom_weight: f32,
    pub effective_cube_weight: f32,
    pub effective_torus_weight: f32,
    pub effective_bloom_weight: f32,
    pub auto_morph: bool,
    pub auto_amount: f32,
    pub auto_speed: f32,
    pub displacement_scale: f32,
    pub exposure: f32,
    pub roughness: f32,
    pub light_azimuth_degrees: f32,
    pub light_elevation_degrees: f32,
    pub light_intensity: f32,
    pub background: f32,
    pub blend_mode: String,
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
        .name("junkpile-wgpu-morph-target-lab".into())
        .spawn(move || renderer.run(rx, thread_info, thread_alive))
        .map_err(|error| format!("could not start renderer thread: {error}"))?;

    Ok(RendererHandle { tx, info })
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct SceneUniforms {
    view_projection: [f32; 16],
    model: [f32; 16],
    camera_position: [f32; 4],
    light_direction_intensity: [f32; 4],
    morph_weights: [f32; 4],
    render_params: [f32; 4],
    animation_params: [f32; 4],
    base_color: [f32; 4],
}

// WGSL uniform layout: two mat4 values plus six vec4 values = 224 bytes.
const _: [(); 224] = [(); size_of::<SceneUniforms>()];

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
    cull_pipeline: wgpu::RenderPipeline,
    double_sided_pipeline: wgpu::RenderPipeline,
    uniform_buffer: wgpu::Buffer,
    bind_group: wgpu::BindGroup,
    vertex_buffer: wgpu::Buffer,
    index_buffer: wgpu::Buffer,
    index_count: u32,
    vertex_count: usize,
    triangle_count: usize,
    latitude_segments: u32,
    longitude_segments: u32,
    adapter_info: wgpu::AdapterInfo,
    width: u32,
    height: u32,
    minimized: bool,
    yaw_degrees: f32,
    pitch_degrees: f32,
    distance: f32,
    fov_degrees: f32,
    auto_orbit_degrees: f32,
    cube_weight: f32,
    torus_weight: f32,
    bloom_weight: f32,
    effective_weights: Vec3,
    auto_morph: bool,
    auto_amount: f32,
    auto_speed: f32,
    displacement_scale: f32,
    exposure: f32,
    roughness: f32,
    light_azimuth_degrees: f32,
    light_elevation_degrees: f32,
    light_intensity: f32,
    background: f32,
    blend_mode: String,
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
                label: Some("junkpile morph target device"),
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

        let mesh = MorphMesh::procedural(96, 144);
        if mesh.indices.len() > u32::MAX as usize {
            return Err("morph mesh contains too many indices".into());
        }
        let vertex_count = mesh.vertices.len();
        let triangle_count = mesh.indices.len() / 3;
        let latitude_segments = mesh.latitude_segments;
        let longitude_segments = mesh.longitude_segments;
        let index_count = mesh.indices.len() as u32;

        let vertex_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("morph target vertex buffer"),
            contents: bytemuck::cast_slice(&mesh.vertices),
            usage: wgpu::BufferUsages::VERTEX,
        });
        let index_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("morph target index buffer"),
            contents: bytemuck::cast_slice(&mesh.indices),
            usage: wgpu::BufferUsages::INDEX,
        });

        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("morph target bind group layout"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            }],
        });

        let initial_uniforms = SceneUniforms {
            view_projection: Mat4::IDENTITY.to_cols_array(),
            model: Mat4::IDENTITY.to_cols_array(),
            camera_position: [0.0, 0.0, DEFAULT_DISTANCE, 1.0],
            light_direction_intensity: [0.0, -1.0, -1.0, DEFAULT_LIGHT_INTENSITY],
            morph_weights: [
                DEFAULT_CUBE_WEIGHT,
                DEFAULT_TORUS_WEIGHT,
                DEFAULT_BLOOM_WEIGHT,
                0.0,
            ],
            render_params: [DEFAULT_EXPOSURE, DEFAULT_ROUGHNESS, 1.0, 0.0],
            animation_params: [0.0, DEFAULT_AUTO_SPEED, DEFAULT_DISPLACEMENT_SCALE, 0.0],
            base_color: [0.08, 0.46, 1.0, 1.0],
        };
        let uniform_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("morph target scene uniform buffer"),
            contents: bytemuck::bytes_of(&initial_uniforms),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("morph target bind group"),
            layout: &bind_group_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: uniform_buffer.as_entire_binding(),
            }],
        });

        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("morph target WGSL"),
            source: wgpu::ShaderSource::Wgsl(include_str!("morph.wgsl").into()),
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("morph target pipeline layout"),
            bind_group_layouts: &[Some(&bind_group_layout)],
            immediate_size: 0,
        });
        let cull_pipeline = create_pipeline(
            &device,
            &shader,
            &pipeline_layout,
            config.format,
            Some(wgpu::Face::Back),
            "morph target culling pipeline",
        );
        let double_sided_pipeline = create_pipeline(
            &device,
            &shader,
            &pipeline_layout,
            config.format,
            None,
            "morph target double-sided pipeline",
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
            cull_pipeline,
            double_sided_pipeline,
            uniform_buffer,
            bind_group,
            vertex_buffer,
            index_buffer,
            index_count,
            vertex_count,
            triangle_count,
            latitude_segments,
            longitude_segments,
            adapter_info,
            width,
            height,
            minimized: false,
            yaw_degrees: DEFAULT_YAW,
            pitch_degrees: DEFAULT_PITCH,
            distance: DEFAULT_DISTANCE,
            fov_degrees: DEFAULT_FOV,
            auto_orbit_degrees: DEFAULT_AUTO_ORBIT,
            cube_weight: DEFAULT_CUBE_WEIGHT,
            torus_weight: DEFAULT_TORUS_WEIGHT,
            bloom_weight: DEFAULT_BLOOM_WEIGHT,
            effective_weights: Vec3::new(
                DEFAULT_CUBE_WEIGHT,
                DEFAULT_TORUS_WEIGHT,
                DEFAULT_BLOOM_WEIGHT,
            ),
            auto_morph: true,
            auto_amount: DEFAULT_AUTO_AMOUNT,
            auto_speed: DEFAULT_AUTO_SPEED,
            displacement_scale: DEFAULT_DISPLACEMENT_SCALE,
            exposure: DEFAULT_EXPOSURE,
            roughness: DEFAULT_ROUGHNESS,
            light_azimuth_degrees: DEFAULT_LIGHT_AZIMUTH,
            light_elevation_degrees: DEFAULT_LIGHT_ELEVATION,
            light_intensity: DEFAULT_LIGHT_INTENSITY,
            background: DEFAULT_BACKGROUND,
            blend_mode: "normalized".into(),
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
            vertex_count: self.vertex_count,
            triangle_count: self.triangle_count,
            latitude_segments: self.latitude_segments,
            longitude_segments: self.longitude_segments,
            camera_yaw_degrees: self.yaw_degrees,
            camera_pitch_degrees: self.pitch_degrees,
            camera_distance: self.distance,
            camera_fov_degrees: self.fov_degrees,
            auto_orbit_degrees: self.auto_orbit_degrees,
            cube_weight: self.cube_weight,
            torus_weight: self.torus_weight,
            bloom_weight: self.bloom_weight,
            effective_cube_weight: self.effective_weights.x,
            effective_torus_weight: self.effective_weights.y,
            effective_bloom_weight: self.effective_weights.z,
            auto_morph: self.auto_morph,
            auto_amount: self.auto_amount,
            auto_speed: self.auto_speed,
            displacement_scale: self.displacement_scale,
            exposure: self.exposure,
            roughness: self.roughness,
            light_azimuth_degrees: self.light_azimuth_degrees,
            light_elevation_degrees: self.light_elevation_degrees,
            light_intensity: self.light_intensity,
            background: self.background,
            blend_mode: self.blend_mode.clone(),
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
            "cube_weight" => self.cube_weight = value.clamp(0.0, 1.0),
            "torus_weight" => self.torus_weight = value.clamp(0.0, 1.0),
            "bloom_weight" => self.bloom_weight = value.clamp(0.0, 1.0),
            "auto_amount" => self.auto_amount = value.clamp(0.0, 1.0),
            "auto_speed" => self.auto_speed = value.clamp(0.0, 4.0),
            "displacement_scale" => self.displacement_scale = value.clamp(0.0, 1.8),
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
            "auto_morph" => self.auto_morph = enabled,
            "backface_culling" => self.backface_culling = enabled,
            _ => {}
        }
    }

    fn apply_preset(&mut self, preset: &str) {
        match preset {
            "cube" => {
                self.cube_weight = 1.0;
                self.torus_weight = 0.0;
                self.bloom_weight = 0.0;
                self.auto_morph = false;
                self.displacement_scale = 1.0;
            }
            "torus" => {
                self.cube_weight = 0.0;
                self.torus_weight = 1.0;
                self.bloom_weight = 0.0;
                self.auto_morph = false;
                self.displacement_scale = 1.0;
            }
            "bloom" => {
                self.cube_weight = 0.0;
                self.torus_weight = 0.0;
                self.bloom_weight = 1.0;
                self.auto_morph = false;
                self.displacement_scale = 1.0;
            }
            "cycle" => {
                self.cube_weight = 0.10;
                self.torus_weight = 0.18;
                self.bloom_weight = 0.32;
                self.auto_morph = true;
                self.auto_amount = 0.92;
                self.auto_speed = 0.52;
                self.blend_mode = "normalized".into();
                self.displacement_scale = 1.0;
            }
            "overdrive" => {
                self.cube_weight = 0.72;
                self.torus_weight = 0.58;
                self.bloom_weight = 0.84;
                self.auto_morph = true;
                self.auto_amount = 0.34;
                self.auto_speed = 1.12;
                self.blend_mode = "additive".into();
                self.displacement_scale = 1.25;
            }
            _ => {}
        }
    }

    fn reset(&mut self) {
        self.yaw_degrees = DEFAULT_YAW;
        self.pitch_degrees = DEFAULT_PITCH;
        self.distance = DEFAULT_DISTANCE;
        self.fov_degrees = DEFAULT_FOV;
        self.auto_orbit_degrees = DEFAULT_AUTO_ORBIT;
        self.cube_weight = DEFAULT_CUBE_WEIGHT;
        self.torus_weight = DEFAULT_TORUS_WEIGHT;
        self.bloom_weight = DEFAULT_BLOOM_WEIGHT;
        self.auto_morph = true;
        self.auto_amount = DEFAULT_AUTO_AMOUNT;
        self.auto_speed = DEFAULT_AUTO_SPEED;
        self.displacement_scale = DEFAULT_DISPLACEMENT_SCALE;
        self.exposure = DEFAULT_EXPOSURE;
        self.roughness = DEFAULT_ROUGHNESS;
        self.light_azimuth_degrees = DEFAULT_LIGHT_AZIMUTH;
        self.light_elevation_degrees = DEFAULT_LIGHT_ELEVATION;
        self.light_intensity = DEFAULT_LIGHT_INTENSITY;
        self.background = DEFAULT_BACKGROUND;
        self.blend_mode = "normalized".into();
        self.view_mode = "lit".into();
        self.backface_culling = true;
        self.last_error.clear();
    }

    fn blend_mode_index(&self) -> f32 {
        match self.blend_mode.as_str() {
            "additive" => 0.0,
            "sequential" => 2.0,
            _ => 1.0,
        }
    }

    fn view_mode_index(&self) -> f32 {
        match self.view_mode.as_str() {
            "normals" => 1.0,
            "morph_heat" => 2.0,
            "grid" => 3.0,
            _ => 0.0,
        }
    }

    fn update_uniforms(&mut self, delta_seconds: f32) {
        self.yaw_degrees += self.auto_orbit_degrees * delta_seconds;
        if self.yaw_degrees > 360.0 {
            self.yaw_degrees -= 720.0;
        } else if self.yaw_degrees < -360.0 {
            self.yaw_degrees += 720.0;
        }

        let elapsed = self.started.elapsed().as_secs_f32();
        let manual = Vec3::new(self.cube_weight, self.torus_weight, self.bloom_weight);
        let automatic = Vec3::new(
            0.5 + 0.5 * (elapsed * self.auto_speed * 1.00).sin(),
            0.5 + 0.5 * (elapsed * self.auto_speed * 1.17 + 2.094).sin(),
            0.5 + 0.5 * (elapsed * self.auto_speed * 0.83 + 4.188).sin(),
        );
        self.effective_weights = if self.auto_morph {
            manual.lerp(automatic, self.auto_amount)
        } else {
            manual
        }
        .clamp(Vec3::ZERO, Vec3::ONE);

        let yaw = self.yaw_degrees.to_radians();
        let pitch = self.pitch_degrees.to_radians();
        let eye = Vec3::new(
            self.distance * pitch.cos() * yaw.sin(),
            self.distance * pitch.sin(),
            self.distance * pitch.cos() * yaw.cos(),
        );
        let view = Mat4::look_at_rh(eye, Vec3::ZERO, Vec3::Y);
        let aspect = self.width.max(1) as f32 / self.height.max(1) as f32;
        let projection = Mat4::perspective_rh(
            self.fov_degrees.to_radians(),
            aspect,
            0.01,
            100.0,
        );
        let model = Mat4::from_rotation_y(elapsed * -0.12)
            * Mat4::from_rotation_x((elapsed * 0.07).sin() * 0.12)
            * Mat4::from_scale(Vec3::splat(1.16));

        let light_azimuth = self.light_azimuth_degrees.to_radians();
        let light_elevation = self.light_elevation_degrees.to_radians();
        let light_direction = Vec3::new(
            light_elevation.cos() * light_azimuth.sin(),
            -light_elevation.sin(),
            light_elevation.cos() * light_azimuth.cos(),
        )
        .normalize_or_zero();

        let uniforms = SceneUniforms {
            view_projection: (projection * view).to_cols_array(),
            model: model.to_cols_array(),
            camera_position: [eye.x, eye.y, eye.z, 1.0],
            light_direction_intensity: [
                light_direction.x,
                light_direction.y,
                light_direction.z,
                self.light_intensity,
            ],
            morph_weights: [
                self.effective_weights.x,
                self.effective_weights.y,
                self.effective_weights.z,
                0.0,
            ],
            render_params: [
                self.exposure,
                self.roughness,
                self.blend_mode_index(),
                self.view_mode_index(),
            ],
            animation_params: [
                elapsed,
                self.auto_speed,
                self.displacement_scale,
                if self.auto_morph { 1.0 } else { 0.0 },
            ],
            base_color: [0.08, 0.46, 1.0, 1.0],
        };
        self.queue
            .write_buffer(&self.uniform_buffer, 0, bytemuck::bytes_of(&uniforms));
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
        self.update_uniforms(raw_delta.clamp(0.0, 0.1));

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
                label: Some("morph target frame encoder"),
            });

        {
            let background = self.background as f64;
            let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("morph target render pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color {
                            r: background * 0.34,
                            g: background * 0.52,
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
            render_pass.set_bind_group(0, &self.bind_group, &[]);
            render_pass.set_vertex_buffer(0, self.vertex_buffer.slice(..));
            render_pass.set_index_buffer(self.index_buffer.slice(..), wgpu::IndexFormat::Uint32);
            render_pass.draw_indexed(0..self.index_count, 0, 0..1);
        }

        self.queue.submit([encoder.finish()]);
        frame.present();
        if reconfigure_after_present {
            self.surface.configure(&self.device, &self.config);
        }

        self.frame_count += 1;
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
                    Ok(RenderCommand::SetBlendMode(mode)) => {
                        if matches!(mode.as_str(), "normalized" | "additive" | "sequential") {
                            self.blend_mode = mode;
                        }
                    }
                    Ok(RenderCommand::SetViewMode(mode)) => {
                        if matches!(mode.as_str(), "lit" | "normals" | "morph_heat" | "grid") {
                            self.view_mode = mode;
                        }
                    },
                    Ok(RenderCommand::ApplyPreset(preset)) => self.apply_preset(&preset),
                    Ok(RenderCommand::Reset) => self.reset(),
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
            metric_frames += 1;

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

fn create_pipeline(
    device: &wgpu::Device,
    shader: &wgpu::ShaderModule,
    layout: &wgpu::PipelineLayout,
    surface_format: wgpu::TextureFormat,
    cull_mode: Option<wgpu::Face>,
    label: &str,
) -> wgpu::RenderPipeline {
    let attributes = [
        wgpu::VertexAttribute {
            format: wgpu::VertexFormat::Float32x3,
            offset: 0,
            shader_location: 0,
        },
        wgpu::VertexAttribute {
            format: wgpu::VertexFormat::Float32x3,
            offset: 12,
            shader_location: 1,
        },
        wgpu::VertexAttribute {
            format: wgpu::VertexFormat::Float32x3,
            offset: 24,
            shader_location: 2,
        },
        wgpu::VertexAttribute {
            format: wgpu::VertexFormat::Float32x3,
            offset: 36,
            shader_location: 3,
        },
        wgpu::VertexAttribute {
            format: wgpu::VertexFormat::Float32x3,
            offset: 48,
            shader_location: 4,
        },
        wgpu::VertexAttribute {
            format: wgpu::VertexFormat::Float32x3,
            offset: 60,
            shader_location: 5,
        },
        wgpu::VertexAttribute {
            format: wgpu::VertexFormat::Float32x3,
            offset: 72,
            shader_location: 6,
        },
        wgpu::VertexAttribute {
            format: wgpu::VertexFormat::Float32x3,
            offset: 84,
            shader_location: 7,
        },
        wgpu::VertexAttribute {
            format: wgpu::VertexFormat::Float32x2,
            offset: 96,
            shader_location: 8,
        },
    ];

    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some(label),
        layout: Some(layout),
        vertex: wgpu::VertexState {
            module: shader,
            entry_point: Some("vs_main"),
            compilation_options: Default::default(),
            buffers: &[wgpu::VertexBufferLayout {
                array_stride: size_of::<MorphVertex>() as u64,
                step_mode: wgpu::VertexStepMode::Vertex,
                attributes: &attributes,
            }],
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
        label: Some("morph target depth target"),
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
