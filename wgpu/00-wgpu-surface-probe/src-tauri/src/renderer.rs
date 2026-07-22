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

#[derive(Debug, Clone)]
pub enum RenderCommand {
    Resize(u32, u32),

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
    pub width: u32,
    pub height: u32,
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
        .name("junkpile-wgpu-renderer".into())
        .spawn(move || renderer.run(rx, thread_info, thread_alive))
        .map_err(|error| format!("could not start renderer thread: {error}"))?;

    Ok(RendererHandle { tx, info })
}


struct Renderer {
    window: tauri::Window,
    instance: wgpu::Instance,
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    adapter_info: wgpu::AdapterInfo,
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
                label: Some("junkpile surface probe device"),
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

        Ok(Self {
            window, instance, surface, device, queue, config, adapter_info,
            width, height, minimized: false, started: Instant::now(),
            frame_count: 0, last_error: String::new(),
        })
    }

    fn info(&self) -> RendererInfo {
        RendererInfo {
            backend: format!("{:?}", self.adapter_info.backend),
            adapter_name: self.adapter_info.name.clone(),
            device_type: format!("{:?}", self.adapter_info.device_type),
            driver: self.adapter_info.driver.clone(),
            driver_info: self.adapter_info.driver_info.clone(),
            surface_format: format!("{:?}", self.config.format),
            width: self.width, height: self.height, fps: 0.0, frame_time_ms: 0.0,
            frame_count: self.frame_count, running: true, last_error: self.last_error.clone(),
        }
    }

    fn render(&mut self) -> Result<(), String> {
        if self.minimized { return Ok(()); }
        let (frame, reconfigure) = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(frame) => (frame, false),
            wgpu::CurrentSurfaceTexture::Suboptimal(frame) => (frame, true),
            wgpu::CurrentSurfaceTexture::Timeout | wgpu::CurrentSurfaceTexture::Occluded => return Ok(()),
            wgpu::CurrentSurfaceTexture::Outdated => { self.surface.configure(&self.device, &self.config); return Ok(()); }
            wgpu::CurrentSurfaceTexture::Lost => { self.recreate_surface()?; return Ok(()); }
            wgpu::CurrentSurfaceTexture::Validation => return Err("surface validation error".into()),
        };
        let t = self.started.elapsed().as_secs_f64();
        let clear = wgpu::Color {
            r: 0.025 + 0.018 * (t * 0.73).sin().abs(),
            g: 0.045 + 0.035 * (t * 0.51).sin().abs(),
            b: 0.090 + 0.080 * (t * 0.37).sin().abs(),
            a: 1.0,
        };
        let view = frame.texture.create_view(&wgpu::TextureViewDescriptor::default());
        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("surface probe encoder") });
        {
            let _pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("surface probe clear pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view, depth_slice: None, resolve_target: None,
                    ops: wgpu::Operations { load: wgpu::LoadOp::Clear(clear), store: wgpu::StoreOp::Store },
                })],
                depth_stencil_attachment: None, timestamp_writes: None,
                occlusion_query_set: None, multiview_mask: None,
            });
        }
        self.queue.submit([encoder.finish()]);
        frame.present();
        if reconfigure { self.surface.configure(&self.device, &self.config); }
        Ok(())
    }

    fn run(&mut self, rx: Receiver<RenderCommand>, shared: Arc<RwLock<RendererInfo>>, alive: Arc<AtomicBool>) {
        let mut metrics_started = Instant::now();
        let mut metrics_frames = 0u64;
        while alive.load(Ordering::Relaxed) {
            let frame_started = Instant::now();
            loop {
                match rx.try_recv() {
                    Ok(RenderCommand::Resize(w, h)) => self.resize(w, h),
                    Ok(RenderCommand::Shutdown) | Err(TryRecvError::Disconnected) => { alive.store(false, Ordering::Relaxed); break; }
                    Err(TryRecvError::Empty) => break,
                }
            }
            if !alive.load(Ordering::Relaxed) { break; }
            if let Err(error) = self.render() {
                self.last_error = error;
                thread::sleep(Duration::from_millis(100));
            }
            self.update_metrics(&shared, &mut metrics_started, &mut metrics_frames, frame_started);
            let remaining = Duration::from_millis(16).saturating_sub(frame_started.elapsed());
            if !remaining.is_zero() { thread::sleep(remaining); }
        }
        if let Ok(mut info) = shared.write() { info.running = false; }
    }

fn resize(&mut self, width: u32, height: u32) {
        self.width = width;
        self.height = height;
        self.minimized = width == 0 || height == 0;
        if !self.minimized {
            self.config.width = width;
            self.config.height = height;
            self.surface.configure(&self.device, &self.config);
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

    fn update_metrics(
        &mut self,
        shared: &Arc<RwLock<RendererInfo>>,
        metrics_started: &mut Instant,
        metrics_frames: &mut u64,
        last_frame: Instant,
    ) {
        *metrics_frames += 1;
        self.frame_count += 1;
        let elapsed = metrics_started.elapsed();
        if elapsed >= Duration::from_millis(500) {
            let fps = *metrics_frames as f64 / elapsed.as_secs_f64();
            let frame_time_ms = last_frame.elapsed().as_secs_f64() * 1000.0;
            if let Ok(mut info) = shared.write() {
                info.width = self.width;
                info.height = self.height;
                info.fps = fps;
                info.frame_time_ms = frame_time_ms;
                info.frame_count = self.frame_count;
                info.running = true;
                info.last_error = self.last_error.clone();
            }
            *metrics_frames = 0;
            *metrics_started = Instant::now();
        }
    }

}
