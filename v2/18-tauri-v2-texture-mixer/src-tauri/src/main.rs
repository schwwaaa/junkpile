#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::Write;
use tauri::{ipc::Response, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaSelection {
    path: String,
    name: String,
    size_bytes: u64,
    kind: String,
}

fn extension(path: &std::path::Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

fn media_kind(path: &std::path::Path) -> Option<&'static str> {
    match extension(path).as_str() {
        "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp" | "tif" | "tiff" | "avif" => Some("image"),
        "mp4" | "mov" | "m4v" | "webm" | "mkv" | "avi" | "ogv" | "ogg" => Some("video"),
        _ => None,
    }
}

fn resolve_media_file(path: &str) -> Result<(std::path::PathBuf, fs::Metadata, &'static str), String> {
    let canonical_path = fs::canonicalize(path)
        .map_err(|error| format!("Could not resolve selected media: {error}"))?;
    let metadata = fs::metadata(&canonical_path)
        .map_err(|error| format!("Could not inspect selected media: {error}"))?;
    if !metadata.is_file() {
        return Err("The selected path is not a file".to_string());
    }
    let kind = media_kind(&canonical_path)
        .ok_or_else(|| "The selected file does not have a supported image or video extension".to_string())?;
    Ok((canonical_path, metadata, kind))
}

#[tauri::command]
fn inspect_media_file(app: tauri::AppHandle, path: String) -> Result<MediaSelection, String> {
    let (canonical_path, metadata, kind) = resolve_media_file(&path)?;

    // Videos are streamed by the WebView through Tauri's asset protocol.
    // Images are returned as binary bytes instead, so WebGL sees an origin-clean Blob URL.
    if kind == "video" {
        app.asset_protocol_scope()
            .allow_file(&canonical_path)
            .map_err(|error| format!("Could not authorize selected video: {error}"))?;
    }

    let name = canonical_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("media")
        .to_string();
    let path = canonical_path
        .to_str()
        .ok_or_else(|| "The selected media path is not valid UTF-8".to_string())?
        .to_string();

    Ok(MediaSelection {
        path,
        name,
        size_bytes: metadata.len(),
        kind: kind.to_string(),
    })
}

#[tauri::command]
fn read_image_file(path: String) -> Result<Response, String> {
    let (canonical_path, _, kind) = resolve_media_file(&path)?;
    if kind != "image" {
        return Err("Only image files can be returned through the binary image reader".to_string());
    }
    let bytes = fs::read(&canonical_path)
        .map_err(|error| format!("Could not read selected image: {error}"))?;
    Ok(Response::new(bytes))
}

#[tauri::command]
fn write_binary(path: String, bytes: Vec<u8>) -> Result<String, String> {
    fs::write(&path, bytes).map_err(|error| format!("Could not save composited frame: {error}"))?;
    Ok(path)
}

#[tauri::command]
fn create_binary(path: String) -> Result<String, String> {
    fs::File::create(&path).map_err(|error| format!("Could not create output file: {error}"))?;
    Ok(path)
}

#[tauri::command]
fn append_binary(path: String, bytes: Vec<u8>) -> Result<u64, String> {
    let mut file = OpenOptions::new()
        .append(true)
        .open(&path)
        .map_err(|error| format!("Could not open output file: {error}"))?;
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
            inspect_media_file,
            read_image_file,
            write_binary,
            create_binary,
            append_binary,
            toggle_fullscreen
        ])
        .run(tauri::generate_context!())
        .expect("error while running Junkpile Tauri v2 example 18");
}
