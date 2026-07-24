#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::{fs, io::Write, path::{Path, PathBuf}};
use tauri::{ipc::Response, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioSelection {
    path: String,
    name: String,
    size_bytes: u64,
    extension: String,
}

fn audio_extension(path: &Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

fn is_audio(path: &Path) -> bool {
    matches!(
        audio_extension(path).as_str(),
        "mp3" | "wav" | "wave" | "aif" | "aiff" | "m4a" | "aac" | "flac" | "ogg" | "oga" | "opus"
    )
}

fn resolve_audio_file(path: &str) -> Result<(PathBuf, fs::Metadata), String> {
    let canonical = fs::canonicalize(path)
        .map_err(|error| format!("Could not resolve selected audio file: {error}"))?;
    let metadata = fs::metadata(&canonical)
        .map_err(|error| format!("Could not inspect selected audio file: {error}"))?;
    if !metadata.is_file() {
        return Err("The selected path is not a file".to_string());
    }
    if !is_audio(&canonical) {
        return Err("The selected file does not use a supported audio extension".to_string());
    }
    Ok((canonical, metadata))
}

#[tauri::command]
fn inspect_audio_file(path: String) -> Result<AudioSelection, String> {
    let (canonical, metadata) = resolve_audio_file(&path)?;
    let name = canonical
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("audio")
        .to_string();
    let path = canonical
        .to_str()
        .ok_or_else(|| "The selected audio path is not valid UTF-8".to_string())?
        .to_string();
    Ok(AudioSelection {
        path,
        name,
        size_bytes: metadata.len(),
        extension: audio_extension(&canonical),
    })
}

#[tauri::command]
fn read_audio_file(path: String) -> Result<Response, String> {
    let (canonical, _) = resolve_audio_file(&path)?;
    let bytes = fs::read(&canonical)
        .map_err(|error| format!("Could not read selected audio file: {error}"))?;
    Ok(Response::new(bytes))
}

#[tauri::command]
fn write_binary(path: String, bytes: Vec<u8>) -> Result<String, String> {
    fs::write(&path, bytes).map_err(|error| format!("Could not save output: {error}"))?;
    Ok(path)
}

#[tauri::command]
fn create_binary(path: String) -> Result<String, String> {
    fs::File::create(&path).map_err(|error| format!("Could not create output: {error}"))?;
    Ok(path)
}

#[tauri::command]
fn append_binary(path: String, bytes: Vec<u8>) -> Result<u64, String> {
    let mut file = fs::OpenOptions::new()
        .append(true)
        .open(&path)
        .map_err(|error| format!("Could not open output: {error}"))?;
    file.write_all(&bytes)
        .map_err(|error| format!("Could not append output data: {error}"))?;
    Ok(bytes.len() as u64)
}

#[tauri::command]
fn toggle_fullscreen(app: tauri::AppHandle) -> Result<bool, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window is unavailable".to_string())?;
    let next = !window
        .is_fullscreen()
        .map_err(|error| format!("Could not read fullscreen state: {error}"))?;
    window
        .set_fullscreen(next)
        .map_err(|error| format!("Could not change fullscreen state: {error}"))?;
    Ok(next)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            inspect_audio_file,
            read_audio_file,
            write_binary,
            create_binary,
            append_binary,
            toggle_fullscreen
        ])
        .run(tauri::generate_context!())
        .expect("error while running Junkpile Tauri v2 example 23");
}
