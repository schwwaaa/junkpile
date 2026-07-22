use crate::scene::{CpuImage, CpuScene, SceneStats, Vertex};
use bytemuck::{Pod, Zeroable};
use glam::{Mat4, Vec3};
use serde::Serialize;
use std::{
    env,
    mem::size_of,
    path::PathBuf,
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
const DEFAULT_YAW: f32 = 28.0;
const DEFAULT_PITCH: f32 = 18.0;
const DEFAULT_DISTANCE: f32 = 4.2;
const DEFAULT_FOV: f32 = 52.0;
const DEFAULT_AUTO_ORBIT: f32 = 4.0;
const DEFAULT_EXPOSURE: f32 = 1.15;
const DEFAULT_LIGHT_AZIMUTH: f32 = 42.0;
const DEFAULT_LIGHT_ELEVATION: f32 = 38.0;
const DEFAULT_LIGHT_INTENSITY: f32 = 1.25;
const DEFAULT_BACKGROUND: f32 = 0.035;
const SAMPLE_SCENE: &[u8] = include_bytes!("../assets/sample-scene.glb");

#[derive(Debug, Clone)]
pub enum RenderCommand {
    Resize(u32, u32),
    LoadPath(String),
    LoadSample,
    SetParam(String, f32),
    SetViewMode(String),
    SetBackfaceCulling(bool),
    ResetCamera,
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
    pub camera_yaw_degrees: f32,
    pub camera_pitch_degrees: f32,
    pub camera_distance: f32,
    pub camera_fov_degrees: f32,
    pub auto_orbit_degrees: f32,
    pub exposure: f32,
    pub light_azimuth_degrees: f32,
    pub light_elevation_degrees: f32,
    pub light_intensity: f32,
    pub background: f32,
    pub view_mode: String,
    pub backface_culling: bool,
    pub loading: bool,
    pub running: bool,
    pub last_error: String,
    #[serde(flatten)]
    pub scene: SceneStats,
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
        .name("junkpile-wgpu-gltf-scene-loader".into())
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
    render_params: [f32; 4],
    scene_params: [f32; 4],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct MaterialUniforms {
    base_color: [f32; 4],
    material_params: [f32; 4],
}

struct DepthTarget {
    _texture: wgpu::Texture,
    view: wgpu::TextureView,
}

struct GpuPrimitive {
    vertex_buffer: wgpu::Buffer,
    index_buffer: wgpu::Buffer,
    index_count: u32,
    material_index: usize,
}

struct GpuMaterial {
    _uniform_buffer: wgpu::Buffer,
    bind_group: wgpu::BindGroup,
}

struct GpuScene {
    primitives: Vec<GpuPrimitive>,
    materials: Vec<GpuMaterial>,
    _textures: Vec<wgpu::Texture>,
    _texture_views: Vec<wgpu::TextureView>,
    stats: SceneStats,
    normalization: Mat4,
}

impl GpuScene {
    fn from_cpu(
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        material_layout: &wgpu::BindGroupLayout,
        sampler: &wgpu::Sampler,
        cpu: CpuScene,
    ) -> Result<Self, String> {
        let mut textures = Vec::new();
        let mut texture_views = Vec::new();

        let (white_texture, white_view) = create_rgba_texture(
            device,
            queue,
            "glTF white fallback texture",
            1,
            1,
            &[255, 255, 255, 255],
        );
        textures.push(white_texture);
        texture_views.push(white_view);

        for (index, image) in cpu.images.iter().enumerate() {
            let (texture, view) = create_image_texture(device, queue, index, image);
            textures.push(texture);
            texture_views.push(view);
        }

        let mut materials = Vec::with_capacity(cpu.materials.len());
        for (index, material) in cpu.materials.iter().enumerate() {
            let uniforms = MaterialUniforms {
                base_color: material.base_color,
                material_params: [
                    material.metallic,
                    material.roughness,
                    index as f32,
                    if material.base_color_image.is_some() { 1.0 } else { 0.0 },
                ],
            };
            let uniform_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("glTF material uniform buffer"),
                contents: bytemuck::bytes_of(&uniforms),
                usage: wgpu::BufferUsages::UNIFORM,
            });
            let texture_view_index = material
                .base_color_image
                .map(|image_index| image_index + 1)
                .filter(|image_index| *image_index < texture_views.len())
                .unwrap_or(0);
            let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("glTF material bind group"),
                layout: material_layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: uniform_buffer.as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: wgpu::BindingResource::TextureView(
                            &texture_views[texture_view_index],
                        ),
                    },
                    wgpu::BindGroupEntry {
                        binding: 2,
                        resource: wgpu::BindingResource::Sampler(sampler),
                    },
                ],
            });
            materials.push(GpuMaterial {
                _uniform_buffer: uniform_buffer,
                bind_group,
            });
        }

        if materials.is_empty() {
            return Err("scene produced no materials".into());
        }

        let mut primitives = Vec::with_capacity(cpu.primitives.len());
        for primitive in &cpu.primitives {
            if primitive.indices.len() > u32::MAX as usize {
                return Err("a primitive contains more indices than wgpu can draw".into());
            }
            let vertex_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("glTF vertex buffer"),
                contents: bytemuck::cast_slice(&primitive.vertices),
                usage: wgpu::BufferUsages::VERTEX,
            });
            let index_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("glTF index buffer"),
                contents: bytemuck::cast_slice(&primitive.indices),
                usage: wgpu::BufferUsages::INDEX,
            });
            primitives.push(GpuPrimitive {
                vertex_buffer,
                index_buffer,
                index_count: primitive.indices.len() as u32,
                material_index: primitive.material_index.min(materials.len() - 1),
            });
        }

        let bounds_min = Vec3::from_array(cpu.stats.bounds_min);
        let bounds_max = Vec3::from_array(cpu.stats.bounds_max);
        let center = (bounds_min + bounds_max) * 0.5;
        let extent = (bounds_max - bounds_min).max(Vec3::splat(0.0001));
        let scale = 2.2 / extent.max_element();
        let normalization = Mat4::from_scale(Vec3::splat(scale))
            * Mat4::from_translation(-center);

        Ok(Self {
            primitives,
            materials,
            _textures: textures,
            _texture_views: texture_views,
            stats: cpu.stats,
            normalization,
        })
    }
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
    global_bind_group: wgpu::BindGroup,
    material_layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
    scene: GpuScene,
    adapter_info: wgpu::AdapterInfo,
    width: u32,
    height: u32,
    minimized: bool,
    yaw_degrees: f32,
    pitch_degrees: f32,
    distance: f32,
    fov_degrees: f32,
    auto_orbit_degrees: f32,
    exposure: f32,
    light_azimuth_degrees: f32,
    light_elevation_degrees: f32,
    light_intensity: f32,
    background: f32,
    view_mode: String,
    backface_culling: bool,
    loading: bool,
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
                label: Some("junkpile glTF scene device"),
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

        let global_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("glTF global bind group layout"),
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
        let material_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("glTF material bind group layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
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

        let initial_uniforms = SceneUniforms {
            view_projection: Mat4::IDENTITY.to_cols_array(),
            model: Mat4::IDENTITY.to_cols_array(),
            camera_position: [0.0, 0.0, 4.0, 1.0],
            light_direction_intensity: [0.0, -1.0, -1.0, DEFAULT_LIGHT_INTENSITY],
            render_params: [DEFAULT_EXPOSURE, 0.0, 0.0, 0.0],
            scene_params: [0.0; 4],
        };
        let uniform_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("glTF scene uniform buffer"),
            contents: bytemuck::bytes_of(&initial_uniforms),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });
        let global_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("glTF global bind group"),
            layout: &global_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: uniform_buffer.as_entire_binding(),
            }],
        });

        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("glTF linear sampler"),
            address_mode_u: wgpu::AddressMode::Repeat,
            address_mode_v: wgpu::AddressMode::Repeat,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::MipmapFilterMode::Linear,
            ..Default::default()
        });

        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("glTF scene WGSL"),
            source: wgpu::ShaderSource::Wgsl(include_str!("scene.wgsl").into()),
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("glTF scene pipeline layout"),
            bind_group_layouts: &[Some(&global_layout), Some(&material_layout)],
            immediate_size: 0,
        });
        let cull_pipeline = create_pipeline(
            &device,
            &shader,
            &pipeline_layout,
            config.format,
            Some(wgpu::Face::Back),
            "glTF culling pipeline",
        );
        let double_sided_pipeline = create_pipeline(
            &device,
            &shader,
            &pipeline_layout,
            config.format,
            None,
            "glTF double-sided pipeline",
        );

        let depth_target = create_depth_target(&device, width, height);
        let sample_cpu = CpuScene::from_slice(SAMPLE_SCENE, "Junkpile sample scene")?;
        let scene = GpuScene::from_cpu(
            &device,
            &queue,
            &material_layout,
            &sampler,
            sample_cpu,
        )?;

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
            global_bind_group,
            material_layout,
            sampler,
            scene,
            adapter_info,
            width,
            height,
            minimized: false,
            yaw_degrees: DEFAULT_YAW,
            pitch_degrees: DEFAULT_PITCH,
            distance: DEFAULT_DISTANCE,
            fov_degrees: DEFAULT_FOV,
            auto_orbit_degrees: DEFAULT_AUTO_ORBIT,
            exposure: DEFAULT_EXPOSURE,
            light_azimuth_degrees: DEFAULT_LIGHT_AZIMUTH,
            light_elevation_degrees: DEFAULT_LIGHT_ELEVATION,
            light_intensity: DEFAULT_LIGHT_INTENSITY,
            background: DEFAULT_BACKGROUND,
            view_mode: "lit".into(),
            backface_culling: true,
            loading: false,
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
            camera_yaw_degrees: self.yaw_degrees,
            camera_pitch_degrees: self.pitch_degrees,
            camera_distance: self.distance,
            camera_fov_degrees: self.fov_degrees,
            auto_orbit_degrees: self.auto_orbit_degrees,
            exposure: self.exposure,
            light_azimuth_degrees: self.light_azimuth_degrees,
            light_elevation_degrees: self.light_elevation_degrees,
            light_intensity: self.light_intensity,
            background: self.background,
            view_mode: self.view_mode.clone(),
            backface_culling: self.backface_culling,
            loading: self.loading,
            running: true,
            last_error: self.last_error.clone(),
            scene: self.scene.stats.clone(),
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
            "camera_distance" => self.distance = value.clamp(1.25, 20.0),
            "camera_fov" => self.fov_degrees = value.clamp(18.0, 110.0),
            "auto_orbit" => self.auto_orbit_degrees = value.clamp(-90.0, 90.0),
            "exposure" => self.exposure = value.clamp(0.1, 5.0),
            "light_azimuth" => self.light_azimuth_degrees = value.clamp(-180.0, 180.0),
            "light_elevation" => self.light_elevation_degrees = value.clamp(-89.0, 89.0),
            "light_intensity" => self.light_intensity = value.clamp(0.0, 5.0),
            "background" => self.background = value.clamp(0.0, 0.35),
            _ => {}
        }
    }

    fn reset_camera(&mut self) {
        self.yaw_degrees = DEFAULT_YAW;
        self.pitch_degrees = DEFAULT_PITCH;
        self.distance = DEFAULT_DISTANCE;
        self.fov_degrees = DEFAULT_FOV;
        self.auto_orbit_degrees = DEFAULT_AUTO_ORBIT;
    }

    fn load_sample(&mut self) {
        self.loading = true;
        let result = CpuScene::from_slice(SAMPLE_SCENE, "Junkpile sample scene")
            .and_then(|cpu| {
                GpuScene::from_cpu(
                    &self.device,
                    &self.queue,
                    &self.material_layout,
                    &self.sampler,
                    cpu,
                )
            });
        match result {
            Ok(scene) => {
                self.scene = scene;
                self.last_error.clear();
                self.reset_camera();
            }
            Err(error) => self.last_error = error,
        }
        self.loading = false;
    }

    fn load_path(&mut self, path: String) {
        self.loading = true;
        let result = CpuScene::from_path(&PathBuf::from(&path)).and_then(|cpu| {
            GpuScene::from_cpu(
                &self.device,
                &self.queue,
                &self.material_layout,
                &self.sampler,
                cpu,
            )
        });
        match result {
            Ok(scene) => {
                self.scene = scene;
                self.last_error.clear();
                self.reset_camera();
            }
            Err(error) => self.last_error = error,
        }
        self.loading = false;
    }

    fn view_mode_index(&self) -> f32 {
        match self.view_mode.as_str() {
            "normals" => 1.0,
            "uv" => 2.0,
            "materials" => 3.0,
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
            model: self.scene.normalization.to_cols_array(),
            camera_position: [eye.x, eye.y, eye.z, 1.0],
            light_direction_intensity: [
                light_direction.x,
                light_direction.y,
                light_direction.z,
                self.light_intensity,
            ],
            render_params: [self.exposure, self.view_mode_index(), 0.0, 0.0],
            scene_params: [
                self.scene.stats.material_count as f32,
                self.scene.stats.primitive_count as f32,
                self.started.elapsed().as_secs_f32(),
                0.0,
            ],
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
                label: Some("glTF scene frame encoder"),
            });

        {
            let background = self.background as f64;
            let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("glTF scene render pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color {
                            r: background * 0.62,
                            g: background * 0.74,
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
            render_pass.set_bind_group(0, &self.global_bind_group, &[]);

            for primitive in &self.scene.primitives {
                let material = &self.scene.materials[primitive.material_index];
                render_pass.set_bind_group(1, &material.bind_group, &[]);
                render_pass.set_vertex_buffer(0, primitive.vertex_buffer.slice(..));
                render_pass
                    .set_index_buffer(primitive.index_buffer.slice(..), wgpu::IndexFormat::Uint32);
                render_pass.draw_indexed(0..primitive.index_count, 0, 0..1);
            }
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
                    Ok(RenderCommand::LoadPath(path)) => self.load_path(path),
                    Ok(RenderCommand::LoadSample) => self.load_sample(),
                    Ok(RenderCommand::SetParam(name, value)) => self.set_param(&name, value),
                    Ok(RenderCommand::SetViewMode(mode)) => self.view_mode = mode,
                    Ok(RenderCommand::SetBackfaceCulling(enabled)) => {
                        self.backface_culling = enabled
                    }
                    Ok(RenderCommand::ResetCamera) => self.reset_camera(),
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

            if let Err(error) = self.render() {
                self.last_error = error;
                thread::sleep(Duration::from_millis(100));
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
            format: wgpu::VertexFormat::Float32x2,
            offset: 24,
            shader_location: 2,
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
                array_stride: size_of::<Vertex>() as u64,
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
        label: Some("glTF scene depth target"),
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

fn create_image_texture(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    index: usize,
    image: &CpuImage,
) -> (wgpu::Texture, wgpu::TextureView) {
    create_rgba_texture(
        device,
        queue,
        &format!("glTF image texture {index}"),
        image.width,
        image.height,
        &image.rgba,
    )
}

fn create_rgba_texture(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    label: &str,
    width: u32,
    height: u32,
    rgba: &[u8],
) -> (wgpu::Texture, wgpu::TextureView) {
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some(label),
        size: wgpu::Extent3d {
            width: width.max(1),
            height: height.max(1),
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8UnormSrgb,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    });
    queue.write_texture(
        wgpu::TexelCopyTextureInfo {
            texture: &texture,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        rgba,
        wgpu::TexelCopyBufferLayout {
            offset: 0,
            bytes_per_row: Some(width.max(1) * 4),
            rows_per_image: Some(height.max(1)),
        },
        wgpu::Extent3d {
            width: width.max(1),
            height: height.max(1),
            depth_or_array_layers: 1,
        },
    );
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    (texture, view)
}
