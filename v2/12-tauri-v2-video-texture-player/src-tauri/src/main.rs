#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::fs;
use tauri::Manager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VideoSelection { path: String, name: String, size_bytes: u64 }

#[tauri::command]
fn inspect_video_file(app: tauri::AppHandle, path: String) -> Result<VideoSelection, String> {
    let canonical_path = fs::canonicalize(&path).map_err(|e| format!("Could not resolve selected video: {e}"))?;
    let metadata = fs::metadata(&canonical_path).map_err(|e| format!("Could not inspect selected video: {e}"))?;
    if !metadata.is_file() { return Err("The selected path is not a file".into()); }
    app.asset_protocol_scope().allow_file(&canonical_path).map_err(|e| format!("Could not authorize selected video: {e}"))?;
    let name = canonical_path.file_name().and_then(|v| v.to_str()).unwrap_or("video").to_string();
    let path = canonical_path.to_str().ok_or("The selected video path is not valid UTF-8")?.to_string();
    Ok(VideoSelection { path, name, size_bytes: metadata.len() })
}

#[tauri::command]
fn write_png(path: String, bytes: Vec<u8>) -> Result<String, String> {
    fs::write(&path, bytes).map_err(|e| format!("Could not save PNG: {e}"))?; Ok(path)
}

#[tauri::command]
fn toggle_fullscreen(app: tauri::AppHandle) -> Result<bool, String> {
    let window=app.get_webview_window("main").ok_or("Main window is unavailable")?;
    let next=!window.is_fullscreen().map_err(|e|format!("Could not read fullscreen state: {e}"))?;
    window.set_fullscreen(next).map_err(|e|format!("Could not change fullscreen state: {e}"))?; Ok(next)
}

fn main() {
    tauri::Builder::default().plugin(tauri_plugin_dialog::init())
      .invoke_handler(tauri::generate_handler![inspect_video_file, write_png, toggle_fullscreen])
      .run(tauri::generate_context!()).expect("error while running Junkpile Tauri v2 example 12");
}
