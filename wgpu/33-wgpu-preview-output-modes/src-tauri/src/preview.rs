use crate::config::PreviewScaleMode;
use bytemuck::{Pod, Zeroable};
use serde::Serialize;
use wgpu::util::DeviceExt;

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct PreviewUniforms {
    dimensions: [f32; 4],
    mode: [u32; 4],
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewGeometry {
    pub image_width: f64,
    pub image_height: f64,
    pub offset_x: f64,
    pub offset_y: f64,
    pub scale_x: f64,
    pub scale_y: f64,
    pub visible_source_percent: f64,
    pub description: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewStatus {
    pub enabled: bool,
    pub mode: PreviewScaleMode,
    pub mode_name: String,
    pub window_width: u32,
    pub window_height: u32,
    pub source_width: u32,
    pub source_height: u32,
    pub presented_frames: u64,
    pub hidden_frames: u64,
    pub unavailable_frames: u64,
    pub last_presented_frame: u64,
    pub geometry: PreviewGeometry,
    pub last_error: String,
}

pub struct PreviewSink {
    pipeline: wgpu::RenderPipeline,
    layout: wgpu::BindGroupLayout,
    linear_sampler: wgpu::Sampler,
    nearest_sampler: wgpu::Sampler,
    linear_bind_group: wgpu::BindGroup,
    nearest_bind_group: wgpu::BindGroup,
    uniform_buffer: wgpu::Buffer,
    window_width: u32,
    window_height: u32,
    source_width: u32,
    source_height: u32,
    mode: PreviewScaleMode,
    enabled: bool,
    presented_frames: u64,
    hidden_frames: u64,
    unavailable_frames: u64,
    last_presented_frame: u64,
    last_error: String,
}

impl PreviewSink {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        device: &wgpu::Device,
        surface_format: wgpu::TextureFormat,
        source_view: &wgpu::TextureView,
        window_width: u32,
        window_height: u32,
        source_width: u32,
        source_height: u32,
        mode: PreviewScaleMode,
        enabled: bool,
    ) -> Self {
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("preview output modes shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("preview.wgsl").into()),
        });
        let linear_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("preview linear sampler"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        let nearest_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("preview pixel sampler"),
            mag_filter: wgpu::FilterMode::Nearest,
            min_filter: wgpu::FilterMode::Nearest,
            ..Default::default()
        });
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("preview output modes bind group layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });
        let uniform_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("preview output modes uniforms"),
            contents: bytemuck::bytes_of(&PreviewUniforms {
                dimensions: [
                    window_width as f32,
                    window_height as f32,
                    source_width as f32,
                    source_height as f32,
                ],
                mode: [mode.as_u32(), 0, 0, 0],
            }),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });
        let linear_bind_group = create_bind_group(
            device,
            &layout,
            &linear_sampler,
            source_view,
            &uniform_buffer,
            "preview linear bind group",
        );
        let nearest_bind_group = create_bind_group(
            device,
            &layout,
            &nearest_sampler,
            source_view,
            &uniform_buffer,
            "preview nearest bind group",
        );
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("preview output modes pipeline layout"),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("preview output modes pipeline"),
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
            pipeline,
            layout,
            linear_sampler,
            nearest_sampler,
            linear_bind_group,
            nearest_bind_group,
            uniform_buffer,
            window_width,
            window_height,
            source_width,
            source_height,
            mode,
            enabled,
            presented_frames: 0,
            hidden_frames: 0,
            unavailable_frames: 0,
            last_presented_frame: 0,
            last_error: String::new(),
        }
    }

    pub fn update_source(
        &mut self,
        device: &wgpu::Device,
        source_view: &wgpu::TextureView,
        source_width: u32,
        source_height: u32,
    ) {
        self.source_width = source_width;
        self.source_height = source_height;
        self.linear_bind_group = create_bind_group(
            device,
            &self.layout,
            &self.linear_sampler,
            source_view,
            &self.uniform_buffer,
            "preview linear bind group",
        );
        self.nearest_bind_group = create_bind_group(
            device,
            &self.layout,
            &self.nearest_sampler,
            source_view,
            &self.uniform_buffer,
            "preview nearest bind group",
        );
    }

    pub fn resize(&mut self, width: u32, height: u32) {
        self.window_width = width;
        self.window_height = height;
    }

    pub fn set_mode(&mut self, mode: PreviewScaleMode) {
        self.mode = mode;
    }

    pub fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    pub fn mark_hidden(&mut self) {
        self.hidden_frames = self.hidden_frames.saturating_add(1);
    }

    pub fn mark_unavailable(&mut self) {
        self.unavailable_frames = self.unavailable_frames.saturating_add(1);
    }

    pub fn reset_metrics(&mut self) {
        self.presented_frames = 0;
        self.hidden_frames = 0;
        self.unavailable_frames = 0;
        self.last_presented_frame = 0;
        self.last_error.clear();
    }

    pub fn submit(
        &mut self,
        queue: &wgpu::Queue,
        encoder: &mut wgpu::CommandEncoder,
        target: &wgpu::TextureView,
        frame_index: u64,
    ) {
        let uniforms = PreviewUniforms {
            dimensions: [
                self.window_width.max(1) as f32,
                self.window_height.max(1) as f32,
                self.source_width.max(1) as f32,
                self.source_height.max(1) as f32,
            ],
            mode: [self.mode.as_u32(), 0, 0, 0],
        };
        queue.write_buffer(&self.uniform_buffer, 0, bytemuck::bytes_of(&uniforms));

        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("preview output modes presentation pass"),
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
        let bind_group = if self.mode == PreviewScaleMode::Pixel {
            &self.nearest_bind_group
        } else {
            &self.linear_bind_group
        };
        pass.set_bind_group(0, bind_group, &[]);
        pass.draw(0..3, 0..1);
        self.presented_frames = self.presented_frames.saturating_add(1);
        self.last_presented_frame = frame_index;
        self.last_error.clear();
    }

    pub fn status(&self) -> PreviewStatus {
        PreviewStatus {
            enabled: self.enabled,
            mode: self.mode,
            mode_name: self.mode.as_str().to_string(),
            window_width: self.window_width,
            window_height: self.window_height,
            source_width: self.source_width,
            source_height: self.source_height,
            presented_frames: self.presented_frames,
            hidden_frames: self.hidden_frames,
            unavailable_frames: self.unavailable_frames,
            last_presented_frame: self.last_presented_frame,
            geometry: calculate_geometry(
                self.mode,
                self.window_width,
                self.window_height,
                self.source_width,
                self.source_height,
            ),
            last_error: self.last_error.clone(),
        }
    }
}

fn create_bind_group(
    device: &wgpu::Device,
    layout: &wgpu::BindGroupLayout,
    sampler: &wgpu::Sampler,
    source_view: &wgpu::TextureView,
    uniform_buffer: &wgpu::Buffer,
    label: &'static str,
) -> wgpu::BindGroup {
    device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some(label),
        layout,
        entries: &[
            wgpu::BindGroupEntry {
                binding: 0,
                resource: wgpu::BindingResource::TextureView(source_view),
            },
            wgpu::BindGroupEntry {
                binding: 1,
                resource: wgpu::BindingResource::Sampler(sampler),
            },
            wgpu::BindGroupEntry {
                binding: 2,
                resource: uniform_buffer.as_entire_binding(),
            },
        ],
    })
}

fn calculate_geometry(
    mode: PreviewScaleMode,
    window_width: u32,
    window_height: u32,
    source_width: u32,
    source_height: u32,
) -> PreviewGeometry {
    let dw = window_width.max(1) as f64;
    let dh = window_height.max(1) as f64;
    let sw = source_width.max(1) as f64;
    let sh = source_height.max(1) as f64;

    match mode {
        PreviewScaleMode::Stretch => PreviewGeometry {
            image_width: dw,
            image_height: dh,
            offset_x: 0.0,
            offset_y: 0.0,
            scale_x: dw / sw,
            scale_y: dh / sh,
            visible_source_percent: 100.0,
            description: "The source independently scales to the full window; aspect ratio may change."
                .into(),
        },
        PreviewScaleMode::Fit | PreviewScaleMode::Fill | PreviewScaleMode::Pixel => {
            let scale = match mode {
                PreviewScaleMode::Fit => (dw / sw).min(dh / sh),
                PreviewScaleMode::Fill => (dw / sw).max(dh / sh),
                PreviewScaleMode::Pixel => 1.0,
                PreviewScaleMode::Stretch => unreachable!(),
            };
            let image_width = sw * scale;
            let image_height = sh * scale;
            let visible_x = (dw / image_width).clamp(0.0, 1.0);
            let visible_y = (dh / image_height).clamp(0.0, 1.0);
            let description = match mode {
                PreviewScaleMode::Fit => {
                    "The entire source remains visible; unused window space is letterboxed."
                }
                PreviewScaleMode::Fill => {
                    "The window is completely covered; source edges may be cropped."
                }
                PreviewScaleMode::Pixel => {
                    "The source is centered at exact 1:1 pixels with nearest-neighbor sampling."
                }
                PreviewScaleMode::Stretch => unreachable!(),
            };
            PreviewGeometry {
                image_width,
                image_height,
                offset_x: (dw - image_width) * 0.5,
                offset_y: (dh - image_height) * 0.5,
                scale_x: scale,
                scale_y: scale,
                visible_source_percent: visible_x * visible_y * 100.0,
                description: description.into(),
            }
        }
    }
}
