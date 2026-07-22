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

const HDR_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;

const DEFAULT_MAX_STEPS: f32 = 128.0;
const DEFAULT_MAX_DISTANCE: f32 = 12.0;
const DEFAULT_EPSILON: f32 = 0.0015;
const DEFAULT_SHADOW_SOFTNESS: f32 = 18.0;
const DEFAULT_SHAPE_SCALE: f32 = 1.0;
const DEFAULT_TWIST: f32 = 0.75;
const DEFAULT_REPETITION: f32 = 1.1;
const DEFAULT_MORPH: f32 = 0.55;
const DEFAULT_FOG_DENSITY: f32 = 0.055;
const DEFAULT_GLOW: f32 = 0.7;
const DEFAULT_AO_STRENGTH: f32 = 1.0;
const DEFAULT_EXPOSURE: f32 = 1.05;
const DEFAULT_SPEED: f32 = 1.0;
const DEFAULT_AUTO_ORBIT_DEGREES: f32 = 5.0;
const DEFAULT_CAMERA_YAW_DEGREES: f32 = 28.0;
const DEFAULT_CAMERA_PITCH_DEGREES: f32 = 12.0;
const DEFAULT_CAMERA_DISTANCE: f32 = 3.4;
const DEFAULT_CAMERA_FOV_DEGREES: f32 = 52.0;
const DEFAULT_BLOOM: f32 = 0.38;
const DEFAULT_CHROMATIC: f32 = 0.35;
const DEFAULT_VIGNETTE: f32 = 0.32;

#[derive(Debug, Clone)]
pub enum RenderCommand {
    Resize(u32, u32),
    SetResolutionPreset(String),
    SetScene(u32),
    SetParam(String, f32),
    SetPaused(bool),
    SetShadows(bool),
    SetAmbientOcclusion(bool),
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
    pub window_width: u32,
    pub window_height: u32,
    pub internal_width: u32,
    pub internal_height: u32,
    pub resolution_preset: String,
    pub render_scale: f32,
    pub scene: u32,
    pub scene_name: String,
    pub max_steps: f32,
    pub max_distance: f32,
    pub epsilon: f32,
    pub shadow_softness: f32,
    pub shape_scale: f32,
    pub twist: f32,
    pub repetition: f32,
    pub morph: f32,
    pub fog_density: f32,
    pub glow: f32,
    pub ao_strength: f32,
    pub exposure: f32,
    pub speed: f32,
    pub auto_orbit_degrees: f32,
    pub camera_yaw_degrees: f32,
    pub camera_pitch_degrees: f32,
    pub camera_distance: f32,
    pub camera_fov_degrees: f32,
    pub bloom: f32,
    pub chromatic: f32,
    pub vignette: f32,
    pub shadows: bool,
    pub ambient_occlusion: bool,
    pub paused: bool,
    pub max_texture_dimension_2d: u32,
    pub megapixels: f64,
    pub target_megabytes: f64,
    pub pixel_rate_gigapixels: f64,
    pub maximum_sdf_budget_giga: f64,
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
        .name("junkpile-wgpu-volumetric-raymarcher".into())
        .spawn(move || renderer.run(rx, thread_info, thread_alive))
        .map_err(|error| format!("could not start renderer thread: {error}"))?;

    Ok(RendererHandle { tx, info })
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Uniforms {
    resolution_time: [f32; 4],
    camera: [f32; 4],
    march: [f32; 4],
    shape: [f32; 4],
    look: [f32; 4],
    motion: [f32; 4],
    post: [f32; 4],
    window: [f32; 4],
    flags: [u32; 4],
}

struct HighResolutionTarget {
    _texture: wgpu::Texture,
    view: wgpu::TextureView,
    sample_bind: wgpu::BindGroup,
    width: u32,
    height: u32,
}

fn create_target(
    device: &wgpu::Device,
    present_layout: &wgpu::BindGroupLayout,
    uniform_buffer: &wgpu::Buffer,
    sampler: &wgpu::Sampler,
    width: u32,
    height: u32,
) -> HighResolutionTarget {
    let size = wgpu::Extent3d {
        width: width.max(1),
        height: height.max(1),
        depth_or_array_layers: 1,
    };
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("raymarch HDR target"),
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
        label: Some("raymarch present bind group"),
        layout: present_layout,
        entries: &[
            wgpu::BindGroupEntry {
                binding: 0,
                resource: uniform_buffer.as_entire_binding(),
            },
            wgpu::BindGroupEntry {
                binding: 1,
                resource: wgpu::BindingResource::TextureView(&view),
            },
            wgpu::BindGroupEntry {
                binding: 2,
                resource: wgpu::BindingResource::Sampler(sampler),
            },
        ],
    });

    HighResolutionTarget {
        _texture: texture,
        view,
        sample_bind,
        width: size.width,
        height: size.height,
    }
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
    raymarch_pipeline: wgpu::RenderPipeline,
    present_pipeline: wgpu::RenderPipeline,
    uniform_buffer: wgpu::Buffer,
    uniform_bind: wgpu::BindGroup,
    uniforms: Uniforms,
    target: HighResolutionTarget,
    window_width: u32,
    window_height: u32,
    resolution_preset: String,
    render_scale: f32,
    scene: u32,
    shadows: bool,
    ambient_occlusion: bool,
    paused: bool,
    minimized: bool,
    simulation_time: f32,
    last_tick: Instant,
    frame_count: u64,
    measured_fps: f64,
    measured_frame_time_ms: f64,
    last_error: String,
}

impl Renderer {
    async fn new(window_handle: tauri::Window) -> Result<Self, String> {
        let size = window_handle.inner_size().map_err(|error| error.to_string())?;
        let window_width = size.width.max(1);
        let window_height = size.height.max(1);

        let requested_backends = wgpu::Backends::from_env().unwrap_or(wgpu::Backends::PRIMARY);
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
            backends: requested_backends,
            ..wgpu::InstanceDescriptor::new_without_display_handle()
        });
        let surface = instance
            .create_surface(window_handle.clone())
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
            .ok_or_else(|| {
                "no surface-compatible adapter matched the requested backend/device".to_string()
            })?;

        let adapter_info = adapter.get_info();
        let adapter_limits = adapter.limits();
        let max_texture_dimension_2d = adapter_limits.max_texture_dimension_2d;
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("junkpile volumetric raymarch device"),
                required_features: wgpu::Features::empty(),
                required_limits: wgpu::Limits::default(),
                memory_hints: wgpu::MemoryHints::Performance,
                trace: wgpu::Trace::Off,
                ..Default::default()
            })
            .await
            .map_err(|error| format!("could not create GPU device: {error}"))?;

        let mut config = surface
            .get_default_config(&adapter, window_width, window_height)
            .ok_or_else(|| "adapter cannot produce a default surface configuration".to_string())?;
        config.present_mode = wgpu::PresentMode::Fifo;
        surface.configure(&device, &config);

        let uniforms = Self::default_uniforms(window_width, window_height);
        let uniform_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("volumetric raymarch uniforms"),
            contents: bytemuck::bytes_of(&uniforms),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });

        let uniform_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("volumetric raymarch uniform layout"),
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

        let present_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("volumetric raymarch present layout"),
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

        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("raymarch HDR downsample sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::MipmapFilterMode::Nearest,
            ..Default::default()
        });

        let uniform_bind = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("volumetric raymarch uniform bind group"),
            layout: &uniform_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: uniform_buffer.as_entire_binding(),
            }],
        });

        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("volumetric raymarch WGSL"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shader.wgsl").into()),
        });

        let raymarch_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("volumetric raymarch pipeline layout"),
            bind_group_layouts: &[Some(&uniform_layout)],
            immediate_size: 0,
        });
        let present_pipeline_layout =
            device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("volumetric raymarch present pipeline layout"),
                bind_group_layouts: &[Some(&present_layout)],
                immediate_size: 0,
            });

        let make_pipeline = |
            label: &'static str,
            entry_point: &'static str,
            format: wgpu::TextureFormat,
            layout: &wgpu::PipelineLayout,
        | {
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some(label),
                layout: Some(layout),
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
                    entry_point: Some(entry_point),
                    compilation_options: Default::default(),
                    targets: &[Some(wgpu::ColorTargetState {
                        format,
                        blend: Some(wgpu::BlendState::REPLACE),
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                }),
                multiview_mask: None,
                cache: None,
            })
        };

        let raymarch_pipeline = make_pipeline(
            "volumetric raymarch HDR pipeline",
            "fs_raymarch",
            HDR_FORMAT,
            &raymarch_layout,
        );
        let present_pipeline = make_pipeline(
            "volumetric raymarch present pipeline",
            "fs_present",
            config.format,
            &present_pipeline_layout,
        );

        let target = create_target(
            &device,
            &present_layout,
            &uniform_buffer,
            &sampler,
            window_width,
            window_height,
        );

        Ok(Self {
            window_handle,
            instance,
            surface,
            device,
            queue,
            config,
            adapter_info,
            max_texture_dimension_2d,
            present_layout,
            sampler,
            raymarch_pipeline,
            present_pipeline,
            uniform_buffer,
            uniform_bind,
            uniforms,
            target,
            window_width,
            window_height,
            resolution_preset: "window".into(),
            render_scale: 1.0,
            scene: 0,
            shadows: true,
            ambient_occlusion: true,
            paused: false,
            minimized: false,
            simulation_time: 0.0,
            last_tick: Instant::now(),
            frame_count: 0,
            measured_fps: 0.0,
            measured_frame_time_ms: 0.0,
            last_error: String::new(),
        })
    }

    fn default_uniforms(width: u32, height: u32) -> Uniforms {
        Uniforms {
            resolution_time: [width as f32, height as f32, 0.0, 0.0],
            camera: [
                DEFAULT_CAMERA_YAW_DEGREES.to_radians(),
                DEFAULT_CAMERA_PITCH_DEGREES.to_radians(),
                DEFAULT_CAMERA_DISTANCE,
                DEFAULT_CAMERA_FOV_DEGREES.to_radians(),
            ],
            march: [
                DEFAULT_MAX_STEPS,
                DEFAULT_MAX_DISTANCE,
                DEFAULT_EPSILON,
                DEFAULT_SHADOW_SOFTNESS,
            ],
            shape: [
                DEFAULT_SHAPE_SCALE,
                DEFAULT_TWIST,
                DEFAULT_REPETITION,
                DEFAULT_MORPH,
            ],
            look: [
                DEFAULT_FOG_DENSITY,
                DEFAULT_GLOW,
                DEFAULT_AO_STRENGTH,
                DEFAULT_EXPOSURE,
            ],
            motion: [
                DEFAULT_SPEED,
                DEFAULT_AUTO_ORBIT_DEGREES.to_radians(),
                0.0,
                0.0,
            ],
            post: [
                DEFAULT_BLOOM,
                DEFAULT_CHROMATIC,
                DEFAULT_VIGNETTE,
                0.0,
            ],
            window: [width as f32, height as f32, 0.0, 0.0],
            flags: [0, 1, 1, 0],
        }
    }

    fn desired_dimensions(&self, preset: &str, scale: f32) -> (u32, u32) {
        let (base_width, base_height) = match preset {
            "1080p" => (1920, 1080),
            "4k" => (3840, 2160),
            "8k" => (7680, 4320),
            _ => (self.window_width.max(1), self.window_height.max(1)),
        };
        (
            ((base_width as f32 * scale).round() as u32).max(1),
            ((base_height as f32 * scale).round() as u32).max(1),
        )
    }

    fn rebuild_target(&mut self, preset: String, scale: f32) {
        let scale = scale.clamp(0.125, 1.0);
        let (width, height) = self.desired_dimensions(&preset, scale);
        if width > self.max_texture_dimension_2d || height > self.max_texture_dimension_2d {
            self.last_error = format!(
                "requested {width}×{height}, but adapter max_texture_dimension_2d is {}",
                self.max_texture_dimension_2d
            );
            return;
        }

        self.target = create_target(
            &self.device,
            &self.present_layout,
            &self.uniform_buffer,
            &self.sampler,
            width,
            height,
        );
        self.resolution_preset = preset;
        self.render_scale = scale;
        self.last_error.clear();
    }

    fn scene_name(&self) -> &'static str {
        match self.scene {
            1 => "Oscillator Tunnel",
            2 => "Finite Lattice",
            3 => "Soft Organism",
            _ => "SDF Sculpture",
        }
    }

    fn info(&self) -> RendererInfo {
        let pixels = self.target.width as f64 * self.target.height as f64;
        RendererInfo {
            backend: format!("{:?}", self.adapter_info.backend),
            adapter: self.adapter_info.name.clone(),
            device_type: format!("{:?}", self.adapter_info.device_type),
            driver: self.adapter_info.driver.clone(),
            surface_format: format!("{:?}", self.config.format),
            window_width: self.window_width,
            window_height: self.window_height,
            internal_width: self.target.width,
            internal_height: self.target.height,
            resolution_preset: self.resolution_preset.clone(),
            render_scale: self.render_scale,
            scene: self.scene,
            scene_name: self.scene_name().into(),
            max_steps: self.uniforms.march[0],
            max_distance: self.uniforms.march[1],
            epsilon: self.uniforms.march[2],
            shadow_softness: self.uniforms.march[3],
            shape_scale: self.uniforms.shape[0],
            twist: self.uniforms.shape[1],
            repetition: self.uniforms.shape[2],
            morph: self.uniforms.shape[3],
            fog_density: self.uniforms.look[0],
            glow: self.uniforms.look[1],
            ao_strength: self.uniforms.look[2],
            exposure: self.uniforms.look[3],
            speed: self.uniforms.motion[0],
            auto_orbit_degrees: self.uniforms.motion[1].to_degrees(),
            camera_yaw_degrees: self.uniforms.camera[0].to_degrees(),
            camera_pitch_degrees: self.uniforms.camera[1].to_degrees(),
            camera_distance: self.uniforms.camera[2],
            camera_fov_degrees: self.uniforms.camera[3].to_degrees(),
            bloom: self.uniforms.post[0],
            chromatic: self.uniforms.post[1],
            vignette: self.uniforms.post[2],
            shadows: self.shadows,
            ambient_occlusion: self.ambient_occlusion,
            paused: self.paused,
            max_texture_dimension_2d: self.max_texture_dimension_2d,
            megapixels: pixels / 1_000_000.0,
            target_megabytes: pixels * 8.0 / 1_048_576.0,
            pixel_rate_gigapixels: pixels * self.measured_fps / 1_000_000_000.0,
            maximum_sdf_budget_giga: pixels
                * self.uniforms.march[0] as f64
                * self.measured_fps
                / 1_000_000_000.0,
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

        let now = Instant::now();
        let delta_seconds = now.duration_since(self.last_tick).as_secs_f32().min(0.1);
        self.last_tick = now;
        if !self.paused {
            self.simulation_time += delta_seconds * self.uniforms.motion[0];
        }

        self.uniforms.resolution_time = [
            self.target.width as f32,
            self.target.height as f32,
            self.simulation_time,
            self.frame_count as f32,
        ];
        self.uniforms.window = [
            self.window_width as f32,
            self.window_height as f32,
            self.render_scale,
            0.0,
        ];
        self.uniforms.flags = [
            self.scene,
            if self.shadows { 1 } else { 0 },
            if self.ambient_occlusion { 1 } else { 0 },
            if self.paused { 1 } else { 0 },
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

        let surface_view = frame
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("volumetric raymarch frame encoder"),
            });

        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("volumetric raymarch HDR pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &self.target.view,
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
            pass.set_pipeline(&self.raymarch_pipeline);
            pass.set_bind_group(0, &self.uniform_bind, &[]);
            pass.draw(0..3, 0..1);
        }

        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("volumetric raymarch post-process pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &surface_view,
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
            pass.set_pipeline(&self.present_pipeline);
            pass.set_bind_group(0, &self.target.sample_bind, &[]);
            pass.draw(0..3, 0..1);
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
                    Ok(RenderCommand::SetResolutionPreset(preset)) => {
                        self.rebuild_target(preset, self.render_scale)
                    }
                    Ok(RenderCommand::SetScene(scene)) => {
                        self.scene = scene.min(3);
                    }
                    Ok(RenderCommand::SetParam(name, value)) => self.set_param(&name, value),
                    Ok(RenderCommand::SetPaused(paused)) => {
                        self.paused = paused;
                        self.last_tick = Instant::now();
                    }
                    Ok(RenderCommand::SetShadows(enabled)) => self.shadows = enabled,
                    Ok(RenderCommand::SetAmbientOcclusion(enabled)) => {
                        self.ambient_occlusion = enabled
                    }
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
            let metrics_elapsed = metrics_started.elapsed();
            if metrics_elapsed >= Duration::from_millis(500) {
                self.measured_fps = metrics_frames as f64 / metrics_elapsed.as_secs_f64();
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

    fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "render_scale" => self.rebuild_target(self.resolution_preset.clone(), value),
            "max_steps" => self.uniforms.march[0] = value.clamp(24.0, 320.0).round(),
            "max_distance" => self.uniforms.march[1] = value.clamp(3.0, 40.0),
            "epsilon" => self.uniforms.march[2] = value.clamp(0.0002, 0.02),
            "shadow_softness" => self.uniforms.march[3] = value.clamp(1.0, 64.0),
            "shape_scale" => self.uniforms.shape[0] = value.clamp(0.25, 2.5),
            "twist" => self.uniforms.shape[1] = value.clamp(0.0, 4.0),
            "repetition" => self.uniforms.shape[2] = value.clamp(0.35, 2.5),
            "morph" => self.uniforms.shape[3] = value.clamp(0.0, 1.5),
            "fog_density" => self.uniforms.look[0] = value.clamp(0.0, 0.35),
            "glow" => self.uniforms.look[1] = value.clamp(0.0, 3.0),
            "ao_strength" => self.uniforms.look[2] = value.clamp(0.0, 3.0),
            "exposure" => self.uniforms.look[3] = value.clamp(0.0, 4.0),
            "speed" => self.uniforms.motion[0] = value.clamp(0.0, 4.0),
            "auto_orbit" => self.uniforms.motion[1] = value.clamp(-45.0, 45.0).to_radians(),
            "camera_yaw" => self.uniforms.camera[0] = value.to_radians(),
            "camera_pitch" => self.uniforms.camera[1] = value.clamp(-85.0, 85.0).to_radians(),
            "camera_distance" => self.uniforms.camera[2] = value.clamp(1.5, 12.0),
            "camera_fov" => self.uniforms.camera[3] = value.clamp(20.0, 110.0).to_radians(),
            "bloom" => self.uniforms.post[0] = value.clamp(0.0, 2.0),
            "chromatic" => self.uniforms.post[1] = value.clamp(0.0, 4.0),
            "vignette" => self.uniforms.post[2] = value.clamp(0.0, 1.0),
            _ => {}
        }
    }

    fn reset(&mut self) {
        self.uniforms = Self::default_uniforms(self.window_width, self.window_height);
        self.scene = 0;
        self.shadows = true;
        self.ambient_occlusion = true;
        self.paused = false;
        self.simulation_time = 0.0;
        self.last_tick = Instant::now();
        self.rebuild_target("window".into(), 1.0);
    }

    fn resize(&mut self, width: u32, height: u32) {
        self.window_width = width;
        self.window_height = height;
        self.minimized = width == 0 || height == 0;
        if !self.minimized {
            self.config.width = width;
            self.config.height = height;
            self.surface.configure(&self.device, &self.config);
            if self.resolution_preset == "window" {
                self.rebuild_target("window".into(), self.render_scale);
            }
        }
    }

    fn recreate_surface(&mut self) -> Result<(), String> {
        self.surface = self
            .instance
            .create_surface(self.window_handle.clone())
            .map_err(|error| error.to_string())?;
        self.surface.configure(&self.device, &self.config);
        Ok(())
    }
}
