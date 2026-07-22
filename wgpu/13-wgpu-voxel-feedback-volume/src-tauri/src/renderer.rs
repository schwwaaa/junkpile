use bytemuck::{Pod, Zeroable};
use serde::Serialize;
use std::{env, sync::{atomic::{AtomicBool, Ordering}, mpsc::{sync_channel, Receiver, SyncSender, TryRecvError}, Arc, RwLock}, thread, time::{Duration, Instant}};
use wgpu::util::DeviceExt;

const VOLUME_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;
const HDR_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;
const WORKGROUP: u32 = 4;
const DEFAULT_VOLUME_SIZE: u32 = 128;

#[derive(Debug, Clone)]
pub enum RenderCommand { Resize(u32,u32), SetVolumeSize(u32), SetResolutionPreset(String), SetScene(u32), SetViewMode(u32), SetParam(String,f32), SetPaused(bool), ClearVolume, ResetParams, TriggerBurst, Shutdown }

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all="camelCase")]
pub struct RendererInfo {
    pub backend:String, pub adapter:String, pub device_type:String, pub driver:String, pub surface_format:String,
    pub window_width:u32, pub window_height:u32, pub output_width:u32, pub output_height:u32, pub resolution_preset:String, pub render_scale:f32,
    pub volume_size:u32, pub voxel_count:u64, pub volume_memory_megabytes:f64, pub output_memory_megabytes:f64, pub estimated_total_megabytes:f64,
    pub workgroups_per_axis:u32, pub scene:u32, pub scene_name:String, pub view_mode:u32, pub view_name:String,
    pub retention:f32, pub diffusion:f32, pub erosion:f32, pub injection:f32, pub advection:f32, pub swirl:f32, pub simulation_speed:f32,
    pub density:f32, pub ray_steps:f32, pub exposure:f32, pub bloom:f32, pub fog:f32, pub threshold:f32, pub hue_shift:f32,
    pub camera_yaw_degrees:f32, pub camera_pitch_degrees:f32, pub camera_distance:f32, pub camera_fov_degrees:f32, pub auto_orbit_degrees:f32,
    pub slice_depth:f32, pub slice_thickness:f32, pub paused:bool, pub burst_active:bool,
    pub max_texture_dimension_3d:u32, pub max_texture_dimension_2d:u32, pub fps:f64, pub frame_time_ms:f64, pub voxel_updates_per_second:f64, pub frame_count:u64, pub running:bool, pub last_error:String,
}

#[derive(Clone)] pub struct RendererHandle { tx:SyncSender<RenderCommand>, info:Arc<RwLock<RendererInfo>> }
impl RendererHandle { pub fn send(&self,c:RenderCommand){let _=self.tx.try_send(c);} pub fn info(&self)->RendererInfo{self.info.read().expect("renderer info poisoned").clone()} }

pub fn start(window:tauri::Window)->Result<RendererHandle,String>{
    let (tx,rx)=sync_channel(256); let alive=Arc::new(AtomicBool::new(true)); let mut renderer=pollster::block_on(Renderer::new(window))?;
    let info=Arc::new(RwLock::new(renderer.info())); let thread_info=Arc::clone(&info); let thread_alive=Arc::clone(&alive);
    thread::Builder::new().name("junkpile-wgpu-voxel-feedback-volume".into()).spawn(move||renderer.run(rx,thread_info,thread_alive)).map_err(|e|format!("could not start renderer thread: {e}"))?;
    Ok(RendererHandle{tx,info})
}

#[repr(C)] #[derive(Clone,Copy,Pod,Zeroable)]
struct Uniforms { volume_time:[f32;4], behavior:[f32;4], motion:[f32;4], camera:[f32;4], render:[f32;4], look:[f32;4], output:[f32;4], slice:[f32;4], flags:[u32;4] }

struct VolumeTextures { _a:wgpu::Texture, _b:wgpu::Texture, view_a:wgpu::TextureView, view_b:wgpu::TextureView, compute_a_to_b:wgpu::BindGroup, compute_b_to_a:wgpu::BindGroup, render_a:wgpu::BindGroup, render_b:wgpu::BindGroup, size:u32 }
impl VolumeTextures {
    fn new(device:&wgpu::Device, compute_layout:&wgpu::BindGroupLayout, render_layout:&wgpu::BindGroupLayout, uniform:&wgpu::Buffer, sampler:&wgpu::Sampler, size:u32)->Self{
        fn make(device:&wgpu::Device,size:u32,label:&str)->(wgpu::Texture,wgpu::TextureView){
            let texture=device.create_texture(&wgpu::TextureDescriptor{label:Some(label),size:wgpu::Extent3d{width:size,height:size,depth_or_array_layers:size},mip_level_count:1,sample_count:1,dimension:wgpu::TextureDimension::D3,format:VOLUME_FORMAT,usage:wgpu::TextureUsages::TEXTURE_BINDING|wgpu::TextureUsages::STORAGE_BINDING,view_formats:&[]});
            let view=texture.create_view(&wgpu::TextureViewDescriptor::default()); (texture,view)
        }
        let (a,view_a)=make(device,size,"voxel volume A"); let (b,view_b)=make(device,size,"voxel volume B");
        fn compute_bg(device:&wgpu::Device,layout:&wgpu::BindGroupLayout,uniform:&wgpu::Buffer,source:&wgpu::TextureView,target:&wgpu::TextureView,label:&str)->wgpu::BindGroup{
            device.create_bind_group(&wgpu::BindGroupDescriptor{label:Some(label),layout,entries:&[
                wgpu::BindGroupEntry{binding:0,resource:uniform.as_entire_binding()},wgpu::BindGroupEntry{binding:1,resource:wgpu::BindingResource::TextureView(source)},wgpu::BindGroupEntry{binding:2,resource:wgpu::BindingResource::TextureView(target)}]})
        }
        fn render_bg(device:&wgpu::Device,layout:&wgpu::BindGroupLayout,uniform:&wgpu::Buffer,view:&wgpu::TextureView,sampler:&wgpu::Sampler,label:&str)->wgpu::BindGroup{
            device.create_bind_group(&wgpu::BindGroupDescriptor{label:Some(label),layout,entries:&[
                wgpu::BindGroupEntry{binding:0,resource:uniform.as_entire_binding()},wgpu::BindGroupEntry{binding:1,resource:wgpu::BindingResource::TextureView(view)},wgpu::BindGroupEntry{binding:2,resource:wgpu::BindingResource::Sampler(sampler)}]})
        }
        let compute_a_to_b=compute_bg(device,compute_layout,uniform,&view_a,&view_b,"voxel A to B"); let compute_b_to_a=compute_bg(device,compute_layout,uniform,&view_b,&view_a,"voxel B to A");
        let render_a=render_bg(device,render_layout,uniform,&view_a,sampler,"render voxel A"); let render_b=render_bg(device,render_layout,uniform,&view_b,sampler,"render voxel B");
        Self{_a:a,_b:b,view_a,view_b,compute_a_to_b,compute_b_to_a,render_a,render_b,size}
    }
}

struct Target { _texture:wgpu::Texture, view:wgpu::TextureView, sample_bind:wgpu::BindGroup, width:u32, height:u32 }
fn create_target(device:&wgpu::Device,present_layout:&wgpu::BindGroupLayout,uniform:&wgpu::Buffer,sampler:&wgpu::Sampler,width:u32,height:u32)->Target{
    let size=wgpu::Extent3d{width:width.max(1),height:height.max(1),depth_or_array_layers:1};
    let texture=device.create_texture(&wgpu::TextureDescriptor{label:Some("voxel HDR output"),size,mip_level_count:1,sample_count:1,dimension:wgpu::TextureDimension::D2,format:HDR_FORMAT,usage:wgpu::TextureUsages::RENDER_ATTACHMENT|wgpu::TextureUsages::TEXTURE_BINDING,view_formats:&[]});
    let view=texture.create_view(&wgpu::TextureViewDescriptor::default());
    let sample_bind=device.create_bind_group(&wgpu::BindGroupDescriptor{label:Some("voxel output present bind"),layout:present_layout,entries:&[
        wgpu::BindGroupEntry{binding:0,resource:uniform.as_entire_binding()},wgpu::BindGroupEntry{binding:1,resource:wgpu::BindingResource::TextureView(&view)},wgpu::BindGroupEntry{binding:2,resource:wgpu::BindingResource::Sampler(sampler)}]});
    Target{_texture:texture,view,sample_bind,width:size.width,height:size.height}
}

struct Renderer {
    window_handle:tauri::Window, instance:wgpu::Instance, surface:wgpu::Surface<'static>, device:wgpu::Device, queue:wgpu::Queue, config:wgpu::SurfaceConfiguration, adapter_info:wgpu::AdapterInfo,
    max_texture_dimension_3d:u32, max_texture_dimension_2d:u32, compute_layout:wgpu::BindGroupLayout, render_layout:wgpu::BindGroupLayout, present_layout:wgpu::BindGroupLayout, sampler:wgpu::Sampler,
    compute_pipeline:wgpu::ComputePipeline, volume_pipeline:wgpu::RenderPipeline, present_pipeline:wgpu::RenderPipeline, uniform_buffer:wgpu::Buffer, uniforms:Uniforms,
    volumes:VolumeTextures, volume_is_a:bool, target:Target, window_width:u32, window_height:u32, resolution_preset:String, render_scale:f32, scene:u32, view_mode:u32, paused:bool, minimized:bool,
    simulation_time:f32, last_tick:Instant, frame_count:u64, measured_fps:f64, measured_frame_time_ms:f64, last_error:String, clear_frames:u32, burst_frames:u32,
}

fn render_pipeline(device:&wgpu::Device,module:&wgpu::ShaderModule,layout:&wgpu::PipelineLayout,entry:&'static str,format:wgpu::TextureFormat,label:&'static str)->wgpu::RenderPipeline{
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor{label:Some(label),layout:Some(layout),vertex:wgpu::VertexState{module,entry_point:Some("vs_main"),compilation_options:Default::default(),buffers:&[]},primitive:wgpu::PrimitiveState::default(),depth_stencil:None,multisample:wgpu::MultisampleState::default(),fragment:Some(wgpu::FragmentState{module,entry_point:Some(entry),compilation_options:Default::default(),targets:&[Some(wgpu::ColorTargetState{format,blend:Some(wgpu::BlendState::REPLACE),write_mask:wgpu::ColorWrites::ALL})]}),multiview_mask:None,cache:None})
}

impl Renderer {
    async fn new(window_handle:tauri::Window)->Result<Self,String>{
        let size=window_handle.inner_size().map_err(|e|e.to_string())?; let window_width=size.width.max(1); let window_height=size.height.max(1);
        let backends=wgpu::Backends::from_env().unwrap_or(wgpu::Backends::PRIMARY); let instance=wgpu::Instance::new(wgpu::InstanceDescriptor{backends,..wgpu::InstanceDescriptor::new_without_display_handle()});
        let surface=instance.create_surface(window_handle.clone()).map_err(|e|format!("could not create GPU surface: {e}"))?;
        let adapters=instance.enumerate_adapters(backends).await; let filter=env::var("WGPU_ADAPTER_NAME").ok().map(|v|v.to_lowercase());
        let adapter=adapters.into_iter().find(|a|a.is_surface_supported(&surface)&&filter.as_ref().map(|f|a.get_info().name.to_lowercase().contains(f)).unwrap_or(true)).ok_or_else(||"no surface-compatible adapter matched the requested backend/device".to_string())?;
        let adapter_info=adapter.get_info(); let limits=adapter.limits(); let max_texture_dimension_3d=limits.max_texture_dimension_3d; let max_texture_dimension_2d=limits.max_texture_dimension_2d;
        let (device,queue)=adapter.request_device(&wgpu::DeviceDescriptor{label:Some("junkpile voxel feedback device"),required_features:wgpu::Features::empty(),required_limits:wgpu::Limits::default(),memory_hints:wgpu::MemoryHints::Performance,trace:wgpu::Trace::Off,..Default::default()}).await.map_err(|e|format!("could not create GPU device: {e}"))?;
        let mut config=surface.get_default_config(&adapter,window_width,window_height).ok_or_else(||"adapter cannot produce a default surface configuration".to_string())?; config.present_mode=wgpu::PresentMode::Fifo; surface.configure(&device,&config);
        let uniforms=Self::default_uniforms(window_width,window_height); let uniform_buffer=device.create_buffer_init(&wgpu::util::BufferInitDescriptor{label:Some("voxel feedback uniforms"),contents:bytemuck::bytes_of(&uniforms),usage:wgpu::BufferUsages::UNIFORM|wgpu::BufferUsages::COPY_DST});
        let compute_layout=device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor{label:Some("voxel compute layout"),entries:&[
            wgpu::BindGroupLayoutEntry{binding:0,visibility:wgpu::ShaderStages::COMPUTE,ty:wgpu::BindingType::Buffer{ty:wgpu::BufferBindingType::Uniform,has_dynamic_offset:false,min_binding_size:None},count:None},
            wgpu::BindGroupLayoutEntry{binding:1,visibility:wgpu::ShaderStages::COMPUTE,ty:wgpu::BindingType::Texture{sample_type:wgpu::TextureSampleType::Float{filterable:false},view_dimension:wgpu::TextureViewDimension::D3,multisampled:false},count:None},
            wgpu::BindGroupLayoutEntry{binding:2,visibility:wgpu::ShaderStages::COMPUTE,ty:wgpu::BindingType::StorageTexture{access:wgpu::StorageTextureAccess::WriteOnly,format:VOLUME_FORMAT,view_dimension:wgpu::TextureViewDimension::D3},count:None}]});
        let render_layout=device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor{label:Some("voxel render layout"),entries:&[
            wgpu::BindGroupLayoutEntry{binding:0,visibility:wgpu::ShaderStages::FRAGMENT,ty:wgpu::BindingType::Buffer{ty:wgpu::BufferBindingType::Uniform,has_dynamic_offset:false,min_binding_size:None},count:None},
            wgpu::BindGroupLayoutEntry{binding:1,visibility:wgpu::ShaderStages::FRAGMENT,ty:wgpu::BindingType::Texture{sample_type:wgpu::TextureSampleType::Float{filterable:true},view_dimension:wgpu::TextureViewDimension::D3,multisampled:false},count:None},
            wgpu::BindGroupLayoutEntry{binding:2,visibility:wgpu::ShaderStages::FRAGMENT,ty:wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),count:None}]});
        let present_layout=device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor{label:Some("voxel present layout"),entries:&[
            wgpu::BindGroupLayoutEntry{binding:0,visibility:wgpu::ShaderStages::FRAGMENT,ty:wgpu::BindingType::Buffer{ty:wgpu::BufferBindingType::Uniform,has_dynamic_offset:false,min_binding_size:None},count:None},
            wgpu::BindGroupLayoutEntry{binding:1,visibility:wgpu::ShaderStages::FRAGMENT,ty:wgpu::BindingType::Texture{sample_type:wgpu::TextureSampleType::Float{filterable:true},view_dimension:wgpu::TextureViewDimension::D2,multisampled:false},count:None},
            wgpu::BindGroupLayoutEntry{binding:2,visibility:wgpu::ShaderStages::FRAGMENT,ty:wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),count:None}]});
        let sampler=device.create_sampler(&wgpu::SamplerDescriptor{label:Some("voxel linear sampler"),address_mode_u:wgpu::AddressMode::ClampToEdge,address_mode_v:wgpu::AddressMode::ClampToEdge,address_mode_w:wgpu::AddressMode::ClampToEdge,mag_filter:wgpu::FilterMode::Linear,min_filter:wgpu::FilterMode::Linear,mipmap_filter:wgpu::MipmapFilterMode::Nearest,..Default::default()});
        let compute_module=device.create_shader_module(wgpu::ShaderModuleDescriptor{label:Some("voxel feedback compute WGSL"),source:wgpu::ShaderSource::Wgsl(include_str!("volume.wgsl").into())});
        let render_module=device.create_shader_module(wgpu::ShaderModuleDescriptor{label:Some("voxel feedback render WGSL"),source:wgpu::ShaderSource::Wgsl(include_str!("render.wgsl").into())});
        let present_module=device.create_shader_module(wgpu::ShaderModuleDescriptor{label:Some("voxel feedback present WGSL"),source:wgpu::ShaderSource::Wgsl(include_str!("present.wgsl").into())});
        let compute_pl=device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor{label:Some("voxel compute pipeline layout"),bind_group_layouts:&[Some(&compute_layout)],immediate_size:0});
        let compute_pipeline=device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor{label:Some("voxel evolution pipeline"),layout:Some(&compute_pl),module:&compute_module,entry_point:Some("evolve"),compilation_options:Default::default(),cache:None});
        let render_pl=device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor{label:Some("voxel render pipeline layout"),bind_group_layouts:&[Some(&render_layout)],immediate_size:0});
        let present_pl=device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor{label:Some("voxel present pipeline layout"),bind_group_layouts:&[Some(&present_layout)],immediate_size:0});
        let volume_pipeline=render_pipeline(&device,&render_module,&render_pl,"fs_volume",HDR_FORMAT,"voxel volume raymarch pipeline");
        let present_pipeline=render_pipeline(&device,&present_module,&present_pl,"fs_present",config.format,"voxel surface present pipeline");
        let volumes=VolumeTextures::new(&device,&compute_layout,&render_layout,&uniform_buffer,&sampler,DEFAULT_VOLUME_SIZE.min(max_texture_dimension_3d));
        let target=create_target(&device,&present_layout,&uniform_buffer,&sampler,window_width,window_height);
        Ok(Self{window_handle,instance,surface,device,queue,config,adapter_info,max_texture_dimension_3d,max_texture_dimension_2d,compute_layout,render_layout,present_layout,sampler,compute_pipeline,volume_pipeline,present_pipeline,uniform_buffer,uniforms,volumes,volume_is_a:true,target,window_width,window_height,resolution_preset:"window".into(),render_scale:1.0,scene:0,view_mode:0,paused:false,minimized:false,simulation_time:0.0,last_tick:Instant::now(),frame_count:0,measured_fps:0.0,measured_frame_time_ms:0.0,last_error:String::new(),clear_frames:2,burst_frames:0})
    }
    fn default_uniforms(w:u32,h:u32)->Uniforms{ Uniforms{volume_time:[DEFAULT_VOLUME_SIZE as f32,1.0,0.0,0.0],behavior:[0.992,0.12,0.08,1.2],motion:[0.75,1.1,0.035,0.0],camera:[28f32.to_radians(),12f32.to_radians(),3.25,52f32.to_radians()],render:[2.2,160.0,1.05,0.48],look:[0.4,0.0,0.055,0.10],output:[w as f32,h as f32,w as f32,h as f32],slice:[0.5,0.04,0.0,0.0],flags:[0,0,1,0]} }
    fn scene_name(&self)->&'static str{match self.scene{1=>"Eroding sculpture",2=>"Voxel tunnel",3=>"Cellular bloom",_=>"Memory cloud"}}
    fn view_name(&self)->&'static str{match self.view_mode{1=>"XY slice",2=>"XZ slice",3=>"Maximum intensity",4=>"Threshold surface",_=>"Volume raymarch"}}
    fn info(&self)->RendererInfo{
        let voxels=self.volumes.size as u64*self.volumes.size as u64*self.volumes.size as u64; let volume_mb=voxels as f64*8.0*2.0/(1024.0*1024.0); let output_mb=self.target.width as f64*self.target.height as f64*8.0/(1024.0*1024.0);
        RendererInfo{backend:format!("{:?}",self.adapter_info.backend),adapter:self.adapter_info.name.clone(),device_type:format!("{:?}",self.adapter_info.device_type),driver:self.adapter_info.driver.clone(),surface_format:format!("{:?}",self.config.format),window_width:self.window_width,window_height:self.window_height,output_width:self.target.width,output_height:self.target.height,resolution_preset:self.resolution_preset.clone(),render_scale:self.render_scale,volume_size:self.volumes.size,voxel_count:voxels,volume_memory_megabytes:volume_mb,output_memory_megabytes:output_mb,estimated_total_megabytes:volume_mb+output_mb,workgroups_per_axis:self.volumes.size.div_ceil(WORKGROUP),scene:self.scene,scene_name:self.scene_name().into(),view_mode:self.view_mode,view_name:self.view_name().into(),retention:self.uniforms.behavior[0],diffusion:self.uniforms.behavior[1],erosion:self.uniforms.behavior[2],injection:self.uniforms.behavior[3],advection:self.uniforms.motion[0],swirl:self.uniforms.motion[1],simulation_speed:self.uniforms.volume_time[1],density:self.uniforms.render[0],ray_steps:self.uniforms.render[1],exposure:self.uniforms.render[2],bloom:self.uniforms.render[3],fog:self.uniforms.look[2],threshold:self.uniforms.look[3],hue_shift:self.uniforms.look[0],camera_yaw_degrees:self.uniforms.camera[0].to_degrees(),camera_pitch_degrees:self.uniforms.camera[1].to_degrees(),camera_distance:self.uniforms.camera[2],camera_fov_degrees:self.uniforms.camera[3].to_degrees(),auto_orbit_degrees:self.uniforms.motion[2].to_degrees(),slice_depth:self.uniforms.slice[0],slice_thickness:self.uniforms.slice[1],paused:self.paused,burst_active:self.burst_frames>0,max_texture_dimension_3d:self.max_texture_dimension_3d,max_texture_dimension_2d:self.max_texture_dimension_2d,fps:self.measured_fps,frame_time_ms:self.measured_frame_time_ms,voxel_updates_per_second:self.measured_fps*voxels as f64,frame_count:self.frame_count,running:true,last_error:self.last_error.clone()}
    }
    fn output_dims(&self,preset:&str,scale:f32)->(u32,u32){let (w,h)=match preset{"1080p"=>(1920,1080),"4k"=>(3840,2160),"8k"=>(7680,4320),_=>(self.window_width.max(1),self.window_height.max(1))}; let s=scale.clamp(0.125,1.0);((w as f32*s).round() as u32,(h as f32*s).round() as u32)}
    fn rebuild_target(&mut self,preset:String,scale:f32){let (w,h)=self.output_dims(&preset,scale); if w>self.max_texture_dimension_2d||h>self.max_texture_dimension_2d{self.last_error=format!("requested target {w}x{h} exceeds max 2D texture dimension {}",self.max_texture_dimension_2d);return;} self.target=create_target(&self.device,&self.present_layout,&self.uniform_buffer,&self.sampler,w,h);self.resolution_preset=preset;self.render_scale=scale.clamp(0.125,1.0);}
    fn rebuild_volume(&mut self,size:u32){let size=size.min(self.max_texture_dimension_3d);self.volumes=VolumeTextures::new(&self.device,&self.compute_layout,&self.render_layout,&self.uniform_buffer,&self.sampler,size);self.volume_is_a=true;self.clear_frames=2;self.uniforms.volume_time[0]=size as f32;}
    fn encode_compute(&mut self,encoder:&mut wgpu::CommandEncoder){let bind=if self.volume_is_a{&self.volumes.compute_a_to_b}else{&self.volumes.compute_b_to_a};let groups=self.volumes.size.div_ceil(WORKGROUP);let mut pass=encoder.begin_compute_pass(&wgpu::ComputePassDescriptor{label:Some("voxel evolution pass"),timestamp_writes:None});pass.set_pipeline(&self.compute_pipeline);pass.set_bind_group(0,bind,&[]);pass.dispatch_workgroups(groups,groups,groups);self.volume_is_a=!self.volume_is_a;}
    fn render(&mut self)->Result<(),String>{
        if self.minimized{return Ok(());} let now=Instant::now();let dt=now.duration_since(self.last_tick).as_secs_f32().clamp(1.0/500.0,1.0/20.0);self.last_tick=now;if !self.paused{self.simulation_time+=dt*self.uniforms.volume_time[1];}
        self.uniforms.volume_time=[self.volumes.size as f32,self.uniforms.volume_time[1],self.simulation_time,if self.paused{0.0}else{dt*self.uniforms.volume_time[1]}];self.uniforms.motion[3]=if self.burst_frames>0{1.0}else{0.0};self.uniforms.output=[self.target.width as f32,self.target.height as f32,self.window_width as f32,self.window_height as f32];self.uniforms.flags=[self.scene,self.view_mode,if self.clear_frames>0{1}else{0},if self.paused{1}else{0}];self.queue.write_buffer(&self.uniform_buffer,0,bytemuck::bytes_of(&self.uniforms));
        let (frame,reconfigure)=match self.surface.get_current_texture(){wgpu::CurrentSurfaceTexture::Success(f)=>(f,false),wgpu::CurrentSurfaceTexture::Suboptimal(f)=>(f,true),wgpu::CurrentSurfaceTexture::Timeout|wgpu::CurrentSurfaceTexture::Occluded=>return Ok(()),wgpu::CurrentSurfaceTexture::Outdated=>{self.surface.configure(&self.device,&self.config);return Ok(())},wgpu::CurrentSurfaceTexture::Lost=>{self.recreate_surface()?;return Ok(())},wgpu::CurrentSurfaceTexture::Validation=>return Err("surface validation error".into())};
        let surface_view=frame.texture.create_view(&wgpu::TextureViewDescriptor::default());let mut encoder=self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor{label:Some("voxel feedback frame encoder")});
        if !self.paused||self.clear_frames>0{self.encode_compute(&mut encoder);}
        {let bind=if self.volume_is_a{&self.volumes.render_a}else{&self.volumes.render_b};let mut pass=encoder.begin_render_pass(&wgpu::RenderPassDescriptor{label:Some("voxel HDR raymarch pass"),color_attachments:&[Some(wgpu::RenderPassColorAttachment{view:&self.target.view,depth_slice:None,resolve_target:None,ops:wgpu::Operations{load:wgpu::LoadOp::Clear(wgpu::Color::BLACK),store:wgpu::StoreOp::Store}})],depth_stencil_attachment:None,timestamp_writes:None,occlusion_query_set:None,multiview_mask:None});pass.set_pipeline(&self.volume_pipeline);pass.set_bind_group(0,bind,&[]);pass.draw(0..3,0..1);}
        {let mut pass=encoder.begin_render_pass(&wgpu::RenderPassDescriptor{label:Some("voxel surface presentation pass"),color_attachments:&[Some(wgpu::RenderPassColorAttachment{view:&surface_view,depth_slice:None,resolve_target:None,ops:wgpu::Operations{load:wgpu::LoadOp::Clear(wgpu::Color::BLACK),store:wgpu::StoreOp::Store}})],depth_stencil_attachment:None,timestamp_writes:None,occlusion_query_set:None,multiview_mask:None});pass.set_pipeline(&self.present_pipeline);pass.set_bind_group(0,&self.target.sample_bind,&[]);pass.draw(0..3,0..1);}
        self.queue.submit([encoder.finish()]);frame.present();if reconfigure{self.surface.configure(&self.device,&self.config);}if self.clear_frames>0{self.clear_frames-=1;}if self.burst_frames>0{self.burst_frames-=1;}Ok(())
    }
    fn run(&mut self,rx:Receiver<RenderCommand>,shared:Arc<RwLock<RendererInfo>>,alive:Arc<AtomicBool>){let mut metrics_started=Instant::now();let mut metrics_frames=0u64;while alive.load(Ordering::Relaxed){let frame_started=Instant::now();loop{match rx.try_recv(){Ok(RenderCommand::Resize(w,h))=>self.resize(w,h),Ok(RenderCommand::SetVolumeSize(s))=>self.rebuild_volume(s),Ok(RenderCommand::SetResolutionPreset(p))=>self.rebuild_target(p,self.render_scale),Ok(RenderCommand::SetScene(s))=>{self.scene=s.min(3);self.clear_frames=1;},Ok(RenderCommand::SetViewMode(v))=>self.view_mode=v.min(4),Ok(RenderCommand::SetParam(n,v))=>self.set_param(&n,v),Ok(RenderCommand::SetPaused(p))=>{self.paused=p;self.last_tick=Instant::now();},Ok(RenderCommand::ClearVolume)=>self.clear_frames=2,Ok(RenderCommand::ResetParams)=>self.reset_params(),Ok(RenderCommand::TriggerBurst)=>self.burst_frames=30,Ok(RenderCommand::Shutdown)|Err(TryRecvError::Disconnected)=>{alive.store(false,Ordering::Relaxed);break},Err(TryRecvError::Empty)=>break}}if !alive.load(Ordering::Relaxed){break}if let Err(e)=self.render(){self.last_error=e;thread::sleep(Duration::from_millis(100));}metrics_frames+=1;self.frame_count+=1;let elapsed=metrics_started.elapsed();if elapsed>=Duration::from_millis(500){self.measured_fps=metrics_frames as f64/elapsed.as_secs_f64();self.measured_frame_time_ms=frame_started.elapsed().as_secs_f64()*1000.0;if let Ok(mut info)=shared.write(){*info=self.info();}metrics_frames=0;metrics_started=Instant::now();}let remaining=Duration::from_millis(16).saturating_sub(frame_started.elapsed());if !remaining.is_zero(){thread::sleep(remaining);}}if let Ok(mut info)=shared.write(){info.running=false;}}
    fn set_param(&mut self,name:&str,value:f32){match name{"render_scale"=>self.rebuild_target(self.resolution_preset.clone(),value),"retention"=>self.uniforms.behavior[0]=value.clamp(0.8,1.0),"diffusion"=>self.uniforms.behavior[1]=value.clamp(0.0,1.0),"erosion"=>self.uniforms.behavior[2]=value.clamp(0.0,1.0),"injection"=>self.uniforms.behavior[3]=value.clamp(0.0,4.0),"advection"=>self.uniforms.motion[0]=value.clamp(0.0,3.0),"swirl"=>self.uniforms.motion[1]=value.clamp(0.0,4.0),"simulation_speed"=>self.uniforms.volume_time[1]=value.clamp(0.0,4.0),"density"=>self.uniforms.render[0]=value.clamp(0.0,8.0),"ray_steps"=>self.uniforms.render[1]=value.clamp(16.0,512.0).round(),"exposure"=>self.uniforms.render[2]=value.clamp(0.0,4.0),"bloom"=>self.uniforms.render[3]=value.clamp(0.0,2.0),"fog"=>self.uniforms.look[2]=value.clamp(0.0,0.5),"threshold"=>self.uniforms.look[3]=value.clamp(0.0,2.0),"hue_shift"=>self.uniforms.look[0]=value.clamp(-2.0,2.0),"camera_yaw"=>self.uniforms.camera[0]=value.to_radians(),"camera_pitch"=>self.uniforms.camera[1]=value.clamp(-85.0,85.0).to_radians(),"camera_distance"=>self.uniforms.camera[2]=value.clamp(1.5,10.0),"camera_fov"=>self.uniforms.camera[3]=value.clamp(20.0,110.0).to_radians(),"auto_orbit"=>self.uniforms.motion[2]=value.clamp(-45.0,45.0).to_radians(),"slice_depth"=>self.uniforms.slice[0]=value.clamp(0.0,1.0),"slice_thickness"=>self.uniforms.slice[1]=value.clamp(0.002,0.5),_=>{}}}
    fn reset_params(&mut self){let size=self.volumes.size;self.uniforms=Self::default_uniforms(self.window_width,self.window_height);self.uniforms.volume_time[0]=size as f32;self.scene=0;self.view_mode=0;self.paused=false;self.simulation_time=0.0;self.clear_frames=2;self.rebuild_target("window".into(),1.0);}
    fn resize(&mut self,w:u32,h:u32){self.window_width=w;self.window_height=h;self.minimized=w==0||h==0;if !self.minimized{self.config.width=w;self.config.height=h;self.surface.configure(&self.device,&self.config);if self.resolution_preset=="window"{self.rebuild_target("window".into(),self.render_scale);}}}
    fn recreate_surface(&mut self)->Result<(),String>{self.surface=self.instance.create_surface(self.window_handle.clone()).map_err(|e|e.to_string())?;self.surface.configure(&self.device,&self.config);Ok(())}
}
