#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config;
mod frame;
mod ndi;
mod output;
mod output_directory;
mod platform_share;
mod profile;
mod recording;
mod renderer;
#[cfg(target_os = "macos")]
mod syphon;
#[cfg(target_os = "windows")]
mod spout;

use config::{ProfileConfigHandle, ProfileStatus};
use profile::IoProfile;
use recording::RecordingState;
use renderer::{RenderCommand, RendererHandle, RuntimeSnapshot};
use std::{path::PathBuf, process::Command};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
fn get_runtime_snapshot(state: tauri::State<'_, RendererHandle>) -> RuntimeSnapshot {
    state.snapshot()
}

#[tauri::command]
fn get_profile_status(state: tauri::State<'_, ProfileConfigHandle>) -> ProfileStatus {
    state.status()
}

fn prepare_route(
    app: &tauri::AppHandle,
    renderer: &RendererHandle,
    profile: &IoProfile,
) -> Result<(), String> {
    let snapshot = renderer.snapshot();
    if matches!(snapshot.recording.state, RecordingState::Recording | RecordingState::Finalizing)
        || snapshot.ndi.active
        || snapshot.platform_share.active
    {
        return Err("stop all active outputs before arming another route".into());
    }
    renderer.prepare_profile(
        profile.frame.width,
        profile.frame.height,
        profile.recording.fps,
    )?;
    renderer.configure_ndi(profile.ndi.to_config(profile.frame.width, profile.frame.height))?;
    renderer.configure_platform_share(
        profile
            .platform_share
            .to_config(profile.frame.width, profile.frame.height),
    )?;
    renderer.set_preview_enabled(profile.preview.enabled)?;
    let window = app
        .get_window("renderer")
        .ok_or_else(|| "renderer window is not available".to_string())?;
    if profile.preview.enabled {
        window
            .show()
            .map_err(|error| format!("could not show preview window: {error}"))?;
    } else {
        window
            .hide()
            .map_err(|error| format!("could not hide preview window: {error}"))?;
    }
    Ok(())
}

#[tauri::command]
fn select_io_profile(
    app: tauri::AppHandle,
    profiles: tauri::State<'_, ProfileConfigHandle>,
    renderer: tauri::State<'_, RendererHandle>,
    profile_id: String,
) -> Result<ProfileStatus, String> {
    let profile = profiles.profile(&profile_id)?;
    prepare_route(&app, &renderer, &profile)?;
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

fn start_recording_for_profile(
    profile: &IoProfile,
    renderer: &RendererHandle,
) -> Result<Option<String>, String> {
    if !profile.recording.enabled {
        return Ok(None);
    }
    renderer
        .start_recording(
            profile.recording.codec.as_renderer_value().to_string(),
            profile.frame.width,
            profile.frame.height,
            profile.recording.fps,
            profile.recording.worker_delay_ms,
        )
        .map(Some)
}

#[tauri::command]
fn start_profile_outputs(
    profiles: tauri::State<'_, ProfileConfigHandle>,
    renderer: tauri::State<'_, RendererHandle>,
) -> Result<String, String> {
    let profile = profiles.active_profile()?;
    if !profile.recording.enabled && !profile.ndi.enabled && !profile.platform_share.enabled {
        return Err(format!(
            "profile '{}' contains no active external output route",
            profile.label
        ));
    }

    let recording_path = start_recording_for_profile(&profile, &renderer)?;
    let mut ndi_started = false;
    if profile.ndi.enabled {
        if let Err(error) = renderer.start_ndi() {
            if recording_path.is_some() {
                let _ = renderer.stop_recording();
            }
            return Err(format!("NDI route failed to start; file route was rolled back: {error}"));
        }
        ndi_started = true;
    }
    if profile.platform_share.enabled {
        if let Err(error) = renderer.start_platform_share() {
            if ndi_started {
                let _ = renderer.stop_ndi();
            }
            if recording_path.is_some() {
                let _ = renderer.stop_recording();
            }
            return Err(format!(
                "platform-share route failed to start; earlier outputs were rolled back: {error}"
            ));
        }
    }

    let mut active = Vec::new();
    if profile.recording.enabled {
        active.push("file recording");
    }
    if profile.ndi.enabled {
        active.push("NDI");
    }
    if profile.platform_share.enabled {
        active.push("Syphon/Spout");
    }
    Ok(format!(
        "started {} for '{}'{}",
        active.join(" + "),
        profile.label,
        recording_path
            .map(|path| format!(" · {path}"))
            .unwrap_or_default()
    ))
}

#[tauri::command]
fn stop_all_outputs(state: tauri::State<'_, RendererHandle>) -> Result<(), String> {
    let snapshot = state.snapshot();
    let mut failures = Vec::new();
    if snapshot.platform_share.active {
        if let Err(error) = state.stop_platform_share() {
            failures.push(format!("platform share: {error}"));
        }
    }
    if snapshot.ndi.active {
        if let Err(error) = state.stop_ndi() {
            failures.push(format!("NDI: {error}"));
        }
    }
    if matches!(snapshot.recording.state, RecordingState::Recording | RecordingState::Finalizing) {
        if let Err(error) = state.stop_recording() {
            failures.push(format!("recording: {error}"));
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("; "))
    }
}

#[tauri::command]
fn start_profile_recording(
    profiles: tauri::State<'_, ProfileConfigHandle>,
    renderer: tauri::State<'_, RendererHandle>,
) -> Result<String, String> {
    let profile = profiles.active_profile()?;
    start_recording_for_profile(&profile, &renderer)?.ok_or_else(|| {
        format!("profile '{}' has no file recording route", profile.label)
    })
}

#[tauri::command]
fn stop_recording(state: tauri::State<'_, RendererHandle>) -> Result<(), String> {
    state.stop_recording()
}

#[tauri::command]
fn start_profile_ndi(
    profiles: tauri::State<'_, ProfileConfigHandle>,
    renderer: tauri::State<'_, RendererHandle>,
) -> Result<(), String> {
    let profile = profiles.active_profile()?;
    if !profile.ndi.enabled {
        return Err(format!("profile '{}' has no NDI route", profile.label));
    }
    renderer.start_ndi()
}

#[tauri::command]
fn stop_ndi(state: tauri::State<'_, RendererHandle>) -> Result<(), String> {
    state.stop_ndi()
}

#[tauri::command]
fn start_profile_platform_share(
    profiles: tauri::State<'_, ProfileConfigHandle>,
    renderer: tauri::State<'_, RendererHandle>,
) -> Result<(), String> {
    let profile = profiles.active_profile()?;
    if !profile.platform_share.enabled {
        return Err(format!(
            "profile '{}' has no platform-share route",
            profile.label
        ));
    }
    renderer.start_platform_share()
}

#[tauri::command]
fn stop_platform_share(state: tauri::State<'_, RendererHandle>) -> Result<(), String> {
    state.stop_platform_share()
}

#[tauri::command]
fn reset_router_metrics(state: tauri::State<'_, RendererHandle>) -> Result<(), String> {
    state.send(RenderCommand::ResetMetrics)
}

#[tauri::command]
async fn select_recording_output_folder(
    app: tauri::AppHandle,
    state: tauri::State<'_, RendererHandle>,
) -> Result<String, String> {
    let previous = PathBuf::from(state.snapshot().recording.output_directory);
    let selected = app
        .dialog()
        .file()
        .set_title("Choose Junkpile recording output folder")
        .set_directory(previous.clone())
        .blocking_pick_folder();
    let Some(selected) = selected else {
        return Ok(previous.to_string_lossy().into_owned());
    };
    let selected = selected
        .into_path()
        .map_err(|error| format!("selected folder is not a local filesystem path: {error}"))?;
    output_directory::ensure_writable_directory(&selected)?;
    state.set_output_directory(selected.clone())?;
    if let Err(error) = output_directory::save_custom_output_directory(&app, &selected) {
        let _ = state.set_output_directory(previous);
        return Err(error);
    }
    Ok(selected.to_string_lossy().into_owned())
}

#[tauri::command]
fn reset_recording_output_folder(
    app: tauri::AppHandle,
    state: tauri::State<'_, RendererHandle>,
) -> Result<String, String> {
    let previous = PathBuf::from(state.snapshot().recording.output_directory);
    let fallback = output_directory::default_output_directory(&app)?;
    output_directory::ensure_writable_directory(&fallback)?;
    state.set_output_directory(fallback.clone())?;
    if let Err(error) = output_directory::clear_custom_output_directory(&app) {
        let _ = state.set_output_directory(previous);
        return Err(error);
    }
    Ok(fallback.to_string_lossy().into_owned())
}

#[tauri::command]
fn open_recordings_folder(state: tauri::State<'_, RendererHandle>) -> Result<String, String> {
    let snapshot = state.snapshot();
    let path = PathBuf::from(snapshot.recording.output_directory);
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

#[tauri::command]
fn show_renderer_window(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_window("renderer")
        .ok_or_else(|| "renderer window is not available".to_string())?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
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
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let renderer_window = tauri::window::WindowBuilder::new(app, "renderer")
                .title("Junkpile 39 · Cross-Platform Output Router · Native Surface")
                .inner_size(1280.0, 720.0)
                .min_inner_size(640.0, 360.0)
                .resizable(true)
                .build()?;

            let recording_directory = output_directory::load_effective_output_directory(app.handle())
                .or_else(|error| {
                    eprintln!("Junkpile output-directory preference ignored: {error}");
                    output_directory::default_output_directory(app.handle())
                })
                .map_err(std::io::Error::other)?;

            let renderer_handle = renderer::start(renderer_window.clone(), recording_directory)
                .map_err(std::io::Error::other)?;
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
            prepare_route(app.handle(), &renderer_handle, &initial_profile)
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
            start_profile_outputs,
            stop_all_outputs,
            start_profile_recording,
            stop_recording,
            start_profile_ndi,
            stop_ndi,
            start_profile_platform_share,
            stop_platform_share,
            reset_router_metrics,
            select_recording_output_folder,
            reset_recording_output_folder,
            open_recordings_folder,
            toggle_renderer_fullscreen,
            show_renderer_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running Junkpile cross-platform output router example");
}

fn main() {
    run();
}
