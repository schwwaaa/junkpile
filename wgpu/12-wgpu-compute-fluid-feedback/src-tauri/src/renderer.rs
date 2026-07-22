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

const FIELD_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;
const HDR_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;
const WORKGROUP_SIZE: u32 = 8;
const FIELD_TEXTURE_COUNT: u32 = 8;
const DEFAULT_SIMULATION_SIZE: u32 = 512;

const DEFAULT_VELOCITY_DISSIPATION: f32 = 0.994;
const DEFAULT_DYE_DISSIPATION: f32 = 0.998;
const DEFAULT_VISCOSITY: f32 = 0.08;
const DEFAULT_VORTICITY: f32 = 28.0;
const DEFAULT_FORCE: f32 = 2.2;
const DEFAULT_RADIUS: f32 = 0.055;
const DEFAULT_DYE_AMOUNT: f32 = 2.6;
const DEFAULT_FEEDBACK: f32 = 0.18;
const DEFAULT_SIMULATION_SPEED: f32 = 1.0;
const DEFAULT_EMITTER_SPEED: f32 = 0.75;
const DEFAULT_INJECTOR_X: f32 = 0.5;
const DEFAULT_INJECTOR_Y: f32 = 0.5;
const DEFAULT_PRESSURE_ITERATIONS: u32 = 24;
const DEFAULT_SUBSTEPS: u32 = 1;
const DEFAULT_EXPOSURE: f32 = 1.10;
const DEFAULT_BLOOM: f32 = 0.55;
const DEFAULT_CONTRAST: f32 = 1.05;
const DEFAULT_VIGNETTE: f32 = 0.22;

#[derive(Debug, Clone)]
pub enum RenderCommand {
    Resize(u32, u32),
    SetSimulationSize(u32),
    SetResolutionPreset(String),
    SetEmitterMode(u32),
    SetPalette(u32),
    SetViewMode(u32),
    SetParam(String, f32),
    SetPaused(bool),
    ResetFluid,
    ResetParams,
    TriggerBurst,
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
    pub output_width: u32,
    pub output_height: u32,
    pub resolution_preset: String,
    pub render_scale: f32,
    pub simulation_size: u32,
    pub workgroups_x: u32,
    pub workgroups_y: u32,
    pub field_texture_count: u32,
    pub field_memory_megabytes: f64,
    pub output_memory_megabytes: f64,
    pub estimated_total_megabytes: f64,
    pub pressure_iterations: u32,
    pub substeps: u32,
    pub compute_passes_per_frame: u32,
    pub emitter_mode: u32,
    pub emitter_name: String,
    pub palette: u32,
    pub palette_name: String,
    pub view_mode: u32,
    pub view_name: String,
    pub velocity_dissipation: f32,
    pub dye_dissipation: f32,
    pub viscosity: f32,
    pub vorticity: f32,
    pub force: f32,
    pub radius: f32,
    pub dye_amount: f32,
    pub feedback: f32,
    pub simulation_speed: f32,
    pub emitter_speed: f32,
    pub injector_x: f32,
    pub injector_y: f32,
    pub exposure: f32,
    pub bloom: f32,
    pub contrast: f32,
    pub vignette: f32,
    pub paused: bool,
    pub burst_active: bool,
    pub max_texture_dimension_2d: u32,
    pub fps: f64,
    pub frame_time_ms: f64,
    pub cell_updates_per_second: f64,
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
        .name("junkpile-wgpu-compute-fluid-feedback".into())
        .spawn(move || renderer.run(rx, thread_info, thread_alive))
        .map_err(|error| format!("could not start renderer thread: {error}"))?;

    Ok(RendererHandle { tx, info })
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Uniforms {
    grid_time: [f32; 4],
    flow: [f32; 4],
    emitter: [f32; 4],
    motion: [f32; 4],
    look: [f32; 4],
    control: [f32; 4],
    output: [f32; 4],
    flags: [u32; 4],
}

struct FieldTexture {
    texture: wgpu::Texture,
    view: wgpu::TextureView,
}

fn create_field_texture(device: &wgpu::Device, size: u32, label: &'static str) -> FieldTexture {
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some(label),
        size: wgpu::Extent3d {
            width: size.max(1),
            height: size.max(1),
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: FIELD_FORMAT,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::STORAGE_BINDING,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    FieldTexture { texture, view }
}

fn create_compute_bind_group(
    device: &wgpu::Device,
    layout: &wgpu::BindGroupLayout,
    uniform_buffer: &wgpu::Buffer,
    source: &wgpu::TextureView,
    auxiliary: &wgpu::TextureView,
    destination: &wgpu::TextureView,
    label: &'static str,
) -> wgpu::BindGroup {
    device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some(label),
        layout,
        entries: &[
            wgpu::BindGroupEntry {
                binding: 0,
                resource: uniform_buffer.as_entire_binding(),
            },
            wgpu::BindGroupEntry {
                binding: 1,
                resource: wgpu::BindingResource::TextureView(source),
            },
            wgpu::BindGroupEntry {
                binding: 2,
                resource: wgpu::BindingResource::TextureView(auxiliary),
            },
            wgpu::BindGroupEntry {
                binding: 3,
                resource: wgpu::BindingResource::TextureView(destination),
            },
        ],
    })
}

fn create_display_bind_group(
    device: &wgpu::Device,
    layout: &wgpu::BindGroupLayout,
    uniform_buffer: &wgpu::Buffer,
    view: &wgpu::TextureView,
    sampler: &wgpu::Sampler,
    label: &'static str,
) -> wgpu::BindGroup {
    device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some(label),
        layout,
        entries: &[
            wgpu::BindGroupEntry {
                binding: 0,
                resource: uniform_buffer.as_entire_binding(),
            },
            wgpu::BindGroupEntry {
                binding: 1,
                resource: wgpu::BindingResource::TextureView(view),
            },
            wgpu::BindGroupEntry {
                binding: 2,
                resource: wgpu::BindingResource::Sampler(sampler),
            },
        ],
    })
}

struct SimulationTextures {
    velocity_a: FieldTexture,
    velocity_b: FieldTexture,
    dye_a: FieldTexture,
    dye_b: FieldTexture,
    pressure_a: FieldTexture,
    pressure_b: FieldTexture,
    divergence: FieldTexture,
    curl: FieldTexture,
    advect_a_to_b: wgpu::BindGroup,
    advect_b_to_a: wgpu::BindGroup,
    curl_from_a: wgpu::BindGroup,
    curl_from_b: wgpu::BindGroup,
    vorticity_a_to_b: wgpu::BindGroup,
    vorticity_b_to_a: wgpu::BindGroup,
    divergence_from_a: wgpu::BindGroup,
    divergence_from_b: wgpu::BindGroup,
    pressure_a_to_b: wgpu::BindGroup,
    pressure_b_to_a: wgpu::BindGroup,
    gradient_a_to_b: wgpu::BindGroup,
    gradient_b_to_a: wgpu::BindGroup,
    dye_a_to_b: wgpu::BindGroup,
    dye_b_to_a: wgpu::BindGroup,
    display_dye_a: wgpu::BindGroup,
    display_dye_b: wgpu::BindGroup,
    display_velocity_a: wgpu::BindGroup,
    display_velocity_b: wgpu::BindGroup,
    display_pressure: wgpu::BindGroup,
    display_divergence: wgpu::BindGroup,
    display_curl: wgpu::BindGroup,
    size: u32,
}

impl SimulationTextures {
    fn new(
        device: &wgpu::Device,
        compute_layout: &wgpu::BindGroupLayout,
        display_layout: &wgpu::BindGroupLayout,
        uniform_buffer: &wgpu::Buffer,
        sampler: &wgpu::Sampler,
        size: u32,
    ) -> Self {
        let velocity_a = create_field_texture(device, size, "fluid velocity A");
        let velocity_b = create_field_texture(device, size, "fluid velocity B");
        let dye_a = create_field_texture(device, size, "fluid dye A");
        let dye_b = create_field_texture(device, size, "fluid dye B");
        let pressure_a = create_field_texture(device, size, "fluid pressure A");
        let pressure_b = create_field_texture(device, size, "fluid pressure B");
        let divergence = create_field_texture(device, size, "fluid divergence");
        let curl = create_field_texture(device, size, "fluid curl");

        let advect_a_to_b = create_compute_bind_group(
            device,
            compute_layout,
            uniform_buffer,
            &velocity_a.view,
            &velocity_a.view,
            &velocity_b.view,
            "advect velocity A to B",
        );
        let advect_b_to_a = create_compute_bind_group(
            device,
            compute_layout,
            uniform_buffer,
            &velocity_b.view,
            &velocity_b.view,
            &velocity_a.view,
            "advect velocity B to A",
        );
        let curl_from_a = create_compute_bind_group(
            device,
            compute_layout,
            uniform_buffer,
            &velocity_a.view,
            &velocity_a.view,
            &curl.view,
            "curl from velocity A",
        );
        let curl_from_b = create_compute_bind_group(
            device,
            compute_layout,
            uniform_buffer,
            &velocity_b.view,
            &velocity_b.view,
            &curl.view,
            "curl from velocity B",
        );
        let vorticity_a_to_b = create_compute_bind_group(
            device,
            compute_layout,
            uniform_buffer,
            &velocity_a.view,
            &curl.view,
            &velocity_b.view,
            "vorticity velocity A to B",
        );
        let vorticity_b_to_a = create_compute_bind_group(
            device,
            compute_layout,
            uniform_buffer,
            &velocity_b.view,
            &curl.view,
            &velocity_a.view,
            "vorticity velocity B to A",
        );
        let divergence_from_a = create_compute_bind_group(
            device,
            compute_layout,
            uniform_buffer,
            &velocity_a.view,
            &velocity_a.view,
            &divergence.view,
            "divergence from velocity A",
        );
        let divergence_from_b = create_compute_bind_group(
            device,
            compute_layout,
            uniform_buffer,
            &velocity_b.view,
            &velocity_b.view,
            &divergence.view,
            "divergence from velocity B",
        );
        let pressure_a_to_b = create_compute_bind_group(
            device,
            compute_layout,
            uniform_buffer,
            &pressure_a.view,
            &divergence.view,
            &pressure_b.view,
            "pressure A to B",
        );
        let pressure_b_to_a = create_compute_bind_group(
            device,
            compute_layout,
            uniform_buffer,
            &pressure_b.view,
            &divergence.view,
            &pressure_a.view,
            "pressure B to A",
        );
        let gradient_a_to_b = create_compute_bind_group(
            device,
            compute_layout,
            uniform_buffer,
            &velocity_a.view,
            &pressure_a.view,
            &velocity_b.view,
            "pressure gradient velocity A to B",
        );
        let gradient_b_to_a = create_compute_bind_group(
            device,
            compute_layout,
            uniform_buffer,
            &velocity_b.view,
            &pressure_a.view,
            &velocity_a.view,
            "pressure gradient velocity B to A",
        );
        let dye_a_to_b = create_compute_bind_group(
            device,
            compute_layout,
            uniform_buffer,
            &dye_a.view,
            &velocity_b.view,
            &dye_b.view,
            "advect dye A to B with velocity B",
        );
        let dye_b_to_a = create_compute_bind_group(
            device,
            compute_layout,
            uniform_buffer,
            &dye_b.view,
            &velocity_a.view,
            &dye_a.view,
            "advect dye B to A with velocity A",
        );

        let display_dye_a = create_display_bind_group(
            device,
            display_layout,
            uniform_buffer,
            &dye_a.view,
            sampler,
            "display dye A",
        );
        let display_dye_b = create_display_bind_group(
            device,
            display_layout,
            uniform_buffer,
            &dye_b.view,
            sampler,
            "display dye B",
        );
        let display_velocity_a = create_display_bind_group(
            device,
            display_layout,
            uniform_buffer,
            &velocity_a.view,
            sampler,
            "display velocity A",
        );
        let display_velocity_b = create_display_bind_group(
            device,
            display_layout,
            uniform_buffer,
            &velocity_b.view,
            sampler,
            "display velocity B",
        );
        let display_pressure = create_display_bind_group(
            device,
            display_layout,
            uniform_buffer,
            &pressure_a.view,
            sampler,
            "display pressure",
        );
        let display_divergence = create_display_bind_group(
            device,
            display_layout,
            uniform_buffer,
            &divergence.view,
            sampler,
            "display divergence",
        );
        let display_curl = create_display_bind_group(
            device,
            display_layout,
            uniform_buffer,
            &curl.view,
            sampler,
            "display curl",
        );

        Self {
            velocity_a,
            velocity_b,
            dye_a,
            dye_b,
            pressure_a,
            pressure_b,
            divergence,
            curl,
            advect_a_to_b,
            advect_b_to_a,
            curl_from_a,
            curl_from_b,
            vorticity_a_to_b,
            vorticity_b_to_a,
            divergence_from_a,
            divergence_from_b,
            pressure_a_to_b,
            pressure_b_to_a,
            gradient_a_to_b,
            gradient_b_to_a,
            dye_a_to_b,
            dye_b_to_a,
            display_dye_a,
            display_dye_b,
            display_velocity_a,
            display_velocity_b,
            display_pressure,
            display_divergence,
            display_curl,
            size,
        }
    }

    fn display_bind_group(&self, view_mode: u32, field_is_a: bool) -> &wgpu::BindGroup {
        match view_mode {
            1 => {
                if field_is_a {
                    &self.display_velocity_a
                } else {
                    &self.display_velocity_b
                }
            }
            2 => &self.display_pressure,
            3 => &self.display_divergence,
            4 => &self.display_curl,
            _ => {
                if field_is_a {
                    &self.display_dye_a
                } else {
                    &self.display_dye_b
                }
            }
        }
    }
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
    display_layout: &wgpu::BindGroupLayout,
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
        label: Some("fluid HDR output target"),
        size,
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: HDR_FORMAT,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    let sample_bind = create_display_bind_group(
        device,
        display_layout,
        uniform_buffer,
        &view,
        sampler,
        "fluid HDR present bind group",
    );
    HighResolutionTarget {
        _texture: texture,
        view,
        sample_bind,
        width: size.width,
        height: size.height,
    }
}

struct ComputePipelines {
    advect_velocity: wgpu::ComputePipeline,
    calculate_curl: wgpu::ComputePipeline,
    apply_vorticity: wgpu::ComputePipeline,
    calculate_divergence: wgpu::ComputePipeline,
    solve_pressure: wgpu::ComputePipeline,
    subtract_pressure_gradient: wgpu::ComputePipeline,
    advect_dye: wgpu::ComputePipeline,
}

fn create_compute_pipeline(
    device: &wgpu::Device,
    module: &wgpu::ShaderModule,
    layout: &wgpu::PipelineLayout,
    entry_point: &'static str,
    label: &'static str,
) -> wgpu::ComputePipeline {
    device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
        label: Some(label),
        layout: Some(layout),
        module,
        entry_point: Some(entry_point),
        compilation_options: Default::default(),
        cache: None,
    })
}

fn dispatch_compute(
    encoder: &mut wgpu::CommandEncoder,
    pipeline: &wgpu::ComputePipeline,
    bind_group: &wgpu::BindGroup,
    workgroups: u32,
    label: &'static str,
) {
    let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
        label: Some(label),
        timestamp_writes: None,
    });
    pass.set_pipeline(pipeline);
    pass.set_bind_group(0, bind_group, &[]);
    pass.dispatch_workgroups(workgroups, workgroups, 1);
}

fn create_render_pipeline(
    device: &wgpu::Device,
    module: &wgpu::ShaderModule,
    layout: &wgpu::PipelineLayout,
    label: &'static str,
    entry_point: &'static str,
    format: wgpu::TextureFormat,
) -> wgpu::RenderPipeline {
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some(label),
        layout: Some(layout),
        vertex: wgpu::VertexState {
            module,
            entry_point: Some("vs_main"),
            compilation_options: Default::default(),
            buffers: &[],
        },
        primitive: wgpu::PrimitiveState::default(),
        depth_stencil: None,
        multisample: wgpu::MultisampleState::default(),
        fragment: Some(wgpu::FragmentState {
            module,
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
    compute_layout: wgpu::BindGroupLayout,
    display_layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
    compute_pipelines: ComputePipelines,
    visualize_pipeline: wgpu::RenderPipeline,
    present_pipeline: wgpu::RenderPipeline,
    uniform_buffer: wgpu::Buffer,
    uniforms: Uniforms,
    simulation: SimulationTextures,
    target: HighResolutionTarget,
    field_is_a: bool,
    window_width: u32,
    window_height: u32,
    resolution_preset: String,
    render_scale: f32,
    pressure_iterations: u32,
    substeps: u32,
    emitter_mode: u32,
    palette: u32,
    view_mode: u32,
    paused: bool,
    minimized: bool,
    simulation_time: f32,
    burst_frames: u32,
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
        let max_texture_dimension_2d = adapter.limits().max_texture_dimension_2d;
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("junkpile compute fluid device"),
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
            label: Some("compute fluid uniforms"),
            contents: bytemuck::bytes_of(&uniforms),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });

        let compute_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("compute fluid pass layout"),
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
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: false },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: false },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 3,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::StorageTexture {
                        access: wgpu::StorageTextureAccess::WriteOnly,
                        format: FIELD_FORMAT,
                        view_dimension: wgpu::TextureViewDimension::D2,
                    },
                    count: None,
                },
            ],
        });

        let display_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("compute fluid display layout"),
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
            label: Some("compute fluid linear sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::MipmapFilterMode::Nearest,
            ..Default::default()
        });

        let compute_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("compute fluid WGSL"),
            source: wgpu::ShaderSource::Wgsl(include_str!("compute.wgsl").into()),
        });
        let present_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("compute fluid presentation WGSL"),
            source: wgpu::ShaderSource::Wgsl(include_str!("present.wgsl").into()),
        });

        let compute_pipeline_layout =
            device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("compute fluid pipeline layout"),
                bind_group_layouts: &[Some(&compute_layout)],
                immediate_size: 0,
            });
        let compute_pipelines = ComputePipelines {
            advect_velocity: create_compute_pipeline(
                &device,
                &compute_shader,
                &compute_pipeline_layout,
                "advect_velocity",
                "advect velocity pipeline",
            ),
            calculate_curl: create_compute_pipeline(
                &device,
                &compute_shader,
                &compute_pipeline_layout,
                "calculate_curl",
                "calculate curl pipeline",
            ),
            apply_vorticity: create_compute_pipeline(
                &device,
                &compute_shader,
                &compute_pipeline_layout,
                "apply_vorticity",
                "apply vorticity pipeline",
            ),
            calculate_divergence: create_compute_pipeline(
                &device,
                &compute_shader,
                &compute_pipeline_layout,
                "calculate_divergence",
                "calculate divergence pipeline",
            ),
            solve_pressure: create_compute_pipeline(
                &device,
                &compute_shader,
                &compute_pipeline_layout,
                "solve_pressure",
                "pressure Jacobi pipeline",
            ),
            subtract_pressure_gradient: create_compute_pipeline(
                &device,
                &compute_shader,
                &compute_pipeline_layout,
                "subtract_pressure_gradient",
                "subtract pressure gradient pipeline",
            ),
            advect_dye: create_compute_pipeline(
                &device,
                &compute_shader,
                &compute_pipeline_layout,
                "advect_dye",
                "advect dye pipeline",
            ),
        };

        let display_pipeline_layout =
            device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("compute fluid display pipeline layout"),
                bind_group_layouts: &[Some(&display_layout)],
                immediate_size: 0,
            });

        let visualize_pipeline = create_render_pipeline(
            &device,
            &present_shader,
            &display_pipeline_layout,
            "compute fluid HDR visualizer pipeline",
            "fs_visualize",
            HDR_FORMAT,
        );
        let present_pipeline = create_render_pipeline(
            &device,
            &present_shader,
            &display_pipeline_layout,
            "compute fluid surface presentation pipeline",
            "fs_present",
            config.format,
        );

        let simulation = SimulationTextures::new(
            &device,
            &compute_layout,
            &display_layout,
            &uniform_buffer,
            &sampler,
            DEFAULT_SIMULATION_SIZE,
        );
        let target = create_target(
            &device,
            &display_layout,
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
            compute_layout,
            display_layout,
            sampler,
            compute_pipelines,
            visualize_pipeline,
            present_pipeline,
            uniform_buffer,
            uniforms,
            simulation,
            target,
            field_is_a: true,
            window_width,
            window_height,
            resolution_preset: "window".into(),
            render_scale: 1.0,
            pressure_iterations: DEFAULT_PRESSURE_ITERATIONS,
            substeps: DEFAULT_SUBSTEPS,
            emitter_mode: 0,
            palette: 0,
            view_mode: 0,
            paused: false,
            minimized: false,
            simulation_time: 0.0,
            burst_frames: 0,
            last_tick: Instant::now(),
            frame_count: 0,
            measured_fps: 0.0,
            measured_frame_time_ms: 0.0,
            last_error: String::new(),
        })
    }

    fn default_uniforms(width: u32, height: u32) -> Uniforms {
        Uniforms {
            grid_time: [DEFAULT_SIMULATION_SIZE as f32, DEFAULT_SIMULATION_SIZE as f32, 0.0, 0.0],
            flow: [
                DEFAULT_VELOCITY_DISSIPATION,
                DEFAULT_DYE_DISSIPATION,
                DEFAULT_VISCOSITY,
                DEFAULT_VORTICITY,
            ],
            emitter: [
                DEFAULT_FORCE,
                DEFAULT_RADIUS,
                DEFAULT_DYE_AMOUNT,
                DEFAULT_FEEDBACK,
            ],
            motion: [
                DEFAULT_SIMULATION_SPEED,
                DEFAULT_EMITTER_SPEED,
                DEFAULT_INJECTOR_X,
                DEFAULT_INJECTOR_Y,
            ],
            look: [
                DEFAULT_EXPOSURE,
                DEFAULT_BLOOM,
                DEFAULT_CONTRAST,
                DEFAULT_VIGNETTE,
            ],
            control: [1.0, 1.0, 0.0, 0.0],
            output: [width as f32, height as f32, width as f32, height as f32],
            flags: [DEFAULT_PRESSURE_ITERATIONS, 0, 0, 0],
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
                "requested output {width}×{height}, but adapter max_texture_dimension_2d is {}",
                self.max_texture_dimension_2d
            );
            return;
        }
        self.target = create_target(
            &self.device,
            &self.display_layout,
            &self.uniform_buffer,
            &self.sampler,
            width,
            height,
        );
        self.resolution_preset = preset;
        self.render_scale = scale;
        self.last_error.clear();
    }

    fn rebuild_simulation(&mut self, requested_size: u32) {
        let size = requested_size.min(2048);
        if size > self.max_texture_dimension_2d {
            self.last_error = format!(
                "requested fluid grid {size}×{size}, but adapter max_texture_dimension_2d is {}",
                self.max_texture_dimension_2d
            );
            return;
        }
        self.simulation = SimulationTextures::new(
            &self.device,
            &self.compute_layout,
            &self.display_layout,
            &self.uniform_buffer,
            &self.sampler,
            size,
        );
        self.field_is_a = true;
        self.simulation_time = 0.0;
        self.last_tick = Instant::now();
        self.last_error.clear();
    }

    fn emitter_name(&self) -> &'static str {
        match self.emitter_mode {
            1 => "Twin Vortices",
            2 => "Chromatic Rain",
            3 => "Lattice Stirrer",
            _ => "Orbiting Injector",
        }
    }

    fn palette_name(&self) -> &'static str {
        match self.palette {
            1 => "Inferno",
            2 => "Acid",
            3 => "Monochrome",
            _ => "Cyan / Magenta",
        }
    }

    fn view_name(&self) -> &'static str {
        match self.view_mode {
            1 => "Velocity",
            2 => "Pressure",
            3 => "Divergence",
            4 => "Curl",
            _ => "Dye",
        }
    }

    fn workgroups(&self) -> u32 {
        self.simulation.size.div_ceil(WORKGROUP_SIZE)
    }

    fn compute_passes_per_frame(&self) -> u32 {
        (self.pressure_iterations + 6) * self.substeps
    }

    fn field_memory_megabytes(&self) -> f64 {
        let cells = self.simulation.size as f64 * self.simulation.size as f64;
        cells * 8.0 * FIELD_TEXTURE_COUNT as f64 / 1_048_576.0
    }

    fn output_memory_megabytes(&self) -> f64 {
        self.target.width as f64 * self.target.height as f64 * 8.0 / 1_048_576.0
    }

    fn info(&self) -> RendererInfo {
        let cells = self.simulation.size as f64 * self.simulation.size as f64;
        let compute_passes = self.compute_passes_per_frame();
        let field_memory = self.field_memory_megabytes();
        let output_memory = self.output_memory_megabytes();
        RendererInfo {
            backend: format!("{:?}", self.adapter_info.backend),
            adapter: self.adapter_info.name.clone(),
            device_type: format!("{:?}", self.adapter_info.device_type),
            driver: self.adapter_info.driver.clone(),
            surface_format: format!("{:?}", self.config.format),
            window_width: self.window_width,
            window_height: self.window_height,
            output_width: self.target.width,
            output_height: self.target.height,
            resolution_preset: self.resolution_preset.clone(),
            render_scale: self.render_scale,
            simulation_size: self.simulation.size,
            workgroups_x: self.workgroups(),
            workgroups_y: self.workgroups(),
            field_texture_count: FIELD_TEXTURE_COUNT,
            field_memory_megabytes: field_memory,
            output_memory_megabytes: output_memory,
            estimated_total_megabytes: field_memory + output_memory,
            pressure_iterations: self.pressure_iterations,
            substeps: self.substeps,
            compute_passes_per_frame: compute_passes,
            emitter_mode: self.emitter_mode,
            emitter_name: self.emitter_name().into(),
            palette: self.palette,
            palette_name: self.palette_name().into(),
            view_mode: self.view_mode,
            view_name: self.view_name().into(),
            velocity_dissipation: self.uniforms.flow[0],
            dye_dissipation: self.uniforms.flow[1],
            viscosity: self.uniforms.flow[2],
            vorticity: self.uniforms.flow[3],
            force: self.uniforms.emitter[0],
            radius: self.uniforms.emitter[1],
            dye_amount: self.uniforms.emitter[2],
            feedback: self.uniforms.emitter[3],
            simulation_speed: self.uniforms.motion[0],
            emitter_speed: self.uniforms.motion[1],
            injector_x: self.uniforms.motion[2],
            injector_y: self.uniforms.motion[3],
            exposure: self.uniforms.look[0],
            bloom: self.uniforms.look[1],
            contrast: self.uniforms.look[2],
            vignette: self.uniforms.look[3],
            paused: self.paused,
            burst_active: self.burst_frames > 0,
            max_texture_dimension_2d: self.max_texture_dimension_2d,
            fps: self.measured_fps,
            frame_time_ms: self.measured_frame_time_ms,
            cell_updates_per_second: cells * compute_passes as f64 * self.measured_fps,
            frame_count: self.frame_count,
            running: true,
            last_error: self.last_error.clone(),
        }
    }

    fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "render_scale" => self.rebuild_target(self.resolution_preset.clone(), value),
            "velocity_dissipation" => self.uniforms.flow[0] = value.clamp(0.80, 1.0),
            "dye_dissipation" => self.uniforms.flow[1] = value.clamp(0.80, 1.0),
            "viscosity" => self.uniforms.flow[2] = value.clamp(0.0, 1.0),
            "vorticity" => self.uniforms.flow[3] = value.clamp(0.0, 80.0),
            "force" => self.uniforms.emitter[0] = value.clamp(0.0, 8.0),
            "radius" => self.uniforms.emitter[1] = value.clamp(0.005, 0.25),
            "dye_amount" => self.uniforms.emitter[2] = value.clamp(0.0, 10.0),
            "feedback" => self.uniforms.emitter[3] = value.clamp(0.0, 1.0),
            "simulation_speed" => self.uniforms.motion[0] = value.clamp(0.0, 4.0),
            "emitter_speed" => self.uniforms.motion[1] = value.clamp(0.0, 4.0),
            "injector_x" => self.uniforms.motion[2] = value.clamp(0.02, 0.98),
            "injector_y" => self.uniforms.motion[3] = value.clamp(0.02, 0.98),
            "pressure_iterations" => {
                let clamped = value.round().clamp(4.0, 80.0) as u32;
                self.pressure_iterations = (clamped / 2) * 2;
            }
            "substeps" => self.substeps = value.round().clamp(1.0, 4.0) as u32,
            "exposure" => self.uniforms.look[0] = value.clamp(0.0, 4.0),
            "bloom" => self.uniforms.look[1] = value.clamp(0.0, 2.0),
            "contrast" => self.uniforms.look[2] = value.clamp(0.25, 2.5),
            "vignette" => self.uniforms.look[3] = value.clamp(0.0, 1.0),
            _ => {}
        }
    }

    fn reset_params(&mut self) {
        self.uniforms.flow = [
            DEFAULT_VELOCITY_DISSIPATION,
            DEFAULT_DYE_DISSIPATION,
            DEFAULT_VISCOSITY,
            DEFAULT_VORTICITY,
        ];
        self.uniforms.emitter = [
            DEFAULT_FORCE,
            DEFAULT_RADIUS,
            DEFAULT_DYE_AMOUNT,
            DEFAULT_FEEDBACK,
        ];
        self.uniforms.motion = [
            DEFAULT_SIMULATION_SPEED,
            DEFAULT_EMITTER_SPEED,
            DEFAULT_INJECTOR_X,
            DEFAULT_INJECTOR_Y,
        ];
        self.uniforms.look = [
            DEFAULT_EXPOSURE,
            DEFAULT_BLOOM,
            DEFAULT_CONTRAST,
            DEFAULT_VIGNETTE,
        ];
        self.pressure_iterations = DEFAULT_PRESSURE_ITERATIONS;
        self.substeps = DEFAULT_SUBSTEPS;
        self.emitter_mode = 0;
        self.palette = 0;
        self.view_mode = 0;
        self.paused = false;
        self.burst_frames = 0;
        self.last_tick = Instant::now();
        self.rebuild_target("window".into(), 1.0);
    }

    fn encode_fluid_substep(&mut self, encoder: &mut wgpu::CommandEncoder) {
        let workgroups = self.workgroups();
        if self.field_is_a {
            dispatch_compute(
                encoder,
                &self.compute_pipelines.advect_velocity,
                &self.simulation.advect_a_to_b,
                workgroups,
                "advect velocity A to B pass",
            );
            dispatch_compute(
                encoder,
                &self.compute_pipelines.calculate_curl,
                &self.simulation.curl_from_b,
                workgroups,
                "curl from velocity B pass",
            );
            dispatch_compute(
                encoder,
                &self.compute_pipelines.apply_vorticity,
                &self.simulation.vorticity_b_to_a,
                workgroups,
                "vorticity velocity B to A pass",
            );
            dispatch_compute(
                encoder,
                &self.compute_pipelines.calculate_divergence,
                &self.simulation.divergence_from_a,
                workgroups,
                "divergence from velocity A pass",
            );
        } else {
            dispatch_compute(
                encoder,
                &self.compute_pipelines.advect_velocity,
                &self.simulation.advect_b_to_a,
                workgroups,
                "advect velocity B to A pass",
            );
            dispatch_compute(
                encoder,
                &self.compute_pipelines.calculate_curl,
                &self.simulation.curl_from_a,
                workgroups,
                "curl from velocity A pass",
            );
            dispatch_compute(
                encoder,
                &self.compute_pipelines.apply_vorticity,
                &self.simulation.vorticity_a_to_b,
                workgroups,
                "vorticity velocity A to B pass",
            );
            dispatch_compute(
                encoder,
                &self.compute_pipelines.calculate_divergence,
                &self.simulation.divergence_from_b,
                workgroups,
                "divergence from velocity B pass",
            );
        }

        for iteration in 0..self.pressure_iterations {
            if iteration % 2 == 0 {
                dispatch_compute(
                    encoder,
                    &self.compute_pipelines.solve_pressure,
                    &self.simulation.pressure_a_to_b,
                    workgroups,
                    "pressure A to B pass",
                );
            } else {
                dispatch_compute(
                    encoder,
                    &self.compute_pipelines.solve_pressure,
                    &self.simulation.pressure_b_to_a,
                    workgroups,
                    "pressure B to A pass",
                );
            }
        }

        if self.field_is_a {
            dispatch_compute(
                encoder,
                &self.compute_pipelines.subtract_pressure_gradient,
                &self.simulation.gradient_a_to_b,
                workgroups,
                "subtract pressure gradient A to B pass",
            );
            dispatch_compute(
                encoder,
                &self.compute_pipelines.advect_dye,
                &self.simulation.dye_a_to_b,
                workgroups,
                "advect dye A to B pass",
            );
        } else {
            dispatch_compute(
                encoder,
                &self.compute_pipelines.subtract_pressure_gradient,
                &self.simulation.gradient_b_to_a,
                workgroups,
                "subtract pressure gradient B to A pass",
            );
            dispatch_compute(
                encoder,
                &self.compute_pipelines.advect_dye,
                &self.simulation.dye_b_to_a,
                workgroups,
                "advect dye B to A pass",
            );
        }
        self.field_is_a = !self.field_is_a;
    }

    fn render(&mut self) -> Result<(), String> {
        if self.minimized {
            return Ok(());
        }

        let now = Instant::now();
        let raw_delta = now.duration_since(self.last_tick).as_secs_f32();
        self.last_tick = now;
        let frame_delta = raw_delta.clamp(1.0 / 500.0, 1.0 / 20.0);
        let simulation_delta = if self.paused {
            0.0
        } else {
            frame_delta * self.uniforms.motion[0] / self.substeps.max(1) as f32
        };
        if !self.paused {
            self.simulation_time += frame_delta * self.uniforms.motion[0];
        }

        self.uniforms.grid_time = [
            self.simulation.size as f32,
            self.simulation.size as f32,
            self.simulation_time,
            simulation_delta,
        ];
        self.uniforms.control = [
            if self.burst_frames > 0 { 4.0 } else { 1.0 },
            self.render_scale,
            0.0,
            0.0,
        ];
        self.uniforms.output = [
            self.target.width as f32,
            self.target.height as f32,
            self.window_width as f32,
            self.window_height as f32,
        ];
        self.uniforms.flags = [
            self.pressure_iterations,
            self.emitter_mode,
            self.palette,
            self.view_mode,
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
                label: Some("compute fluid frame encoder"),
            });

        if !self.paused {
            for _ in 0..self.substeps {
                self.encode_fluid_substep(&mut encoder);
            }
        }

        {
            let source_bind = self
                .simulation
                .display_bind_group(self.view_mode, self.field_is_a);
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("compute fluid HDR visualization pass"),
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
            pass.set_pipeline(&self.visualize_pipeline);
            pass.set_bind_group(0, source_bind, &[]);
            pass.draw(0..3, 0..1);
        }

        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("compute fluid surface presentation pass"),
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
        if self.burst_frames > 0 {
            self.burst_frames -= 1;
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
                    Ok(RenderCommand::SetSimulationSize(size)) => self.rebuild_simulation(size),
                    Ok(RenderCommand::SetResolutionPreset(preset)) => {
                        self.rebuild_target(preset, self.render_scale)
                    }
                    Ok(RenderCommand::SetEmitterMode(mode)) => self.emitter_mode = mode.min(3),
                    Ok(RenderCommand::SetPalette(palette)) => self.palette = palette.min(3),
                    Ok(RenderCommand::SetViewMode(mode)) => self.view_mode = mode.min(4),
                    Ok(RenderCommand::SetParam(name, value)) => self.set_param(&name, value),
                    Ok(RenderCommand::SetPaused(paused)) => {
                        self.paused = paused;
                        self.last_tick = Instant::now();
                    }
                    Ok(RenderCommand::ResetFluid) => {
                        let size = self.simulation.size;
                        self.rebuild_simulation(size);
                    }
                    Ok(RenderCommand::ResetParams) => self.reset_params(),
                    Ok(RenderCommand::TriggerBurst) => self.burst_frames = 36,
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
