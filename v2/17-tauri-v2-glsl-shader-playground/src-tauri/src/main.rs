#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::fs;
use tauri::Manager;

const MAX_SHADER_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ShaderSource {
    path: String,
    name: String,
    size_bytes: u64,
    source: String,
}

fn supported_shader_extension(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| matches!(value.to_ascii_lowercase().as_str(), "frag" | "glsl" | "fs" | "txt"))
        .unwrap_or(false)
}

#[tauri::command]
fn read_shader_file(path: String) -> Result<ShaderSource, String> {
    let canonical = fs::canonicalize(&path)
        .map_err(|error| format!("Could not resolve shader file: {error}"))?;
    let metadata = fs::metadata(&canonical)
        .map_err(|error| format!("Could not inspect shader file: {error}"))?;
    if !metadata.is_file() {
        return Err("The selected shader path is not a file".to_string());
    }
    if !supported_shader_extension(&canonical) {
        return Err("Supported shader extensions are .frag, .glsl, .fs, and .txt".to_string());
    }
    if metadata.len() > MAX_SHADER_BYTES {
        return Err(format!("Shader source is larger than the {} MiB safety limit", MAX_SHADER_BYTES / 1024 / 1024));
    }
    let source = fs::read_to_string(&canonical)
        .map_err(|error| format!("Shader source must be UTF-8 text: {error}"))?;
    let name = canonical
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("shader.frag")
        .to_string();
    let path = canonical
        .to_str()
        .ok_or_else(|| "The shader path is not valid UTF-8".to_string())?
        .to_string();
    Ok(ShaderSource { path, name, size_bytes: metadata.len(), source })
}

#[tauri::command]
fn write_binary(path: String, bytes: Vec<u8>) -> Result<String, String> {
    fs::write(&path, bytes).map_err(|error| format!("Could not save file: {error}"))?;
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
        .invoke_handler(tauri::generate_handler![read_shader_file, write_binary, toggle_fullscreen])
        .run(tauri::generate_context!())
        .expect("error while running Junkpile Tauri v2 example 17");
}
