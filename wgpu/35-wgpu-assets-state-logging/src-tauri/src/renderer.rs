use crate::{
    assets::RuntimeBundle,
    config::{ParamDefinition, PreviewScaleMode},
    frame::FrameDescriptor,
    preview::{PreviewSink, PreviewStatus},
    runtime::PersistedRuntimeState,
};
use bytemuck::{Pod, Zeroable};
use serde::Serialize;
use std::{
    collections::BTreeMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{sync_channel, Receiver, SyncSender, TryRecvError, TrySendError},
        Arc, RwLock,
    },
    thread,
    time::{Duration, Instant},
};
use wgpu::util::DeviceExt;

const RENDER_TARGET_FPS: u32 = 60;
const SOURCE_WIDTH: u32 = 1280;
const SOURCE_HEIGHT: u32 = 720;
const AUTHORITATIVE_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8UnormSrgb;

type Reply<T> = SyncSender<Result<T, String>>;

pub enum RenderCommand {
    Resize(u32, u32),
    ApplyBundle {
        bundle: RuntimeBundle,
        reason: String,
        reply: Reply<()>,
    },
    ReportReloadFailure {
        reason: String,
        error: String,
    },
    CycleShader {
        direction: i32,
        reply: Reply<()>,
    },
    CycleProfile {
        direction: i32,
        reply: Reply<()>,
    },
    SetParameter {
        name: String,
        value: f32,
        reply: Reply<()>,
    },
    RestoreRuntimeState {
        state: PersistedRuntimeState,
        reply: Reply<()>,
    },
    ResetMetrics,
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
    pub running: bool,
    pub last_error: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParameterStatus {
    pub name: String,
    pub current: f32,
    pub target: f32,
    pub default: f32,
    pub min: f32,
    pub max: f32,
    pub smoothing: f32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShaderRuntimeStatus {
    pub active_shader: String,
    pub active_profile: String,
    pub shader_variants: Vec<String>,
    pub profile_names: Vec<String>,
    pub pipeline_generation: u64,
    pub successful_reloads: u64,
    pub failed_reloads: u64,
    pub last_reload_reason: String,
    pub last_reload_error: String,
    pub last_reload_seconds: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSnapshot {
    pub renderer: RendererInfo,
    pub frame: FrameDescriptor,
    pub preview: PreviewStatus,
    pub shader: ShaderRuntimeStatus,
    pub parameters: Vec<ParameterStatus>,
    pub render_config: crate::config::RenderConfig,
    pub params_config: crate::config::ParamsConfig,
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

    fn request(&self, command: impl FnOnce(Reply<()>) -> RenderCommand) -> Result<(), String> {
        let (reply, response) = sync_channel(1);
        self.send(command(reply))?;
        response
            .recv_timeout(Duration::from_secs(8))
            .map_err(|_| "renderer did not answer the request".to_string())?
    }

    pub fn apply_bundle(&self, bundle: RuntimeBundle, reason: impl Into<String>) -> Result<(), String> {
        let reason = reason.into();
        self.request(|reply| RenderCommand::ApplyBundle {
            bundle,
            reason,
            reply,
        })
    }

    pub fn report_reload_failure(&self, reason: impl Into<String>, error: impl Into<String>) {
        let _ = self.send(RenderCommand::ReportReloadFailure {
            reason: reason.into(),
            error: error.into(),
        });
    }

    pub fn cycle_shader(&self, direction: i32) -> Result<(), String> {
        self.request(|reply| RenderCommand::CycleShader { direction, reply })
    }

    pub fn cycle_profile(&self, direction: i32) -> Result<(), String> {
        self.request(|reply| RenderCommand::CycleProfile { direction, reply })
    }

    pub fn set_parameter(&self, name: String, value: f32) -> Result<(), String> {
        self.request(|reply| RenderCommand::SetParameter { name, value, reply })
    }

    pub fn restore_runtime_state(&self, state: PersistedRuntimeState) -> Result<(), String> {
        self.request(|reply| RenderCommand::RestoreRuntimeState { state, reply })
    }
}

pub fn start(window: tauri::Window, bundle: RuntimeBundle) -> Result<RendererHandle, String> {
    let (tx, rx) = sync_channel(128);
    let alive = Arc::new(AtomicBool::new(true));
    let mut renderer = pollster::block_on(Renderer::new(window, bundle))?;
    let snapshot = Arc::new(RwLock::new(renderer.snapshot()));
    let thread_snapshot = Arc::clone(&snapshot);
    let thread_alive = Arc::clone(&alive);

    thread::Builder::new()
        .name("junkpile-wgpu-assets-state-logging".into())
        .spawn(move || renderer.run(rx, thread_snapshot, thread_alive))
        .map_err(|error| format!("could not start renderer thread: {error}"))?;

    Ok(RendererHandle { tx, snapshot })
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct SourceUniforms {
    timing: [f32; 4],
    resolution: [f32; 4],
    params: [f32; 4],
}

#[derive(Clone)]
struct ParameterRuntime {
    definition: ParamDefinition,
    current: f32,
    target: f32,
}

struct Renderer {
    window: tauri::Window,
    instance: wgpu::Instance,
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    surface_config: wgpu::SurfaceConfiguration,
    adapter_info: wgpu::AdapterInfo,
    source_pipeline_layout: wgpu::PipelineLayout,
    source_pipeline: wgpu::RenderPipeline,
    source_uniform_buffer: wgpu::Buffer,
    source_bind_group: wgpu::BindGroup,
    source_uniforms: SourceUniforms,
    _authoritative_texture: wgpu::Texture,
    authoritative_view: wgpu::TextureView,
    frame_descriptor: FrameDescriptor,
    preview: PreviewSink,
    bundle: RuntimeBundle,
    parameters: BTreeMap<String, ParameterRuntime>,
    active_shader: String,
    active_profile: String,
    width: u32,
    height: u32,
    minimized: bool,
    started: Instant,
    frame_count: u64,
    measured_fps: f64,
    frame_time_ms: f64,
    last_error: String,
    pipeline_generation: u64,
    successful_reloads: u64,
    failed_reloads: u64,
    last_reload_reason: String,
    last_reload_error: String,
    last_reload_seconds: f64,
}

impl Renderer {
    async fn new(window: tauri::Window, bundle: RuntimeBundle) -> Result<Self, String> {
        bundle.render.validate()?;
        bundle.params.validate(&bundle.render)?;
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
                label: Some("junkpile shader hot reload device"),
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

        let (authoritative_texture, authoritative_view) =
            create_authoritative_target(&device, SOURCE_WIDTH, SOURCE_HEIGHT);
        let source_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("shader hot reload source bind group layout"),
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
        let source_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("shader hot reload source pipeline layout"),
            bind_group_layouts: &[Some(&source_layout)],
            immediate_size: 0,
        });
        let active_shader = bundle.render.active_frag.clone();
        let active_source = bundle
            .shader_sources
            .get(&active_shader)
            .ok_or_else(|| format!("active shader source is missing: {active_shader}"))?;
        let source_pipeline = build_source_pipeline(
            &device,
            &source_pipeline_layout,
            active_source,
            &active_shader,
        )?;

        let parameters = build_parameter_runtime(&bundle, &active_shader, None)?;
        let active_profile = active_profile_name(&bundle, &active_shader)?;
        let source_uniforms = SourceUniforms {
            timing: [0.0; 4],
            resolution: [SOURCE_WIDTH as f32, SOURCE_HEIGHT as f32, 0.0, 0.0],
            params: parameter_vector(&parameters),
        };
        let source_uniform_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("shader hot reload source uniforms"),
            contents: bytemuck::bytes_of(&source_uniforms),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });
        let source_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("shader hot reload source bind group"),
            layout: &source_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: source_uniform_buffer.as_entire_binding(),
            }],
        });
        let preview = PreviewSink::new(
            &device,
            surface_config.format,
            &authoritative_view,
            width,
            height,
            SOURCE_WIDTH,
            SOURCE_HEIGHT,
            PreviewScaleMode::Fit,
            true,
        );

        let now = Instant::now();
        Ok(Self {
            window,
            instance,
            surface,
            device,
            queue,
            surface_config,
            adapter_info,
            source_pipeline_layout,
            source_pipeline,
            source_uniform_buffer,
            source_bind_group,
            source_uniforms,
            _authoritative_texture: authoritative_texture,
            authoritative_view,
            frame_descriptor: FrameDescriptor::rgba_srgb(
                SOURCE_WIDTH,
                SOURCE_HEIGHT,
                RENDER_TARGET_FPS,
            ),
            preview,
            bundle,
            parameters,
            active_shader,
            active_profile,
            width,
            height,
            minimized: false,
            started: now,
            frame_count: 0,
            measured_fps: 0.0,
            frame_time_ms: 0.0,
            last_error: String::new(),
            pipeline_generation: 1,
            successful_reloads: 0,
            failed_reloads: 0,
            last_reload_reason: "initial assets".into(),
            last_reload_error: String::new(),
            last_reload_seconds: 0.0,
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
            target_fps: RENDER_TARGET_FPS,
            running: true,
            last_error: self.last_error.clone(),
        }
    }

    fn snapshot(&self) -> RuntimeSnapshot {
        let profile_names = self
            .bundle
            .params
            .shader_profiles
            .get(&self.active_shader)
            .map(|profiles| profiles.keys().cloned().collect())
            .unwrap_or_default();
        RuntimeSnapshot {
            renderer: self.renderer_info(),
            frame: self.frame_descriptor.clone(),
            preview: self.preview.status(),
            shader: ShaderRuntimeStatus {
                active_shader: self.active_shader.clone(),
                active_profile: self.active_profile.clone(),
                shader_variants: self.bundle.render.frag_variants.clone(),
                profile_names,
                pipeline_generation: self.pipeline_generation,
                successful_reloads: self.successful_reloads,
                failed_reloads: self.failed_reloads,
                last_reload_reason: self.last_reload_reason.clone(),
                last_reload_error: self.last_reload_error.clone(),
                last_reload_seconds: self.last_reload_seconds,
            },
            parameters: self
                .bundle
                .params
                .params
                .iter()
                .filter_map(|definition| self.parameters.get(&definition.name))
                .map(|runtime| ParameterStatus {
                    name: runtime.definition.name.clone(),
                    current: runtime.current,
                    target: runtime.target,
                    default: runtime.definition.default,
                    min: runtime.definition.min,
                    max: runtime.definition.max,
                    smoothing: runtime.definition.smoothing,
                })
                .collect(),
            render_config: self.bundle.render.clone(),
            params_config: self.bundle.params.clone(),
            contract_summary: "render.json provides the shader catalog and startup selection; runtime selection stays active across file saves. params.json defines ranges, targets, smoothing, per-shader profiles, and hotkeys. Spin is angular velocity in radians per second. Candidate assets replace the last-known-good pipeline only after validation.".into(),
        }
    }

    fn apply_bundle(&mut self, bundle: RuntimeBundle, reason: String) -> Result<(), String> {
        // Runtime selection is authoritative after launch. Saving a WGSL or JSON file must
        // never jump to render.json's startup shader or silently reset the active profile.
        // We only fall back to the configured startup shader/profile when the currently
        // selected item was actually removed from the reloaded asset set.
        let active_shader = if bundle.render.frag_variants.contains(&self.active_shader) {
            self.active_shader.clone()
        } else {
            bundle.render.active_frag.clone()
        };
        let source = bundle
            .shader_sources
            .get(&active_shader)
            .ok_or_else(|| format!("active shader source is missing: {active_shader}"))?;
        let pipeline = build_source_pipeline(
            &self.device,
            &self.source_pipeline_layout,
            source,
            &active_shader,
        )?;

        let configured_profiles = bundle
            .params
            .shader_profiles
            .get(&active_shader)
            .ok_or_else(|| format!("no profiles exist for {active_shader}"))?;
        let active_profile = if active_shader == self.active_shader
            && configured_profiles.contains_key(&self.active_profile)
        {
            self.active_profile.clone()
        } else {
            active_profile_name(&bundle, &active_shader)?
        };

        let mut parameters = build_parameter_runtime_preserving_values(
            &bundle,
            Some(&self.parameters),
        );
        if active_shader != self.active_shader || active_profile != self.active_profile {
            apply_profile_targets(
                &bundle,
                &active_shader,
                &active_profile,
                &mut parameters,
            )?;
        }

        self.source_pipeline = pipeline;
        self.bundle = bundle;
        self.parameters = parameters;
        self.active_shader = active_shader;
        self.active_profile = active_profile;
        self.pipeline_generation = self.pipeline_generation.saturating_add(1);
        self.successful_reloads = self.successful_reloads.saturating_add(1);
        self.last_reload_reason = reason;
        self.last_reload_error.clear();
        self.last_reload_seconds = self.started.elapsed().as_secs_f64();
        self.last_error.clear();
        Ok(())
    }

    fn mark_reload_failure(&mut self, reason: String, error: String) {
        self.failed_reloads = self.failed_reloads.saturating_add(1);
        self.last_reload_reason = reason;
        self.last_reload_error = error.clone();
        self.last_reload_seconds = self.started.elapsed().as_secs_f64();
        self.last_error = "reload rejected; last-known-good shader remains active".into();
    }

    fn cycle_shader(&mut self, direction: i32) -> Result<(), String> {
        let variants = &self.bundle.render.frag_variants;
        if variants.is_empty() {
            return Err("no shader variants are configured".into());
        }
        let current = variants
            .iter()
            .position(|shader| shader == &self.active_shader)
            .unwrap_or(0);
        let next = wrapped_index(current, direction, variants.len());
        let shader = variants[next].clone();
        self.activate_shader(shader, "shader hotkey / control")
    }

    fn activate_shader(&mut self, shader: String, reason: &str) -> Result<(), String> {
        let source = self
            .bundle
            .shader_sources
            .get(&shader)
            .ok_or_else(|| format!("shader source is missing: {shader}"))?;
        let pipeline = build_source_pipeline(
            &self.device,
            &self.source_pipeline_layout,
            source,
            &shader,
        )?;
        self.source_pipeline = pipeline;
        self.active_shader = shader.clone();
        self.active_profile = active_profile_name(&self.bundle, &shader)?;
        apply_profile_targets(
            &self.bundle,
            &shader,
            &self.active_profile,
            &mut self.parameters,
        )?;
        self.pipeline_generation = self.pipeline_generation.saturating_add(1);
        self.successful_reloads = self.successful_reloads.saturating_add(1);
        self.last_reload_reason = reason.into();
        self.last_reload_error.clear();
        self.last_reload_seconds = self.started.elapsed().as_secs_f64();
        Ok(())
    }

    fn cycle_profile(&mut self, direction: i32) -> Result<(), String> {
        let profiles = self
            .bundle
            .params
            .shader_profiles
            .get(&self.active_shader)
            .ok_or_else(|| format!("no profiles exist for {}", self.active_shader))?;
        let names: Vec<String> = profiles.keys().cloned().collect();
        if names.is_empty() {
            return Err("active shader has no profiles".into());
        }
        let current = names
            .iter()
            .position(|name| name == &self.active_profile)
            .unwrap_or(0);
        let next = wrapped_index(current, direction, names.len());
        self.active_profile = names[next].clone();
        apply_profile_targets(
            &self.bundle,
            &self.active_shader,
            &self.active_profile,
            &mut self.parameters,
        )?;
        self.last_reload_reason = "profile hotkey / control".into();
        self.last_reload_error.clear();
        self.last_reload_seconds = self.started.elapsed().as_secs_f64();
        Ok(())
    }

    fn set_parameter(&mut self, name: &str, value: f32) -> Result<(), String> {
        let runtime = self
            .parameters
            .get_mut(name)
            .ok_or_else(|| format!("unknown parameter '{name}'"))?;
        if !value.is_finite() {
            return Err(format!("parameter '{name}' value must be finite"));
        }
        runtime.target = value.clamp(runtime.definition.min, runtime.definition.max);
        Ok(())
    }

    fn restore_runtime_state(&mut self, state: PersistedRuntimeState) -> Result<(), String> {
        if !self.bundle.render.frag_variants.contains(&state.active_shader) {
            return Err(format!(
                "persisted shader '{}' is not available in the active asset root",
                state.active_shader
            ));
        }
        let profiles = self
            .bundle
            .params
            .shader_profiles
            .get(&state.active_shader)
            .ok_or_else(|| format!("no profiles exist for {}", state.active_shader))?;
        if !profiles.contains_key(&state.active_profile) {
            return Err(format!(
                "persisted profile '{}' is not available for {}",
                state.active_profile, state.active_shader
            ));
        }
        for (name, value) in &state.parameter_targets {
            let runtime = self
                .parameters
                .get(name)
                .ok_or_else(|| format!("persisted state references unknown parameter '{name}'"))?;
            if !value.is_finite()
                || *value < runtime.definition.min
                || *value > runtime.definition.max
            {
                return Err(format!(
                    "persisted value {value} for '{name}' is outside {}..{}",
                    runtime.definition.min, runtime.definition.max
                ));
            }
        }

        self.activate_shader(state.active_shader.clone(), "persisted runtime state restore")?;
        self.active_profile = state.active_profile.clone();
        apply_profile_targets(
            &self.bundle,
            &self.active_shader,
            &self.active_profile,
            &mut self.parameters,
        )?;
        for (name, value) in state.parameter_targets {
            self.set_parameter(&name, value)?;
        }
        self.last_reload_reason = "persisted runtime state restore".into();
        self.last_reload_error.clear();
        self.last_reload_seconds = self.started.elapsed().as_secs_f64();
        Ok(())
    }

    fn update_parameters(&mut self) {
        for runtime in self.parameters.values_mut() {
            let alpha = (1.0 - runtime.definition.smoothing).clamp(0.001, 1.0);
            runtime.current += (runtime.target - runtime.current) * alpha;
            if (runtime.target - runtime.current).abs() < 0.000_01 {
                runtime.current = runtime.target;
            }
        }
        self.source_uniforms.params = parameter_vector(&self.parameters);
    }

    fn render(&mut self) -> Result<(), String> {
        self.update_parameters();
        self.source_uniforms.timing[0] = self.started.elapsed().as_secs_f32();
        self.source_uniforms.timing[1] = self.frame_count as f32;
        self.queue.write_buffer(
            &self.source_uniform_buffer,
            0,
            bytemuck::bytes_of(&self.source_uniforms),
        );

        let surface_output = if self.minimized {
            self.preview.mark_unavailable();
            None
        } else {
            match self.surface.get_current_texture() {
                wgpu::CurrentSurfaceTexture::Success(frame) => Some((frame, false)),
                wgpu::CurrentSurfaceTexture::Suboptimal(frame) => Some((frame, true)),
                wgpu::CurrentSurfaceTexture::Timeout | wgpu::CurrentSurfaceTexture::Occluded => {
                    self.preview.mark_unavailable();
                    None
                }
                wgpu::CurrentSurfaceTexture::Outdated => {
                    self.surface.configure(&self.device, &self.surface_config);
                    self.preview.mark_unavailable();
                    None
                }
                wgpu::CurrentSurfaceTexture::Lost => {
                    self.recreate_surface()?;
                    self.preview.mark_unavailable();
                    None
                }
                wgpu::CurrentSurfaceTexture::Validation => {
                    self.preview.mark_unavailable();
                    return Err("preview surface validation error".into());
                }
            }
        };

        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("assets state logging frame encoder"),
        });
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("assets state logging authoritative render pass"),
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

        if let Some((surface_frame, reconfigure)) = surface_output {
            let surface_view = surface_frame
                .texture
                .create_view(&wgpu::TextureViewDescriptor::default());
            self.preview
                .submit(&self.queue, &mut encoder, &surface_view, self.frame_count);
            self.queue.submit([encoder.finish()]);
            surface_frame.present();
            if reconfigure {
                self.surface.configure(&self.device, &self.surface_config);
            }
        } else {
            self.queue.submit([encoder.finish()]);
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
            loop {
                match rx.try_recv() {
                    Ok(RenderCommand::Resize(width, height)) => self.resize(width, height),
                    Ok(RenderCommand::ApplyBundle {
                        bundle,
                        reason,
                        reply,
                    }) => {
                        let result = self.apply_bundle(bundle, reason.clone());
                        if let Err(error) = &result {
                            self.mark_reload_failure(reason, error.clone());
                        }
                        let _ = reply.send(result);
                    }
                    Ok(RenderCommand::ReportReloadFailure { reason, error }) => {
                        self.mark_reload_failure(reason, error);
                    }
                    Ok(RenderCommand::CycleShader { direction, reply }) => {
                        let result = self.cycle_shader(direction);
                        if let Err(error) = &result {
                            self.mark_reload_failure("shader selection".into(), error.clone());
                        }
                        let _ = reply.send(result);
                    }
                    Ok(RenderCommand::CycleProfile { direction, reply }) => {
                        let _ = reply.send(self.cycle_profile(direction));
                    }
                    Ok(RenderCommand::SetParameter { name, value, reply }) => {
                        let _ = reply.send(self.set_parameter(&name, value));
                    }
                    Ok(RenderCommand::RestoreRuntimeState { state, reply }) => {
                        let _ = reply.send(self.restore_runtime_state(state));
                    }
                    Ok(RenderCommand::ResetMetrics) => {
                        self.preview.reset_metrics();
                        self.successful_reloads = 0;
                        self.failed_reloads = 0;
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
            } else if self.last_reload_error.is_empty() {
                self.last_error.clear();
            }

            self.frame_count = self.frame_count.saturating_add(1);
            metrics_frames = metrics_frames.saturating_add(1);
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

            let frame_budget = Duration::from_secs_f64(1.0 / RENDER_TARGET_FPS as f64);
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

fn build_source_pipeline(
    device: &wgpu::Device,
    layout: &wgpu::PipelineLayout,
    source: &str,
    label: &str,
) -> Result<wgpu::RenderPipeline, String> {
    let scope = device.push_error_scope(wgpu::ErrorFilter::Validation);
    let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some(label),
        source: wgpu::ShaderSource::Wgsl(source.into()),
    });
    let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("hot-reloadable source pipeline"),
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
    if let Some(error) = pollster::block_on(scope.pop()) {
        return Err(format!("wgpu rejected shader '{label}': {error}"));
    }
    Ok(pipeline)
}

fn build_parameter_runtime(
    bundle: &RuntimeBundle,
    shader: &str,
    previous: Option<&BTreeMap<String, ParameterRuntime>>,
) -> Result<BTreeMap<String, ParameterRuntime>, String> {
    let mut runtime = build_parameter_runtime_preserving_values(bundle, previous);
    let profile = active_profile_name(bundle, shader)?;
    apply_profile_targets(bundle, shader, &profile, &mut runtime)?;
    Ok(runtime)
}

fn build_parameter_runtime_preserving_values(
    bundle: &RuntimeBundle,
    previous: Option<&BTreeMap<String, ParameterRuntime>>,
) -> BTreeMap<String, ParameterRuntime> {
    let mut runtime = BTreeMap::new();
    for definition in &bundle.params.params {
        let prior = previous.and_then(|values| values.get(&definition.name));
        let current = prior
            .map(|value| value.current.clamp(definition.min, definition.max))
            .unwrap_or(definition.default);
        let target = prior
            .map(|value| value.target.clamp(definition.min, definition.max))
            .unwrap_or(definition.default);
        runtime.insert(
            definition.name.clone(),
            ParameterRuntime {
                definition: definition.clone(),
                current,
                target,
            },
        );
    }
    runtime
}

fn active_profile_name(bundle: &RuntimeBundle, shader: &str) -> Result<String, String> {
    bundle
        .params
        .active_shader_profiles
        .get(shader)
        .cloned()
        .ok_or_else(|| format!("active profile is missing for '{shader}'"))
}

fn apply_profile_targets(
    bundle: &RuntimeBundle,
    shader: &str,
    profile: &str,
    runtime: &mut BTreeMap<String, ParameterRuntime>,
) -> Result<(), String> {
    let profile = bundle
        .params
        .shader_profiles
        .get(shader)
        .and_then(|profiles| profiles.get(profile))
        .ok_or_else(|| format!("profile '{profile}' is missing for '{shader}'"))?;
    for (name, value) in &profile.uniforms {
        let parameter = runtime
            .get_mut(name)
            .ok_or_else(|| format!("profile references unknown parameter '{name}'"))?;
        parameter.target = value.clamp(parameter.definition.min, parameter.definition.max);
    }
    Ok(())
}

fn parameter_vector(parameters: &BTreeMap<String, ParameterRuntime>) -> [f32; 4] {
    [
        parameters.get("u_gain").map(|value| value.current).unwrap_or(0.5),
        parameters.get("u_zoom").map(|value| value.current).unwrap_or(1.0),
        parameters.get("u_spin").map(|value| value.current).unwrap_or(0.0),
        parameters
            .get("u_complexity")
            .map(|value| value.current)
            .unwrap_or(6.0),
    ]
}

fn wrapped_index(current: usize, direction: i32, length: usize) -> usize {
    if length == 0 {
        return 0;
    }
    (current as i32 + direction).rem_euclid(length as i32) as usize
}

fn create_authoritative_target(
    device: &wgpu::Device,
    width: u32,
    height: u32,
) -> (wgpu::Texture, wgpu::TextureView) {
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("shader parameter authoritative texture"),
        size: wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: AUTHORITATIVE_FORMAT,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    (texture, view)
}
