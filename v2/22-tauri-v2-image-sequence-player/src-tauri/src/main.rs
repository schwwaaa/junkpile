#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::{fs, io::Write, path::{Path, PathBuf}};
use tauri::{ipc::Response, Manager, PhysicalPosition, PhysicalSize};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MonitorInfo { name: String, width: u32, height: u32, x: i32, y: i32, scale_factor: f64 }

fn is_image(path: &Path) -> bool {
    path.extension().and_then(|value| value.to_str()).map(|value| {
        matches!(value.to_ascii_lowercase().as_str(), "png" | "jpg" | "jpeg" | "webp" | "bmp" | "gif" | "tif" | "tiff" | "avif")
    }).unwrap_or(false)
}

fn collect_images(dir: &Path, recursive: bool, out: &mut Vec<PathBuf>) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|error| format!("Could not read {}: {error}", dir.display()))?;
    for entry in entries {
        let path = entry.map_err(|error| format!("Could not read directory entry: {error}"))?.path();
        if path.is_dir() && recursive { collect_images(&path, true, out)?; }
        else if path.is_file() && is_image(&path) { out.push(path); }
    }
    Ok(())
}

fn resolve_image(path: &str) -> Result<PathBuf, String> {
    let canonical = fs::canonicalize(path).map_err(|error| format!("Could not resolve frame: {error}"))?;
    if !canonical.is_file() { return Err("The selected frame is not a file".into()); }
    if !is_image(&canonical) { return Err("The selected frame is not a supported image".into()); }
    Ok(canonical)
}

#[tauri::command]
fn scan_sequence_directory(path: String, recursive: bool) -> Result<Vec<String>, String> {
    let root = fs::canonicalize(path).map_err(|error| format!("Could not resolve sequence folder: {error}"))?;
    if !root.is_dir() { return Err("The selected path is not a directory".into()); }
    let mut images = Vec::new();
    collect_images(&root, recursive, &mut images)?;
    Ok(images.into_iter().map(|path| path.to_string_lossy().into_owned()).collect())
}

#[tauri::command]
fn read_image_file(path: String) -> Result<Response, String> {
    let canonical = resolve_image(&path)?;
    let bytes = fs::read(canonical).map_err(|error| format!("Could not read frame: {error}"))?;
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
    let mut file = fs::OpenOptions::new().append(true).open(&path).map_err(|error| format!("Could not open output: {error}"))?;
    file.write_all(&bytes).map_err(|error| format!("Could not append output: {error}"))?;
    Ok(bytes.len() as u64)
}

fn output_window(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, String> {
    app.get_webview_window("output").ok_or_else(|| "Sequence output window is unavailable".to_string())
}

#[tauri::command]
fn list_monitors(app: tauri::AppHandle) -> Result<Vec<MonitorInfo>, String> {
    let window = output_window(&app)?;
    let monitors = window.available_monitors().map_err(|error| format!("Could not enumerate displays: {error}"))?;
    Ok(monitors.into_iter().map(|monitor| MonitorInfo {
        name: monitor.name().map(ToOwned::to_owned).unwrap_or_else(|| "Display".to_string()),
        width: monitor.size().width, height: monitor.size().height,
        x: monitor.position().x, y: monitor.position().y, scale_factor: monitor.scale_factor(),
    }).collect())
}

#[tauri::command]
fn place_output(app: tauri::AppHandle, index: usize, fullscreen: bool) -> Result<String, String> {
    let window = output_window(&app)?;
    let monitors = window.available_monitors().map_err(|error| format!("Could not enumerate displays: {error}"))?;
    let monitor = monitors.get(index).or_else(|| monitors.first()).ok_or_else(|| "No displays are available".to_string())?;
    window.set_fullscreen(false).map_err(|error| format!("Could not leave fullscreen: {error}"))?;
    window.set_position(PhysicalPosition::new(monitor.position().x, monitor.position().y)).map_err(|error| format!("Could not move output: {error}"))?;
    window.set_size(PhysicalSize::new(monitor.size().width, monitor.size().height)).map_err(|error| format!("Could not resize output: {error}"))?;
    if fullscreen { window.set_fullscreen(true).map_err(|error| format!("Could not enter fullscreen: {error}"))?; }
    window.show().map_err(|error| format!("Could not show output: {error}"))?;
    window.set_focus().map_err(|error| format!("Could not focus output: {error}"))?;
    Ok(if fullscreen { format!("Fullscreen on display {}", index + 1) } else { format!("Moved to display {}", index + 1) })
}

#[tauri::command]
fn toggle_output_fullscreen(app: tauri::AppHandle, index: usize) -> Result<bool, String> {
    let window = output_window(&app)?;
    let current = window.is_fullscreen().map_err(|error| format!("Could not read fullscreen state: {error}"))?;
    if current { window.set_fullscreen(false).map_err(|error| format!("Could not leave fullscreen: {error}"))?; Ok(false) }
    else { place_output(app, index, true)?; Ok(true) }
}

#[tauri::command]
fn show_output(app: tauri::AppHandle) -> Result<(), String> {
    let window = output_window(&app)?;
    window.show().map_err(|error| format!("Could not show output: {error}"))?;
    window.set_focus().map_err(|error| format!("Could not focus output: {error}"))
}

#[tauri::command]
fn hide_output(app: tauri::AppHandle) -> Result<(), String> {
    output_window(&app)?.hide().map_err(|error| format!("Could not hide output: {error}"))
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
            scan_sequence_directory, read_image_file, write_binary, create_binary, append_binary,
            list_monitors, place_output, toggle_output_fullscreen, show_output, hide_output
        ])
        .run(tauri::generate_context!())
        .expect("error while running Junkpile Tauri v2 example 22");
}
