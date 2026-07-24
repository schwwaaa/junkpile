#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::Write;
use tauri::{ipc::Response, Manager, PhysicalPosition, PhysicalSize};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaSelection {
    path: String,
    name: String,
    size_bytes: u64,
    kind: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MonitorInfo {
    name: String,
    width: u32,
    height: u32,
    x: i32,
    y: i32,
    scale_factor: f64,
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
    Ok(MediaSelection { path, name, size_bytes: metadata.len(), kind: kind.to_string() })
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
    fs::write(&path, bytes).map_err(|error| format!("Could not save output: {error}"))?;
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

fn output_window(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, String> {
    app.get_webview_window("output")
        .ok_or_else(|| "Projection output window is unavailable".to_string())
}

#[tauri::command]
fn list_monitors(app: tauri::AppHandle) -> Result<Vec<MonitorInfo>, String> {
    let window = output_window(&app)?;
    let monitors = window
        .available_monitors()
        .map_err(|error| format!("Could not enumerate displays: {error}"))?;
    Ok(monitors
        .into_iter()
        .map(|monitor| MonitorInfo {
            name: monitor.name().map(ToOwned::to_owned).unwrap_or_else(|| "Display".to_string()),
            width: monitor.size().width,
            height: monitor.size().height,
            x: monitor.position().x,
            y: monitor.position().y,
            scale_factor: monitor.scale_factor(),
        })
        .collect())
}

#[tauri::command]
fn place_output(app: tauri::AppHandle, index: usize, fullscreen: bool) -> Result<String, String> {
    let window = output_window(&app)?;
    let monitors = window
        .available_monitors()
        .map_err(|error| format!("Could not enumerate displays: {error}"))?;
    let monitor = monitors
        .get(index)
        .or_else(|| monitors.first())
        .ok_or_else(|| "No displays are available".to_string())?;

    window
        .set_fullscreen(false)
        .map_err(|error| format!("Could not leave fullscreen: {error}"))?;
    window
        .set_position(PhysicalPosition::new(monitor.position().x, monitor.position().y))
        .map_err(|error| format!("Could not move output: {error}"))?;
    window
        .set_size(PhysicalSize::new(monitor.size().width, monitor.size().height))
        .map_err(|error| format!("Could not resize output: {error}"))?;
    if fullscreen {
        window
            .set_fullscreen(true)
            .map_err(|error| format!("Could not enter fullscreen: {error}"))?;
    }
    window.show().map_err(|error| format!("Could not show output: {error}"))?;
    window.set_focus().map_err(|error| format!("Could not focus output: {error}"))?;
    Ok(if fullscreen {
        format!("Fullscreen on display {}", index + 1)
    } else {
        format!("Moved to display {}", index + 1)
    })
}

#[tauri::command]
fn toggle_output_fullscreen(app: tauri::AppHandle, index: usize) -> Result<bool, String> {
    let window = output_window(&app)?;
    let is_fullscreen = window
        .is_fullscreen()
        .map_err(|error| format!("Could not read fullscreen state: {error}"))?;
    if is_fullscreen {
        window
            .set_fullscreen(false)
            .map_err(|error| format!("Could not leave fullscreen: {error}"))?;
        Ok(false)
    } else {
        place_output(app, index, true)?;
        Ok(true)
    }
}

#[tauri::command]
fn show_output(app: tauri::AppHandle) -> Result<(), String> {
    let window = output_window(&app)?;
    window.show().map_err(|error| format!("Could not show output: {error}"))?;
    window.set_focus().map_err(|error| format!("Could not focus output: {error}"))?;
    Ok(())
}

#[tauri::command]
fn hide_output(app: tauri::AppHandle) -> Result<(), String> {
    output_window(&app)?
        .hide()
        .map_err(|error| format!("Could not hide output: {error}"))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .on_window_event(|window, event| {
            if window.label() == "output" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            inspect_media_file,
            read_image_file,
            write_binary,
            create_binary,
            append_binary,
            list_monitors,
            place_output,
            toggle_output_fullscreen,
            show_output,
            hide_output
        ])
        .run(tauri::generate_context!())
        .expect("error while running Junkpile Tauri v2 example 21");
}
