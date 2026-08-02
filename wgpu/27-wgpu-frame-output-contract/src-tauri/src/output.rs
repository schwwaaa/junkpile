use crate::frame::VideoFrame;
use serde::Serialize;
use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc::{sync_channel, SyncSender, TrySendError},
        Arc,
    },
    thread,
    time::Duration,
};

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SinkState {
    Running,
    Disabled,
    Backpressured,
    Error,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SubmitResult {
    Submitted,
    Skipped,
    Dropped,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SinkStatus {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub accepts: String,
    pub enabled: bool,
    pub state: SinkState,
    pub width: u32,
    pub height: u32,
    pub submitted: u64,
    pub processed: u64,
    pub dropped: u64,
    pub pending: u64,
    pub last_frame: u64,
    pub last_error: String,
}

pub struct SinkContext<'a> {
    pub frame: &'a VideoFrame<'a>,
    pub encoder: &'a mut wgpu::CommandEncoder,
    pub preview_target: Option<&'a wgpu::TextureView>,
}

pub trait FrameSink: Send {
    fn id(&self) -> &str;
    fn set_enabled(&mut self, enabled: bool);
    fn set_worker_delay_ms(&mut self, _delay_ms: u64) {}
    fn resize(&mut self, _width: u32, _height: u32) {}
    fn reset_metrics(&mut self);
    fn submit(&mut self, context: &mut SinkContext<'_>) -> SubmitResult;
    fn status(&self) -> SinkStatus;
}

pub struct GpuMirrorSink {
    id: String,
    name: String,
    texture: wgpu::Texture,
    view: wgpu::TextureView,
    width: u32,
    height: u32,
    enabled: bool,
    state: SinkState,
    submitted: u64,
    last_frame: u64,
    last_error: String,
}

impl GpuMirrorSink {
    pub fn new(
        device: &wgpu::Device,
        id: &str,
        name: &str,
        width: u32,
        height: u32,
        format: wgpu::TextureFormat,
    ) -> Self {
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some(name),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::COPY_DST
                | wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        Self {
            id: id.into(),
            name: name.into(),
            texture,
            view,
            width,
            height,
            enabled: true,
            state: SinkState::Running,
            submitted: 0,
            last_frame: 0,
            last_error: String::new(),
        }
    }

    pub fn view(&self) -> &wgpu::TextureView {
        &self.view
    }
}

impl FrameSink for GpuMirrorSink {
    fn id(&self) -> &str {
        &self.id
    }

    fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
        self.state = if enabled {
            SinkState::Running
        } else {
            SinkState::Disabled
        };
    }

    fn reset_metrics(&mut self) {
        self.submitted = 0;
        self.last_frame = 0;
        self.last_error.clear();
    }

    fn submit(&mut self, context: &mut SinkContext<'_>) -> SubmitResult {
        if !self.enabled {
            self.state = SinkState::Disabled;
            return SubmitResult::Skipped;
        }
        if context.frame.descriptor.width != self.width
            || context.frame.descriptor.height != self.height
        {
            self.state = SinkState::Error;
            self.last_error = "GPU mirror dimensions do not match the source frame".into();
            return SubmitResult::Failed;
        }

        context.encoder.copy_texture_to_texture(
            wgpu::TexelCopyTextureInfo {
                texture: context.frame.texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyTextureInfo {
                texture: &self.texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::Extent3d {
                width: self.width,
                height: self.height,
                depth_or_array_layers: 1,
            },
        );
        self.submitted += 1;
        self.last_frame = context.frame.frame_index;
        self.state = SinkState::Running;
        self.last_error.clear();
        SubmitResult::Submitted
    }

    fn status(&self) -> SinkStatus {
        SinkStatus {
            id: self.id.clone(),
            name: self.name.clone(),
            kind: "GPU texture mirror".into(),
            accepts: "GPU texture".into(),
            enabled: self.enabled,
            state: self.state,
            width: self.width,
            height: self.height,
            submitted: self.submitted,
            processed: self.submitted,
            dropped: 0,
            pending: 0,
            last_frame: self.last_frame,
            last_error: self.last_error.clone(),
        }
    }
}

pub struct PreviewSink {
    id: String,
    name: String,
    pipeline: wgpu::RenderPipeline,
    bind_group: wgpu::BindGroup,
    width: u32,
    height: u32,
    enabled: bool,
    state: SinkState,
    submitted: u64,
    last_frame: u64,
    last_error: String,
}

impl PreviewSink {
    pub fn new(
        device: &wgpu::Device,
        surface_format: wgpu::TextureFormat,
        source_view: &wgpu::TextureView,
        recording_view: &wgpu::TextureView,
        streaming_view: &wgpu::TextureView,
        width: u32,
        height: u32,
    ) -> Self {
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("frame contract preview shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("preview.wgsl").into()),
        });
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("frame contract preview sampler"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("frame contract preview bind group layout"),
            entries: &[
                texture_entry(0),
                texture_entry(1),
                texture_entry(2),
                wgpu::BindGroupLayoutEntry {
                    binding: 3,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("frame contract preview bind group"),
            layout: &layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(source_view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(recording_view),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::TextureView(streaming_view),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: wgpu::BindingResource::Sampler(&sampler),
                },
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("frame contract preview pipeline layout"),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("frame contract preview pipeline"),
            layout: Some(&pipeline_layout),
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
                    format: surface_format,
                    blend: Some(wgpu::BlendState::REPLACE),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            multiview_mask: None,
            cache: None,
        });

        Self {
            id: "preview".into(),
            name: "Window Preview".into(),
            pipeline,
            bind_group,
            width,
            height,
            enabled: true,
            state: SinkState::Running,
            submitted: 0,
            last_frame: 0,
            last_error: String::new(),
        }
    }
}

impl FrameSink for PreviewSink {
    fn id(&self) -> &str {
        &self.id
    }

    fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
        self.state = if enabled {
            SinkState::Running
        } else {
            SinkState::Disabled
        };
    }

    fn resize(&mut self, width: u32, height: u32) {
        self.width = width;
        self.height = height;
    }

    fn reset_metrics(&mut self) {
        self.submitted = 0;
        self.last_frame = 0;
        self.last_error.clear();
    }

    fn submit(&mut self, context: &mut SinkContext<'_>) -> SubmitResult {
        if !self.enabled {
            self.state = SinkState::Disabled;
            return SubmitResult::Skipped;
        }
        let Some(target) = context.preview_target else {
            self.state = SinkState::Error;
            self.last_error = "preview surface target was unavailable".into();
            return SubmitResult::Failed;
        };

        {
            let mut pass = context.encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("frame contract preview pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: target,
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
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &self.bind_group, &[]);
            pass.draw(0..3, 0..1);
        }

        self.submitted += 1;
        self.last_frame = context.frame.frame_index;
        self.state = SinkState::Running;
        self.last_error.clear();
        SubmitResult::Submitted
    }

    fn status(&self) -> SinkStatus {
        SinkStatus {
            id: self.id.clone(),
            name: self.name.clone(),
            kind: "presentation sink".into(),
            accepts: "GPU texture".into(),
            enabled: self.enabled,
            state: self.state,
            width: self.width,
            height: self.height,
            submitted: self.submitted,
            processed: self.submitted,
            dropped: 0,
            pending: 0,
            last_frame: self.last_frame,
            last_error: self.last_error.clone(),
        }
    }
}

fn texture_entry(binding: u32) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility: wgpu::ShaderStages::FRAGMENT,
        ty: wgpu::BindingType::Texture {
            sample_type: wgpu::TextureSampleType::Float { filterable: true },
            view_dimension: wgpu::TextureViewDimension::D2,
            multisampled: false,
        },
        count: None,
    }
}

#[derive(Clone, Copy)]
struct FrameToken {
    frame_index: u64,
    timestamp_ns: u64,
    width: u32,
    height: u32,
}

pub struct WorkerProbeSink {
    id: String,
    name: String,
    tx: SyncSender<FrameToken>,
    delay_ms: Arc<AtomicU64>,
    processed: Arc<AtomicU64>,
    processed_offset: u64,
    pending: Arc<AtomicU64>,
    last_processed: Arc<AtomicU64>,
    enabled: bool,
    state: SinkState,
    width: u32,
    height: u32,
    submitted: u64,
    dropped: u64,
    last_frame: u64,
    last_error: String,
}

impl WorkerProbeSink {
    pub fn new(width: u32, height: u32, queue_capacity: usize) -> Self {
        let (tx, rx) = sync_channel::<FrameToken>(queue_capacity);
        let delay_ms = Arc::new(AtomicU64::new(0));
        let processed = Arc::new(AtomicU64::new(0));
        let pending = Arc::new(AtomicU64::new(0));
        let last_processed = Arc::new(AtomicU64::new(0));
        let worker_delay = Arc::clone(&delay_ms);
        let worker_processed = Arc::clone(&processed);
        let worker_pending = Arc::clone(&pending);
        let worker_last = Arc::clone(&last_processed);

        thread::Builder::new()
            .name("junkpile-frame-contract-worker-probe".into())
            .spawn(move || {
                while let Ok(token) = rx.recv() {
                    let delay = worker_delay.load(Ordering::Relaxed);
                    if delay > 0 {
                        thread::sleep(Duration::from_millis(delay));
                    }
                    let _contract_use = token.timestamp_ns
                        ^ token.frame_index
                        ^ u64::from(token.width)
                        ^ u64::from(token.height);
                    worker_last.store(token.frame_index, Ordering::Relaxed);
                    worker_processed.fetch_add(1, Ordering::Relaxed);
                    worker_pending.fetch_sub(1, Ordering::Relaxed);
                }
            })
            .expect("worker probe thread must start");

        Self {
            id: "cpu-worker-probe".into(),
            name: "Bounded CPU Worker Probe".into(),
            tx,
            delay_ms,
            processed,
            processed_offset: 0,
            pending,
            last_processed,
            enabled: true,
            state: SinkState::Running,
            width,
            height,
            submitted: 0,
            dropped: 0,
            last_frame: 0,
            last_error: String::new(),
        }
    }
}

impl FrameSink for WorkerProbeSink {
    fn id(&self) -> &str {
        &self.id
    }

    fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
        self.state = if enabled {
            SinkState::Running
        } else {
            SinkState::Disabled
        };
    }

    fn set_worker_delay_ms(&mut self, delay_ms: u64) {
        self.delay_ms.store(delay_ms.min(500), Ordering::Relaxed);
    }

    fn reset_metrics(&mut self) {
        self.submitted = 0;
        self.dropped = 0;
        self.last_frame = 0;
        self.processed_offset = self.processed.load(Ordering::Relaxed);
        self.last_processed.store(0, Ordering::Relaxed);
        self.last_error.clear();
    }

    fn submit(&mut self, context: &mut SinkContext<'_>) -> SubmitResult {
        if !self.enabled {
            self.state = SinkState::Disabled;
            return SubmitResult::Skipped;
        }
        let token = FrameToken {
            frame_index: context.frame.frame_index,
            timestamp_ns: context.frame.timestamp_ns,
            width: context.frame.descriptor.width,
            height: context.frame.descriptor.height,
        };
        self.pending.fetch_add(1, Ordering::Relaxed);
        match self.tx.try_send(token) {
            Ok(()) => {
                self.submitted += 1;
                self.last_frame = context.frame.frame_index;
                self.state = SinkState::Running;
                self.last_error.clear();
                SubmitResult::Submitted
            }
            Err(TrySendError::Full(_)) => {
                self.pending.fetch_sub(1, Ordering::Relaxed);
                self.dropped += 1;
                self.last_frame = context.frame.frame_index;
                self.state = SinkState::Backpressured;
                SubmitResult::Dropped
            }
            Err(TrySendError::Disconnected(_)) => {
                self.pending.fetch_sub(1, Ordering::Relaxed);
                self.state = SinkState::Error;
                self.last_error = "CPU worker channel disconnected".into();
                SubmitResult::Failed
            }
        }
    }

    fn status(&self) -> SinkStatus {
        SinkStatus {
            id: self.id.clone(),
            name: self.name.clone(),
            kind: format!(
                "bounded CPU worker · {} ms simulated work",
                self.delay_ms.load(Ordering::Relaxed)
            ),
            accepts: "frame descriptor + timestamp token".into(),
            enabled: self.enabled,
            state: self.state,
            width: self.width,
            height: self.height,
            submitted: self.submitted,
            processed: self
                .processed
                .load(Ordering::Relaxed)
                .saturating_sub(self.processed_offset),
            dropped: self.dropped,
            pending: self.pending.load(Ordering::Relaxed),
            last_frame: self.last_processed.load(Ordering::Relaxed),
            last_error: self.last_error.clone(),
        }
    }
}
