use crate::frame::VideoFrame;
use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SubmitResult {
    Submitted,
    Skipped,
    Dropped,
    Failed,
}

pub struct SinkContext<'a> {
    pub frame: &'a VideoFrame<'a>,
    pub encoder: &'a mut wgpu::CommandEncoder,
    pub preview_target: Option<&'a wgpu::TextureView>,
}

pub trait FrameSink {
    fn id(&self) -> &str;
    fn submit(&mut self, context: &mut SinkContext<'_>) -> SubmitResult;
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewStatus {
    pub id: String,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub submitted: u64,
    pub last_frame: u64,
    pub running: bool,
    pub last_error: String,
}

pub struct PreviewSink {
    id: String,
    name: String,
    pipeline: wgpu::RenderPipeline,
    layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
    bind_group: wgpu::BindGroup,
    width: u32,
    height: u32,
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
        width: u32,
        height: u32,
    ) -> Self {
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("ffmpeg recording preview shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("preview.wgsl").into()),
        });
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("ffmpeg recording preview sampler"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("ffmpeg recording preview bind group layout"),
            entries: &[
                texture_entry(0),
                texture_entry(1),
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });
        let bind_group = create_bind_group(
            device,
            &layout,
            &sampler,
            source_view,
            recording_view,
        );
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("ffmpeg recording preview pipeline layout"),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("ffmpeg recording preview pipeline"),
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
            layout,
            sampler,
            bind_group,
            width,
            height,
            submitted: 0,
            last_frame: 0,
            last_error: String::new(),
        }
    }

    pub fn update_recording_view(
        &mut self,
        device: &wgpu::Device,
        source_view: &wgpu::TextureView,
        recording_view: &wgpu::TextureView,
    ) {
        self.bind_group = create_bind_group(
            device,
            &self.layout,
            &self.sampler,
            source_view,
            recording_view,
        );
    }

    pub fn resize(&mut self, width: u32, height: u32) {
        self.width = width;
        self.height = height;
    }

    pub fn status(&self) -> PreviewStatus {
        PreviewStatus {
            id: self.id.clone(),
            name: self.name.clone(),
            width: self.width,
            height: self.height,
            submitted: self.submitted,
            last_frame: self.last_frame,
            running: self.last_error.is_empty(),
            last_error: self.last_error.clone(),
        }
    }
}

impl FrameSink for PreviewSink {
    fn id(&self) -> &str {
        &self.id
    }

    fn submit(&mut self, context: &mut SinkContext<'_>) -> SubmitResult {
        let Some(target) = context.preview_target else {
            self.last_error = "preview surface target was unavailable".into();
            return SubmitResult::Failed;
        };

        {
            let mut pass = context.encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("ffmpeg recording preview pass"),
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
        self.last_error.clear();
        SubmitResult::Submitted
    }
}

fn create_bind_group(
    device: &wgpu::Device,
    layout: &wgpu::BindGroupLayout,
    sampler: &wgpu::Sampler,
    source_view: &wgpu::TextureView,
    recording_view: &wgpu::TextureView,
) -> wgpu::BindGroup {
    device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("ffmpeg recording preview bind group"),
        layout,
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
                resource: wgpu::BindingResource::Sampler(sampler),
            },
        ],
    })
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
