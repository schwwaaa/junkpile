use bytemuck::{Pod, Zeroable};
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
use wgpu::util::DeviceExt;

const HDR_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;
const TARGET_BYTES_PER_PIXEL: f64 = 8.0;
const TARGET_COUNT: f64 = 3.0;

#[derive(Debug, Clone)]
pub enum RenderCommand {
    Resize(u32, u32),
    SetParam(String, f32),
    Reset,
    Shutdown,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RendererInfo {
    pub backend: String,
    pub adapter_name: String,
    pub width: u32,
    pub height: u32,
    pub hdr_format: String,
    pub pass_count: u32,
    pub target_count: u32,
    pub target_megabytes: f64,
    pub total_target_megabytes: f64,
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
        self.info
            .read()
            .expect("renderer info poisoned")
            .clone()
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
        .name("junkpile-wgpu-multipass".into())
        .spawn(move || renderer.run(rx, thread_info, thread_alive))
        .map_err(|error| format!("could not start renderer thread: {error}"))?;

    Ok(RendererHandle { tx, info })
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Uniforms {
    // xy: target resolution, z: elapsed seconds, w: frame index
    resolution_time: [f32; 4],
    // x: blur radius, y: bloom amount, z: chromatic shift, w: reserved
    blur: [f32; 4],
    // x: source scale, y: speed, z: hue, w: octave count
    source: [f32; 4],
    // x: exposure, y: display gamma, z: grain, w: reserved
    look: [f32; 4],
}

impl Uniforms {
    fn defaults(width: u32, height: u32) -> Self {
        Self {
            resolution_time: [width as f32, height as f32, 0.0, 0.0],
            blur: [7.0, 1.2, 0.006, 0.0],
            source: [2.0, 1.0, 205.0, 5.0],
            look: [1.0, 0.9, 0.015, 0.0],
        }
    }
}

struct Targets {
    // Textures must remain alive for their views and bind groups.
    _source: wgpu::Texture,
    _blur_a: wgpu::Texture,
    _blur_b: wgpu::Texture,
    source_view: wgpu::TextureView,
    blur_a_view: wgpu::TextureView,
    blur_b_view: wgpu::TextureView,
    source_sample: wgpu::BindGroup,
    blur_a_sample: wgpu::BindGroup,
    composite: wgpu::BindGroup,
    width: u32,
    height: u32,
}

fn create_hdr_texture(
    device: &wgpu::Device,
    label: &str,
    size: wgpu::Extent3d,
) -> wgpu::Texture {
    device.create_texture(&wgpu::TextureDescriptor {
        label: Some(label),
        size,
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: HDR_FORMAT,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT
            | wgpu::TextureUsages::TEXTURE_BINDING,
        view_formats: &[],
    })
}

fn create_sample_bind_group(
    device: &wgpu::Device,
    label: &str,
    layout: &wgpu::BindGroupLayout,
    uniform_buffer: &wgpu::Buffer,
    texture_view: &wgpu::TextureView,
    sampler: &wgpu::Sampler,
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
                resource: wgpu::BindingResource::TextureView(texture_view),
            },
            wgpu::BindGroupEntry {
                binding: 3,
                resource: wgpu::BindingResource::Sampler(sampler),
            },
        ],
    })
}

fn create_targets(
    device: &wgpu::Device,
    sample_layout: &wgpu::BindGroupLayout,
    composite_layout: &wgpu::BindGroupLayout,
    uniform_buffer: &wgpu::Buffer,
    sampler: &wgpu::Sampler,
    width: u32,
    height: u32,
) -> Targets {
    let size = wgpu::Extent3d {
        width: width.max(1),
        height: height.max(1),
        depth_or_array_layers: 1,
    };

    let source = create_hdr_texture(device, "multipass source", size);
    let blur_a = create_hdr_texture(device, "multipass blur A", size);
    let blur_b = create_hdr_texture(device, "multipass blur B", size);

    let source_view = source.create_view(&wgpu::TextureViewDescriptor::default());
    let blur_a_view = blur_a.create_view(&wgpu::TextureViewDescriptor::default());
    let blur_b_view = blur_b.create_view(&wgpu::TextureViewDescriptor::default());

    let source_sample = create_sample_bind_group(
        device,
        "sample source",
        sample_layout,
        uniform_buffer,
        &source_view,
        sampler,
    );
    let blur_a_sample = create_sample_bind_group(
        device,
        "sample blur A",
        sample_layout,
        uniform_buffer,
        &blur_a_view,
        sampler,
    );

    let composite = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("composite bind group"),
        layout: composite_layout,
        entries: &[
            wgpu::BindGroupEntry {
                binding: 0,
                resource: uniform_buffer.as_entire_binding(),
            },
            wgpu::BindGroupEntry {
                binding: 1,
                resource: wgpu::BindingResource::TextureView(&source_view),
            },
            wgpu::BindGroupEntry {
                binding: 2,
                resource: wgpu::BindingResource::TextureView(&blur_b_view),
            },
            wgpu::BindGroupEntry {
                binding: 3,
                resource: wgpu::BindingResource::Sampler(sampler),
            },
        ],
    });

    Targets {
        _source: source,
        _blur_a: blur_a,
        _blur_b: blur_b,
        source_view,
        blur_a_view,
        blur_b_view,
        source_sample,
        blur_a_sample,
        composite,
        width: size.width,
        height: size.height,
    }
}

fn create_uniform_layout(device: &wgpu::Device) -> wgpu::BindGroupLayout {
    device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("multipass uniform layout"),
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
    })
}

fn create_sample_layout(device: &wgpu::Device) -> wgpu::BindGroupLayout {
    device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("multipass sample layout"),
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
            // Binding 2 belongs only to the composite entry point.
            wgpu::BindGroupLayoutEntry {
                binding: 3,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                count: None,
            },
        ],
    })
}

fn create_composite_layout(device: &wgpu::Device) -> wgpu::BindGroupLayout {
    device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("multipass composite layout"),
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
                ty: wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Float { filterable: true },
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: false,
                },
                count: None,
            },
            wgpu::BindGroupLayoutEntry {
                binding: 3,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                count: None,
            },
        ],
    })
}

fn create_pipeline(
    device: &wgpu::Device,
    shader: &wgpu::ShaderModule,
    label: &str,
    entry_point: &str,
    format: wgpu::TextureFormat,
    bind_group_layout: &wgpu::BindGroupLayout,
) -> wgpu::RenderPipeline {
    let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some(label),
        bind_group_layouts: &[Some(bind_group_layout)],
        immediate_size: 0,
    });

    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some(label),
        layout: Some(&pipeline_layout),
        vertex: wgpu::VertexState {
            module: shader,
            entry_point: Some("vs_main"),
            compilation_options: wgpu::PipelineCompilationOptions::default(),
            buffers: &[],
        },
        primitive: wgpu::PrimitiveState::default(),
        depth_stencil: None,
        multisample: wgpu::MultisampleState::default(),
        fragment: Some(wgpu::FragmentState {
            module: shader,
            entry_point: Some(entry_point),
            compilation_options: wgpu::PipelineCompilationOptions::default(),
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
    window: tauri::Window,
    instance: wgpu::Instance,
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    adapter_info: wgpu::AdapterInfo,
    sample_layout: wgpu::BindGroupLayout,
    composite_layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
    source_pipeline: wgpu::RenderPipeline,
    blur_h_pipeline: wgpu::RenderPipeline,
    blur_v_pipeline: wgpu::RenderPipeline,
    composite_pipeline: wgpu::RenderPipeline,
    uniform_buffer: wgpu::Buffer,
    uniform_bind: wgpu::BindGroup,
    uniforms: Uniforms,
    targets: Targets,
    width: u32,
    height: u32,
    minimized: bool,
    started: Instant,
    frame_count: u64,
    last_error: String,
}

impl Renderer {
    async fn new(window: tauri::Window) -> Result<Self, String> {
        let size = window.inner_size().map_err(|error| error.to_string())?;
        let width = size.width.max(1);
        let height = size.height.max(1);

        // PRIMARY intentionally excludes the legacy GL/GLES fallback.
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
            backends: wgpu::Backends::PRIMARY,
            ..wgpu::InstanceDescriptor::new_without_display_handle()
        });
        let surface = instance
            .create_surface(window.clone())
            .map_err(|error| format!("could not create surface: {error}"))?;
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: Some(&surface),
                force_fallback_adapter: false,
            })
            .await
            .map_err(|error| format!("no compatible GPU adapter: {error}"))?;
        let adapter_info = adapter.get_info();
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("multipass device"),
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
            .ok_or_else(|| "adapter cannot present to this surface".to_string())?;
        config.present_mode = wgpu::PresentMode::Fifo;
        surface.configure(&device, &config);

        let uniforms = Uniforms::defaults(width, height);
        let uniform_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("multipass uniforms"),
            contents: bytemuck::bytes_of(&uniforms),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });

        let uniform_layout = create_uniform_layout(&device);
        let sample_layout = create_sample_layout(&device);
        let composite_layout = create_composite_layout(&device);

        let uniform_bind = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("multipass uniform bind group"),
            layout: &uniform_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: uniform_buffer.as_entire_binding(),
            }],
        });

        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("multipass sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::MipmapFilterMode::Nearest,
            ..Default::default()
        });

        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("multipass WGSL"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shader.wgsl").into()),
        });

        let source_pipeline = create_pipeline(
            &device,
            &shader,
            "source pipeline",
            "fs_source",
            HDR_FORMAT,
            &uniform_layout,
        );
        let blur_h_pipeline = create_pipeline(
            &device,
            &shader,
            "horizontal blur pipeline",
            "fs_blur_h",
            HDR_FORMAT,
            &sample_layout,
        );
        let blur_v_pipeline = create_pipeline(
            &device,
            &shader,
            "vertical blur pipeline",
            "fs_blur_v",
            HDR_FORMAT,
            &sample_layout,
        );
        let composite_pipeline = create_pipeline(
            &device,
            &shader,
            "composite pipeline",
            "fs_composite",
            config.format,
            &composite_layout,
        );

        let targets = create_targets(
            &device,
            &sample_layout,
            &composite_layout,
            &uniform_buffer,
            &sampler,
            width,
            height,
        );

        Ok(Self {
            window,
            instance,
            surface,
            device,
            queue,
            config,
            adapter_info,
            sample_layout,
            composite_layout,
            sampler,
            source_pipeline,
            blur_h_pipeline,
            blur_v_pipeline,
            composite_pipeline,
            uniform_buffer,
            uniform_bind,
            uniforms,
            targets,
            width,
            height,
            minimized: false,
            started: Instant::now(),
            frame_count: 0,
            last_error: String::new(),
        })
    }

    fn info(&self) -> RendererInfo {
        let target_bytes = self.targets.width as f64
            * self.targets.height as f64
            * TARGET_BYTES_PER_PIXEL;

        RendererInfo {
            backend: format!("{:?}", self.adapter_info.backend),
            adapter_name: self.adapter_info.name.clone(),
            width: self.width,
            height: self.height,
            hdr_format: format!("{:?}", HDR_FORMAT),
            pass_count: 4,
            target_count: TARGET_COUNT as u32,
            target_megabytes: target_bytes / 1_048_576.0,
            total_target_megabytes: target_bytes * TARGET_COUNT / 1_048_576.0,
            fps: 0.0,
            frame_time_ms: 0.0,
            frame_count: self.frame_count,
            running: true,
            last_error: self.last_error.clone(),
        }
    }

    fn rebuild_targets(&mut self) {
        self.targets = create_targets(
            &self.device,
            &self.sample_layout,
            &self.composite_layout,
            &self.uniform_buffer,
            &self.sampler,
            self.width.max(1),
            self.height.max(1),
        );
    }

    fn render(&mut self) -> Result<(), String> {
        if self.minimized {
            return Ok(());
        }

        self.uniforms.resolution_time = [
            self.targets.width as f32,
            self.targets.height as f32,
            self.started.elapsed().as_secs_f32(),
            self.frame_count as f32,
        ];
        self.queue.write_buffer(
            &self.uniform_buffer,
            0,
            bytemuck::bytes_of(&self.uniforms),
        );

        let (frame, reconfigure) = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(frame) => (frame, false),
            wgpu::CurrentSurfaceTexture::Suboptimal(frame) => (frame, true),
            wgpu::CurrentSurfaceTexture::Timeout | wgpu::CurrentSurfaceTexture::Occluded => {
                return Ok(());
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
                return Err("surface validation error".into());
            }
        };

        let surface_view = frame
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("multipass encoder"),
            });

        // Pass 1: generate an HDR procedural source.
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("1 · source"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &self.targets.source_view,
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
            pass.set_pipeline(&self.source_pipeline);
            pass.set_bind_group(0, &self.uniform_bind, &[]);
            pass.draw(0..3, 0..1);
        }

        // Pass 2: horizontal Gaussian blur.
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("2 · horizontal blur"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &self.targets.blur_a_view,
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
            pass.set_pipeline(&self.blur_h_pipeline);
            pass.set_bind_group(0, &self.targets.source_sample, &[]);
            pass.draw(0..3, 0..1);
        }

        // Pass 3: vertical Gaussian blur.
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("3 · vertical blur"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &self.targets.blur_b_view,
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
            pass.set_pipeline(&self.blur_v_pipeline);
            pass.set_bind_group(0, &self.targets.blur_a_sample, &[]);
            pass.draw(0..3, 0..1);
        }

        // Pass 4: composite source + bloom, apply chromatic shift and tone map.
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("4 · composite"),
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
            pass.set_pipeline(&self.composite_pipeline);
            pass.set_bind_group(0, &self.targets.composite, &[]);
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
        let mut metrics_frames = 0_u64;

        while alive.load(Ordering::Relaxed) {
            let frame_started = Instant::now();

            loop {
                match rx.try_recv() {
                    Ok(RenderCommand::Resize(width, height)) => self.resize(width, height),
                    Ok(RenderCommand::SetParam(name, value)) => {
                        self.set_param(&name, value);
                    }
                    Ok(RenderCommand::Reset) => {
                        self.uniforms = Uniforms::defaults(self.width, self.height);
                    }
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
                let fps = metrics_frames as f64 / metrics_elapsed.as_secs_f64();
                if let Ok(mut info) = shared.write() {
                    *info = self.info();
                    info.fps = fps;
                    info.frame_time_ms = frame_started.elapsed().as_secs_f64() * 1000.0;
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
            "blur_radius" => self.uniforms.blur[0] = value.clamp(0.0, 16.0),
            "bloom" => self.uniforms.blur[1] = value.clamp(0.0, 4.0),
            "chromatic" => self.uniforms.blur[2] = value.clamp(0.0, 0.03),
            "source_scale" => self.uniforms.source[0] = value.clamp(0.2, 8.0),
            "speed" => self.uniforms.source[1] = value.clamp(0.0, 4.0),
            "hue" => self.uniforms.source[2] = value.rem_euclid(360.0),
            "complexity" => self.uniforms.source[3] = value.clamp(1.0, 8.0).round(),
            "exposure" => self.uniforms.look[0] = value.clamp(0.0, 4.0),
            "grain" => self.uniforms.look[2] = value.clamp(0.0, 0.2),
            _ => {}
        }
    }

    fn resize(&mut self, width: u32, height: u32) {
        self.width = width;
        self.height = height;
        self.minimized = width == 0 || height == 0;

        if !self.minimized {
            self.config.width = width;
            self.config.height = height;
            self.surface.configure(&self.device, &self.config);
            self.rebuild_targets();
        }
    }

    fn recreate_surface(&mut self) -> Result<(), String> {
        self.surface = self
            .instance
            .create_surface(self.window.clone())
            .map_err(|error| error.to_string())?;
        self.surface.configure(&self.device, &self.config);
        Ok(())
    }
}
