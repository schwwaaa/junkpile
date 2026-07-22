use crate::scene::{
    AnimationInfo, CpuImage, CpuScene, JointInfo, NodePose, SceneStats, Vertex,
};
use bytemuck::{Pod, Zeroable};
use glam::{EulerRot, Mat4, Quat, Vec3};
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
const DEFAULT_PITCH: f32 = 12.0;
const DEFAULT_DISTANCE: f32 = 4.8;
const DEFAULT_FOV: f32 = 50.0;
const DEFAULT_AUTO_ORBIT: f32 = 0.0;
const DEFAULT_EXPOSURE: f32 = 1.12;
const DEFAULT_LIGHT_AZIMUTH: f32 = 38.0;
const DEFAULT_LIGHT_ELEVATION: f32 = 42.0;
const DEFAULT_LIGHT_INTENSITY: f32 = 1.45;
const DEFAULT_BACKGROUND: f32 = 0.025;
const MAX_BONE_VERTICES: usize = 4096;
const SAMPLE_SCENE: &[u8] = include_bytes!("../assets/sample-skinned.glb");

#[derive(Debug, Clone)]
pub enum RenderCommand {
    Resize(u32, u32),
    LoadPath(String),
    LoadSample,
    SetParam(String, f32),
    SetViewMode(String),
    SetBackfaceCulling(bool),
    SetShowSkeleton(bool),
    SetAnimation(usize),
    SetAnimationPlaying(bool),
    SetAnimationLoop(bool),
    SetAnimationTime(f32),
    SetAnimationSpeed(f32),
    SetAnimationBlend(f32),
    SelectJoint(usize),
    SetJointRotation(f32, f32, f32),
    ResetSelectedJoint,
    ResetPose,
    ApplyPosePreset(String),
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
    pub show_skeleton: bool,
    pub loading: bool,
    pub running: bool,
    pub last_error: String,
    pub active_animation_index: usize,
    pub animation_playing: bool,
    pub animation_loop: bool,
    pub animation_time: f32,
    pub animation_duration: f32,
    pub animation_speed: f32,
    pub animation_blend: f32,
    pub selected_joint_index: usize,
    pub selected_joint_rotation: [f32; 3],
    pub bone_segment_count: u32,
    pub joints: Vec<JointInfo>,
    pub animations: Vec<AnimationInfo>,
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
    let (tx, rx) = sync_channel(256);
    let alive = Arc::new(AtomicBool::new(true));
    let mut renderer = pollster::block_on(Renderer::new(window))?;
    let info = Arc::new(RwLock::new(renderer.info()));
    let thread_info = Arc::clone(&info);
    let thread_alive = Arc::clone(&alive);

    thread::Builder::new()
        .name("junkpile-wgpu-skeletal-pose-lab".into())
        .spawn(move || renderer.run(rx, thread_info, thread_alive))
        .map_err(|error| format!("could not start renderer thread: {error}"))?;

    Ok(RendererHandle { tx, info })
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct SceneUniforms {
    view_projection: [f32; 16],
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

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct ObjectUniforms {
    model: [f32; 16],
    skin_params: [f32; 4],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct BoneVertex {
    position: [f32; 3],
    color: [f32; 3],
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
    node_index: usize,
    skin_index: Option<usize>,
    object_buffer: wgpu::Buffer,
    joint_buffer: wgpu::Buffer,
    object_bind_group: wgpu::BindGroup,
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
    cpu: CpuScene,
    normalization: Mat4,
}

impl GpuScene {
    fn from_cpu(
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        material_layout: &wgpu::BindGroupLayout,
        object_layout: &wgpu::BindGroupLayout,
        sampler: &wgpu::Sampler,
        cpu: CpuScene,
    ) -> Result<Self, String> {
        let mut textures = Vec::new();
        let mut texture_views = Vec::new();
        let (white_texture, white_view) = create_rgba_texture(
            device,
            queue,
            "skeletal white fallback texture",
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
                label: Some("skeletal material uniform buffer"),
                contents: bytemuck::bytes_of(&uniforms),
                usage: wgpu::BufferUsages::UNIFORM,
            });
            let texture_view_index = material
                .base_color_image
                .map(|image_index| image_index + 1)
                .filter(|image_index| *image_index < texture_views.len())
                .unwrap_or(0);
            let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("skeletal material bind group"),
                layout: material_layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: uniform_buffer.as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: wgpu::BindingResource::TextureView(&texture_views[texture_view_index]),
                    },
                    wgpu::BindGroupEntry {
                        binding: 2,
                        resource: wgpu::BindingResource::Sampler(sampler),
                    },
                ],
            });
            materials.push(GpuMaterial { _uniform_buffer: uniform_buffer, bind_group });
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
                label: Some("skeletal vertex buffer"),
                contents: bytemuck::cast_slice(&primitive.vertices),
                usage: wgpu::BufferUsages::VERTEX,
            });
            let index_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("skeletal index buffer"),
                contents: bytemuck::cast_slice(&primitive.indices),
                usage: wgpu::BufferUsages::INDEX,
            });
            let object_uniforms = ObjectUniforms {
                model: Mat4::IDENTITY.to_cols_array(),
                skin_params: [0.0, 1.0, -1.0, 0.0],
            };
            let object_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("skeletal object uniform buffer"),
                contents: bytemuck::bytes_of(&object_uniforms),
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            });
            let joint_count = primitive
                .skin_index
                .and_then(|index| cpu.skins.get(index))
                .map(|skin| skin.joints.len())
                .unwrap_or(1)
                .max(1);
            let identity_matrices = vec![Mat4::IDENTITY.to_cols_array(); joint_count];
            let joint_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("skeletal joint matrix storage buffer"),
                contents: bytemuck::cast_slice(&identity_matrices),
                usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            });
            let object_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("skeletal object bind group"),
                layout: object_layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: object_buffer.as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: joint_buffer.as_entire_binding(),
                    },
                ],
            });
            primitives.push(GpuPrimitive {
                vertex_buffer,
                index_buffer,
                index_count: primitive.indices.len() as u32,
                material_index: primitive.material_index.min(materials.len() - 1),
                node_index: primitive.node_index,
                skin_index: primitive.skin_index,
                object_buffer,
                joint_buffer,
                object_bind_group,
            });
        }

        let bounds_min = Vec3::from_array(cpu.stats.bounds_min);
        let bounds_max = Vec3::from_array(cpu.stats.bounds_max);
        let center = (bounds_min + bounds_max) * 0.5;
        let extent = (bounds_max - bounds_min).max(Vec3::splat(0.0001));
        let scale = 2.5 / extent.max_element();
        let normalization = Mat4::from_scale(Vec3::splat(scale)) * Mat4::from_translation(-center);

        Ok(Self {
            primitives,
            materials,
            _textures: textures,
            _texture_views: texture_views,
            cpu,
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
    bone_pipeline: wgpu::RenderPipeline,
    uniform_buffer: wgpu::Buffer,
    global_bind_group: wgpu::BindGroup,
    material_layout: wgpu::BindGroupLayout,
    object_layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
    scene: GpuScene,
    bone_buffer: wgpu::Buffer,
    bone_vertex_count: u32,
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
    show_skeleton: bool,
    loading: bool,
    active_animation_index: usize,
    animation_playing: bool,
    animation_loop: bool,
    animation_time: f32,
    animation_speed: f32,
    animation_blend: f32,
    selected_joint_index: usize,
    joint_rotations: Vec<Vec3>,
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
                label: Some("junkpile skeletal pose device"),
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
            label: Some("skeletal global bind group layout"),
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
            label: Some("skeletal material bind group layout"),
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
        let object_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("skeletal object bind group layout"),
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

        let initial_uniforms = SceneUniforms {
            view_projection: Mat4::IDENTITY.to_cols_array(),
            camera_position: [0.0, 0.0, 4.0, 1.0],
            light_direction_intensity: [0.0, -1.0, -1.0, DEFAULT_LIGHT_INTENSITY],
            render_params: [DEFAULT_EXPOSURE, 0.0, 0.0, 0.0],
            scene_params: [0.0; 4],
        };
        let uniform_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("skeletal scene uniform buffer"),
            contents: bytemuck::bytes_of(&initial_uniforms),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });
        let global_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("skeletal global bind group"),
            layout: &global_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: uniform_buffer.as_entire_binding(),
            }],
        });
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("skeletal linear sampler"),
            address_mode_u: wgpu::AddressMode::Repeat,
            address_mode_v: wgpu::AddressMode::Repeat,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::MipmapFilterMode::Linear,
            ..Default::default()
        });
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("skeletal pose WGSL"),
            source: wgpu::ShaderSource::Wgsl(include_str!("skin.wgsl").into()),
        });
        let mesh_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("skeletal mesh pipeline layout"),
            bind_group_layouts: &[
                Some(&global_layout),
                Some(&material_layout),
                Some(&object_layout),
            ],
            immediate_size: 0,
        });
        let bone_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("skeletal bone pipeline layout"),
            bind_group_layouts: &[Some(&global_layout)],
            immediate_size: 0,
        });
        let cull_pipeline = create_mesh_pipeline(
            &device,
            &shader,
            &mesh_pipeline_layout,
            config.format,
            Some(wgpu::Face::Back),
            "skeletal culling pipeline",
        );
        let double_sided_pipeline = create_mesh_pipeline(
            &device,
            &shader,
            &mesh_pipeline_layout,
            config.format,
            None,
            "skeletal double-sided pipeline",
        );
        let bone_pipeline = create_bone_pipeline(
            &device,
            &shader,
            &bone_pipeline_layout,
            config.format,
        );
        let depth_target = create_depth_target(&device, width, height);
        let sample_cpu = CpuScene::from_slice(SAMPLE_SCENE, "Junkpile skinned sample")?;
        let joint_rotations = vec![Vec3::ZERO; sample_cpu.nodes.len()];
        let scene = GpuScene::from_cpu(
            &device,
            &queue,
            &material_layout,
            &object_layout,
            &sampler,
            sample_cpu,
        )?;
        let bone_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("skeletal bone line buffer"),
            size: (MAX_BONE_VERTICES * size_of::<BoneVertex>()) as u64,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

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
            bone_pipeline,
            uniform_buffer,
            global_bind_group,
            material_layout,
            object_layout,
            sampler,
            scene,
            bone_buffer,
            bone_vertex_count: 0,
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
            show_skeleton: true,
            loading: false,
            active_animation_index: 0,
            animation_playing: true,
            animation_loop: true,
            animation_time: 0.0,
            animation_speed: 1.0,
            animation_blend: 1.0,
            selected_joint_index: 0,
            joint_rotations,
            started: now,
            last_frame: now,
            frame_count: 0,
            measured_fps: 0.0,
            measured_frame_time_ms: 0.0,
            last_error: String::new(),
        })
    }

    fn info(&self) -> RendererInfo {
        let animations = self.scene.cpu.animation_infos();
        let joints = self.scene.cpu.joint_infos();
        let duration = animations
            .get(self.active_animation_index)
            .map(|animation| animation.duration)
            .unwrap_or(0.0);
        let selected_rotation = joints
            .get(self.selected_joint_index)
            .and_then(|joint| self.joint_rotations.get(joint.node_index))
            .copied()
            .unwrap_or(Vec3::ZERO);
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
            show_skeleton: self.show_skeleton,
            loading: self.loading,
            running: true,
            last_error: self.last_error.clone(),
            active_animation_index: self.active_animation_index,
            animation_playing: self.animation_playing,
            animation_loop: self.animation_loop,
            animation_time: self.animation_time,
            animation_duration: duration,
            animation_speed: self.animation_speed,
            animation_blend: self.animation_blend,
            selected_joint_index: self.selected_joint_index,
            selected_joint_rotation: selected_rotation.to_array(),
            bone_segment_count: self.bone_vertex_count / 2,
            joints,
            animations,
            scene: self.scene.cpu.stats.clone(),
        }
    }

    fn resize(&mut self, width: u32, height: u32) {
        self.width = width.max(1);
        self.height = height.max(1);
        self.minimized = width == 0 || height == 0;
        if self.minimized {
            return;
        }
        self.config.width = self.width;
        self.config.height = self.height;
        self.surface.configure(&self.device, &self.config);
        self.depth_target = create_depth_target(&self.device, self.width, self.height);
    }

    fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "camera_yaw" => self.yaw_degrees = value.clamp(-180.0, 180.0),
            "camera_pitch" => self.pitch_degrees = value.clamp(-85.0, 85.0),
            "camera_distance" => self.distance = value.clamp(1.25, 16.0),
            "camera_fov" => self.fov_degrees = value.clamp(18.0, 100.0),
            "auto_orbit" => self.auto_orbit_degrees = value.clamp(-45.0, 45.0),
            "exposure" => self.exposure = value.clamp(0.1, 4.0),
            "light_azimuth" => self.light_azimuth_degrees = value.clamp(-180.0, 180.0),
            "light_elevation" => self.light_elevation_degrees = value.clamp(-80.0, 80.0),
            "light_intensity" => self.light_intensity = value.clamp(0.0, 5.0),
            "background" => self.background = value.clamp(0.0, 0.3),
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

    fn reset_scene_state(&mut self) {
        self.joint_rotations = vec![Vec3::ZERO; self.scene.cpu.nodes.len()];
        self.selected_joint_index = 0;
        self.active_animation_index = 0;
        self.animation_time = 0.0;
        self.animation_playing = !self.scene.cpu.animations.is_empty();
        self.animation_loop = true;
        self.animation_speed = 1.0;
        self.animation_blend = 1.0;
    }

    fn install_scene(&mut self, cpu: CpuScene) -> Result<(), String> {
        self.scene = GpuScene::from_cpu(
            &self.device,
            &self.queue,
            &self.material_layout,
            &self.object_layout,
            &self.sampler,
            cpu,
        )?;
        self.reset_scene_state();
        self.last_error.clear();
        Ok(())
    }

    fn load_sample(&mut self) {
        self.loading = true;
        match CpuScene::from_slice(SAMPLE_SCENE, "Junkpile skinned sample")
            .and_then(|cpu| self.install_scene(cpu))
        {
            Ok(()) => {}
            Err(error) => self.last_error = error,
        }
        self.loading = false;
    }

    fn load_path(&mut self, path: String) {
        self.loading = true;
        let result = CpuScene::from_path(&PathBuf::from(&path))
            .and_then(|cpu| self.install_scene(cpu));
        if let Err(error) = result {
            self.last_error = error;
        }
        self.loading = false;
    }

    fn animation_duration(&self) -> f32 {
        self.scene
            .cpu
            .animations
            .get(self.active_animation_index)
            .map(|animation| animation.duration)
            .unwrap_or(0.0)
    }

    fn select_joint(&mut self, index: usize) {
        let count = self.scene.cpu.joint_infos().len();
        self.selected_joint_index = index.min(count.saturating_sub(1));
    }

    fn set_joint_rotation(&mut self, x: f32, y: f32, z: f32) {
        let joints = self.scene.cpu.joint_infos();
        let Some(joint) = joints.get(self.selected_joint_index) else {
            return;
        };
        if let Some(rotation) = self.joint_rotations.get_mut(joint.node_index) {
            *rotation = Vec3::new(
                x.clamp(-180.0, 180.0),
                y.clamp(-180.0, 180.0),
                z.clamp(-180.0, 180.0),
            );
        }
    }

    fn reset_selected_joint(&mut self) {
        let joints = self.scene.cpu.joint_infos();
        let Some(joint) = joints.get(self.selected_joint_index) else {
            return;
        };
        if let Some(rotation) = self.joint_rotations.get_mut(joint.node_index) {
            *rotation = Vec3::ZERO;
        }
    }

    fn reset_pose(&mut self) {
        for rotation in &mut self.joint_rotations {
            *rotation = Vec3::ZERO;
        }
    }

    fn apply_pose_preset(&mut self, name: &str) {
        self.reset_pose();
        let joints = self.scene.cpu.joint_infos();
        let angles: &[[f32; 3]] = match name {
            "wave" => &[[0.0, 0.0, 12.0], [0.0, 0.0, 32.0], [0.0, 0.0, -46.0], [18.0, 0.0, 24.0]],
            "s_curve" => &[[0.0, 0.0, -12.0], [0.0, 0.0, 38.0], [0.0, 0.0, -52.0], [0.0, 0.0, 28.0]],
            "twist" => &[[0.0, 0.0, 0.0], [0.0, 36.0, 8.0], [0.0, -58.0, -12.0], [24.0, 42.0, 18.0]],
            _ => &[],
        };
        for (joint, angle) in joints.iter().zip(angles.iter()) {
            if let Some(rotation) = self.joint_rotations.get_mut(joint.node_index) {
                *rotation = Vec3::from_array(*angle);
            }
        }
    }

    fn view_mode_index(&self) -> f32 {
        match self.view_mode.as_str() {
            "weights" => 1.0,
            "joints" => 2.0,
            "normals" => 3.0,
            _ => 0.0,
        }
    }

    fn update_pose_and_buffers(&mut self, delta_seconds: f32) {
        if self.animation_playing {
            let duration = self.animation_duration();
            if duration > 0.0 {
                self.animation_time += delta_seconds * self.animation_speed;
                if self.animation_loop {
                    self.animation_time = self.animation_time.rem_euclid(duration);
                } else if self.animation_time >= duration {
                    self.animation_time = duration;
                    self.animation_playing = false;
                } else if self.animation_time < 0.0 {
                    self.animation_time = 0.0;
                    self.animation_playing = false;
                }
            }
        }

        let mut poses = if self.scene.cpu.animations.is_empty() {
            self.scene.cpu.base_poses()
        } else {
            self.scene.cpu.sample_animation(
                self.active_animation_index,
                self.animation_time,
                self.animation_blend,
            )
        };
        for (index, offset) in self.joint_rotations.iter().copied().enumerate() {
            if offset.length_squared() <= f32::EPSILON {
                continue;
            }
            if let Some(pose) = poses.get_mut(index) {
                let manual = Quat::from_euler(
                    EulerRot::XYZ,
                    offset.x.to_radians(),
                    offset.y.to_radians(),
                    offset.z.to_radians(),
                );
                pose.rotation = (pose.rotation * manual).normalize();
            }
        }
        let world = self.scene.cpu.world_matrices(&poses);
        let joint_infos = self.scene.cpu.joint_infos();
        let selected_node = joint_infos
            .get(self.selected_joint_index)
            .map(|joint| joint.node_index);

        for primitive in &self.scene.primitives {
            let node_world = world.get(primitive.node_index).copied().unwrap_or(Mat4::IDENTITY);
            let model = self.scene.normalization * node_world;
            let mut skin_enabled = 0.0;
            let mut joint_count = 1usize;
            let mut selected_local = -1.0f32;
            let mut joint_matrices = vec![Mat4::IDENTITY.to_cols_array()];
            if let Some(skin_index) = primitive.skin_index {
                if let Some(skin) = self.scene.cpu.skins.get(skin_index) {
                    skin_enabled = 1.0;
                    joint_count = skin.joints.len().max(1);
                    selected_local = selected_node
                        .and_then(|node| skin.joints.iter().position(|joint| *joint == node))
                        .map(|index| index as f32)
                        .unwrap_or(-1.0);
                    let inverse_mesh = safe_inverse(node_world);
                    joint_matrices = skin
                        .joints
                        .iter()
                        .enumerate()
                        .map(|(index, joint_node)| {
                            let joint_world = world.get(*joint_node).copied().unwrap_or(Mat4::IDENTITY);
                            let inverse_bind = skin
                                .inverse_bind_matrices
                                .get(index)
                                .copied()
                                .unwrap_or(Mat4::IDENTITY);
                            (inverse_mesh * joint_world * inverse_bind).to_cols_array()
                        })
                        .collect();
                    if joint_matrices.is_empty() {
                        joint_matrices.push(Mat4::IDENTITY.to_cols_array());
                    }
                }
            }
            let object_uniforms = ObjectUniforms {
                model: model.to_cols_array(),
                skin_params: [skin_enabled, joint_count as f32, selected_local, 0.0],
            };
            self.queue.write_buffer(
                &primitive.object_buffer,
                0,
                bytemuck::bytes_of(&object_uniforms),
            );
            self.queue.write_buffer(
                &primitive.joint_buffer,
                0,
                bytemuck::cast_slice(&joint_matrices),
            );
        }

        let mut bone_vertices = Vec::new();
        for skin in &self.scene.cpu.skins {
            for &joint_node in &skin.joints {
                let Some(parent_node) = self.scene.cpu.nodes.get(joint_node).and_then(|node| node.parent) else {
                    continue;
                };
                if !skin.joints.contains(&parent_node) {
                    continue;
                }
                if bone_vertices.len() + 2 > MAX_BONE_VERTICES {
                    break;
                }
                let parent_position = self
                    .scene
                    .normalization
                    .transform_point3(world.get(parent_node).copied().unwrap_or(Mat4::IDENTITY).transform_point3(Vec3::ZERO));
                let joint_position = self
                    .scene
                    .normalization
                    .transform_point3(world.get(joint_node).copied().unwrap_or(Mat4::IDENTITY).transform_point3(Vec3::ZERO));
                let selected = selected_node == Some(joint_node) || selected_node == Some(parent_node);
                let color = if selected { [1.0, 0.42, 0.08] } else { [0.16, 0.86, 1.0] };
                bone_vertices.push(BoneVertex { position: parent_position.to_array(), color });
                bone_vertices.push(BoneVertex { position: joint_position.to_array(), color });
            }
        }
        self.bone_vertex_count = bone_vertices.len() as u32;
        if !bone_vertices.is_empty() {
            self.queue.write_buffer(
                &self.bone_buffer,
                0,
                bytemuck::cast_slice(&bone_vertices),
            );
        }

        self.yaw_degrees = (self.yaw_degrees + self.auto_orbit_degrees * delta_seconds + 180.0)
            .rem_euclid(360.0)
            - 180.0;
        let yaw = self.yaw_degrees.to_radians();
        let pitch = self.pitch_degrees.to_radians();
        let eye = Vec3::new(
            self.distance * pitch.cos() * yaw.sin(),
            self.distance * pitch.sin(),
            self.distance * pitch.cos() * yaw.cos(),
        );
        let view = Mat4::look_at_rh(eye, Vec3::ZERO, Vec3::Y);
        let aspect = self.width.max(1) as f32 / self.height.max(1) as f32;
        let projection = Mat4::perspective_rh(self.fov_degrees.to_radians(), aspect, 0.01, 100.0);
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
            camera_position: [eye.x, eye.y, eye.z, 1.0],
            light_direction_intensity: [
                light_direction.x,
                light_direction.y,
                light_direction.z,
                self.light_intensity,
            ],
            render_params: [self.exposure, self.view_mode_index(), if self.show_skeleton { 1.0 } else { 0.0 }, 0.0],
            scene_params: [
                self.scene.cpu.stats.material_count as f32,
                self.scene.cpu.stats.joint_count as f32,
                self.started.elapsed().as_secs_f32(),
                self.animation_time,
            ],
        };
        self.queue.write_buffer(&self.uniform_buffer, 0, bytemuck::bytes_of(&uniforms));
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
        self.update_pose_and_buffers(raw_delta.clamp(0.0, 0.1));

        let (frame, reconfigure_after_present) = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(frame) => (frame, false),
            wgpu::CurrentSurfaceTexture::Suboptimal(frame) => (frame, true),
            wgpu::CurrentSurfaceTexture::Timeout | wgpu::CurrentSurfaceTexture::Occluded => return Ok(()),
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
        let view = frame.texture.create_view(&wgpu::TextureViewDescriptor::default());
        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("skeletal pose frame encoder"),
        });
        {
            let background = self.background as f64;
            let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("skeletal pose render pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color {
                            r: background * 0.58,
                            g: background * 0.7,
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
                render_pass.set_bind_group(2, &primitive.object_bind_group, &[]);
                render_pass.set_vertex_buffer(0, primitive.vertex_buffer.slice(..));
                render_pass.set_index_buffer(primitive.index_buffer.slice(..), wgpu::IndexFormat::Uint32);
                render_pass.draw_indexed(0..primitive.index_count, 0, 0..1);
            }
            if self.show_skeleton && self.bone_vertex_count > 0 {
                render_pass.set_pipeline(&self.bone_pipeline);
                render_pass.set_bind_group(0, &self.global_bind_group, &[]);
                render_pass.set_vertex_buffer(0, self.bone_buffer.slice(..));
                render_pass.draw(0..self.bone_vertex_count, 0..1);
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
                    Ok(RenderCommand::SetBackfaceCulling(enabled)) => self.backface_culling = enabled,
                    Ok(RenderCommand::SetShowSkeleton(enabled)) => self.show_skeleton = enabled,
                    Ok(RenderCommand::SetAnimation(index)) => {
                        self.active_animation_index = index.min(self.scene.cpu.animations.len().saturating_sub(1));
                        self.animation_time = 0.0;
                    }
                    Ok(RenderCommand::SetAnimationPlaying(playing)) => self.animation_playing = playing,
                    Ok(RenderCommand::SetAnimationLoop(looping)) => self.animation_loop = looping,
                    Ok(RenderCommand::SetAnimationTime(time)) => {
                        let duration = self.animation_duration().max(0.0);
                        self.animation_time = time.clamp(0.0, duration);
                    }
                    Ok(RenderCommand::SetAnimationSpeed(speed)) => self.animation_speed = speed.clamp(-4.0, 4.0),
                    Ok(RenderCommand::SetAnimationBlend(blend)) => self.animation_blend = blend.clamp(0.0, 1.0),
                    Ok(RenderCommand::SelectJoint(index)) => self.select_joint(index),
                    Ok(RenderCommand::SetJointRotation(x, y, z)) => self.set_joint_rotation(x, y, z),
                    Ok(RenderCommand::ResetSelectedJoint) => self.reset_selected_joint(),
                    Ok(RenderCommand::ResetPose) => self.reset_pose(),
                    Ok(RenderCommand::ApplyPosePreset(name)) => self.apply_pose_preset(&name),
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

fn safe_inverse(matrix: Mat4) -> Mat4 {
    let determinant = matrix.determinant();
    if determinant.is_finite() && determinant.abs() > 0.000001 {
        matrix.inverse()
    } else {
        Mat4::IDENTITY
    }
}

fn create_mesh_pipeline(
    device: &wgpu::Device,
    shader: &wgpu::ShaderModule,
    layout: &wgpu::PipelineLayout,
    surface_format: wgpu::TextureFormat,
    cull_mode: Option<wgpu::Face>,
    label: &str,
) -> wgpu::RenderPipeline {
    let attributes = [
        wgpu::VertexAttribute { format: wgpu::VertexFormat::Float32x3, offset: 0, shader_location: 0 },
        wgpu::VertexAttribute { format: wgpu::VertexFormat::Float32x3, offset: 12, shader_location: 1 },
        wgpu::VertexAttribute { format: wgpu::VertexFormat::Float32x2, offset: 24, shader_location: 2 },
        wgpu::VertexAttribute { format: wgpu::VertexFormat::Uint32x4, offset: 32, shader_location: 3 },
        wgpu::VertexAttribute { format: wgpu::VertexFormat::Float32x4, offset: 48, shader_location: 4 },
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

fn create_bone_pipeline(
    device: &wgpu::Device,
    shader: &wgpu::ShaderModule,
    layout: &wgpu::PipelineLayout,
    surface_format: wgpu::TextureFormat,
) -> wgpu::RenderPipeline {
    let attributes = [
        wgpu::VertexAttribute { format: wgpu::VertexFormat::Float32x3, offset: 0, shader_location: 0 },
        wgpu::VertexAttribute { format: wgpu::VertexFormat::Float32x3, offset: 12, shader_location: 1 },
    ];
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("skeletal bone overlay pipeline"),
        layout: Some(layout),
        vertex: wgpu::VertexState {
            module: shader,
            entry_point: Some("vs_bone"),
            compilation_options: Default::default(),
            buffers: &[wgpu::VertexBufferLayout {
                array_stride: size_of::<BoneVertex>() as u64,
                step_mode: wgpu::VertexStepMode::Vertex,
                attributes: &attributes,
            }],
        },
        primitive: wgpu::PrimitiveState {
            topology: wgpu::PrimitiveTopology::LineList,
            front_face: wgpu::FrontFace::Ccw,
            cull_mode: None,
            ..Default::default()
        },
        depth_stencil: Some(wgpu::DepthStencilState {
            format: DEPTH_FORMAT,
            depth_write_enabled: Some(false),
            depth_compare: Some(wgpu::CompareFunction::LessEqual),
            stencil: wgpu::StencilState::default(),
            bias: wgpu::DepthBiasState::default(),
        }),
        multisample: wgpu::MultisampleState::default(),
        fragment: Some(wgpu::FragmentState {
            module: shader,
            entry_point: Some("fs_bone"),
            compilation_options: Default::default(),
            targets: &[Some(wgpu::ColorTargetState {
                format: surface_format,
                blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                write_mask: wgpu::ColorWrites::ALL,
            })],
        }),
        multiview_mask: None,
        cache: None,
    })
}

fn create_depth_target(device: &wgpu::Device, width: u32, height: u32) -> DepthTarget {
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("skeletal depth target"),
        size: wgpu::Extent3d { width: width.max(1), height: height.max(1), depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: DEPTH_FORMAT,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    DepthTarget { _texture: texture, view }
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
        &format!("skeletal image texture {index}"),
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
        size: wgpu::Extent3d { width: width.max(1), height: height.max(1), depth_or_array_layers: 1 },
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
        wgpu::Extent3d { width: width.max(1), height: height.max(1), depth_or_array_layers: 1 },
    );
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    (texture, view)
}
