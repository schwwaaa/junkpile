use crate::{
    config::{ProfileConfigHandle, ProfileStatus},
    renderer::{RendererHandle, RuntimeSnapshot},
    recording::RecordingState,
};
use serde::{Deserialize, Serialize};
use std::{
    env, fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, RwLock,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

pub const DEFAULT_APPLIANCE_JSON: &str = include_str!("../../config/appliance.json");

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PreviewPolicy {
    Profile,
    Hidden,
    Visible,
}

impl PreviewPolicy {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Profile => "profile",
            Self::Hidden => "hidden",
            Self::Visible => "visible",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ApplianceConfig {
    pub schema_version: u32,
    pub startup_profile: String,
    pub auto_start_outputs: bool,
    pub controls_visible: bool,
    pub preview_policy: PreviewPolicy,
    pub heartbeat_ms: u64,
    pub status_file: String,
    pub exit_after_seconds: Option<u64>,
}

impl ApplianceConfig {
    pub fn built_in() -> Result<Self, String> {
        let config: Self = serde_json::from_str(DEFAULT_APPLIANCE_JSON)
            .map_err(|error| format!("built-in appliance configuration is invalid: {error}"))?;
        config.validate()?;
        Ok(config)
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != 1 {
            return Err(format!(
                "unsupported appliance schema version {}; expected 1",
                self.schema_version
            ));
        }
        if self.startup_profile.trim().is_empty() {
            return Err("startupProfile cannot be empty".into());
        }
        if !(200..=60_000).contains(&self.heartbeat_ms) {
            return Err("heartbeatMs must be between 200 and 60000".into());
        }
        if self.status_file.trim().is_empty() {
            return Err("statusFile cannot be empty".into());
        }
        if matches!(self.exit_after_seconds, Some(0)) {
            return Err("exitAfterSeconds must be null or greater than zero".into());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliOverrides {
    pub profile: Option<String>,
    pub auto_start_outputs: Option<bool>,
    pub controls_visible: Option<bool>,
    pub preview_policy: Option<PreviewPolicy>,
    pub status_file: Option<String>,
    pub exit_after_seconds: Option<u64>,
    pub applied: Vec<String>,
}

impl CliOverrides {
    fn parse() -> Self {
        let mut result = Self::default();
        let args: Vec<String> = env::args().skip(1).collect();
        let mut index = 0usize;
        while index < args.len() {
            match args[index].as_str() {
                "--profile" if index + 1 < args.len() => {
                    result.profile = Some(args[index + 1].clone());
                    result.applied.push(format!("--profile {}", args[index + 1]));
                    index += 2;
                }
                "--autostart" => {
                    result.auto_start_outputs = Some(true);
                    result.applied.push("--autostart".into());
                    index += 1;
                }
                "--no-autostart" => {
                    result.auto_start_outputs = Some(false);
                    result.applied.push("--no-autostart".into());
                    index += 1;
                }
                "--headless" => {
                    result.controls_visible = Some(false);
                    result.preview_policy = Some(PreviewPolicy::Hidden);
                    result.applied.push("--headless".into());
                    index += 1;
                }
                "--show-controls" => {
                    result.controls_visible = Some(true);
                    result.applied.push("--show-controls".into());
                    index += 1;
                }
                "--hide-controls" => {
                    result.controls_visible = Some(false);
                    result.applied.push("--hide-controls".into());
                    index += 1;
                }
                "--show-preview" => {
                    result.preview_policy = Some(PreviewPolicy::Visible);
                    result.applied.push("--show-preview".into());
                    index += 1;
                }
                "--hide-preview" => {
                    result.preview_policy = Some(PreviewPolicy::Hidden);
                    result.applied.push("--hide-preview".into());
                    index += 1;
                }
                "--profile-preview" => {
                    result.preview_policy = Some(PreviewPolicy::Profile);
                    result.applied.push("--profile-preview".into());
                    index += 1;
                }
                "--status-file" if index + 1 < args.len() => {
                    result.status_file = Some(args[index + 1].clone());
                    result
                        .applied
                        .push(format!("--status-file {}", args[index + 1]));
                    index += 2;
                }
                "--exit-after" if index + 1 < args.len() => {
                    if let Ok(seconds) = args[index + 1].parse::<u64>() {
                        result.exit_after_seconds = Some(seconds);
                        result.applied.push(format!("--exit-after {seconds}"));
                    }
                    index += 2;
                }
                _ => index += 1,
            }
        }
        result
    }

    fn apply(&self, config: &mut ApplianceConfig) {
        if let Some(profile) = &self.profile {
            config.startup_profile = profile.clone();
        }
        if let Some(value) = self.auto_start_outputs {
            config.auto_start_outputs = value;
        }
        if let Some(value) = self.controls_visible {
            config.controls_visible = value;
        }
        if let Some(value) = self.preview_policy {
            config.preview_policy = value;
        }
        if let Some(value) = &self.status_file {
            config.status_file = value.clone();
        }
        if let Some(value) = self.exit_after_seconds {
            config.exit_after_seconds = Some(value);
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplianceStatus {
    pub generation: u64,
    pub schema_version: u32,
    pub config_path: String,
    pub status_path: String,
    pub startup_profile: String,
    pub active_profile: String,
    pub auto_start_outputs: bool,
    pub controls_visible: bool,
    pub preview_policy: String,
    pub heartbeat_ms: u64,
    pub exit_after_seconds: Option<u64>,
    pub started_at_ms: u128,
    pub last_heartbeat_ms: u128,
    pub uptime_seconds: u64,
    pub outputs_active: bool,
    pub last_event: String,
    pub last_error: String,
    pub cli_overrides: CliOverrides,
    pub runtime: RuntimeSnapshot,
    pub profiles: ProfileStatus,
}

#[derive(Clone)]
pub struct ApplianceHandle {
    config_path: PathBuf,
    config: Arc<RwLock<ApplianceConfig>>,
    status: Arc<RwLock<ApplianceStatus>>,
    cli_overrides: CliOverrides,
    alive: Arc<AtomicBool>,
}

impl ApplianceHandle {
    pub fn start(
        app: &tauri::AppHandle,
        renderer: &RendererHandle,
        profiles: &ProfileConfigHandle,
    ) -> Result<Self, String> {
        let config_path = resolve_config_path(app)?;
        seed_config(&config_path, false)?;
        let cli_overrides = CliOverrides::parse();
        let mut config = load_config(&config_path)?;
        cli_overrides.apply(&mut config);
        config.validate()?;
        let status_path = resolve_status_path(&config_path, &config.status_file)?;
        let now = now_ms();
        let status = ApplianceStatus {
            generation: 1,
            schema_version: config.schema_version,
            config_path: config_path.display().to_string(),
            status_path: status_path.display().to_string(),
            startup_profile: config.startup_profile.clone(),
            active_profile: profiles.status().active_profile_id.clone(),
            auto_start_outputs: config.auto_start_outputs,
            controls_visible: config.controls_visible,
            preview_policy: config.preview_policy.as_str().into(),
            heartbeat_ms: config.heartbeat_ms,
            exit_after_seconds: config.exit_after_seconds,
            started_at_ms: now,
            last_heartbeat_ms: now,
            uptime_seconds: 0,
            outputs_active: outputs_active(&renderer.snapshot()),
            last_event: "appliance configuration loaded".into(),
            last_error: String::new(),
            cli_overrides: cli_overrides.clone(),
            runtime: renderer.snapshot(),
            profiles: profiles.status(),
        };
        let handle = Self {
            config_path,
            config: Arc::new(RwLock::new(config)),
            status: Arc::new(RwLock::new(status)),
            cli_overrides,
            alive: Arc::new(AtomicBool::new(true)),
        };
        handle.write_status(renderer, profiles)?;
        handle.spawn_heartbeat(renderer.clone(), profiles.clone())?;
        Ok(handle)
    }

    pub fn config(&self) -> ApplianceConfig {
        self.config
            .read()
            .expect("appliance configuration poisoned")
            .clone()
    }

    pub fn status(&self) -> ApplianceStatus {
        self.status
            .read()
            .expect("appliance status poisoned")
            .clone()
    }

    pub fn reload(&self) -> Result<ApplianceConfig, String> {
        let mut config = load_config(&self.config_path)?;
        self.cli_overrides.apply(&mut config);
        config.validate()?;
        *self
            .config
            .write()
            .map_err(|_| "appliance configuration poisoned".to_string())? = config.clone();
        if let Ok(mut status) = self.status.write() {
            status.generation = status.generation.saturating_add(1);
            status.schema_version = config.schema_version;
            status.startup_profile = config.startup_profile.clone();
            status.auto_start_outputs = config.auto_start_outputs;
            status.controls_visible = config.controls_visible;
            status.preview_policy = config.preview_policy.as_str().into();
            status.heartbeat_ms = config.heartbeat_ms;
            status.exit_after_seconds = config.exit_after_seconds;
            status.status_path = resolve_status_path(&self.config_path, &config.status_file)?
                .display()
                .to_string();
            status.last_event = "appliance configuration reloaded".into();
            status.last_error.clear();
        }
        Ok(config)
    }

    pub fn restore_defaults(&self) -> Result<ApplianceConfig, String> {
        seed_config(&self.config_path, true)?;
        self.reload()
    }

    pub fn set_event(&self, event: impl Into<String>) {
        if let Ok(mut status) = self.status.write() {
            status.last_event = event.into();
            status.last_error.clear();
        }
    }

    pub fn set_error(&self, error: impl Into<String>) {
        if let Ok(mut status) = self.status.write() {
            status.last_event = "appliance operation failed".into();
            status.last_error = error.into();
        }
    }

    pub fn set_controls_visible(&self, visible: bool) {
        if let Ok(mut status) = self.status.write() {
            status.controls_visible = visible;
            status.last_event = if visible {
                "controls window shown".into()
            } else {
                "controls window hidden".into()
            };
        }
    }

    pub fn write_status(
        &self,
        renderer: &RendererHandle,
        profiles: &ProfileConfigHandle,
    ) -> Result<ApplianceStatus, String> {
        let runtime = renderer.snapshot();
        let profile_status = profiles.status();
        let now = now_ms();
        let snapshot = {
            let mut status = self
                .status
                .write()
                .map_err(|_| "appliance status poisoned".to_string())?;
            status.active_profile = profile_status.active_profile_id.clone();
            status.last_heartbeat_ms = now;
            status.uptime_seconds = ((now.saturating_sub(status.started_at_ms)) / 1000) as u64;
            status.outputs_active = outputs_active(&runtime);
            status.runtime = runtime;
            status.profiles = profile_status;
            status.clone()
        };
        let path = PathBuf::from(&snapshot.status_path);
        write_json_atomic(&path, &snapshot)?;
        Ok(snapshot)
    }

    pub fn config_path(&self) -> &Path {
        &self.config_path
    }

    pub fn status_path(&self) -> PathBuf {
        PathBuf::from(self.status().status_path)
    }

    pub fn stop(&self) {
        self.alive.store(false, Ordering::Relaxed);
    }

    fn spawn_heartbeat(
        &self,
        renderer: RendererHandle,
        profiles: ProfileConfigHandle,
    ) -> Result<(), String> {
        let handle = self.clone();
        thread::Builder::new()
            .name("junkpile-appliance-heartbeat".into())
            .spawn(move || {
                while handle.alive.load(Ordering::Relaxed) {
                    let heartbeat = handle.config().heartbeat_ms.clamp(200, 60_000);
                    thread::sleep(Duration::from_millis(heartbeat));
                    if !handle.alive.load(Ordering::Relaxed) {
                        break;
                    }
                    if let Err(error) = handle.write_status(&renderer, &profiles) {
                        handle.set_error(format!("could not write appliance status: {error}"));
                    }
                }
            })
            .map_err(|error| format!("could not start appliance heartbeat: {error}"))?;
        Ok(())
    }
}

impl Drop for ApplianceHandle {
    fn drop(&mut self) {
        if Arc::strong_count(&self.alive) == 1 {
            self.stop();
        }
    }
}

pub fn apply_window_policy(
    app: &tauri::AppHandle,
    renderer: &RendererHandle,
    profile_preview_enabled: bool,
    config: &ApplianceConfig,
) -> Result<(), String> {
    let preview_enabled = match config.preview_policy {
        PreviewPolicy::Profile => profile_preview_enabled,
        PreviewPolicy::Hidden => false,
        PreviewPolicy::Visible => true,
    };
    renderer.set_preview_enabled(preview_enabled)?;

    let renderer_window = app
        .get_window("renderer")
        .ok_or_else(|| "renderer window is not available".to_string())?;
    if preview_enabled {
        renderer_window
            .show()
            .map_err(|error| format!("could not show renderer window: {error}"))?;
    } else {
        renderer_window
            .hide()
            .map_err(|error| format!("could not hide renderer window: {error}"))?;
    }

    if let Some(controls) = app.get_webview_window("controls") {
        if config.controls_visible {
            controls
                .show()
                .map_err(|error| format!("could not show controls window: {error}"))?;
        } else {
            controls
                .hide()
                .map_err(|error| format!("could not hide controls window: {error}"))?;
        }
    }
    Ok(())
}

fn outputs_active(snapshot: &RuntimeSnapshot) -> bool {
    matches!(
        snapshot.recording.state,
        RecordingState::Recording | RecordingState::Finalizing
    ) || snapshot.ndi.active
        || snapshot.platform_share.active
}

fn resolve_config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
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
    Ok(directory.join("appliance.json"))
}

fn resolve_status_path(config_path: &Path, configured: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(configured);
    if path.is_absolute() {
        return Ok(path);
    }
    let directory = config_path
        .parent()
        .ok_or_else(|| "appliance config directory is unavailable".to_string())?;
    Ok(directory.join(path))
}

fn load_config(path: &Path) -> Result<ApplianceConfig, String> {
    let text = fs::read_to_string(path)
        .map_err(|error| format!("could not read {}: {error}", path.display()))?;
    let config: ApplianceConfig = serde_json::from_str(&text)
        .map_err(|error| format!("appliance configuration error: {error}"))?;
    config.validate()?;
    Ok(config)
}

fn seed_config(path: &Path, force: bool) -> Result<(), String> {
    let directory = path
        .parent()
        .ok_or_else(|| "appliance config directory is unavailable".to_string())?;
    fs::create_dir_all(directory)
        .map_err(|error| format!("could not create appliance config directory: {error}"))?;
    if force || !path.exists() {
        fs::write(path, DEFAULT_APPLIANCE_JSON)
            .map_err(|error| format!("could not write {}: {error}", path.display()))?;
    }
    Ok(())
}

fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("could not create status directory: {error}"))?;
    }
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("could not serialize appliance status: {error}"))?;
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, bytes)
        .map_err(|error| format!("could not write {}: {error}", temporary.display()))?;
    match fs::rename(&temporary, path) {
        Ok(()) => Ok(()),
        Err(first_error) => {
            if path.exists() {
                fs::remove_file(path).map_err(|error| {
                    format!(
                        "could not replace {} after rename error {first_error}: {error}",
                        path.display()
                    )
                })?;
                fs::rename(&temporary, path).map_err(|error| {
                    format!("could not replace {}: {error}", path.display())
                })
            } else {
                Err(format!("could not replace {}: {first_error}", path.display()))
            }
        }
    }
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}
