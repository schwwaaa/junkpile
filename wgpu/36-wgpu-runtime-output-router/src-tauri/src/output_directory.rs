use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const SETTINGS_FILE: &str = "recording-output.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct OutputDirectoryPreference {
    schema_version: u32,
    custom_output_directory: String,
}

pub fn default_output_directory(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .video_dir()
        .or_else(|_| app.path().app_data_dir())
        .map_err(|error| format!("could not resolve a default video directory: {error}"))
        .map(|path| path.join("Junkpile").join("36-wgpu-runtime-output-router"))
}

pub fn load_effective_output_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let settings_path = settings_path(app)?;
    if !settings_path.exists() {
        return default_output_directory(app);
    }

    let text = fs::read_to_string(&settings_path)
        .map_err(|error| format!("could not read {}: {error}", settings_path.display()))?;
    let preference: OutputDirectoryPreference = serde_json::from_str(&text)
        .map_err(|error| format!("could not parse {}: {error}", settings_path.display()))?;
    if preference.schema_version != 1 {
        return Err(format!(
            "unsupported output-directory settings schema {}; expected 1",
            preference.schema_version
        ));
    }

    let selected = PathBuf::from(preference.custom_output_directory);
    if !selected.is_absolute() {
        return Err(format!(
            "saved recording output directory must be absolute: {}",
            selected.display()
        ));
    }
    Ok(selected)
}

pub fn save_custom_output_directory(app: &AppHandle, path: &Path) -> Result<(), String> {
    if !path.is_absolute() {
        return Err(format!("output directory must be absolute: {}", path.display()));
    }
    let settings_path = settings_path(app)?;
    let parent = settings_path
        .parent()
        .ok_or_else(|| "output-directory settings path has no parent".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("could not create {}: {error}", parent.display()))?;

    let preference = OutputDirectoryPreference {
        schema_version: 1,
        custom_output_directory: path.to_string_lossy().into_owned(),
    };
    let serialized = serde_json::to_string_pretty(&preference)
        .map_err(|error| format!("could not serialize output-directory settings: {error}"))?;
    fs::write(&settings_path, format!("{serialized}\n"))
        .map_err(|error| format!("could not write {}: {error}", settings_path.display()))?;
    Ok(())
}

pub fn clear_custom_output_directory(app: &AppHandle) -> Result<(), String> {
    let settings_path = settings_path(app)?;
    if settings_path.exists() {
        fs::remove_file(&settings_path)
            .map_err(|error| format!("could not remove {}: {error}", settings_path.display()))?;
    }
    Ok(())
}

pub fn ensure_writable_directory(path: &Path) -> Result<(), String> {
    if !path.is_absolute() {
        return Err(format!("output directory must be absolute: {}", path.display()));
    }
    fs::create_dir_all(path)
        .map_err(|error| format!("could not create output directory {}: {error}", path.display()))?;
    if !path.is_dir() {
        return Err(format!("output path is not a directory: {}", path.display()));
    }

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let probe_path = path.join(format!(
        ".junkpile-output-write-test-{}-{stamp}",
        std::process::id()
    ));
    let probe_result = (|| -> Result<(), String> {
        let mut probe = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&probe_path)
            .map_err(|error| {
                format!(
                    "selected output directory is not writable ({}): {error}",
                    path.display()
                )
            })?;
        probe
            .write_all(b"junkpile output validation\n")
            .map_err(|error| format!("could not write to {}: {error}", path.display()))?;
        probe
            .sync_all()
            .map_err(|error| format!("could not flush a test file in {}: {error}", path.display()))?;
        Ok(())
    })();
    let _ = fs::remove_file(&probe_path);
    probe_result
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|error| format!("could not resolve the app config directory: {error}"))
        .map(|directory| directory.join(SETTINGS_FILE))
}
