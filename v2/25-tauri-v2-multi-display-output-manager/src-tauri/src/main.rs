#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::Write;
use tauri::{Manager, PhysicalPosition, PhysicalSize};

const OUTPUT_LABELS: [&str; 3] = ["output-1", "output-2", "output-3"];

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

fn managed_output(app: &tauri::AppHandle, label: &str) -> Result<tauri::WebviewWindow, String> {
    if !OUTPUT_LABELS.contains(&label) {
        return Err(format!("Unknown output window: {label}"));
    }
    app.get_webview_window(label)
        .ok_or_else(|| format!("Output window {label} is unavailable"))
}

#[tauri::command]
fn current_window_label(window: tauri::WebviewWindow) -> String {
    window.label().to_string()
}

#[tauri::command]
fn list_monitors(app: tauri::AppHandle) -> Result<Vec<MonitorInfo>, String> {
    let window = managed_output(&app, "output-1")?;
    let monitors = window
        .available_monitors()
        .map_err(|error| format!("Could not enumerate displays: {error}"))?;
    Ok(monitors
        .into_iter()
        .map(|monitor| MonitorInfo {
            name: monitor
                .name()
                .map(ToOwned::to_owned)
                .unwrap_or_else(|| "Display".to_string()),
            width: monitor.size().width,
            height: monitor.size().height,
            x: monitor.position().x,
            y: monitor.position().y,
            scale_factor: monitor.scale_factor(),
        })
        .collect())
}

#[tauri::command]
fn place_output(
    app: tauri::AppHandle,
    label: String,
    index: usize,
    fullscreen: bool,
) -> Result<String, String> {
    let window = managed_output(&app, &label)?;
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
        .map_err(|error| format!("Could not move {label}: {error}"))?;
    window
        .set_size(PhysicalSize::new(monitor.size().width, monitor.size().height))
        .map_err(|error| format!("Could not resize {label}: {error}"))?;
    window
        .show()
        .map_err(|error| format!("Could not show {label}: {error}"))?;
    if fullscreen {
        window
            .set_fullscreen(true)
            .map_err(|error| format!("Could not fullscreen {label}: {error}"))?;
    }
    window
        .set_focus()
        .map_err(|error| format!("Could not focus {label}: {error}"))?;

    Ok(if fullscreen {
        format!("{label} fullscreen on display {}", index + 1)
    } else {
        format!("{label} moved to display {}", index + 1)
    })
}

#[tauri::command]
fn show_output(app: tauri::AppHandle, label: String) -> Result<(), String> {
    let window = managed_output(&app, &label)?;
    window
        .show()
        .map_err(|error| format!("Could not show {label}: {error}"))?;
    window
        .set_focus()
        .map_err(|error| format!("Could not focus {label}: {error}"))
}

#[tauri::command]
fn hide_output(app: tauri::AppHandle, label: String) -> Result<(), String> {
    managed_output(&app, &label)?
        .hide()
        .map_err(|error| format!("Could not hide {label}: {error}"))
}

#[tauri::command]
fn set_output_fullscreen(
    app: tauri::AppHandle,
    label: String,
    fullscreen: bool,
) -> Result<(), String> {
    managed_output(&app, &label)?
        .set_fullscreen(fullscreen)
        .map_err(|error| format!("Could not change fullscreen for {label}: {error}"))
}

#[tauri::command]
fn write_binary(path: String, bytes: Vec<u8>) -> Result<String, String> {
    fs::write(&path, bytes).map_err(|error| format!("Could not save file: {error}"))?;
    Ok(path)
}

#[tauri::command]
fn create_binary(path: String) -> Result<String, String> {
    fs::File::create(&path).map_err(|error| format!("Could not create file: {error}"))?;
    Ok(path)
}

#[tauri::command]
fn append_binary(path: String, bytes: Vec<u8>) -> Result<u64, String> {
    let mut file = OpenOptions::new()
        .append(true)
        .open(&path)
        .map_err(|error| format!("Could not open file: {error}"))?;
    file.write_all(&bytes)
        .map_err(|error| format!("Could not append file data: {error}"))?;
    Ok(bytes.len() as u64)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .on_window_event(|window, event| {
            if OUTPUT_LABELS.contains(&window.label()) {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            current_window_label,
            list_monitors,
            place_output,
            show_output,
            hide_output,
            set_output_fullscreen,
            write_binary,
            create_binary,
            append_binary
        ])
        .run(tauri::generate_context!())
        .expect("error while running Junkpile Tauri v2 example 25");
}
