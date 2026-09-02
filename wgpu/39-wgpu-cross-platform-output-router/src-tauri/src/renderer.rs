use crate::{
    frame::{FrameDescriptor, VideoFrame},
    ndi::{NdiConfig, NdiOutputSink, NdiStatus},
    platform_share::{PlatformShareConfig, PlatformShareOutputSink, PlatformShareStatus},
    output::{FrameSink, PreviewSink, PreviewStatus, SinkContext},
    recording::{FfmpegInfo, FfmpegRecordingSink, RecordingProfile, RecordingStatus},
};
use bytemuck::{Pod, Zeroable};
use serde::Serialize;
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{sync_channel, Receiver, SyncSender, TryRecvError, TrySendError},
        Arc, RwLock,
    },
    thread,
    time::{Duration, Instant},
};
use wgpu::util::DeviceExt;

const FRAME_WIDTH: u32 = 1920;
const FRAME_HEIGHT: u32 = 1080;
const TARGET_FPS: u32 = 60;
const DEFAULT_RECORD_WIDTH: u32 = 1920;
const DEFAULT_RECORD_HEIGHT: u32 = 1080;
const DEFAULT_RECORD_FPS: u32 = 30;
const AUTHORITATIVE_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8UnormSrgb;

type Reply<T> = SyncSender<Result<T, String>>;

pub enum RenderCommand {
    Resize(u32, u32),
    PrepareProfile {
        width: u32,
        height: u32,
        fps: u32,
        reply: Reply<()>,
    },
    StartRecording {
        profile: String,
        width: u32,
        height: u32,
        fps: u32,
        worker_delay_ms: u64,
        reply: Reply<String>,
    },
    StopRecording {
        reply: Reply<()>,
    },
    SetOutputDirectory {
        path: PathBuf,
        reply: Reply<()>,
    },
    ConfigureNdi {
        config: NdiConfig,
        reply: Reply<()>,
    },
    StartNdi {
        reply: Reply<()>,
    },
    StopNdi {
        reply: Reply<()>,
    },
    ConfigurePlatformShare {
        config: PlatformShareConfig,
        reply: Reply<()>,
    },
    StartPlatformShare {
        reply: Reply<()>,
    },
    StopPlatformShare {
        reply: Reply<()>,
    },
    ResetMetrics,
    SetPreviewEnabled {
        enabled: bool,
        reply: Reply<()>,
    },
    Shutdown,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RendererInfo {
    pub backend: String,
    pub adapter_name: String,
    pub device_type: String,
    pub driver: String,
    pub driver_info: String,
    pub surface_format: String,
    pub window_width: u32,
    pub window_height: u32,
    pub fps: f64,
    pub frame_time_ms: f64,
    pub frame_count: u64,
    pub target_fps: u32,
    pub max_texture_dimension_2d: u32,
    pub running: bool,
    pub preview_enabled: bool,
    pub last_error: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSnapshot {
    pub renderer: RendererInfo,
    pub source_frame: FrameDescriptor,
    pub recording_frame: FrameDescriptor,
    pub preview: PreviewStatus,
    pub recording: RecordingStatus,
    pub ndi: NdiStatus,
    pub platform_share: PlatformShareStatus,
    pub ffmpeg: FfmpegInfo,
    pub contract_summary: String,
}

#[derive(Clone)]
pub struct RendererHandle {
    tx: SyncSender<RenderCommand>,
    snapshot: Arc<RwLock<RuntimeSnapshot>>,
}

impl RendererHandle {
    pub fn snapshot(&self) -> RuntimeSnapshot {
        self.snapshot
            .read()
            .expect("renderer snapshot poisoned")
            .clone()
    }

    pub fn send(&self, command: RenderCommand) -> Result<(), String> {
        self.tx.try_send(command).map_err(|error| match error {
            TrySendError::Full(_) => "renderer command queue is full".into(),
            TrySendError::Disconnected(_) => "renderer command queue is disconnected".into(),
        })
    }

    pub fn prepare_profile(&self, width: u32, height: u32, fps: u32) -> Result<(), String> {
        let (reply, response) = sync_channel(1);
        self.send(RenderCommand::PrepareProfile {
            width,
            height,
            fps,
            reply,
        })?;
        response
            .recv_timeout(Duration::from_secs(4))
            .map_err(|_| "renderer did not answer the prepare-profile request".to_string())?
    }

    pub fn start_recording(
        &self,
        profile: String,
        width: u32,
        height: u32,
        fps: u32,
        worker_delay_ms: u64,
    ) -> Result<String, String> {
        let (reply, response) = sync_channel(1);
        self.send(RenderCommand::StartRecording {
            profile,
            width,
            height,
            fps,
            worker_delay_ms,
            reply,
        })?;
        response
            .recv_timeout(Duration::from_secs(4))
            .map_err(|_| "renderer did not answer the start-recording request".to_string())?
    }

    pub fn stop_recording(&self) -> Result<(), String> {
        let (reply, response) = sync_channel(1);
        self.send(RenderCommand::StopRecording { reply })?;
        response
            .recv_timeout(Duration::from_secs(2))
            .map_err(|_| "renderer did not answer the stop-recording request".to_string())?
    }

    pub fn set_output_directory(&self, path: PathBuf) -> Result<(), String> {
        let (reply, response) = sync_channel(1);
        self.send(RenderCommand::SetOutputDirectory { path, reply })?;
        response
            .recv_timeout(Duration::from_secs(4))
            .map_err(|_| "renderer did not answer the output-directory request".to_string())?
    }

    pub fn configure_ndi(&self, config: NdiConfig) -> Result<(), String> {
        let (reply, response) = sync_channel(1);
        self.send(RenderCommand::ConfigureNdi { config, reply })?;
        response
            .recv_timeout(Duration::from_secs(5))
            .map_err(|_| "renderer did not answer the NDI configuration request".to_string())?
    }

    pub fn start_ndi(&self) -> Result<(), String> {
        let (reply, response) = sync_channel(1);
        self.send(RenderCommand::StartNdi { reply })?;
        response
            .recv_timeout(Duration::from_secs(10))
            .map_err(|_| "renderer did not answer the NDI start request".to_string())?
    }

    pub fn stop_ndi(&self) -> Result<(), String> {
        let (reply, response) = sync_channel(1);
        self.send(RenderCommand::StopNdi { reply })?;
        response
            .recv_timeout(Duration::from_secs(5))
            .map_err(|_| "renderer did not answer the NDI stop request".to_string())?
    }

    pub fn configure_platform_share(&self, config: PlatformShareConfig) -> Result<(), String> {
        let (reply, response) = sync_channel(1);
        self.send(RenderCommand::ConfigurePlatformShare { config, reply })?;
        response
            .recv_timeout(Duration::from_secs(5))
            .map_err(|_| "renderer did not answer the platform-share configuration request".to_string())?
    }

    pub fn start_platform_share(&self) -> Result<(), String> {
        let (reply, response) = sync_channel(1);
        self.send(RenderCommand::StartPlatformShare { reply })?;
        response
            .recv_timeout(Duration::from_secs(10))
            .map_err(|_| "renderer did not answer the platform-share start request".to_string())?
    }

    pub fn stop_platform_share(&self) -> Result<(), String> {
        let (reply, response) = sync_channel(1);
        self.send(RenderCommand::StopPlatformShare { reply })?;
        response
            .recv_timeout(Duration::from_secs(5))
            .map_err(|_| "renderer did not answer the platform-share stop request".to_string())?
    }

    pub fn set_preview_enabled(&self, enabled: bool) -> Result<(), String> {
        let (reply, response) = sync_channel(1);
        self.send(RenderCommand::SetPreviewEnabled { enabled, reply })?;
        response
            .recv_timeout(Duration::from_secs(4))
            .map_err(|_| "renderer did not answer the preview-state request".to_string())?
    }
}



pub fn start(window: tauri::Window, recording_directory: PathBuf) -> Result<RendererHandle, String> {
    let (tx, rx) = sync_channel(256);
    let alive = Arc::new(AtomicBool::new(true));
    let mut renderer = pollster::block_on(Renderer::new(window, recording_directory))?;
    let snapshot = Arc::new(RwLock::new(renderer.snapshot()));
    let thread_snapshot = Arc::clone(&snapshot);
    let thread_alive = Arc::clone(&alive);

    thread::Builder::new()
        .name("junkpile-wgpu-runtime-output-router".into())
        .spawn(move || renderer.run(rx, thread_snapshot, thread_alive))
        .map_err(|error| format!("could not start renderer thread: {error}"))?;

    Ok(RendererHandle { tx, snapshot })
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct SourceUniforms {
    timing: [f32; 4],
    resolution: [f32; 4],
}

struct Renderer {
    window: tauri::Window,
    instance: wgpu::Instance,
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    surface_config: wgpu::SurfaceConfiguration,
    adapter_info: wgpu::AdapterInfo,
    source_pipeline: wgpu::RenderPipeline,
    source_uniform_buffer: wgpu::Buffer,
    source_bind_group: wgpu::BindGroup,
    source_uniforms: SourceUniforms,
    authoritative_texture: wgpu::Texture,
    authoritative_view: wgpu::TextureView,
    source_descriptor: FrameDescriptor,
    recording: FfmpegRecordingSink,
    ndi: NdiOutputSink,
    platform_share: PlatformShareOutputSink,
    preview: PreviewSink,
    preview_enabled: bool,
    width: u32,
    height: u32,
    minimized: bool,
    started: Instant,
    frame_count: u64,
    measured_fps: f64,
    frame_time_ms: f64,
    last_error: String,
    max_texture_dimension_2d: u32,
}

impl Renderer {
    async fn new(window: tauri::Window, recording_directory: PathBuf) -> Result<Self, String> {
        let size = window.inner_size().map_err(|error| error.to_string())?;
        let width = size.width.max(1);
        let height = size.height.max(1);
        let instance = wgpu::Instance::default();
        let surface = instance
            .create_surface(window.clone())
            .map_err(|error| format!("could not create GPU surface: {error}"))?;
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
                label: Some("junkpile runtime output router device"),
                required_features: wgpu::Features::empty(),
                required_limits: wgpu::Limits::default(),
                memory_hints: wgpu::MemoryHints::Performance,
                trace: wgpu::Trace::Off,
                ..Default::default()
            })
            .await
            .map_err(|error| format!("could not create GPU device: {error}"))?;

        let mut surface_config = surface
            .get_default_config(&adapter, width, height)
            .ok_or_else(|| "adapter cannot present to this surface".to_string())?;
        surface_config.present_mode = wgpu::PresentMode::Fifo;
        surface.configure(&device, &surface_config);

        let max_texture_dimension_2d = device.limits().max_texture_dimension_2d;
        let (authoritative_texture, authoritative_view) =
            create_authoritative_target(&device, FRAME_WIDTH, FRAME_HEIGHT);

        let source_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("ffmpeg recording source shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("source.wgsl").into()),
        });
        let source_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("ffmpeg recording source bind group layout"),
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
        let source_pipeline_layout =
            device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("ffmpeg recording source pipeline layout"),
                bind_group_layouts: &[Some(&source_layout)],
                immediate_size: 0,
            });
        let source_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("ffmpeg recording source pipeline"),
            layout: Some(&source_pipeline_layout),
            vertex: wgpu::VertexState {
                module: &source_shader,
                entry_point: Some("vs_main"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            fragment: Some(wgpu::FragmentState {
                module: &source_shader,
                entry_point: Some("fs_main"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: AUTHORITATIVE_FORMAT,
                    blend: Some(wgpu::BlendState::REPLACE),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            multiview_mask: None,
            cache: None,
        });
        let source_uniforms = SourceUniforms {
            timing: [0.0, 0.0, TARGET_FPS as f32, 0.0],
            resolution: [FRAME_WIDTH as f32, FRAME_HEIGHT as f32, 0.0, 0.0],
        };
        let source_uniform_buffer =
            device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("ffmpeg recording source uniforms"),
                contents: bytemuck::bytes_of(&source_uniforms),
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            });
        let source_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("ffmpeg recording source bind group"),
            layout: &source_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: source_uniform_buffer.as_entire_binding(),
            }],
        });

        let recording = FfmpegRecordingSink::new(
            &device,
            &authoritative_view,
            DEFAULT_RECORD_WIDTH,
            DEFAULT_RECORD_HEIGHT,
            DEFAULT_RECORD_FPS,
            AUTHORITATIVE_FORMAT,
            recording_directory,
        );
        let ndi = NdiOutputSink::new(
            &device,
            NdiConfig {
                width: FRAME_WIDTH,
                height: FRAME_HEIGHT,
                fps_n: 60,
                fps_d: 1,
                ..NdiConfig::default()
            },
        );
        let platform_share = PlatformShareOutputSink::new(
            &device,
            PlatformShareConfig {
                width: FRAME_WIDTH,
                height: FRAME_HEIGHT,
                fps_n: 60,
                fps_d: 1,
                ..PlatformShareConfig::default()
            },
        );
        let preview = PreviewSink::new(
            &device,
            surface_config.format,
            &authoritative_view,
            recording.view(),
            width,
            height,
        );

        Ok(Self {
            window,
            instance,
            surface,
            device,
            queue,
            surface_config,
            adapter_info,
            source_pipeline,
            source_uniform_buffer,
            source_bind_group,
            source_uniforms,
            authoritative_texture,
            authoritative_view,
            source_descriptor: FrameDescriptor::rgba_srgb(
                FRAME_WIDTH,
                FRAME_HEIGHT,
                TARGET_FPS,
                1,
            ),
            recording,
            ndi,
            platform_share,
            preview,
            preview_enabled: true,
            width,
            height,
            minimized: false,
            started: Instant::now(),
            frame_count: 0,
            measured_fps: 0.0,
            frame_time_ms: 0.0,
            last_error: String::new(),
            max_texture_dimension_2d,
        })
    }

    fn renderer_info(&self) -> RendererInfo {
        RendererInfo {
            backend: format!("{:?}", self.adapter_info.backend),
            adapter_name: self.adapter_info.name.clone(),
            device_type: format!("{:?}", self.adapter_info.device_type),
            driver: self.adapter_info.driver.clone(),
            driver_info: self.adapter_info.driver_info.clone(),
            surface_format: format!("{:?}", self.surface_config.format),
            window_width: self.width,
            window_height: self.height,
            fps: self.measured_fps,
            frame_time_ms: self.frame_time_ms,
            frame_count: self.frame_count,
            target_fps: TARGET_FPS,
            max_texture_dimension_2d: self.max_texture_dimension_2d,
            running: true,
            preview_enabled: self.preview_enabled,
            last_error: self.last_error.clone(),
        }
    }

    fn snapshot(&self) -> RuntimeSnapshot {
        RuntimeSnapshot {
            renderer: self.renderer_info(),
            source_frame: self.source_descriptor.clone(),
            recording_frame: self.recording.descriptor(),
            preview: self.preview.status(),
            recording: self.recording.status(),
            ndi: self.ndi.status(),
            platform_share: self.platform_share.status(),
            ffmpeg: self.recording.ffmpeg_info(),
            contract_summary: format!(
                "One native {} × {} authoritative texture feeds preview, the bounded FFmpeg recorder, bounded NDI sender, and the active platform texture-sharing sink (Syphon on macOS or Spout on Windows). A failed or disabled sink does not stop the renderer or the other outputs.",
                self.source_descriptor.width,
                self.source_descriptor.height,
            ),
        }
    }

    fn prepare_profile(&mut self, width: u32, height: u32, fps: u32) -> Result<(), String> {
        if width > self.max_texture_dimension_2d || height > self.max_texture_dimension_2d {
            return Err(format!(
                "{} × {} exceeds this GPU's max 2D texture dimension of {}",
                width, height, self.max_texture_dimension_2d
            ));
        }
        self.recording.reconfigure(
            &self.device,
            width,
            height,
            fps,
            AUTHORITATIVE_FORMAT,
        )?;
        self.reconfigure_authoritative(width, height)?;
        self.recording
            .update_source_view(&self.device, &self.authoritative_view);
        self.preview.update_recording_view(
            &self.device,
            &self.authoritative_view,
            self.recording.view(),
        );
        Ok(())
    }

    fn configure_ndi(&mut self, config: NdiConfig) -> Result<(), String> {
        config.validate(self.max_texture_dimension_2d)?;
        if config.width != self.source_descriptor.width || config.height != self.source_descriptor.height {
            return Err(format!(
                "NDI route {} × {} must match the authoritative frame {} × {} in this router example",
                config.width,
                config.height,
                self.source_descriptor.width,
                self.source_descriptor.height,
            ));
        }
        self.ndi.reconfigure(&self.device, config)
    }

    fn start_ndi(&mut self) -> Result<(), String> {
        self.ndi.start()
    }

    fn stop_ndi(&mut self) -> Result<(), String> {
        self.ndi.stop();
        Ok(())
    }

    fn configure_platform_share(&mut self, config: PlatformShareConfig) -> Result<(), String> {
        config.validate(self.max_texture_dimension_2d)?;
        if config.width != self.source_descriptor.width || config.height != self.source_descriptor.height {
            return Err(format!(
                "platform-share route {} × {} must match the authoritative frame {} × {} in this router example",
                config.width,
                config.height,
                self.source_descriptor.width,
                self.source_descriptor.height,
            ));
        }
        self.platform_share.reconfigure(&self.device, config)
    }

    fn start_platform_share(&mut self) -> Result<(), String> {
        self.platform_share.start()
    }

    fn stop_platform_share(&mut self) -> Result<(), String> {
        self.platform_share.stop();
        Ok(())
    }

    fn start_recording(
        &mut self,
        profile: String,
        width: u32,
        height: u32,
        fps: u32,
        worker_delay_ms: u64,
    ) -> Result<String, String> {
        let profile = RecordingProfile::parse(&profile)?;
        self.prepare_profile(width, height, fps)?;
        self.recording.start(profile, worker_delay_ms)
    }

    fn reconfigure_authoritative(&mut self, width: u32, height: u32) -> Result<(), String> {
        if width < 16 || height < 16 {
            return Err("render dimensions must be at least 16 × 16".into());
        }
        let (texture, view) = create_authoritative_target(&self.device, width, height);
        self.authoritative_texture = texture;
        self.authoritative_view = view;
        self.source_descriptor = FrameDescriptor::rgba_srgb(width, height, TARGET_FPS, 1);
        self.source_uniforms.resolution = [width as f32, height as f32, 0.0, 0.0];
        self.queue.write_buffer(
            &self.source_uniform_buffer,
            0,
            bytemuck::bytes_of(&self.source_uniforms),
        );
        Ok(())
    }

    fn render(&mut self) -> Result<(), String> {
        self.source_uniforms.timing[0] = self.started.elapsed().as_secs_f32();
        self.source_uniforms.timing[1] = self.frame_count as f32;
        self.queue.write_buffer(
            &self.source_uniform_buffer,
            0,
            bytemuck::bytes_of(&self.source_uniforms),
        );

        let mut surface_frame = None;
        let mut reconfigure_surface = false;
        if self.preview_enabled && !self.minimized {
            match self.surface.get_current_texture() {
                wgpu::CurrentSurfaceTexture::Success(frame) => surface_frame = Some(frame),
                wgpu::CurrentSurfaceTexture::Suboptimal(frame) => {
                    surface_frame = Some(frame);
                    reconfigure_surface = true;
                }
                wgpu::CurrentSurfaceTexture::Timeout | wgpu::CurrentSurfaceTexture::Occluded => {}
                wgpu::CurrentSurfaceTexture::Outdated => {
                    self.surface.configure(&self.device, &self.surface_config);
                }
                wgpu::CurrentSurfaceTexture::Lost => {
                    self.recreate_surface()?;
                }
                wgpu::CurrentSurfaceTexture::Validation => {
                    return Err("surface validation error".into());
                }
            }
        }
        let surface_view = surface_frame
            .as_ref()
            .map(|frame| frame.texture.create_view(&wgpu::TextureViewDescriptor::default()));

        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("runtime output router frame encoder"),
            });

        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("runtime router authoritative source pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &self.authoritative_view,
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
            pass.set_bind_group(0, &self.source_bind_group, &[]);
            pass.draw(0..3, 0..1);
        }

        let video_frame = VideoFrame {
            texture: &self.authoritative_texture,
            view: &self.authoritative_view,
            descriptor: &self.source_descriptor,
            frame_index: self.frame_count,
            timestamp_ns: self.started.elapsed().as_nanos().min(u128::from(u64::MAX)) as u64,
        };
        self.ndi.submit(&video_frame, &mut encoder);
        self.platform_share.submit(&video_frame, &mut encoder);
        {
            let mut context = SinkContext {
                frame: &video_frame,
                encoder: &mut encoder,
                preview_target: None,
            };
            let _ = self.recording.submit(&mut context);
        }
        if let Some(surface_view) = surface_view.as_ref() {
            let mut context = SinkContext {
                frame: &video_frame,
                encoder: &mut encoder,
                preview_target: Some(surface_view),
            };
            let _ = self.preview.submit(&mut context);
        }

        self.queue.submit([encoder.finish()]);
        if let Some(frame) = surface_frame {
            frame.present();
        }
        if reconfigure_surface {
            self.surface.configure(&self.device, &self.surface_config);
        }
        Ok(())
    }

    fn run(
        &mut self,
        rx: Receiver<RenderCommand>,
        shared: Arc<RwLock<RuntimeSnapshot>>,
        alive: Arc<AtomicBool>,
    ) {
        let mut metrics_started = Instant::now();
        let mut metrics_frames = 0u64;

        while alive.load(Ordering::Relaxed) {
            let frame_started = Instant::now();
            self.recording.poll_completed(&self.device);
            self.ndi.poll_completed(&self.device);
            self.platform_share.poll_completed(&self.device);
            loop {
                match rx.try_recv() {
                    Ok(RenderCommand::Resize(width, height)) => self.resize(width, height),
                    Ok(RenderCommand::PrepareProfile {
                        width,
                        height,
                        fps,
                        reply,
                    }) => {
                        let _ = reply.send(self.prepare_profile(width, height, fps));
                    }
                    Ok(RenderCommand::StartRecording {
                        profile,
                        width,
                        height,
                        fps,
                        worker_delay_ms,
                        reply,
                    }) => {
                        let result = self.start_recording(
                            profile,
                            width,
                            height,
                            fps,
                            worker_delay_ms,
                        );
                        let _ = reply.send(result);
                    }
                    Ok(RenderCommand::StopRecording { reply }) => {
                        let _ = reply.send(self.recording.stop());
                    }
                    Ok(RenderCommand::SetOutputDirectory { path, reply }) => {
                        let _ = reply.send(self.recording.set_output_directory(path));
                    }
                    Ok(RenderCommand::ConfigureNdi { config, reply }) => {
                        let _ = reply.send(self.configure_ndi(config));
                    }
                    Ok(RenderCommand::StartNdi { reply }) => {
                        let _ = reply.send(self.start_ndi());
                    }
                    Ok(RenderCommand::StopNdi { reply }) => {
                        let _ = reply.send(self.stop_ndi());
                    }
                    Ok(RenderCommand::ConfigurePlatformShare { config, reply }) => {
                        let _ = reply.send(self.configure_platform_share(config));
                    }
                    Ok(RenderCommand::StartPlatformShare { reply }) => {
                        let _ = reply.send(self.start_platform_share());
                    }
                    Ok(RenderCommand::StopPlatformShare { reply }) => {
                        let _ = reply.send(self.stop_platform_share());
                    }
                    Ok(RenderCommand::ResetMetrics) => {
                        self.ndi.reset_metrics();
                        self.platform_share.reset_metrics();
                    }
                    Ok(RenderCommand::SetPreviewEnabled { enabled, reply }) => {
                        self.preview_enabled = enabled;
                        let _ = reply.send(Ok(()));
                    }
                    Ok(RenderCommand::Shutdown) | Err(TryRecvError::Disconnected) => {
                        self.recording.force_close();
                        self.ndi.stop();
                        self.platform_share.stop();
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
            } else {
                self.last_error.clear();
            }

            self.frame_count += 1;
            metrics_frames += 1;
            self.frame_time_ms = frame_started.elapsed().as_secs_f64() * 1000.0;
            let elapsed = metrics_started.elapsed();
            if elapsed >= Duration::from_millis(300) {
                self.measured_fps = metrics_frames as f64 / elapsed.as_secs_f64();
                if let Ok(mut snapshot) = shared.write() {
                    *snapshot = self.snapshot();
                }
                metrics_frames = 0;
                metrics_started = Instant::now();
            }

            let frame_budget = Duration::from_secs_f64(1.0 / TARGET_FPS as f64);
            let remaining = frame_budget.saturating_sub(frame_started.elapsed());
            if !remaining.is_zero() {
                thread::sleep(remaining);
            }
        }

        if let Ok(mut snapshot) = shared.write() {
            snapshot.renderer.running = false;
        }
    }

    fn resize(&mut self, width: u32, height: u32) {
        self.width = width;
        self.height = height;
        self.minimized = width == 0 || height == 0;
        if !self.minimized {
            self.surface_config.width = width;
            self.surface_config.height = height;
            self.surface.configure(&self.device, &self.surface_config);
            self.preview.resize(width, height);
        }
    }

    fn recreate_surface(&mut self) -> Result<(), String> {
        self.surface = self
            .instance
            .create_surface(self.window.clone())
            .map_err(|error| format!("could not recreate GPU surface: {error}"))?;
        self.surface.configure(&self.device, &self.surface_config);
        Ok(())
    }
}


fn create_authoritative_target(
    device: &wgpu::Device,
    width: u32,
    height: u32,
) -> (wgpu::Texture, wgpu::TextureView) {
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("I/O profile authoritative source texture"),
        size: wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: AUTHORITATIVE_FORMAT,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT
            | wgpu::TextureUsages::TEXTURE_BINDING
            | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    (texture, view)
}
