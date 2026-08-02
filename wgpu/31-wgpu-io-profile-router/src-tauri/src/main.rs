#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config;
mod frame;
mod output;
mod profile;
mod recording;
mod renderer;

use config::{ProfileConfigHandle, ProfileStatus};
use renderer::{RenderCommand, RendererHandle, RuntimeSnapshot};
use std::{path::PathBuf, process::Command};
use tauri::Manager;

#[tauri::command]
fn get_runtime_snapshot(state: tauri::State<'_, RendererHandle>) -> RuntimeSnapshot {
    state.snapshot()
}

#[tauri::command]
fn get_profile_status(state: tauri::State<'_, ProfileConfigHandle>) -> ProfileStatus {
    state.status()
}

#[tauri::command]
fn select_io_profile(
    profiles: tauri::State<'_, ProfileConfigHandle>,
    renderer: tauri::State<'_, RendererHandle>,
    profile_id: String,
) -> Result<ProfileStatus, String> {
    let profile = profiles.profile(&profile_id)?;
    renderer.prepare_profile(profile.frame.width, profile.frame.height, profile.recording.fps)?;
    profiles.select(&profile_id)
}

#[tauri::command]
fn reload_io_profiles(
    state: tauri::State<'_, ProfileConfigHandle>,
) -> Result<ProfileStatus, String> {
    state.reload("manual reload")
}

#[tauri::command]
fn restore_io_profiles(
    state: tauri::State<'_, ProfileConfigHandle>,
) -> Result<ProfileStatus, String> {
    state.restore_defaults()
}

#[tauri::command]
fn open_profile_config_folder(
    state: tauri::State<'_, ProfileConfigHandle>,
) -> Result<(), String> {
    state.open_directory()
}

#[tauri::command]
fn start_profile_recording(
    profiles: tauri::State<'_, ProfileConfigHandle>,
    renderer: tauri::State<'_, RendererHandle>,
) -> Result<String, String> {
    let profile = profiles.active_profile()?;
    if !profile.recording.enabled {
        return Err(format!(
            "profile '{}' is preview-only and has no file recording route",
            profile.label
        ));
    }
    renderer.start_recording(
        profile.recording.codec.as_renderer_value().to_string(),
        profile.frame.width,
        profile.frame.height,
        profile.recording.fps,
        profile.recording.worker_delay_ms,
    )
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
                .title("Junkpile 31 · I/O Profile Router · Native Surface")
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

            let profile_handle = ProfileConfigHandle::start(app.handle())
                .map_err(std::io::Error::other)?;
            let initial_profile = profile_handle.active_profile().map_err(std::io::Error::other)?;
            renderer_handle
                .prepare_profile(
                    initial_profile.frame.width,
                    initial_profile.frame.height,
                    initial_profile.recording.fps,
                )
                .map_err(std::io::Error::other)?;
            app.manage(renderer_handle);
            app.manage(profile_handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_runtime_snapshot,
            get_profile_status,
            select_io_profile,
            reload_io_profiles,
            restore_io_profiles,
            open_profile_config_folder,
            start_profile_recording,
            stop_recording,
            open_recordings_folder,
            toggle_renderer_fullscreen
        ])
        .run(tauri::generate_context!())
        .expect("error while running Junkpile I/O profile router example");
}

fn main() {
    run();
}
