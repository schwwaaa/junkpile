use crate::frame::{FrameDescriptor, VideoFrame};
use serde::{Deserialize, Serialize};

#[cfg(target_os = "macos")]
use crate::syphon::{SyphonConfig, SyphonOutputSink};
#[cfg(target_os = "windows")]
use crate::spout::{SpoutConfig, SpoutOutputSink};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlatformShareConfig {
    pub name: String,
    pub only_when_clients: bool,
    pub adapter_index: i32,
    pub fps_n: u32,
    pub fps_d: u32,
    pub width: u32,
    pub height: u32,
    pub vflip: bool,
}

impl Default for PlatformShareConfig {
    fn default() -> Self {
        Self {
            name: "Junkpile 39".into(),
            only_when_clients: true,
            adapter_index: -1,
            fps_n: 60,
            fps_d: 1,
            width: 1920,
            height: 1080,
            vflip: false,
        }
    }
}

impl PlatformShareConfig {
    pub fn validate(&self, max_texture_dimension_2d: u32) -> Result<(), String> {
        if self.name.trim().is_empty() {
            return Err("platform-share source name cannot be empty".into());
        }
        if self.adapter_index < -1 {
            return Err("platform-share adapter index must be -1 or greater".into());
        }
        if self.width < 16 || self.height < 16 {
            return Err("platform-share dimensions must be at least 16 × 16".into());
        }
        if self.width % 2 != 0 || self.height % 2 != 0 {
            return Err("platform-share dimensions must be even".into());
        }
        if self.width > max_texture_dimension_2d || self.height > max_texture_dimension_2d {
            return Err(format!(
                "{} × {} exceeds this GPU's maximum 2D texture dimension of {}",
                self.width, self.height, max_texture_dimension_2d
            ));
        }
        if self.fps_n == 0 || self.fps_d == 0 {
            return Err("platform-share frame-rate numerator and denominator must be greater than zero".into());
        }
        let fps = self.fps();
        if !(1.0..=120.0).contains(&fps) {
            return Err("platform-share frame rate must be between 1 and 120 fps".into());
        }
        Ok(())
    }

    pub fn fps(&self) -> f64 {
        self.fps_n as f64 / self.fps_d.max(1) as f64
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformShareStatus {
    pub platform: String,
    pub sink_name: String,
    pub feature_enabled: bool,
    pub active: bool,
    pub state: String,
    pub name: String,
    pub only_when_clients: bool,
    pub has_clients: bool,
    pub skipped_no_clients: u64,
    pub adapter_index: i32,
    pub vflip: bool,
    pub width: u32,
    pub height: u32,
    pub fps_n: u32,
    pub fps_d: u32,
    pub capture_requests: u64,
    pub readbacks_completed: u64,
    pub frames_sent: u64,
    pub dropped_gpu: u64,
    pub dropped_cpu_pool: u64,
    pub dropped_worker: u64,
    pub pending_worker: u64,
    pub cpu_buffers_available: u64,
    pub readback_slots_busy: u64,
    pub last_frame: u64,
    pub raw_megabytes_per_second: f64,
    pub last_error: String,
    pub last_log: String,
}

pub struct PlatformShareOutputSink {
    config: PlatformShareConfig,
    #[cfg(target_os = "macos")]
    inner: SyphonOutputSink,
    #[cfg(target_os = "windows")]
    inner: SpoutOutputSink,
}

impl PlatformShareOutputSink {
    pub fn new(device: &wgpu::Device, config: PlatformShareConfig) -> Self {
        #[cfg(target_os = "macos")]
        let inner = SyphonOutputSink::new(device, to_syphon_config(&config));
        #[cfg(target_os = "windows")]
        let inner = SpoutOutputSink::new(device, to_spout_config(&config));
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let _ = device;

        Self {
            config,
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            inner,
        }
    }

    pub fn descriptor(&self) -> FrameDescriptor {
        FrameDescriptor::rgba_srgb(
            self.config.width,
            self.config.height,
            self.config.fps_n,
            self.config.fps_d,
        )
    }

    pub fn is_active(&self) -> bool {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            self.inner.is_active()
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            false
        }
    }

    pub fn reconfigure(
        &mut self,
        device: &wgpu::Device,
        config: PlatformShareConfig,
    ) -> Result<(), String> {
        if self.is_active() {
            return Err("stop the platform-share sender before changing its configuration".into());
        }
        #[cfg(target_os = "macos")]
        self.inner.reconfigure(device, to_syphon_config(&config))?;
        #[cfg(target_os = "windows")]
        self.inner.reconfigure(device, to_spout_config(&config))?;
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let _ = device;
        self.config = config;
        Ok(())
    }

    pub fn start(&mut self) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            return self.inner.start();
        }
        #[cfg(target_os = "windows")]
        {
            return self.inner.start();
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            Err("platform texture sharing is available through Syphon on macOS and Spout on Windows".into())
        }
    }

    pub fn stop(&mut self) {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        self.inner.stop();
    }

    pub fn poll_completed(&mut self, device: &wgpu::Device) {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        self.inner.poll_completed(device);
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let _ = device;
    }

    pub fn submit(&mut self, frame: &VideoFrame<'_>, encoder: &mut wgpu::CommandEncoder) {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        self.inner.submit(frame, encoder);
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let _ = (frame, encoder);
    }

    pub fn reset_metrics(&mut self) {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        self.inner.reset_metrics();
    }

    pub fn status(&self) -> PlatformShareStatus {
        #[cfg(target_os = "macos")]
        {
            let status = self.inner.status();
            return PlatformShareStatus {
                platform: "macOS".into(),
                sink_name: "Syphon".into(),
                feature_enabled: status.feature_enabled,
                active: status.active,
                state: status.state,
                name: status.name,
                only_when_clients: status.only_when_clients,
                has_clients: status.has_clients,
                skipped_no_clients: status.skipped_no_clients,
                adapter_index: -1,
                vflip: status.vflip,
                width: status.width,
                height: status.height,
                fps_n: status.fps_n,
                fps_d: status.fps_d,
                capture_requests: status.capture_requests,
                readbacks_completed: status.readbacks_completed,
                frames_sent: status.frames_sent,
                dropped_gpu: status.dropped_gpu,
                dropped_cpu_pool: status.dropped_cpu_pool,
                dropped_worker: status.dropped_worker,
                pending_worker: status.pending_worker,
                cpu_buffers_available: status.cpu_buffers_available,
                readback_slots_busy: status.readback_slots_busy,
                last_frame: status.last_frame,
                raw_megabytes_per_second: status.raw_megabytes_per_second,
                last_error: status.last_error,
                last_log: status.last_log,
            };
        }

        #[cfg(target_os = "windows")]
        {
            let status = self.inner.status();
            return PlatformShareStatus {
                platform: "Windows".into(),
                sink_name: "Spout".into(),
                feature_enabled: status.feature_enabled,
                active: status.active,
                state: status.state,
                name: status.name,
                only_when_clients: false,
                has_clients: false,
                skipped_no_clients: 0,
                adapter_index: status.adapter_index,
                vflip: status.vflip,
                width: status.width,
                height: status.height,
                fps_n: status.fps_n,
                fps_d: status.fps_d,
                capture_requests: status.capture_requests,
                readbacks_completed: status.readbacks_completed,
                frames_sent: status.frames_sent,
                dropped_gpu: status.dropped_gpu,
                dropped_cpu_pool: status.dropped_cpu_pool,
                dropped_worker: status.dropped_worker,
                pending_worker: status.pending_worker,
                cpu_buffers_available: status.cpu_buffers_available,
                readback_slots_busy: status.readback_slots_busy,
                last_frame: status.last_frame,
                raw_megabytes_per_second: status.raw_megabytes_per_second,
                last_error: status.last_error,
                last_log: status.last_log,
            };
        }

        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            PlatformShareStatus {
                platform: std::env::consts::OS.into(),
                sink_name: "Unavailable".into(),
                feature_enabled: false,
                active: false,
                state: "unavailable".into(),
                name: self.config.name.clone(),
                only_when_clients: self.config.only_when_clients,
                has_clients: false,
                skipped_no_clients: 0,
                adapter_index: self.config.adapter_index,
                vflip: self.config.vflip,
                width: self.config.width,
                height: self.config.height,
                fps_n: self.config.fps_n,
                fps_d: self.config.fps_d,
                capture_requests: 0,
                readbacks_completed: 0,
                frames_sent: 0,
                dropped_gpu: 0,
                dropped_cpu_pool: 0,
                dropped_worker: 0,
                pending_worker: 0,
                cpu_buffers_available: 0,
                readback_slots_busy: 0,
                last_frame: 0,
                raw_megabytes_per_second: 0.0,
                last_error: String::new(),
                last_log: String::new(),
            }
        }
    }
}

#[cfg(target_os = "macos")]
fn to_syphon_config(config: &PlatformShareConfig) -> SyphonConfig {
    SyphonConfig {
        name: config.name.clone(),
        only_when_clients: config.only_when_clients,
        fps_n: config.fps_n,
        fps_d: config.fps_d,
        width: config.width,
        height: config.height,
        vflip: config.vflip,
    }
}

#[cfg(target_os = "windows")]
fn to_spout_config(config: &PlatformShareConfig) -> SpoutConfig {
    SpoutConfig {
        name: config.name.clone(),
        adapter_index: config.adapter_index,
        fps_n: config.fps_n,
        fps_d: config.fps_d,
        width: config.width,
        height: config.height,
        vflip: config.vflip,
    }
}
