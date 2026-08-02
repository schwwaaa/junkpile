#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod frame;
mod output;
mod recording;
mod renderer;

use renderer::{RenderCommand, RendererHandle, RuntimeSnapshot};
use std::{path::PathBuf, process::Command};
use tauri::Manager;

#[tauri::command]
fn get_runtime_snapshot(state: tauri::State<'_, RendererHandle>) -> RuntimeSnapshot {
    state.snapshot()
}

#[tauri::command]
fn start_recording(
    state: tauri::State<'_, RendererHandle>,
    profile: String,
    width: u32,
    height: u32,
    fps: u32,
    worker_delay_ms: u64,
) -> Result<String, String> {
    state.start_recording(profile, width, height, fps, worker_delay_ms)
}

#[tauri::command]
fn stop_recording(state: tauri::State<'_, RendererHandle>) -> Result<(), String> {
    state.stop_recording()
}

#[tauri::command]
fn open_recordings_folder(state: tauri::State<'_, RendererHandle>) -> Result<String, String> {
    let snapshot = state.snapshot();
    let path = if snapshot.recording.output_path.is_empty() {
        std::env::current_dir()
            .map_err(|error| error.to_string())?
            .join("recordings")
    } else {
        PathBuf::from(snapshot.recording.output_path)
            .parent()
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("recordings"))
    };
    std::fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    open_path(&path)?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn toggle_renderer_fullscreen(app: tauri::AppHandle) -> Result<bool, String> {
    let window = app
        .get_window("renderer")
        .ok_or_else(|| "renderer window is not available".to_string())?;
    let next = !window.is_fullscreen().map_err(|error| error.to_string())?;
    window
        .set_fullscreen(next)
        .map_err(|error| error.to_string())?;
    Ok(next)
}

fn open_path(path: &std::path::Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = Command::new("open");
    #[cfg(target_os = "windows")]
    let mut command = Command::new("explorer");
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = Command::new("xdg-open");

    command
        .arg(path)
        .spawn()
        .map_err(|error| format!("could not open {}: {error}", path.display()))?;
    Ok(())
}

fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let renderer_window = tauri::window::WindowBuilder::new(app, "renderer")
                .title("Junkpile 28 · FFmpeg Record · Native Surface")
                .inner_size(1280.0, 720.0)
                .min_inner_size(640.0, 360.0)
                .resizable(true)
                .build()?;

            let renderer_handle =
                renderer::start(renderer_window.clone()).map_err(std::io::Error::other)?;
            let resize_handle = renderer_handle.clone();
            renderer_window.on_window_event(move |event| match event {
                tauri::WindowEvent::Resized(size) => {
                    let _ = resize_handle.send(RenderCommand::Resize(size.width, size.height));
                }
                tauri::WindowEvent::ScaleFactorChanged { new_inner_size, .. } => {
                    let _ = resize_handle.send(RenderCommand::Resize(
                        new_inner_size.width,
                        new_inner_size.height,
                    ));
                }
                tauri::WindowEvent::Destroyed => {
                    let _ = resize_handle.send(RenderCommand::Shutdown);
                }
                _ => {}
            });

            if let Some(controls) = app.get_webview_window("controls") {
                let app_handle = app.handle().clone();
                controls.on_window_event(move |event| {
                    if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                        app_handle.exit(0);
                    }
                });
            }

            app.manage(renderer_handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_runtime_snapshot,
            start_recording,
            stop_recording,
            open_recordings_folder,
            toggle_renderer_fullscreen
        ])
        .run(tauri::generate_context!())
        .expect("error while running Junkpile FFmpeg record example");
}

fn main() {
    run();
}
