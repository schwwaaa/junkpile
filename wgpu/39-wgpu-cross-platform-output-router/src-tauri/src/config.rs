use crate::profile::{IoProfile, ProfileFile, DEFAULT_PROFILE_JSON};
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{mpsc, Arc, Mutex, RwLock},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileStatus {
    pub generation: u64,
    pub active_profile_id: String,
    pub config_path: String,
    pub watching: bool,
    pub last_loaded_at_ms: u128,
    pub last_event: String,
    pub last_error: String,
    pub schema_version: u32,
    pub profiles: Vec<IoProfile>,
}

#[derive(Clone)]
pub struct ProfileConfigHandle {
    state: Arc<RwLock<ProfileStatus>>,
    file: Arc<RwLock<ProfileFile>>,
    config_path: PathBuf,
    reload_guard: Arc<Mutex<()>>,
}

impl ProfileConfigHandle {
    pub fn start(app: &tauri::AppHandle) -> Result<Self, String> {
        let config_path = resolve_config_path(app)?;
        seed_config(&config_path, false)?;

        let built_in = ProfileFile::built_in();
        let status = ProfileStatus {
            generation: 0,
            active_profile_id: built_in.default_profile.clone(),
            config_path: config_path.display().to_string(),
            watching: true,
            last_loaded_at_ms: now_ms(),
            last_event: "built-in profiles active".into(),
            last_error: String::new(),
            schema_version: built_in.schema_version,
            profiles: built_in.profiles.clone(),
        };
        let handle = Self {
            state: Arc::new(RwLock::new(status)),
            file: Arc::new(RwLock::new(built_in)),
            config_path,
            reload_guard: Arc::new(Mutex::new(())),
        };
        let _ = handle.reload("startup");
        handle.spawn_watcher()?;
        Ok(handle)
    }

    pub fn status(&self) -> ProfileStatus {
        self.state
            .read()
            .expect("profile status poisoned")
            .clone()
    }

    pub fn active_profile(&self) -> Result<IoProfile, String> {
        let status = self.status();
        let file = self
            .file
            .read()
            .map_err(|_| "profile configuration poisoned".to_string())?;
        file.profile(&status.active_profile_id)
            .cloned()
            .ok_or_else(|| format!("active profile '{}' is unavailable", status.active_profile_id))
    }

    pub fn profile(&self, profile_id: &str) -> Result<IoProfile, String> {
        self.file
            .read()
            .map_err(|_| "profile configuration poisoned".to_string())?
            .profile(profile_id)
            .cloned()
            .ok_or_else(|| format!("unknown I/O profile: {profile_id}"))
    }

    pub fn select(&self, profile_id: &str) -> Result<ProfileStatus, String> {
        let file = self
            .file
            .read()
            .map_err(|_| "profile configuration poisoned".to_string())?;
        if file.profile(profile_id).is_none() {
            return Err(format!("unknown I/O profile: {profile_id}"));
        }
        drop(file);
        let mut status = self
            .state
            .write()
            .map_err(|_| "profile status poisoned".to_string())?;
        status.active_profile_id = profile_id.to_string();
        status.last_event = format!("armed profile: {profile_id}");
        status.last_error.clear();
        Ok(status.clone())
    }

    pub fn reload(&self, reason: &str) -> Result<ProfileStatus, String> {
        let _guard = self
            .reload_guard
            .lock()
            .map_err(|_| "profile reload lock poisoned".to_string())?;
        match load_file(&self.config_path) {
            Ok(next) => {
                let previous = self.status();
                let active_profile_id = if next.profile(&previous.active_profile_id).is_some() {
                    previous.active_profile_id
                } else {
                    next.default_profile.clone()
                };
                let status = ProfileStatus {
                    generation: previous.generation.saturating_add(1),
                    active_profile_id,
                    config_path: self.config_path.display().to_string(),
                    watching: previous.watching,
                    last_loaded_at_ms: now_ms(),
                    last_event: reason.to_string(),
                    last_error: String::new(),
                    schema_version: next.schema_version,
                    profiles: next.profiles.clone(),
                };
                *self
                    .file
                    .write()
                    .map_err(|_| "profile configuration poisoned".to_string())? = next;
                *self
                    .state
                    .write()
                    .map_err(|_| "profile status poisoned".to_string())? = status.clone();
                Ok(status)
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

    pub fn restore_defaults(&self) -> Result<ProfileStatus, String> {
        seed_config(&self.config_path, true)?;
        self.reload("restored built-in profiles")
    }

    pub fn open_directory(&self) -> Result<(), String> {
        let directory = self
            .config_path
            .parent()
            .ok_or_else(|| "profile config directory is unavailable".to_string())?;
        open_path(directory)
    }

    fn spawn_watcher(&self) -> Result<(), String> {
        let handle = self.clone();
        let directory = self
            .config_path
            .parent()
            .ok_or_else(|| "profile config directory is unavailable".to_string())?
            .to_path_buf();
        thread::Builder::new()
            .name("junkpile-io-profile-watcher".into())
            .spawn(move || {
                let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
                let mut watcher: RecommendedWatcher = match notify::recommended_watcher(move |event| {
                    let _ = tx.send(event);
                }) {
                    Ok(watcher) => watcher,
                    Err(error) => {
                        handle.set_watcher_error(format!("could not create profile watcher: {error}"));
                        return;
                    }
                };
                if let Err(error) = watcher.watch(&directory, RecursiveMode::NonRecursive) {
                    handle.set_watcher_error(format!("could not watch profile directory: {error}"));
                    return;
                }

                while let Ok(event) = rx.recv() {
                    let event = match event {
                        Ok(event) => event,
                        Err(error) => {
                            handle.set_watcher_error(format!("profile watcher event error: {error}"));
                            continue;
                        }
                    };
                    if !event.paths.iter().any(|path| same_path(path, &handle.config_path)) {
                        continue;
                    }
                    let debounce_ms = handle
                        .file
                        .read()
                        .ok()
                        .map(|file| file.hot_reload.debounce_ms)
                        .unwrap_or(250);
                    let enabled = handle
                        .file
                        .read()
                        .ok()
                        .map(|file| file.hot_reload.enabled)
                        .unwrap_or(true);
                    if !enabled {
                        continue;
                    }
                    thread::sleep(Duration::from_millis(debounce_ms));
                    while rx.try_recv().is_ok() {}
                    let _ = handle.reload("filesystem hot reload");
                }
            })
            .map_err(|error| format!("could not start profile watcher thread: {error}"))?;
        Ok(())
    }

    fn set_watcher_error(&self, error: String) {
        if let Ok(mut status) = self.state.write() {
            status.watching = false;
            status.last_error = error;
            status.last_event = "watcher stopped".into();
        }
    }
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
    Ok(directory.join("io-profiles.json"))
}

fn load_file(path: &Path) -> Result<ProfileFile, String> {
    let text = fs::read_to_string(path)
        .map_err(|error| format!("could not read {}: {error}", path.display()))?;
    let file: ProfileFile = serde_json::from_str(&text)
        .map_err(|error| format!("I/O profile schema error: {error}"))?;
    file.validate()?;
    Ok(file)
}

fn seed_config(path: &Path, force: bool) -> Result<(), String> {
    let directory = path
        .parent()
        .ok_or_else(|| "profile config directory is unavailable".to_string())?;
    fs::create_dir_all(directory)
        .map_err(|error| format!("could not create profile config directory: {error}"))?;
    if force || !path.exists() {
        fs::write(path, DEFAULT_PROFILE_JSON)
            .map_err(|error| format!("could not write {}: {error}", path.display()))?;
    }
    Ok(())
}

fn same_path(left: &Path, right: &Path) -> bool {
    left == right || (left.file_name() == right.file_name() && left.parent() == right.parent())
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn open_path(path: &Path) -> Result<(), String> {
    let mut command = if cfg!(target_os = "macos") {
        Command::new("open")
    } else if cfg!(target_os = "windows") {
        Command::new("explorer")
    } else {
        Command::new("xdg-open")
    };
    command
        .arg(path)
        .spawn()
        .map_err(|error| format!("could not open {}: {error}", path.display()))?;
    Ok(())
}
