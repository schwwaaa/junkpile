use crate::renderer::{RendererHandle, RuntimeSnapshot};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, VecDeque},
    env,
    ffi::{OsStr, OsString},
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, RwLock,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

const STATE_VERSION: u32 = 1;
const RUNTIME_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

impl LogLevel {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Debug => "debug",
            Self::Info => "info",
            Self::Warn => "warn",
            Self::Error => "error",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RuntimeConfig {
    pub schema_version: u32,
    pub log_level: LogLevel,
    pub autosave_interval_ms: u64,
    pub max_log_entries: usize,
    pub platform_label: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct RuntimeConfigOverride {
    schema_version: Option<u32>,
    log_level: Option<LogLevel>,
    autosave_interval_ms: Option<u64>,
    max_log_entries: Option<usize>,
    platform_label: Option<String>,
}

impl RuntimeConfig {
    fn validate(&self) -> Result<(), String> {
        if self.schema_version != RUNTIME_SCHEMA_VERSION {
            return Err(format!(
                "unsupported runtime config schema {}; expected {}",
                self.schema_version, RUNTIME_SCHEMA_VERSION
            ));
        }
        if !(100..=60_000).contains(&self.autosave_interval_ms) {
            return Err("autosave_interval_ms must be between 100 and 60000".into());
        }
        if !(20..=10_000).contains(&self.max_log_entries) {
            return Err("max_log_entries must be between 20 and 10000".into());
        }
        if self.platform_label.trim().is_empty() {
            return Err("platform_label may not be empty".into());
        }
        Ok(())
    }

    fn apply_override(&mut self, override_config: RuntimeConfigOverride) {
        if let Some(value) = override_config.schema_version {
            self.schema_version = value;
        }
        if let Some(value) = override_config.log_level {
            self.log_level = value;
        }
        if let Some(value) = override_config.autosave_interval_ms {
            self.autosave_interval_ms = value;
        }
        if let Some(value) = override_config.max_log_entries {
            self.max_log_entries = value;
        }
        if let Some(value) = override_config.platform_label {
            self.platform_label = value;
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PersistedRuntimeState {
    pub version: u32,
    pub asset_root: String,
    pub active_shader: String,
    pub active_profile: String,
    pub parameter_targets: BTreeMap<String, f32>,
    pub saved_at_unix_ms: u128,
}

impl PersistedRuntimeState {
    pub fn from_snapshot(snapshot: &RuntimeSnapshot, asset_root: &Path) -> Self {
        Self {
            version: STATE_VERSION,
            asset_root: asset_root.display().to_string(),
            active_shader: snapshot.shader.active_shader.clone(),
            active_profile: snapshot.shader.active_profile.clone(),
            parameter_targets: snapshot
                .parameters
                .iter()
                .map(|parameter| (parameter.name.clone(), parameter.target))
                .collect(),
            saved_at_unix_ms: unix_ms(),
        }
    }

    fn validate(&self) -> Result<(), String> {
        if self.version != STATE_VERSION {
            return Err(format!(
                "unsupported runtime state version {}; expected {}",
                self.version, STATE_VERSION
            ));
        }
        if self.active_shader.trim().is_empty() {
            return Err("runtime state active_shader may not be empty".into());
        }
        if self.active_profile.trim().is_empty() {
            return Err("runtime state active_profile may not be empty".into());
        }
        if self.parameter_targets.values().any(|value| !value.is_finite()) {
            return Err("runtime state contains a non-finite parameter target".into());
        }
        Ok(())
    }

    fn fingerprint(&self) -> Result<String, String> {
        let mut comparable = self.clone();
        comparable.saved_at_unix_ms = 0;
        serde_json::to_string(&comparable)
            .map_err(|error| format!("could not fingerprint runtime state: {error}"))
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StructuredLogEntry {
    pub timestamp_unix_ms: u128,
    pub level: String,
    pub subsystem: String,
    pub event: String,
    pub message: String,
    pub fields: Value,
}

#[derive(Clone)]
pub struct StructuredLogger {
    minimum_level: LogLevel,
    entries: Arc<RwLock<VecDeque<StructuredLogEntry>>>,
    file: Arc<Mutex<Option<File>>>,
    file_path: PathBuf,
    max_entries: usize,
    file_error: Arc<RwLock<String>>,
}

impl StructuredLogger {
    fn new(path: PathBuf, minimum_level: LogLevel, max_entries: usize) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                format!("could not create log directory {}: {error}", parent.display())
            })?;
        }
        let file_result = OpenOptions::new().create(true).append(true).open(&path);
        let (file, file_error) = match file_result {
            Ok(file) => (Some(file), String::new()),
            Err(error) => (
                None,
                format!("could not open structured log {}: {error}", path.display()),
            ),
        };
        Ok(Self {
            minimum_level,
            entries: Arc::new(RwLock::new(VecDeque::with_capacity(max_entries.min(1024)))),
            file: Arc::new(Mutex::new(file)),
            file_path: path,
            max_entries,
            file_error: Arc::new(RwLock::new(file_error)),
        })
    }

    pub fn log(
        &self,
        level: LogLevel,
        subsystem: impl Into<String>,
        event: impl Into<String>,
        message: impl Into<String>,
        fields: Value,
    ) {
        if level < self.minimum_level {
            return;
        }
        let entry = StructuredLogEntry {
            timestamp_unix_ms: unix_ms(),
            level: level.as_str().into(),
            subsystem: subsystem.into(),
            event: event.into(),
            message: message.into(),
            fields,
        };
        if let Ok(mut entries) = self.entries.write() {
            entries.push_back(entry.clone());
            while entries.len() > self.max_entries {
                entries.pop_front();
            }
        }
        if let Ok(line) = serde_json::to_string(&entry) {
            if let Ok(mut file) = self.file.lock() {
                if let Some(file) = file.as_mut() {
                    if let Err(error) = writeln!(file, "{line}").and_then(|_| file.flush()) {
                        if let Ok(mut slot) = self.file_error.write() {
                            *slot = format!("structured log write failed: {error}");
                        }
                    }
                }
            }
        }
    }

    pub fn recent(&self) -> Vec<StructuredLogEntry> {
        self.entries
            .read()
            .map(|entries| entries.iter().cloned().collect())
            .unwrap_or_default()
    }

    pub fn clear_memory(&self) {
        if let Ok(mut entries) = self.entries.write() {
            entries.clear();
        }
    }

    pub fn file_path(&self) -> &Path {
        &self.file_path
    }

    fn file_error(&self) -> String {
        self.file_error
            .read()
            .map(|value| value.clone())
            .unwrap_or_else(|_| "structured log error state unavailable".into())
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimePathSnapshot {
    pub base_directory: String,
    pub active_asset_root: String,
    pub next_launch_asset_root: String,
    pub asset_source: String,
    pub state_file: String,
    pub log_file: String,
    pub log_source: String,
    pub base_runtime_config: String,
    pub platform_runtime_config: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistenceStatus {
    pub save_count: u64,
    pub last_save_unix_ms: u128,
    pub last_error: String,
    pub restored_on_startup: bool,
    pub restored_shader: String,
    pub restored_profile: String,
    pub autosave_running: bool,
}

impl Default for PersistenceStatus {
    fn default() -> Self {
        Self {
            save_count: 0,
            last_save_unix_ms: 0,
            last_error: String::new(),
            restored_on_startup: false,
            restored_shader: String::new(),
            restored_profile: String::new(),
            autosave_running: false,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInfrastructureSnapshot {
    pub paths: RuntimePathSnapshot,
    pub config: RuntimeConfig,
    pub persistence: PersistenceStatus,
    pub recent_logs: Vec<StructuredLogEntry>,
    pub log_file_error: String,
    pub authority_chain: Vec<String>,
}

pub struct RuntimeBootstrap {
    pub base_directory: PathBuf,
    pub default_asset_root: PathBuf,
    pub active_asset_root: PathBuf,
    pub asset_source: String,
    pub state_file: PathBuf,
    pub log_file: PathBuf,
    pub log_source: String,
    pub saved_state: Option<PersistedRuntimeState>,
}

impl RuntimeBootstrap {
    pub fn resolve(app: &tauri::AppHandle) -> Result<Self, String> {
        let base_directory = app
            .path()
            .app_config_dir()
            .map_err(|error| format!("could not resolve application config directory: {error}"))?
            .join("assets-state-logging-v1");
        fs::create_dir_all(&base_directory).map_err(|error| {
            format!("could not create runtime directory {}: {error}", base_directory.display())
        })?;
        let default_asset_root = base_directory.join("assets");
        let state_file = base_directory.join("runtime-state.json");
        let saved_state = load_persisted_state(&state_file).ok().flatten();

        let cli_assets = argument_value("--assets");
        let junkpile_assets = env::var_os("JUNKPILE_ASSETS");
        let shadecore_assets = env::var_os("SHADECORE_ASSETS");
        let persisted_assets = saved_state
            .as_ref()
            .map(|state| OsString::from(&state.asset_root));

        let (active_asset_root, asset_source) = if let Some(value) = cli_assets {
            (PathBuf::from(value), "CLI --assets".to_string())
        } else if let Some(value) = junkpile_assets {
            (PathBuf::from(value), "JUNKPILE_ASSETS".to_string())
        } else if let Some(value) = shadecore_assets {
            (PathBuf::from(value), "SHADECORE_ASSETS compatibility alias".to_string())
        } else if let Some(value) = persisted_assets {
            let path = PathBuf::from(value);
            if path.exists() {
                (path, "persisted runtime state".to_string())
            } else {
                (
                    default_asset_root.clone(),
                    "platform default; persisted asset root was unavailable".to_string(),
                )
            }
        } else {
            (default_asset_root.clone(), "platform default".to_string())
        };

        let cli_log = argument_value("--log-file");
        let junkpile_log = env::var_os("JUNKPILE_LOG_FILE");
        let shadecore_log = env::var_os("SHADECORE_LOG_FILE");
        let (log_file, log_source) = if let Some(value) = cli_log {
            (PathBuf::from(value), "CLI --log-file".to_string())
        } else if let Some(value) = junkpile_log {
            (PathBuf::from(value), "JUNKPILE_LOG_FILE".to_string())
        } else if let Some(value) = shadecore_log {
            (PathBuf::from(value), "SHADECORE_LOG_FILE compatibility alias".to_string())
        } else {
            (
                base_directory.join("logs/runtime.jsonl"),
                "platform default".to_string(),
            )
        };

        Ok(Self {
            base_directory,
            default_asset_root,
            active_asset_root,
            asset_source,
            state_file,
            log_file,
            log_source,
            saved_state,
        })
    }
}

#[derive(Clone)]
pub struct RuntimeServices {
    base_directory: PathBuf,
    default_asset_root: PathBuf,
    active_asset_root: PathBuf,
    next_launch_asset_root: Arc<RwLock<PathBuf>>,
    asset_source: String,
    state_file: PathBuf,
    log_source: String,
    base_runtime_config: PathBuf,
    platform_runtime_config: PathBuf,
    config: RuntimeConfig,
    logger: StructuredLogger,
    persistence: Arc<RwLock<PersistenceStatus>>,
    last_fingerprint: Arc<Mutex<String>>,
    autosave_enabled: Arc<AtomicBool>,
}

impl RuntimeServices {
    pub fn initialize(
        bootstrap: RuntimeBootstrap,
        config: RuntimeConfig,
        base_runtime_config: PathBuf,
        platform_runtime_config: PathBuf,
    ) -> Result<Self, String> {
        config.validate()?;
        let next_launch_asset_root = bootstrap.active_asset_root.clone();
        let logger = StructuredLogger::new(
            bootstrap.log_file.clone(),
            config.log_level,
            config.max_log_entries,
        )?;
        let service = Self {
            base_directory: bootstrap.base_directory,
            default_asset_root: bootstrap.default_asset_root,
            active_asset_root: bootstrap.active_asset_root,
            next_launch_asset_root: Arc::new(RwLock::new(next_launch_asset_root)),
            asset_source: bootstrap.asset_source,
            state_file: bootstrap.state_file,
            log_source: bootstrap.log_source,
            base_runtime_config,
            platform_runtime_config,
            config,
            logger,
            persistence: Arc::new(RwLock::new(PersistenceStatus::default())),
            last_fingerprint: Arc::new(Mutex::new(String::new())),
            autosave_enabled: Arc::new(AtomicBool::new(true)),
        };
        service.logger.log(
            LogLevel::Info,
            "runtime",
            "startup",
            "runtime services initialized",
            json!({
                "assetRoot": service.active_asset_root.display().to_string(),
                "assetSource": service.asset_source.clone(),
                "stateFile": service.state_file.display().to_string(),
                "logFile": service.logger.file_path().display().to_string(),
                "platform": service.config.platform_label.clone(),
            }),
        );
        Ok(service)
    }

    pub fn logger(&self) -> StructuredLogger {
        self.logger.clone()
    }

    pub fn config(&self) -> &RuntimeConfig {
        &self.config
    }

    pub fn active_asset_root(&self) -> &Path {
        &self.active_asset_root
    }

    pub fn state_file(&self) -> &Path {
        &self.state_file
    }

    pub fn restore_saved_state(
        &self,
        saved_state: Option<&PersistedRuntimeState>,
        renderer: &RendererHandle,
    ) {
        let Some(saved_state) = saved_state else {
            self.logger.log(
                LogLevel::Info,
                "state",
                "restore_skipped",
                "no persisted runtime state was available",
                json!({}),
            );
            return;
        };
        match saved_state
            .validate()
            .and_then(|_| renderer.restore_runtime_state(saved_state.clone()))
        {
            Ok(()) => {
                if let Ok(mut status) = self.persistence.write() {
                    status.restored_on_startup = true;
                    status.restored_shader = saved_state.active_shader.clone();
                    status.restored_profile = saved_state.active_profile.clone();
                }
                if let Ok(fingerprint) = saved_state.fingerprint() {
                    if let Ok(mut current) = self.last_fingerprint.lock() {
                        *current = fingerprint;
                    }
                }
                self.logger.log(
                    LogLevel::Info,
                    "state",
                    "restore_complete",
                    "persisted shader, profile, and parameter targets restored",
                    json!({
                        "shader": saved_state.active_shader.clone(),
                        "profile": saved_state.active_profile.clone(),
                        "parameterCount": saved_state.parameter_targets.len(),
                    }),
                );
            }
            Err(error) => {
                if let Ok(mut status) = self.persistence.write() {
                    status.last_error = error.clone();
                }
                self.logger.log(
                    LogLevel::Warn,
                    "state",
                    "restore_rejected",
                    "persisted state could not be applied; defaults remain active",
                    json!({ "error": error }),
                );
            }
        }
    }

    pub fn snapshot(&self) -> RuntimeInfrastructureSnapshot {
        let next_root = self
            .next_launch_asset_root
            .read()
            .map(|path| path.display().to_string())
            .unwrap_or_else(|_| "unavailable".into());
        RuntimeInfrastructureSnapshot {
            paths: RuntimePathSnapshot {
                base_directory: self.base_directory.display().to_string(),
                active_asset_root: self.active_asset_root.display().to_string(),
                next_launch_asset_root: next_root,
                asset_source: self.asset_source.clone(),
                state_file: self.state_file.display().to_string(),
                log_file: self.logger.file_path().display().to_string(),
                log_source: self.log_source.clone(),
                base_runtime_config: self.base_runtime_config.display().to_string(),
                platform_runtime_config: self.platform_runtime_config.display().to_string(),
            },
            config: self.config.clone(),
            persistence: self
                .persistence
                .read()
                .map(|value| value.clone())
                .unwrap_or_default(),
            recent_logs: self.logger.recent(),
            log_file_error: self.logger.file_error(),
            authority_chain: vec![
                "CLI flags (--assets / --log-file)".into(),
                "JUNKPILE_* environment variables".into(),
                "SHADECORE_* compatibility variables".into(),
                "persisted runtime state".into(),
                "platform default directories".into(),
            ],
        }
    }

    pub fn save_snapshot(&self, renderer_snapshot: &RuntimeSnapshot, force: bool) -> Result<bool, String> {
        if force {
            self.autosave_enabled.store(true, Ordering::Relaxed);
            self.mark_autosave_running(true);
        }
        let asset_root = self
            .next_launch_asset_root
            .read()
            .map_err(|_| "next-launch asset root lock is poisoned".to_string())?
            .clone();
        let state = PersistedRuntimeState::from_snapshot(renderer_snapshot, &asset_root);
        let fingerprint = state.fingerprint()?;
        if !force {
            let current = self
                .last_fingerprint
                .lock()
                .map_err(|_| "runtime state fingerprint lock is poisoned".to_string())?;
            if *current == fingerprint {
                return Ok(false);
            }
        }
        atomic_write_json(&self.state_file, &state)?;
        if let Ok(mut current) = self.last_fingerprint.lock() {
            *current = fingerprint;
        }
        if let Ok(mut status) = self.persistence.write() {
            status.save_count = status.save_count.saturating_add(1);
            status.last_save_unix_ms = state.saved_at_unix_ms;
            status.last_error.clear();
        }
        self.logger.log(
            if force { LogLevel::Info } else { LogLevel::Debug },
            "state",
            if force { "manual_save" } else { "autosave" },
            "runtime selection state persisted atomically",
            json!({
                "shader": state.active_shader,
                "profile": state.active_profile,
                "parameterCount": state.parameter_targets.len(),
                "assetRoot": state.asset_root,
            }),
        );
        Ok(true)
    }

    pub fn set_next_asset_root(&self, path: PathBuf, renderer: &RendererHandle) -> Result<(), String> {
        if !path.is_absolute() {
            return Err("asset root must be an absolute path".into());
        }
        for required in ["render.json", "params.json", "runtime.json", "shaders"] {
            if !path.join(required).exists() {
                return Err(format!(
                    "asset root {} is missing required entry '{}'",
                    path.display(), required
                ));
            }
        }
        if let Ok(mut next) = self.next_launch_asset_root.write() {
            *next = path.clone();
        }
        self.save_snapshot(&renderer.snapshot(), true)?;
        self.logger.log(
            LogLevel::Info,
            "assets",
            "next_root_selected",
            "custom asset root saved for the next launch",
            json!({ "path": path.display().to_string() }),
        );
        Ok(())
    }

    pub fn clear_asset_root_override(&self, renderer: &RendererHandle) -> Result<(), String> {
        if let Ok(mut next) = self.next_launch_asset_root.write() {
            *next = self.default_asset_root.clone();
        }
        self.save_snapshot(&renderer.snapshot(), true)?;
        self.logger.log(
            LogLevel::Info,
            "assets",
            "next_root_reset",
            "platform default asset root saved for the next launch",
            json!({ "path": self.default_asset_root.display().to_string() }),
        );
        Ok(())
    }

    pub fn clear_persisted_state(&self) -> Result<(), String> {
        match fs::remove_file(&self.state_file) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!(
                    "could not remove runtime state {}: {error}",
                    self.state_file.display()
                ))
            }
        }
        if let Ok(mut fingerprint) = self.last_fingerprint.lock() {
            fingerprint.clear();
        }
        self.autosave_enabled.store(false, Ordering::Relaxed);
        if let Ok(mut status) = self.persistence.write() {
            *status = PersistenceStatus::default();
            status.autosave_running = false;
        }
        self.logger.log(
            LogLevel::Warn,
            "state",
            "state_cleared",
            "persisted runtime state removed; current session remains unchanged",
            json!({}),
        );
        Ok(())
    }

    pub fn autosave_enabled(&self) -> bool {
        self.autosave_enabled.load(Ordering::Relaxed)
    }

    pub fn mark_autosave_running(&self, running: bool) {
        if let Ok(mut status) = self.persistence.write() {
            status.autosave_running = running;
        }
    }

    pub fn record_persistence_error(&self, error: String) {
        if let Ok(mut status) = self.persistence.write() {
            status.last_error = error.clone();
        }
        self.logger.log(
            LogLevel::Error,
            "state",
            "autosave_failed",
            "runtime autosave failed",
            json!({ "error": error }),
        );
    }
}

pub struct RuntimeStateGuard {
    alive: Arc<AtomicBool>,
}

impl RuntimeStateGuard {
    pub fn start(services: RuntimeServices, renderer: RendererHandle) -> Result<Self, String> {
        let alive = Arc::new(AtomicBool::new(true));
        let thread_alive = Arc::clone(&alive);
        let interval = Duration::from_millis(services.config().autosave_interval_ms);
        services.mark_autosave_running(true);
        thread::Builder::new()
            .name("junkpile-runtime-state-autosave".into())
            .spawn(move || {
                while thread_alive.load(Ordering::Relaxed) {
                    thread::sleep(interval);
                    if !thread_alive.load(Ordering::Relaxed) {
                        break;
                    }
                    if !services.autosave_enabled() {
                        continue;
                    }
                    if let Err(error) = services.save_snapshot(&renderer.snapshot(), false) {
                        services.record_persistence_error(error);
                    }
                }
                services.mark_autosave_running(false);
            })
            .map_err(|error| format!("could not start runtime state autosave thread: {error}"))?;
        Ok(Self { alive })
    }
}

impl Drop for RuntimeStateGuard {
    fn drop(&mut self) {
        self.alive.store(false, Ordering::Relaxed);
    }
}

pub fn load_runtime_config(asset_root: &Path) -> Result<(RuntimeConfig, PathBuf, PathBuf), String> {
    let base_path = asset_root.join("runtime.json");
    let base_text = fs::read_to_string(&base_path)
        .map_err(|error| format!("could not read {}: {error}", base_path.display()))?;
    let mut config: RuntimeConfig = serde_json::from_str(&base_text)
        .map_err(|error| format!("invalid runtime config {}: {error}", base_path.display()))?;

    let platform_name = if cfg!(target_os = "macos") {
        "runtime.macos.json"
    } else if cfg!(target_os = "windows") {
        "runtime.windows.json"
    } else {
        "runtime.linux.json"
    };
    let platform_path = asset_root.join(platform_name);
    if platform_path.exists() {
        let text = fs::read_to_string(&platform_path)
            .map_err(|error| format!("could not read {}: {error}", platform_path.display()))?;
        let override_config: RuntimeConfigOverride = serde_json::from_str(&text)
            .map_err(|error| format!("invalid platform runtime config {}: {error}", platform_path.display()))?;
        config.apply_override(override_config);
    }
    config.validate()?;
    Ok((config, base_path, platform_path))
}

fn load_persisted_state(path: &Path) -> Result<Option<PersistedRuntimeState>, String> {
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(format!("could not read runtime state {}: {error}", path.display()))
        }
    };
    let state: PersistedRuntimeState = serde_json::from_str(&text)
        .map_err(|error| format!("invalid runtime state {}: {error}", path.display()))?;
    state.validate()?;
    Ok(Some(state))
}

fn argument_value(flag: &str) -> Option<OsString> {
    let mut args = env::args_os();
    while let Some(value) = args.next() {
        if value.as_os_str() == OsStr::new(flag) {
            return args.next();
        }
    }
    None
}

fn atomic_write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!("could not create state directory {}: {error}", parent.display())
        })?;
    }
    let temporary = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("could not serialize runtime state: {error}"))?;
    fs::write(&temporary, bytes)
        .map_err(|error| format!("could not write {}: {error}", temporary.display()))?;
    if let Err(first_error) = fs::rename(&temporary, path) {
        if path.exists() {
            fs::remove_file(path).map_err(|remove_error| {
                format!(
                    "could not replace {}: rename failed ({first_error}); removing the prior state also failed ({remove_error})",
                    path.display()
                )
            })?;
            fs::rename(&temporary, path).map_err(|second_error| {
                format!(
                    "could not replace {} after removing the prior state: {second_error}",
                    path.display()
                )
            })?;
        } else {
            return Err(format!(
                "could not replace {} atomically: {first_error}",
                path.display()
            ));
        }
    }
    Ok(())
}

fn unix_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}
