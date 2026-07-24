#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::fs;
use tauri::Manager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VideoSelection {
    path: String,
    name: String,
    size_bytes: u64,
}

#[tauri::command]
fn inspect_video_file(app: tauri::AppHandle, path: String) -> Result<VideoSelection, String> {
    let canonical_path = fs::canonicalize(&path)
        .map_err(|error| format!("Could not resolve selected video: {error}"))?;
    let metadata = fs::metadata(&canonical_path)
        .map_err(|error| format!("Could not inspect selected video: {error}"))?;
    if !metadata.is_file() {
        return Err("The selected path is not a file".to_string());
    }

    app.asset_protocol_scope()
        .allow_file(&canonical_path)
        .map_err(|error| format!("Could not authorize selected video: {error}"))?;

    let name = canonical_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("video")
        .to_string();
    let path = canonical_path
        .to_str()
        .ok_or_else(|| "The selected video path is not valid UTF-8".to_string())?
        .to_string();

    Ok(VideoSelection {
        path,
        name,
        size_bytes: metadata.len(),
    })
}

#[tauri::command]
fn write_png(path: String, bytes: Vec<u8>) -> Result<String, String> {
    fs::write(&path, bytes).map_err(|error| format!("Could not save PNG: {error}"))?;
    Ok(path)
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
            inspect_video_file,
            write_png,
            toggle_fullscreen
        ])
        .run(tauri::generate_context!())
        .expect("error while running Junkpile Tauri v2 example 12");
}
