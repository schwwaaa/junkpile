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

const FEEDBACK_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;

#[derive(Debug, Clone)]
pub enum RenderCommand {
    Resize(u32, u32),
    SetParam(String, f32),
    Clear,
    Reset,
    Shutdown,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RendererInfo {
    pub backend: String,
    pub adapter_name: String,
    pub surface_format: String,
    pub feedback_format: String,
    pub width: u32,
    pub height: u32,
    pub target_megabytes: f64,
    pub total_feedback_megabytes: f64,
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
    pub fn send(&self, command: RenderCommand) { let _ = self.tx.try_send(command); }
    pub fn info(&self) -> RendererInfo { self.info.read().expect("renderer info poisoned").clone() }
}

pub fn start(window: tauri::Window) -> Result<RendererHandle, String> {
    let (tx, rx) = sync_channel(256);
    let alive = Arc::new(AtomicBool::new(true));
    let mut renderer = pollster::block_on(Renderer::new(window))?;
    let info = Arc::new(RwLock::new(renderer.info()));
    let thread_info = Arc::clone(&info);
    let thread_alive = Arc::clone(&alive);
    thread::Builder::new().name("junkpile-wgpu-feedback".into())
        .spawn(move || renderer.run(rx, thread_info, thread_alive))
        .map_err(|e| format!("could not start renderer thread: {e}"))?;
    Ok(RendererHandle { tx, info })
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Uniforms {
    resolution_time: [f32; 4],
    feedback: [f32; 4],
    motion: [f32; 4],
    look: [f32; 4],
}

struct FeedbackTargets {
    _texture_a: wgpu::Texture,
    _texture_b: wgpu::Texture,
    view_a: wgpu::TextureView,
    view_b: wgpu::TextureView,
    bind_a: wgpu::BindGroup,
    bind_b: wgpu::BindGroup,
    width: u32,
    height: u32,
}

fn create_feedback_targets(
    device: &wgpu::Device,
    layout: &wgpu::BindGroupLayout,
    uniform_buffer: &wgpu::Buffer,
    sampler: &wgpu::Sampler,
    width: u32,
    height: u32,
) -> FeedbackTargets {
    let size = wgpu::Extent3d { width: width.max(1), height: height.max(1), depth_or_array_layers: 1 };
    let create = |label| device.create_texture(&wgpu::TextureDescriptor {
        label: Some(label), size, mip_level_count: 1, sample_count: 1,
        dimension: wgpu::TextureDimension::D2, format: FEEDBACK_FORMAT,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
        view_formats: &[],
    });
    let texture_a = create("feedback texture A");
    let texture_b = create("feedback texture B");
    let view_a = texture_a.create_view(&wgpu::TextureViewDescriptor::default());
    let view_b = texture_b.create_view(&wgpu::TextureViewDescriptor::default());
    let make_bind = |label: &'static str, view: &wgpu::TextureView| device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some(label), layout,
        entries: &[
            wgpu::BindGroupEntry { binding: 0, resource: uniform_buffer.as_entire_binding() },
            wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(view) },
            wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::Sampler(sampler) },
        ],
    });
    let bind_a = make_bind("feedback reads A", &view_a);
    let bind_b = make_bind("feedback reads B", &view_b);
    FeedbackTargets { _texture_a: texture_a, _texture_b: texture_b, view_a, view_b, bind_a, bind_b, width: size.width, height: size.height }
}

struct Renderer {
    window: tauri::Window,
    instance: wgpu::Instance,
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    adapter_info: wgpu::AdapterInfo,
    bind_group_layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
    feedback_pipeline: wgpu::RenderPipeline,
    present_pipeline: wgpu::RenderPipeline,
    uniform_buffer: wgpu::Buffer,
    uniforms: Uniforms,
    targets: FeedbackTargets,
    read_a: bool,
    width: u32,
    height: u32,
    minimized: bool,
    started: Instant,
    frame_count: u64,
    last_error: String,
}

impl Renderer {
    async fn new(window: tauri::Window) -> Result<Self, String> {
        let size = window.inner_size().map_err(|e| e.to_string())?;
        let width = size.width.max(1); let height = size.height.max(1);
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
            backends: wgpu::Backends::PRIMARY,
            ..wgpu::InstanceDescriptor::new_without_display_handle()
        });
        let surface = instance.create_surface(window.clone()).map_err(|e| format!("could not create GPU surface: {e}"))?;
        let adapter = instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance, compatible_surface: Some(&surface), force_fallback_adapter: false,
        }).await.map_err(|e| format!("no compatible GPU adapter: {e}"))?;
        let adapter_info = adapter.get_info();
        let (device, queue) = adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("junkpile feedback device"), required_features: wgpu::Features::empty(), required_limits: wgpu::Limits::default(),
            memory_hints: wgpu::MemoryHints::Performance, trace: wgpu::Trace::Off, ..Default::default()
        }).await.map_err(|e| format!("could not create GPU device: {e}"))?;
        let mut config = surface.get_default_config(&adapter, width, height).ok_or_else(|| "adapter cannot present to this surface".to_string())?;
        config.present_mode = wgpu::PresentMode::Fifo; surface.configure(&device, &config);

        let uniforms = Uniforms {
            resolution_time: [width as f32, height as f32, 0.0, 0.0],
            feedback: [0.965, 1.006, 0.003, 0.34],
            motion: [0.0, 0.0, 0.75, 1.0],
            look: [1.0, 0.9, 2.0, 0.0],
        };
        let uniform_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("feedback uniforms"), contents: bytemuck::bytes_of(&uniforms),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });
        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("feedback bind group layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry { binding: 0, visibility: wgpu::ShaderStages::FRAGMENT, ty: wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: false, min_binding_size: None }, count: None },
                wgpu::BindGroupLayoutEntry { binding: 1, visibility: wgpu::ShaderStages::FRAGMENT, ty: wgpu::BindingType::Texture { sample_type: wgpu::TextureSampleType::Float { filterable: true }, view_dimension: wgpu::TextureViewDimension::D2, multisampled: false }, count: None },
                wgpu::BindGroupLayoutEntry { binding: 2, visibility: wgpu::ShaderStages::FRAGMENT, ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering), count: None },
            ],
        });
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("feedback linear sampler"), address_mode_u: wgpu::AddressMode::ClampToEdge, address_mode_v: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear, min_filter: wgpu::FilterMode::Linear, mipmap_filter: wgpu::MipmapFilterMode::Nearest,
            ..Default::default()
        });
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some("feedback WGSL"), source: wgpu::ShaderSource::Wgsl(include_str!("shader.wgsl").into()) });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("feedback pipeline layout"), bind_group_layouts: &[Some(&bind_group_layout)], immediate_size: 0,
        });
        let make_pipeline = |label: &'static str, entry: &'static str, format: wgpu::TextureFormat| device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some(label), layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState { module: &shader, entry_point: Some("vs_main"), compilation_options: Default::default(), buffers: &[] },
            primitive: wgpu::PrimitiveState::default(), depth_stencil: None, multisample: wgpu::MultisampleState::default(),
            fragment: Some(wgpu::FragmentState { module: &shader, entry_point: Some(entry), compilation_options: Default::default(), targets: &[Some(wgpu::ColorTargetState { format, blend: Some(wgpu::BlendState::REPLACE), write_mask: wgpu::ColorWrites::ALL })] }),
            multiview_mask: None, cache: None,
        });
        let feedback_pipeline = make_pipeline("feedback update pipeline", "fs_feedback", FEEDBACK_FORMAT);
        let present_pipeline = make_pipeline("feedback present pipeline", "fs_present", config.format);
        let targets = create_feedback_targets(&device, &bind_group_layout, &uniform_buffer, &sampler, width, height);
        Ok(Self { window, instance, surface, device, queue, config, adapter_info, bind_group_layout, sampler, feedback_pipeline, present_pipeline, uniform_buffer, uniforms, targets, read_a: true, width, height, minimized: false, started: Instant::now(), frame_count: 0, last_error: String::new() })
    }

    fn info(&self) -> RendererInfo {
        let target_bytes = self.targets.width as f64 * self.targets.height as f64 * 8.0;
        RendererInfo { backend: format!("{:?}", self.adapter_info.backend), adapter_name: self.adapter_info.name.clone(), surface_format: format!("{:?}", self.config.format), feedback_format: format!("{:?}", FEEDBACK_FORMAT), width: self.width, height: self.height, target_megabytes: target_bytes / 1_048_576.0, total_feedback_megabytes: target_bytes * 2.0 / 1_048_576.0, fps: 0.0, frame_time_ms: 0.0, frame_count: self.frame_count, running: true, last_error: self.last_error.clone() }
    }

    fn clear_feedback(&mut self) {
        self.targets = create_feedback_targets(&self.device, &self.bind_group_layout, &self.uniform_buffer, &self.sampler, self.width.max(1), self.height.max(1));
        self.read_a = true;
    }

    fn render(&mut self) -> Result<(), String> {
        if self.minimized { return Ok(()); }
        self.uniforms.resolution_time = [self.targets.width as f32, self.targets.height as f32, self.started.elapsed().as_secs_f32(), self.frame_count as f32];
        self.queue.write_buffer(&self.uniform_buffer, 0, bytemuck::bytes_of(&self.uniforms));
        let (frame, reconfigure) = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(frame) => (frame, false),
            wgpu::CurrentSurfaceTexture::Suboptimal(frame) => (frame, true),
            wgpu::CurrentSurfaceTexture::Timeout | wgpu::CurrentSurfaceTexture::Occluded => return Ok(()),
            wgpu::CurrentSurfaceTexture::Outdated => { self.surface.configure(&self.device, &self.config); return Ok(()); },
            wgpu::CurrentSurfaceTexture::Lost => { self.recreate_surface()?; return Ok(()); },
            wgpu::CurrentSurfaceTexture::Validation => return Err("surface validation error".into()),
        };
        let surface_view = frame.texture.create_view(&wgpu::TextureViewDescriptor::default());
        let (read_bind, write_view, output_bind) = if self.read_a {
            (&self.targets.bind_a, &self.targets.view_b, &self.targets.bind_b)
        } else {
            (&self.targets.bind_b, &self.targets.view_a, &self.targets.bind_a)
        };
        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("feedback frame encoder") });
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("ping-pong feedback update"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment { view: write_view, depth_slice: None, resolve_target: None, ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::BLACK), store: wgpu::StoreOp::Store } })],
                depth_stencil_attachment: None, timestamp_writes: None, occlusion_query_set: None, multiview_mask: None,
            });
            pass.set_pipeline(&self.feedback_pipeline); pass.set_bind_group(0, read_bind, &[]); pass.draw(0..3, 0..1);
        }
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("feedback present"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment { view: &surface_view, depth_slice: None, resolve_target: None, ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::BLACK), store: wgpu::StoreOp::Store } })],
                depth_stencil_attachment: None, timestamp_writes: None, occlusion_query_set: None, multiview_mask: None,
            });
            pass.set_pipeline(&self.present_pipeline); pass.set_bind_group(0, output_bind, &[]); pass.draw(0..3, 0..1);
        }
        self.queue.submit([encoder.finish()]); frame.present(); self.read_a = !self.read_a;
        if reconfigure { self.surface.configure(&self.device, &self.config); }
        Ok(())
    }

    fn run(&mut self, rx: Receiver<RenderCommand>, shared: Arc<RwLock<RendererInfo>>, alive: Arc<AtomicBool>) {
        let mut metrics_started=Instant::now(); let mut metrics_frames=0u64;
        while alive.load(Ordering::Relaxed) {
            let frame_started=Instant::now();
            loop { match rx.try_recv() {
                Ok(RenderCommand::Resize(w,h))=>self.resize(w,h),
                Ok(RenderCommand::SetParam(name,value))=>match name.as_str(){
                    "decay"=>self.uniforms.feedback[0]=value.clamp(0.0,0.9995),
                    "zoom"=>self.uniforms.feedback[1]=value.clamp(0.95,1.05),
                    "rotation"=>self.uniforms.feedback[2]=value.clamp(-0.05,0.05),
                    "injection"=>self.uniforms.feedback[3]=value.clamp(0.0,2.0),
                    "shift_x"=>self.uniforms.motion[0]=value.clamp(-0.05,0.05),
                    "shift_y"=>self.uniforms.motion[1]=value.clamp(-0.05,0.05),
                    "gain"=>self.uniforms.motion[2]=value.clamp(0.0,3.0),
                    "saturation"=>self.uniforms.motion[3]=value.clamp(0.0,2.0),
                    "source_scale"=>self.uniforms.look[2]=value.clamp(0.2,8.0), _=>{}
                },
                Ok(RenderCommand::Clear)=>self.clear_feedback(),
                Ok(RenderCommand::Reset)=>{ self.uniforms.feedback=[0.965,1.006,0.003,0.34]; self.uniforms.motion=[0.0,0.0,0.75,1.0]; self.uniforms.look=[1.0,0.9,2.0,0.0]; self.clear_feedback(); },
                Ok(RenderCommand::Shutdown)|Err(TryRecvError::Disconnected)=>{alive.store(false,Ordering::Relaxed);break;},
                Err(TryRecvError::Empty)=>break,
            }}
            if !alive.load(Ordering::Relaxed){break;}
            if let Err(e)=self.render(){self.last_error=e;thread::sleep(Duration::from_millis(100));}
            metrics_frames+=1; self.frame_count+=1;
            let elapsed=metrics_started.elapsed();
            if elapsed>=Duration::from_millis(500){let fps=metrics_frames as f64/elapsed.as_secs_f64();if let Ok(mut info)=shared.write(){*info=self.info();info.fps=fps;info.frame_time_ms=frame_started.elapsed().as_secs_f64()*1000.0;}metrics_frames=0;metrics_started=Instant::now();}
            let remaining=Duration::from_millis(16).saturating_sub(frame_started.elapsed());if !remaining.is_zero(){thread::sleep(remaining);}
        }
        if let Ok(mut info)=shared.write(){info.running=false;}
    }

    fn resize(&mut self,width:u32,height:u32){
        self.width=width;self.height=height;self.minimized=width==0||height==0;
        if !self.minimized{self.config.width=width;self.config.height=height;self.surface.configure(&self.device,&self.config);self.clear_feedback();}
    }
    fn recreate_surface(&mut self)->Result<(),String>{self.surface=self.instance.create_surface(self.window.clone()).map_err(|e|format!("could not recreate GPU surface: {e}"))?;self.surface.configure(&self.device,&self.config);Ok(())}
}
