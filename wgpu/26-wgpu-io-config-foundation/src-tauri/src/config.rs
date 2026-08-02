use crate::renderer::{RenderCommand, RendererConfigSnapshot, RendererHandle};
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        mpsc,
        Arc, Mutex, RwLock,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

const DEFAULT_BASE: &str = include_str!("../../config/io.json");
const DEFAULT_MACOS: &str = include_str!("../../config/io.macos.json");
const DEFAULT_WINDOWS: &str = include_str!("../../config/io.windows.json");
const DEFAULT_LINUX: &str = include_str!("../../config/io.linux.json");
const MAX_PIXELS: u64 = 67_108_864;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
enum Platform {
    Macos,
    Windows,
    Linux,
    Other,
}

impl Platform {
    fn current() -> Self {
        if cfg!(target_os = "macos") {
            Self::Macos
        } else if cfg!(target_os = "windows") {
            Self::Windows
        } else if cfg!(target_os = "linux") {
            Self::Linux
        } else {
            Self::Other
        }
    }

    fn file_suffix(self) -> Option<&'static str> {
        match self {
            Self::Macos => Some("macos"),
            Self::Windows => Some("windows"),
            Self::Linux => Some("linux"),
            Self::Other => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct IoConfig {
    pub schema_version: u32,
    pub render: RenderConfig,
    pub preview: PreviewConfig,
    pub recording: WorkerOutputConfig,
    pub streaming: WorkerOutputConfig,
    pub ndi: NdiConfig,
    pub shared_texture: SharedTextureConfig,
    pub hot_reload: HotReloadConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RenderConfig {
    pub width: u32,
    pub height: u32,
    pub target_fps: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PreviewConfig {
    pub enabled: bool,
    pub width: u32,
    pub height: u32,
    pub scaling: PreviewScaling,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PreviewScaling {
    Fit,
    Fill,
    Stretch,
    Pixel,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct WorkerOutputConfig {
    pub enabled: bool,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub queue_capacity: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct NdiConfig {
    pub enabled: bool,
    pub name: String,
    pub queue_capacity: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SharedTextureConfig {
    pub enabled: bool,
    pub backend: SharedTextureBackend,
    pub name: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SharedTextureBackend {
    Auto,
    Syphon,
    Spout,
    Disabled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct HotReloadConfig {
    pub enabled: bool,
    pub debounce_ms: u64,
}

impl IoConfig {
    fn built_in() -> Self {
        serde_json::from_str(DEFAULT_BASE).expect("built-in I/O config must be valid")
    }

    fn validate(&self, platform: Platform) -> Result<(), String> {
        if self.schema_version != 1 {
            return Err(format!(
                "unsupported schemaVersion {}; expected 1",
                self.schema_version
            ));
        }
        validate_dimensions("render", self.render.width, self.render.height)?;
        validate_fps("render.targetFps", self.render.target_fps)?;
        validate_dimensions("preview", self.preview.width, self.preview.height)?;
        validate_worker("recording", &self.recording)?;
        validate_worker("streaming", &self.streaming)?;
        validate_queue("ndi.queueCapacity", self.ndi.queue_capacity)?;
        validate_name("ndi.name", &self.ndi.name)?;
        validate_name("sharedTexture.name", &self.shared_texture.name)?;

        if !(50..=5_000).contains(&self.hot_reload.debounce_ms) {
            return Err("hotReload.debounceMs must be between 50 and 5000".into());
        }
        if self.shared_texture.enabled
            && matches!(self.shared_texture.backend, SharedTextureBackend::Disabled)
        {
            return Err(
                "sharedTexture.enabled cannot be true when backend is disabled".into(),
            );
        }
        if matches!(self.shared_texture.backend, SharedTextureBackend::Syphon)
            && !matches!(platform, Platform::Macos)
        {
            return Err("Syphon is only valid on macOS".into());
        }
        if matches!(self.shared_texture.backend, SharedTextureBackend::Spout)
            && !matches!(platform, Platform::Windows)
        {
            return Err("Spout is only valid on Windows".into());
        }
        Ok(())
    }

    fn renderer_snapshot(&self, generation: u64) -> RendererConfigSnapshot {
        RendererConfigSnapshot {
            generation,
            target_fps: self.render.target_fps,
            render_width: self.render.width,
            render_height: self.render.height,
            preview_width: self.preview.width,
            preview_height: self.preview.height,
            preview_enabled: self.preview.enabled,
            preview_scaling: match self.preview.scaling {
                PreviewScaling::Fit => 0.0,
                PreviewScaling::Fill => 1.0,
                PreviewScaling::Stretch => 2.0,
                PreviewScaling::Pixel => 3.0,
            },
            recording_width: self.recording.width,
            recording_height: self.recording.height,
            recording_enabled: self.recording.enabled,
            recording_fps: self.recording.fps,
            streaming_width: self.streaming.width,
            streaming_height: self.streaming.height,
            streaming_enabled: self.streaming.enabled,
            streaming_fps: self.streaming.fps,
            ndi_enabled: self.ndi.enabled,
            shared_texture_enabled: self.shared_texture.enabled,
            shared_texture_backend: match self.shared_texture.backend {
                SharedTextureBackend::Auto => 0.0,
                SharedTextureBackend::Syphon => 1.0,
                SharedTextureBackend::Spout => 2.0,
                SharedTextureBackend::Disabled => 3.0,
            },
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigStatus {
    pub platform: String,
    pub generation: u64,
    pub active: IoConfig,
    pub base_path: String,
    pub override_path: Option<String>,
    pub watching: bool,
    pub last_loaded_at_ms: u128,
    pub last_event: String,
    pub last_error: String,
}

#[derive(Debug, Clone)]
struct ConfigPaths {
    directory: PathBuf,
    base: PathBuf,
    platform_override: Option<PathBuf>,
}

impl ConfigPaths {
    fn resolve(app: &tauri::AppHandle, platform: Platform) -> Result<Self, String> {
        let directory = if cfg!(debug_assertions) {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .ok_or_else(|| "could not resolve project directory".to_string())?
                .join("config")
        } else {
            app.path()
                .app_config_dir()
                .map_err(|error| format!("could not resolve app config directory: {error}"))?
        };
        let base = directory.join("io.json");
        let platform_override = platform
            .file_suffix()
            .map(|suffix| directory.join(format!("io.{suffix}.json")));
        Ok(Self {
            directory,
            base,
            platform_override,
        })
    }
}

#[derive(Clone)]
pub struct ConfigHandle {
    state: Arc<RwLock<ConfigStatus>>,
    paths: ConfigPaths,
    platform: Platform,
    renderer: RendererHandle,
    reload_guard: Arc<Mutex<()>>,
}

impl ConfigHandle {
    pub fn start(
        app: tauri::AppHandle,
        renderer: RendererHandle,
    ) -> Result<Self, String> {
        let platform = Platform::current();
        let paths = ConfigPaths::resolve(&app, platform)?;
        seed_files(&paths, platform)?;

        let initial = IoConfig::built_in();
        let status = ConfigStatus {
            platform: format!("{:?}", platform).to_lowercase(),
            generation: 0,
            active: initial.clone(),
            base_path: paths.base.display().to_string(),
            override_path: paths
                .platform_override
                .as_ref()
                .map(|path| path.display().to_string()),
            watching: true,
            last_loaded_at_ms: now_ms(),
            last_event: "built-in defaults active".into(),
            last_error: String::new(),
        };
        renderer.send(RenderCommand::ApplyConfig(
            initial.renderer_snapshot(status.generation),
        ));

        let handle = Self {
            state: Arc::new(RwLock::new(status)),
            paths,
            platform,
            renderer,
            reload_guard: Arc::new(Mutex::new(())),
        };
        let _ = handle.reload("startup");
        handle.spawn_watcher()?;
        Ok(handle)
    }

    pub fn status(&self) -> ConfigStatus {
        self.state
            .read()
            .expect("config status poisoned")
            .clone()
    }

    pub fn reload(&self, reason: &str) -> Result<ConfigStatus, String> {
        let _guard = self
            .reload_guard
            .lock()
            .map_err(|_| "config reload lock poisoned".to_string())?;
        match load_effective(&self.paths, self.platform) {
            Ok(config) => {
                let generation = self.status().generation.saturating_add(1);
                let new_status = ConfigStatus {
                    platform: format!("{:?}", self.platform).to_lowercase(),
                    generation,
                    active: config.clone(),
                    base_path: self.paths.base.display().to_string(),
                    override_path: self
                        .paths
                        .platform_override
                        .as_ref()
                        .map(|path| path.display().to_string()),
                    watching: true,
                    last_loaded_at_ms: now_ms(),
                    last_event: reason.to_string(),
                    last_error: String::new(),
                };
                self.renderer.send(RenderCommand::ApplyConfig(
                    config.renderer_snapshot(generation),
                ));
                *self
                    .state
                    .write()
                    .map_err(|_| "config status poisoned".to_string())? = new_status.clone();
                Ok(new_status)
            }
            Err(error) => {
                if let Ok(mut status) = self.state.write() {
                    status.last_loaded_at_ms = now_ms();
                    status.last_event = format!("rejected: {reason}");
                    status.last_error = error.clone();
                }
                Err(error)
            }
        }
    }

    pub fn write_demo(&self, mode: &str) -> Result<(), String> {
        match mode {
            "valid" => {
                let mut config = self.status().active;
                config.recording.enabled = !config.recording.enabled;
                config.streaming.enabled = !config.streaming.enabled;
                config.render.target_fps = if config.render.target_fps == 60 { 30 } else { 60 };
                let text = serde_json::to_string_pretty(&config)
                    .map_err(|error| format!("could not encode demo config: {error}"))?;
                fs::write(&self.paths.base, format!("{text}\n"))
                    .map_err(|error| format!("could not write valid demo: {error}"))
            }
            "invalid" => fs::write(
                &self.paths.base,
                r#"{
  "schemaVersion": 1,
  "render": { "width": 8, "height": 1080, "targetFps": 60 },
  "unexpectedField": "this must be rejected"
}
"#,
            )
            .map_err(|error| format!("could not write invalid demo: {error}")),
            _ => Err(format!("unknown demo mode: {mode}")),
        }
    }

    pub fn restore_defaults(&self) -> Result<(), String> {
        seed_files_force(&self.paths, self.platform)
    }

    pub fn open_directory(&self) -> Result<(), String> {
        open_path(&self.paths.directory)
    }

    fn spawn_watcher(&self) -> Result<(), String> {
        let handle = self.clone();
        let directory = self.paths.directory.clone();
        thread::Builder::new()
            .name("junkpile-io-config-watcher".into())
            .spawn(move || {
                let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
                let mut watcher: RecommendedWatcher = match notify::recommended_watcher(move |event| {
                    let _ = tx.send(event);
                }) {
                    Ok(watcher) => watcher,
                    Err(error) => {
                        handle.set_watcher_error(format!("could not create file watcher: {error}"));
                        return;
                    }
                };
                if let Err(error) = watcher.watch(&directory, RecursiveMode::NonRecursive) {
                    handle.set_watcher_error(format!("could not watch config directory: {error}"));
                    return;
                }

                while let Ok(event) = rx.recv() {
                    let event = match event {
                        Ok(event) => event,
                        Err(error) => {
                            handle.set_watcher_error(format!("watcher event error: {error}"));
                            continue;
                        }
                    };
                    if !event.paths.iter().any(|path| handle.is_config_path(path)) {
                        continue;
                    }
                    let status = handle.status();
                    if !status.active.hot_reload.enabled {
                        continue;
                    }
                    thread::sleep(Duration::from_millis(
                        status.active.hot_reload.debounce_ms,
                    ));
                    while rx.try_recv().is_ok() {}
                    let _ = handle.reload("filesystem hot reload");
                }
            })
            .map_err(|error| format!("could not start config watcher thread: {error}"))?;
        Ok(())
    }

    fn is_config_path(&self, path: &Path) -> bool {
        path == self.paths.base
            || self
                .paths
                .platform_override
                .as_ref()
                .is_some_and(|override_path| path == override_path)
    }

    fn set_watcher_error(&self, error: String) {
        if let Ok(mut status) = self.state.write() {
            status.watching = false;
            status.last_error = error;
            status.last_event = "watcher stopped".into();
        }
    }
}

fn load_effective(paths: &ConfigPaths, platform: Platform) -> Result<IoConfig, String> {
    let base_text = fs::read_to_string(&paths.base)
        .map_err(|error| format!("could not read {}: {error}", paths.base.display()))?;
    let mut value: Value = serde_json::from_str(&base_text)
        .map_err(|error| format!("invalid base JSON: {error}"))?;

    if let Some(override_path) = &paths.platform_override {
        if override_path.exists() {
            let override_text = fs::read_to_string(override_path).map_err(|error| {
                format!("could not read {}: {error}", override_path.display())
            })?;
            let override_value: Value = serde_json::from_str(&override_text)
                .map_err(|error| format!("invalid platform override JSON: {error}"))?;
            deep_merge(&mut value, override_value);
        }
    }

    let config: IoConfig = serde_json::from_value(value)
        .map_err(|error| format!("configuration schema error: {error}"))?;
    config.validate(platform)?;
    Ok(config)
}

fn deep_merge(base: &mut Value, overlay: Value) {
    match (base, overlay) {
        (Value::Object(base_map), Value::Object(overlay_map)) => {
            for (key, value) in overlay_map {
                deep_merge(base_map.entry(key).or_insert(Value::Null), value);
            }
        }
        (base_slot, overlay_value) => *base_slot = overlay_value,
    }
}

fn validate_worker(name: &str, config: &WorkerOutputConfig) -> Result<(), String> {
    validate_dimensions(name, config.width, config.height)?;
    validate_fps(&format!("{name}.fps"), config.fps)?;
    validate_queue(&format!("{name}.queueCapacity"), config.queue_capacity)
}

fn validate_dimensions(name: &str, width: u32, height: u32) -> Result<(), String> {
    if !(64..=8192).contains(&width) || !(64..=8192).contains(&height) {
        return Err(format!(
            "{name} dimensions must each be between 64 and 8192; got {width}×{height}"
        ));
    }
    if u64::from(width) * u64::from(height) > MAX_PIXELS {
        return Err(format!("{name} exceeds the 67.1 megapixel safety limit"));
    }
    Ok(())
}

fn validate_fps(name: &str, fps: u32) -> Result<(), String> {
    if !(1..=240).contains(&fps) {
        return Err(format!("{name} must be between 1 and 240"));
    }
    Ok(())
}

fn validate_queue(name: &str, capacity: usize) -> Result<(), String> {
    if !(1..=16).contains(&capacity) {
        return Err(format!("{name} must be between 1 and 16"));
    }
    Ok(())
}

fn validate_name(name: &str, value: &str) -> Result<(), String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.chars().count() > 128 {
        return Err(format!("{name} must contain 1 to 128 characters"));
    }
    Ok(())
}

fn seed_files(paths: &ConfigPaths, platform: Platform) -> Result<(), String> {
    fs::create_dir_all(&paths.directory)
        .map_err(|error| format!("could not create config directory: {error}"))?;
    if !paths.base.exists() {
        fs::write(&paths.base, DEFAULT_BASE)
            .map_err(|error| format!("could not seed base config: {error}"))?;
    }
    if let Some(override_path) = &paths.platform_override {
        if !override_path.exists() {
            fs::write(override_path, platform_default(platform))
                .map_err(|error| format!("could not seed platform override: {error}"))?;
        }
    }
    Ok(())
}

fn seed_files_force(paths: &ConfigPaths, platform: Platform) -> Result<(), String> {
    fs::create_dir_all(&paths.directory)
        .map_err(|error| format!("could not create config directory: {error}"))?;
    fs::write(&paths.base, DEFAULT_BASE)
        .map_err(|error| format!("could not restore base config: {error}"))?;
    if let Some(override_path) = &paths.platform_override {
        fs::write(override_path, platform_default(platform))
            .map_err(|error| format!("could not restore platform override: {error}"))?;
    }
    Ok(())
}

fn platform_default(platform: Platform) -> &'static str {
    match platform {
        Platform::Macos => DEFAULT_MACOS,
        Platform::Windows => DEFAULT_WINDOWS,
        Platform::Linux => DEFAULT_LINUX,
        Platform::Other => "{}\n",
    }
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn open_path(path: &Path) -> Result<(), String> {
    let mut command = if cfg!(target_os = "macos") {
        let mut command = Command::new("open");
        command.arg(path);
        command
    } else if cfg!(target_os = "windows") {
        let mut command = Command::new("explorer");
        command.arg(path);
        command
    } else {
        let mut command = Command::new("xdg-open");
        command.arg(path);
        command
    };
    command
        .spawn()
        .map_err(|error| format!("could not open config directory: {error}"))?;
    Ok(())
}
