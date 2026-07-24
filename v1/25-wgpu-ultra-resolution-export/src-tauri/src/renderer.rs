use bytemuck::{Pod, Zeroable};
use serde::{Deserialize, Serialize};
use std::{
    env,
    fs::File,
    io::BufWriter,
    mem::size_of,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{sync_channel, Receiver, SyncSender, TryRecvError},
        Arc, RwLock,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use wgpu::util::DeviceExt;

const EXPORT_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8UnormSrgb;
const COPY_BYTES_PER_PIXEL: u32 = 4;
const COPY_ALIGNMENT: u32 = wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
const MAX_EXPORT_PIXELS: u64 = 8192 * 8192;

const DEFAULT_ANIMATION_SPEED: f32 = 0.55;
const DEFAULT_ZOOM: f32 = 1.35;
const DEFAULT_ROTATION: f32 = 12.0;
const DEFAULT_WARP: f32 = 0.75;
const DEFAULT_FOLD: f32 = 0.92;
const DEFAULT_DENSITY: f32 = 8.5;
const DEFAULT_DETAIL: f32 = 10.0;
const DEFAULT_GLOW: f32 = 0.75;
const DEFAULT_HUE: f32 = 0.08;
const DEFAULT_SATURATION: f32 = 0.92;
const DEFAULT_EXPOSURE: f32 = 1.40;
const DEFAULT_CONTRAST: f32 = 1.12;
const DEFAULT_VIGNETTE: f32 = 0.65;
const DEFAULT_GRAIN: f32 = 0.012;
const DEFAULT_BACKGROUND: f32 = 0.018;

const DEFAULT_EXPORT_WIDTH: u32 = 3840;
const DEFAULT_EXPORT_HEIGHT: u32 = 2160;
const DEFAULT_TILE_SIZE: u32 = 2048;
const DEFAULT_SAMPLES: u32 = 1;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportConfig {
    pub width: u32,
    pub height: u32,
    pub tile_size: u32,
    pub samples: u32,
}

impl ExportConfig {
    pub fn validated(
        width: u32,
        height: u32,
        tile_size: u32,
        samples: u32,
    ) -> Result<Self, String> {
        if !(256..=8192).contains(&width) || !(256..=8192).contains(&height) {
            return Err("export width and height must each be between 256 and 8192 pixels".into());
        }
        if u64::from(width) * u64::from(height) > MAX_EXPORT_PIXELS {
            return Err("export exceeds the 67.1 megapixel safety limit".into());
        }
        if !matches!(tile_size, 512 | 1024 | 2048 | 4096) {
            return Err("tile size must be 512, 1024, 2048, or 4096".into());
        }
        if !matches!(samples, 1 | 2 | 4) {
            return Err("sample count must be 1, 2, or 4".into());
        }
        Ok(Self {
            width,
            height,
            tile_size,
            samples,
        })
    }
}

impl Default for ExportConfig {
    fn default() -> Self {
        Self {
            width: DEFAULT_EXPORT_WIDTH,
            height: DEFAULT_EXPORT_HEIGHT,
            tile_size: DEFAULT_TILE_SIZE,
            samples: DEFAULT_SAMPLES,
        }
    }
}

#[derive(Debug, Clone)]
pub enum RenderCommand {
    Resize(u32, u32),
    SetParam(String, f32),
    SetToggle(String, bool),
    ApplyPreset(String),
    SetExportConfig(ExportConfig),
    Export,
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
    pub export_format: String,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub frame_time_ms: f64,
    pub frame_count: u64,
    pub max_texture_dimension_2d: u32,
    pub scene_time: f32,
    pub animation_speed: f32,
    pub zoom: f32,
    pub rotation_degrees: f32,
    pub warp: f32,
    pub fold: f32,
    pub density: f32,
    pub detail: f32,
    pub glow: f32,
    pub hue: f32,
    pub saturation: f32,
    pub exposure: f32,
    pub contrast: f32,
    pub vignette: f32,
    pub grain: f32,
    pub background: f32,
    pub paused: bool,
    pub export_width: u32,
    pub export_height: u32,
    pub tile_size: u32,
    pub export_samples: u32,
    pub tile_columns: u32,
    pub tile_rows: u32,
    pub total_tiles: u32,
    pub tiles_completed: u32,
    pub export_progress: f32,
    pub exporting: bool,
    pub export_stage: String,
    pub estimated_rgba_bytes: u64,
    pub last_export_path: String,
    pub last_export_bytes: u64,
    pub last_export_ms: f64,
    pub export_directory: String,
    pub running: bool,
    pub last_error: String,
}

#[derive(Clone)]
pub struct RendererHandle {
    tx: SyncSender<RenderCommand>,
    info: Arc<RwLock<RendererInfo>>,
    export_busy: Arc<AtomicBool>,
}

impl RendererHandle {
    pub fn send(&self, command: RenderCommand) {
        let _ = self.tx.try_send(command);
    }

    pub fn info(&self) -> RendererInfo {
        self.info.read().expect("renderer info poisoned").clone()
    }

    pub fn request_export(&self) -> Result<(), String> {
        self.export_busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| "an export is already in progress".to_string())?;
        if self.tx.try_send(RenderCommand::Export).is_err() {
            self.export_busy.store(false, Ordering::Release);
            return Err("renderer command queue is full; try export again".into());
        }
        Ok(())
    }
}

pub fn export_directory() -> Result<PathBuf, String> {
    let base = dirs::picture_dir()
        .or_else(dirs::home_dir)
        .or_else(|| env::current_dir().ok())
        .ok_or_else(|| "could not determine an export directory".to_string())?;
    Ok(base.join("Junkpile Exports"))
}

pub fn start(window: tauri::Window) -> Result<RendererHandle, String> {
    let (tx, rx) = sync_channel(128);
    let alive = Arc::new(AtomicBool::new(true));
    let export_busy = Arc::new(AtomicBool::new(false));
    let mut renderer = pollster::block_on(Renderer::new(window))?;
    let info = Arc::new(RwLock::new(renderer.info()));
    let thread_info = Arc::clone(&info);
    let thread_alive = Arc::clone(&alive);
    let thread_export_busy = Arc::clone(&export_busy);

    thread::Builder::new()
        .name("junkpile-wgpu-ultra-resolution-export".into())
        .spawn(move || renderer.run(rx, thread_info, thread_alive, thread_export_busy))
        .map_err(|error| format!("could not start renderer thread: {error}"))?;

    Ok(RendererHandle {
        tx,
        info,
        export_busy,
    })
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct SceneUniforms {
    resolution_tile_origin: [f32; 4],
    tile_size_time_samples: [f32; 4],
    camera: [f32; 4],
    field_a: [f32; 4],
    field_b: [f32; 4],
    tone: [f32; 4],
    reserved_a: [f32; 4],
    reserved_b: [f32; 4],
}

const _: [(); 128] = [(); size_of::<SceneUniforms>()];

struct Renderer {
    window: tauri::Window,
    instance: wgpu::Instance,
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    preview_pipeline: wgpu::RenderPipeline,
    export_pipeline: wgpu::RenderPipeline,
    uniform_buffer: wgpu::Buffer,
    bind_group: wgpu::BindGroup,
    adapter_info: wgpu::AdapterInfo,
    max_texture_dimension_2d: u32,
    width: u32,
    height: u32,
    minimized: bool,

    scene_time: f32,
    animation_speed: f32,
    zoom: f32,
    rotation_degrees: f32,
    warp: f32,
    fold: f32,
    density: f32,
    detail: f32,
    glow: f32,
    hue: f32,
    saturation: f32,
    exposure: f32,
    contrast: f32,
    vignette: f32,
    grain: f32,
    background: f32,
    paused: bool,

    export_config: ExportConfig,
    tiles_completed: u32,
    export_progress: f32,
    exporting: bool,
    export_stage: String,
    last_export_path: String,
    last_export_bytes: u64,
    last_export_ms: f64,
    export_directory: String,

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
                label: Some("junkpile ultra-resolution export device"),
                required_features: wgpu::Features::empty(),
                required_limits: wgpu::Limits::default(),
                memory_hints: wgpu::MemoryHints::Performance,
                trace: wgpu::Trace::Off,
                ..Default::default()
            })
            .await
            .map_err(|error| format!("could not create GPU device: {error}"))?;
        let max_texture_dimension_2d = device.limits().max_texture_dimension_2d;

        let mut config = surface
            .get_default_config(&adapter, width, height)
            .ok_or_else(|| "adapter cannot produce a default surface configuration".to_string())?;
        config.present_mode = wgpu::PresentMode::Fifo;
        surface.configure(&device, &config);

        let initial_uniforms = SceneUniforms::default_for(width, height);
        let uniform_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("ultra-resolution scene uniforms"),
            contents: bytemuck::bytes_of(&initial_uniforms),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });
        let bind_group_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("ultra-resolution bind group layout"),
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
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("ultra-resolution bind group"),
            layout: &bind_group_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: uniform_buffer.as_entire_binding(),
            }],
        });

        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("ultra-resolution export WGSL"),
            source: wgpu::ShaderSource::Wgsl(include_str!("export_scene.wgsl").into()),
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("ultra-resolution pipeline layout"),
            bind_group_layouts: &[Some(&bind_group_layout)],
            immediate_size: 0,
        });
        let preview_pipeline = create_pipeline(
            &device,
            &shader,
            &pipeline_layout,
            config.format,
            "ultra-resolution preview pipeline",
        );
        let export_pipeline = create_pipeline(
            &device,
            &shader,
            &pipeline_layout,
            EXPORT_FORMAT,
            "ultra-resolution offscreen pipeline",
        );

        let export_directory = export_directory()?.to_string_lossy().into_owned();
        let now = Instant::now();
        Ok(Self {
            window,
            instance,
            surface,
            device,
            queue,
            config,
            preview_pipeline,
            export_pipeline,
            uniform_buffer,
            bind_group,
            adapter_info,
            max_texture_dimension_2d,
            width,
            height,
            minimized: false,
            scene_time: 0.0,
            animation_speed: DEFAULT_ANIMATION_SPEED,
            zoom: DEFAULT_ZOOM,
            rotation_degrees: DEFAULT_ROTATION,
            warp: DEFAULT_WARP,
            fold: DEFAULT_FOLD,
            density: DEFAULT_DENSITY,
            detail: DEFAULT_DETAIL,
            glow: DEFAULT_GLOW,
            hue: DEFAULT_HUE,
            saturation: DEFAULT_SATURATION,
            exposure: DEFAULT_EXPOSURE,
            contrast: DEFAULT_CONTRAST,
            vignette: DEFAULT_VIGNETTE,
            grain: DEFAULT_GRAIN,
            background: DEFAULT_BACKGROUND,
            paused: false,
            export_config: ExportConfig::default(),
            tiles_completed: 0,
            export_progress: 0.0,
            exporting: false,
            export_stage: "Ready".into(),
            last_export_path: String::new(),
            last_export_bytes: 0,
            last_export_ms: 0.0,
            export_directory,
            last_frame: now,
            frame_count: 0,
            measured_fps: 0.0,
            measured_frame_time_ms: 0.0,
            last_error: String::new(),
        })
    }

    fn info(&self) -> RendererInfo {
        let tile_columns = div_ceil(self.export_config.width, self.export_config.tile_size);
        let tile_rows = div_ceil(self.export_config.height, self.export_config.tile_size);
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
            export_format: format!("{:?}", EXPORT_FORMAT),
            width: self.width,
            height: self.height,
            fps: self.measured_fps,
            frame_time_ms: self.measured_frame_time_ms,
            frame_count: self.frame_count,
            max_texture_dimension_2d: self.max_texture_dimension_2d,
            scene_time: self.scene_time,
            animation_speed: self.animation_speed,
            zoom: self.zoom,
            rotation_degrees: self.rotation_degrees,
            warp: self.warp,
            fold: self.fold,
            density: self.density,
            detail: self.detail,
            glow: self.glow,
            hue: self.hue,
            saturation: self.saturation,
            exposure: self.exposure,
            contrast: self.contrast,
            vignette: self.vignette,
            grain: self.grain,
            background: self.background,
            paused: self.paused,
            export_width: self.export_config.width,
            export_height: self.export_config.height,
            tile_size: self.export_config.tile_size,
            export_samples: self.export_config.samples,
            tile_columns,
            tile_rows,
            total_tiles: tile_columns * tile_rows,
            tiles_completed: self.tiles_completed,
            export_progress: self.export_progress,
            exporting: self.exporting,
            export_stage: self.export_stage.clone(),
            estimated_rgba_bytes: u64::from(self.export_config.width)
                * u64::from(self.export_config.height)
                * u64::from(COPY_BYTES_PER_PIXEL),
            last_export_path: self.last_export_path.clone(),
            last_export_bytes: self.last_export_bytes,
            last_export_ms: self.last_export_ms,
            export_directory: self.export_directory.clone(),
            running: true,
            last_error: self.last_error.clone(),
        }
    }

    fn publish_info(&self, shared: &Arc<RwLock<RendererInfo>>) {
        if let Ok(mut info) = shared.write() {
            *info = self.info();
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
        }
    }

    fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "animation_speed" => self.animation_speed = value.clamp(-3.0, 3.0),
            "zoom" => self.zoom = value.clamp(0.25, 4.0),
            "rotation" => self.rotation_degrees = value.clamp(-360.0, 360.0),
            "warp" => self.warp = value.clamp(0.0, 3.0),
            "fold" => self.fold = value.clamp(0.25, 1.8),
            "density" => self.density = value.clamp(1.0, 24.0),
            "detail" => self.detail = value.clamp(1.0, 16.0),
            "glow" => self.glow = value.clamp(0.0, 4.0),
            "hue" => self.hue = value.rem_euclid(1.0),
            "saturation" => self.saturation = value.clamp(0.0, 1.5),
            "exposure" => self.exposure = value.clamp(0.05, 5.0),
            "contrast" => self.contrast = value.clamp(0.25, 2.5),
            "vignette" => self.vignette = value.clamp(0.0, 1.0),
            "grain" => self.grain = value.clamp(0.0, 0.08),
            "background" => self.background = value.clamp(0.0, 0.5),
            _ => {}
        }
    }

    fn set_toggle(&mut self, name: &str, enabled: bool) {
        if name == "paused" {
            self.paused = enabled;
        }
    }

    fn apply_preset(&mut self, preset: &str) {
        match preset {
            "crystal" => {
                self.zoom = 1.72;
                self.rotation_degrees = -18.0;
                self.warp = 0.16;
                self.fold = 0.78;
                self.density = 14.0;
                self.detail = 13.0;
                self.glow = 0.34;
                self.hue = 0.55;
                self.saturation = 0.58;
                self.exposure = 1.62;
                self.contrast = 1.26;
                self.vignette = 0.42;
                self.grain = 0.004;
                self.background = 0.012;
            }
            "void" => {
                self.zoom = 1.18;
                self.rotation_degrees = 42.0;
                self.warp = 1.20;
                self.fold = 1.05;
                self.density = 11.5;
                self.detail = 12.0;
                self.glow = 1.48;
                self.hue = 0.82;
                self.saturation = 1.05;
                self.exposure = 1.18;
                self.contrast = 1.38;
                self.vignette = 0.86;
                self.grain = 0.018;
                self.background = 0.003;
            }
            "aurora" => {
                self.zoom = 1.04;
                self.rotation_degrees = -8.0;
                self.warp = 1.78;
                self.fold = 0.88;
                self.density = 6.4;
                self.detail = 9.0;
                self.glow = 1.22;
                self.hue = 0.39;
                self.saturation = 1.12;
                self.exposure = 1.52;
                self.contrast = 0.98;
                self.vignette = 0.48;
                self.grain = 0.009;
                self.background = 0.026;
            }
            "ember" => {
                self.zoom = 1.46;
                self.rotation_degrees = 17.0;
                self.warp = 0.94;
                self.fold = 0.98;
                self.density = 9.8;
                self.detail = 11.0;
                self.glow = 1.62;
                self.hue = 0.02;
                self.saturation = 1.18;
                self.exposure = 1.48;
                self.contrast = 1.18;
                self.vignette = 0.72;
                self.grain = 0.014;
                self.background = 0.012;
            }
            _ => self.reset_scene(),
        }
    }

    fn reset_scene(&mut self) {
        self.animation_speed = DEFAULT_ANIMATION_SPEED;
        self.zoom = DEFAULT_ZOOM;
        self.rotation_degrees = DEFAULT_ROTATION;
        self.warp = DEFAULT_WARP;
        self.fold = DEFAULT_FOLD;
        self.density = DEFAULT_DENSITY;
        self.detail = DEFAULT_DETAIL;
        self.glow = DEFAULT_GLOW;
        self.hue = DEFAULT_HUE;
        self.saturation = DEFAULT_SATURATION;
        self.exposure = DEFAULT_EXPOSURE;
        self.contrast = DEFAULT_CONTRAST;
        self.vignette = DEFAULT_VIGNETTE;
        self.grain = DEFAULT_GRAIN;
        self.background = DEFAULT_BACKGROUND;
        self.paused = false;
    }

    fn reset_all(&mut self) {
        self.reset_scene();
        self.scene_time = 0.0;
        self.export_config = ExportConfig::default();
        self.tiles_completed = 0;
        self.export_progress = 0.0;
        self.export_stage = "Ready".into();
        self.last_error.clear();
    }

    fn uniforms(
        &self,
        full_width: u32,
        full_height: u32,
        tile_x: u32,
        tile_y: u32,
        tile_width: u32,
        tile_height: u32,
        samples: u32,
        snapshot_time: f32,
    ) -> SceneUniforms {
        SceneUniforms {
            resolution_tile_origin: [
                full_width as f32,
                full_height as f32,
                tile_x as f32,
                tile_y as f32,
            ],
            tile_size_time_samples: [
                tile_width as f32,
                tile_height as f32,
                snapshot_time,
                samples as f32,
            ],
            camera: [
                self.zoom,
                self.rotation_degrees.to_radians(),
                0.0,
                0.0,
            ],
            field_a: [self.warp, self.fold, self.density, self.detail],
            field_b: [self.glow, self.hue, self.saturation, self.background],
            tone: [self.exposure, self.contrast, self.vignette, self.grain],
            reserved_a: [0.0; 4],
            reserved_b: [0.0; 4],
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

    fn render_preview(&mut self) -> Result<(), String> {
        if self.minimized {
            return Ok(());
        }

        let frame_started = Instant::now();
        let delta = frame_started
            .duration_since(self.last_frame)
            .as_secs_f32()
            .clamp(0.0, 0.1);
        self.last_frame = frame_started;
        if !self.paused {
            self.scene_time += delta * self.animation_speed;
        }

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

        let uniforms = self.uniforms(
            self.width,
            self.height,
            0,
            0,
            self.width,
            self.height,
            1,
            self.scene_time,
        );
        self.queue
            .write_buffer(&self.uniform_buffer, 0, bytemuck::bytes_of(&uniforms));

        let view = frame
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("ultra-resolution preview encoder"),
            });
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("ultra-resolution preview pass"),
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
            pass.set_pipeline(&self.preview_pipeline);
            pass.set_bind_group(0, &self.bind_group, &[]);
            pass.draw(0..3, 0..1);
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

    fn export_frame(&mut self, shared: &Arc<RwLock<RendererInfo>>) -> Result<(), String> {
        let started = Instant::now();
        let config = self.export_config;
        if config.tile_size > self.max_texture_dimension_2d {
            return Err(format!(
                "requested tile size {} exceeds this device's 2D texture limit {}",
                config.tile_size, self.max_texture_dimension_2d
            ));
        }

        let tile_columns = div_ceil(config.width, config.tile_size);
        let tile_rows = div_ceil(config.height, config.tile_size);
        let total_tiles = tile_columns * tile_rows;
        let pixel_bytes = u64::from(config.width)
            .checked_mul(u64::from(config.height))
            .and_then(|value| value.checked_mul(u64::from(COPY_BYTES_PER_PIXEL)))
            .ok_or_else(|| "export byte count overflowed".to_string())?;
        let mut image = vec![0u8; pixel_bytes as usize];

        let padded_bytes_per_row = align_up(config.tile_size * COPY_BYTES_PER_PIXEL, COPY_ALIGNMENT);
        let staging_size = u64::from(padded_bytes_per_row) * u64::from(config.tile_size);
        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("ultra-resolution export tile texture"),
            size: wgpu::Extent3d {
                width: config.tile_size,
                height: config.tile_size,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: EXPORT_FORMAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        let staging = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("ultra-resolution export staging buffer"),
            size: staging_size,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });

        self.exporting = true;
        self.export_stage = "Rendering tiles".into();
        self.tiles_completed = 0;
        self.export_progress = 0.0;
        self.last_error.clear();
        self.publish_info(shared);
        let snapshot_time = self.scene_time;

        for tile_row in 0..tile_rows {
            for tile_column in 0..tile_columns {
                let tile_x = tile_column * config.tile_size;
                let tile_y = tile_row * config.tile_size;
                let tile_width = (config.width - tile_x).min(config.tile_size);
                let tile_height = (config.height - tile_y).min(config.tile_size);
                let uniforms = self.uniforms(
                    config.width,
                    config.height,
                    tile_x,
                    tile_y,
                    tile_width,
                    tile_height,
                    config.samples,
                    snapshot_time,
                );
                self.queue
                    .write_buffer(&self.uniform_buffer, 0, bytemuck::bytes_of(&uniforms));

                let mut encoder = self
                    .device
                    .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                        label: Some("ultra-resolution export tile encoder"),
                    });
                {
                    let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                        label: Some("ultra-resolution export tile pass"),
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
                    pass.set_pipeline(&self.export_pipeline);
                    pass.set_bind_group(0, &self.bind_group, &[]);
                    pass.set_viewport(0.0, 0.0, tile_width as f32, tile_height as f32, 0.0, 1.0);
                    pass.set_scissor_rect(0, 0, tile_width, tile_height);
                    pass.draw(0..3, 0..1);
                }
                encoder.copy_texture_to_buffer(
                    wgpu::TexelCopyTextureInfo {
                        texture: &texture,
                        mip_level: 0,
                        origin: wgpu::Origin3d::ZERO,
                        aspect: wgpu::TextureAspect::All,
                    },
                    wgpu::TexelCopyBufferInfo {
                        buffer: &staging,
                        layout: wgpu::TexelCopyBufferLayout {
                            offset: 0,
                            bytes_per_row: Some(padded_bytes_per_row),
                            rows_per_image: Some(config.tile_size),
                        },
                    },
                    wgpu::Extent3d {
                        width: tile_width,
                        height: tile_height,
                        depth_or_array_layers: 1,
                    },
                );
                self.queue.submit([encoder.finish()]);

                let slice = staging.slice(..);
                let (map_tx, map_rx) = sync_channel(1);
                slice.map_async(wgpu::MapMode::Read, move |result| {
                    let _ = map_tx.send(result);
                });
                self.device
                    .poll(wgpu::PollType::wait_indefinitely())
                    .map_err(|error| format!("GPU polling failed during readback: {error}"))?;
                map_rx
                    .recv()
                    .map_err(|error| format!("readback callback was disconnected: {error}"))?
                    .map_err(|error| format!("could not map export buffer: {error}"))?;

                {
                    let mapped = slice
                        .get_mapped_range()
                        .map_err(|error| format!("could not access mapped export buffer: {error}"))?;
                    let dense_row_bytes = tile_width as usize * COPY_BYTES_PER_PIXEL as usize;
                    for local_y in 0..tile_height as usize {
                        let source_start = local_y * padded_bytes_per_row as usize;
                        let source_end = source_start + dense_row_bytes;
                        let destination_y = tile_y as usize + local_y;
                        let destination_start =
                            (destination_y * config.width as usize + tile_x as usize)
                                * COPY_BYTES_PER_PIXEL as usize;
                        let destination_end = destination_start + dense_row_bytes;
                        image[destination_start..destination_end]
                            .copy_from_slice(&mapped[source_start..source_end]);
                    }
                }
                staging.unmap();

                self.tiles_completed = self.tiles_completed.saturating_add(1);
                self.export_progress = self.tiles_completed as f32 / total_tiles.max(1) as f32;
                self.publish_info(shared);
            }
        }

        self.export_stage = "Encoding PNG".into();
        self.publish_info(shared);
        let directory = export_directory()?;
        std::fs::create_dir_all(&directory)
            .map_err(|error| format!("could not create export directory: {error}"))?;
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| format!("system clock error: {error}"))?
            .as_millis();
        let filename = format!(
            "junkpile25_{}x{}_{}spp_{}.png",
            config.width, config.height, config.samples, timestamp
        );
        let path = directory.join(filename);
        write_png(&path, config.width, config.height, &image)?;
        let file_bytes = std::fs::metadata(&path)
            .map(|metadata| metadata.len())
            .unwrap_or(0);

        self.last_export_path = path.to_string_lossy().into_owned();
        self.last_export_bytes = file_bytes;
        self.last_export_ms = started.elapsed().as_secs_f64() * 1000.0;
        self.export_stage = "Complete".into();
        self.export_progress = 1.0;
        self.publish_info(shared);
        Ok(())
    }

    fn run(
        &mut self,
        rx: Receiver<RenderCommand>,
        shared: Arc<RwLock<RendererInfo>>,
        alive: Arc<AtomicBool>,
        export_busy: Arc<AtomicBool>,
    ) {
        let mut metric_started = Instant::now();
        let mut metric_frames = 0u64;

        while alive.load(Ordering::Relaxed) {
            let mut exported_this_iteration = false;
            loop {
                match rx.try_recv() {
                    Ok(RenderCommand::Resize(width, height)) => self.resize(width, height),
                    Ok(RenderCommand::SetParam(name, value)) => self.set_param(&name, value),
                    Ok(RenderCommand::SetToggle(name, enabled)) => {
                        self.set_toggle(&name, enabled)
                    }
                    Ok(RenderCommand::ApplyPreset(preset)) => self.apply_preset(&preset),
                    Ok(RenderCommand::SetExportConfig(config)) => self.export_config = config,
                    Ok(RenderCommand::Export) => {
                        exported_this_iteration = true;
                        let result = self.export_frame(&shared);
                        self.exporting = false;
                        export_busy.store(false, Ordering::Release);
                        if let Err(error) = result {
                            self.last_error = error;
                            self.export_stage = "Failed".into();
                        } else {
                            self.last_error.clear();
                        }
                        self.publish_info(&shared);
                    }
                    Ok(RenderCommand::Reset) => self.reset_all(),
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

            if !exported_this_iteration {
                match self.render_preview() {
                    Ok(()) => {
                        if self.export_stage == "Failed" {
                            // Preserve export errors until another successful action.
                        } else {
                            self.last_error.clear();
                        }
                    }
                    Err(error) => {
                        self.last_error = error;
                        thread::sleep(Duration::from_millis(100));
                    }
                }
                metric_frames = metric_frames.saturating_add(1);
            } else {
                self.last_frame = Instant::now();
                metric_started = Instant::now();
                metric_frames = 0;
            }

            let elapsed = metric_started.elapsed();
            if elapsed >= Duration::from_millis(400) {
                self.measured_fps = metric_frames as f64 / elapsed.as_secs_f64();
                metric_frames = 0;
                metric_started = Instant::now();
                self.publish_info(&shared);
            }

            thread::sleep(Duration::from_millis(1));
        }
    }
}

impl SceneUniforms {
    fn default_for(width: u32, height: u32) -> Self {
        Self {
            resolution_tile_origin: [width as f32, height as f32, 0.0, 0.0],
            tile_size_time_samples: [width as f32, height as f32, 0.0, 1.0],
            camera: [DEFAULT_ZOOM, DEFAULT_ROTATION.to_radians(), 0.0, 0.0],
            field_a: [DEFAULT_WARP, DEFAULT_FOLD, DEFAULT_DENSITY, DEFAULT_DETAIL],
            field_b: [
                DEFAULT_GLOW,
                DEFAULT_HUE,
                DEFAULT_SATURATION,
                DEFAULT_BACKGROUND,
            ],
            tone: [
                DEFAULT_EXPOSURE,
                DEFAULT_CONTRAST,
                DEFAULT_VIGNETTE,
                DEFAULT_GRAIN,
            ],
            reserved_a: [0.0; 4],
            reserved_b: [0.0; 4],
        }
    }
}

fn create_pipeline(
    device: &wgpu::Device,
    shader: &wgpu::ShaderModule,
    layout: &wgpu::PipelineLayout,
    format: wgpu::TextureFormat,
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
            ..Default::default()
        },
        depth_stencil: None,
        multisample: wgpu::MultisampleState::default(),
        fragment: Some(wgpu::FragmentState {
            module: shader,
            entry_point: Some("fs_main"),
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

fn write_png(path: &PathBuf, width: u32, height: u32, rgba: &[u8]) -> Result<(), String> {
    let file = File::create(path)
        .map_err(|error| format!("could not create PNG {}: {error}", path.display()))?;
    let writer = BufWriter::new(file);
    let mut encoder = png::Encoder::new(writer, width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut png_writer = encoder
        .write_header()
        .map_err(|error| format!("could not write PNG header: {error}"))?;
    png_writer
        .write_image_data(rgba)
        .map_err(|error| format!("could not write PNG pixels: {error}"))?;
    Ok(())
}

fn div_ceil(value: u32, divisor: u32) -> u32 {
    (value + divisor - 1) / divisor
}

fn align_up(value: u32, alignment: u32) -> u32 {
    ((value + alignment - 1) / alignment) * alignment
}
