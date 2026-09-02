#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod appliance;
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

use appliance::{ApplianceHandle, ApplianceStatus};
use config::{ProfileConfigHandle, ProfileStatus};
use profile::IoProfile;
use recording::RecordingState;
use renderer::{RenderCommand, RendererHandle, RuntimeSnapshot};
use std::{path::PathBuf, process::Command, thread, time::Duration};
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

#[tauri::command]
fn get_appliance_status(state: tauri::State<'_, ApplianceHandle>) -> ApplianceStatus {
    state.status()
}

fn prepare_route(
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
    Ok(())
}

fn prepare_and_apply_route(
    app: &tauri::AppHandle,
    renderer: &RendererHandle,
    appliance: &ApplianceHandle,
    profile: &IoProfile,
) -> Result<(), String> {
    prepare_route(renderer, profile)?;
    appliance::apply_window_policy(
        app,
        renderer,
        profile.preview.enabled,
        &appliance.config(),
    )
}

#[tauri::command]
fn select_io_profile(
    app: tauri::AppHandle,
    profiles: tauri::State<'_, ProfileConfigHandle>,
    renderer: tauri::State<'_, RendererHandle>,
    appliance: tauri::State<'_, ApplianceHandle>,
    profile_id: String,
) -> Result<ProfileStatus, String> {
    let profile = profiles.profile(&profile_id)?;
    prepare_and_apply_route(&app, &renderer, &appliance, &profile)?;
    let status = profiles.select(&profile_id)?;
    appliance.set_event(format!("armed profile: {}", profile.label));
    let _ = appliance.write_status(&renderer, &profiles);
    Ok(status)
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

fn start_outputs_for_profile(
    profile: &IoProfile,
    renderer: &RendererHandle,
) -> Result<String, String> {
    if !profile.recording.enabled && !profile.ndi.enabled && !profile.platform_share.enabled {
        return Err(format!(
            "profile '{}' contains no active external output route",
            profile.label
        ));
    }

    let recording_path = start_recording_for_profile(profile, renderer)?;
    let mut ndi_started = false;
    if profile.ndi.enabled {
        if let Err(error) = renderer.start_ndi() {
            if recording_path.is_some() {
                let _ = renderer.stop_recording();
            }
            return Err(format!(
                "NDI route failed to start; file route was rolled back: {error}"
            ));
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
fn start_profile_outputs(
    profiles: tauri::State<'_, ProfileConfigHandle>,
    renderer: tauri::State<'_, RendererHandle>,
    appliance: tauri::State<'_, ApplianceHandle>,
) -> Result<String, String> {
    let profile = profiles.active_profile()?;
    match start_outputs_for_profile(&profile, &renderer) {
        Ok(message) => {
            appliance.set_event(message.clone());
            let _ = appliance.write_status(&renderer, &profiles);
            Ok(message)
        }
        Err(error) => {
            appliance.set_error(error.clone());
            let _ = appliance.write_status(&renderer, &profiles);
            Err(error)
        }
    }
}

fn stop_outputs(renderer: &RendererHandle) -> Result<(), String> {
    let snapshot = renderer.snapshot();
    let mut failures = Vec::new();
    if snapshot.platform_share.active {
        if let Err(error) = renderer.stop_platform_share() {
            failures.push(format!("platform share: {error}"));
        }
    }
    if snapshot.ndi.active {
        if let Err(error) = renderer.stop_ndi() {
            failures.push(format!("NDI: {error}"));
        }
    }
    if matches!(
        snapshot.recording.state,
        RecordingState::Recording | RecordingState::Finalizing
    ) {
        if let Err(error) = renderer.stop_recording() {
            failures.push(format!("recording: {error}"));
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("; "))
    }
}

fn stop_outputs_and_wait(renderer: &RendererHandle) -> Result<(), String> {
    stop_outputs(renderer)?;
    for _ in 0..150 {
        let state = renderer.snapshot().recording.state;
        if !matches!(state, RecordingState::Recording | RecordingState::Finalizing) {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(100));
    }
    Err("recording did not finalize before the shutdown deadline".into())
}

#[tauri::command]
fn stop_all_outputs(
    state: tauri::State<'_, RendererHandle>,
    profiles: tauri::State<'_, ProfileConfigHandle>,
    appliance: tauri::State<'_, ApplianceHandle>,
) -> Result<(), String> {
    match stop_outputs(&state) {
        Ok(()) => {
            appliance.set_event("all outputs stopped");
            let _ = appliance.write_status(&state, &profiles);
            Ok(())
        }
        Err(error) => {
            appliance.set_error(error.clone());
            Err(error)
        }
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
fn reload_appliance_config(
    state: tauri::State<'_, ApplianceHandle>,
) -> Result<ApplianceStatus, String> {
    state.reload()?;
    Ok(state.status())
}

#[tauri::command]
fn restore_appliance_config(
    state: tauri::State<'_, ApplianceHandle>,
) -> Result<ApplianceStatus, String> {
    state.restore_defaults()?;
    Ok(state.status())
}

#[tauri::command]
fn apply_appliance_config(
    app: tauri::AppHandle,
    renderer: tauri::State<'_, RendererHandle>,
    profiles: tauri::State<'_, ProfileConfigHandle>,
    appliance: tauri::State<'_, ApplianceHandle>,
) -> Result<String, String> {
    stop_outputs_and_wait(&renderer)?;
    let config = appliance.reload()?;
    let profile = profiles.profile(&config.startup_profile)?;
    prepare_route(&renderer, &profile)?;
    profiles.select(&profile.id)?;
    appliance::apply_window_policy(&app, &renderer, profile.preview.enabled, &config)?;
    appliance.set_controls_visible(config.controls_visible);
    let message = if config.auto_start_outputs {
        start_outputs_for_profile(&profile, &renderer)?
    } else {
        format!("applied appliance profile '{}' without starting outputs", profile.label)
    };
    appliance.set_event(message.clone());
    let _ = appliance.write_status(&renderer, &profiles);
    Ok(message)
}

#[tauri::command]
fn write_appliance_status(
    renderer: tauri::State<'_, RendererHandle>,
    profiles: tauri::State<'_, ProfileConfigHandle>,
    appliance: tauri::State<'_, ApplianceHandle>,
) -> Result<ApplianceStatus, String> {
    appliance.write_status(&renderer, &profiles)
}

#[tauri::command]
fn open_appliance_config_folder(
    appliance: tauri::State<'_, ApplianceHandle>,
) -> Result<(), String> {
    let directory = appliance
        .config_path()
        .parent()
        .ok_or_else(|| "appliance config directory is unavailable".to_string())?;
    open_path(directory)
}

#[tauri::command]
fn open_appliance_status_folder(
    appliance: tauri::State<'_, ApplianceHandle>,
) -> Result<(), String> {
    let path = appliance.status_path();
    let directory = path
        .parent()
        .ok_or_else(|| "appliance status directory is unavailable".to_string())?;
    open_path(directory)
}

#[tauri::command]
fn hide_controls_window(
    app: tauri::AppHandle,
    appliance: tauri::State<'_, ApplianceHandle>,
) -> Result<(), String> {
    let controls = app
        .get_webview_window("controls")
        .ok_or_else(|| "controls window is not available".to_string())?;
    controls.hide().map_err(|error| error.to_string())?;
    appliance.set_controls_visible(false);
    Ok(())
}

#[tauri::command]
fn shutdown_appliance(
    app: tauri::AppHandle,
    renderer: tauri::State<'_, RendererHandle>,
    profiles: tauri::State<'_, ProfileConfigHandle>,
    appliance: tauri::State<'_, ApplianceHandle>,
) -> Result<(), String> {
    let result = stop_outputs_and_wait(&renderer);
    if let Err(error) = &result {
        appliance.set_error(error.clone());
    } else {
        appliance.set_event("clean appliance shutdown");
    }
    let _ = appliance.write_status(&renderer, &profiles);
    appliance.stop();
    let _ = renderer.send(RenderCommand::Shutdown);
    app.exit(if result.is_ok() { 0 } else { 1 });
    result
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
fn show_renderer_window(
    app: tauri::AppHandle,
    renderer: tauri::State<'_, RendererHandle>,
    appliance: tauri::State<'_, ApplianceHandle>,
) -> Result<(), String> {
    renderer.set_preview_enabled(true)?;
    let window = app
        .get_window("renderer")
        .ok_or_else(|| "renderer window is not available".to_string())?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    appliance.set_event("preview shown for inspection");
    Ok(())
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
                .title("Junkpile 41 · Appliance Runtime · Native Surface")
                .inner_size(1280.0, 720.0)
                .min_inner_size(640.0, 360.0)
                .resizable(true)
                .build()?;

            let recording_directory =
                output_directory::load_effective_output_directory(app.handle())
                    .or_else(|error| {
                        eprintln!("Junkpile output-directory preference ignored: {error}");
                        output_directory::default_output_directory(app.handle())
                    })
                    .map_err(std::io::Error::other)?;

            let renderer_handle = renderer::start(renderer_window.clone(), recording_directory)
                .map_err(std::io::Error::other)?;
            let resize_handle = renderer_handle.clone();
            let close_window = renderer_window.clone();
            renderer_window.on_window_event(move |event| match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = resize_handle.set_preview_enabled(false);
                    let _ = close_window.hide();
                }
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

            let profile_handle =
                ProfileConfigHandle::start(app.handle()).map_err(std::io::Error::other)?;
            let appliance_handle = ApplianceHandle::start(
                app.handle(),
                &renderer_handle,
                &profile_handle,
            )
            .map_err(std::io::Error::other)?;
            let appliance_config = appliance_handle.config();
            let initial_profile = profile_handle
                .profile(&appliance_config.startup_profile)
                .map_err(std::io::Error::other)?;
            prepare_route(&renderer_handle, &initial_profile).map_err(std::io::Error::other)?;
            profile_handle
                .select(&initial_profile.id)
                .map_err(std::io::Error::other)?;
            appliance::apply_window_policy(
                app.handle(),
                &renderer_handle,
                initial_profile.preview.enabled,
                &appliance_config,
            )
            .map_err(std::io::Error::other)?;
            appliance_handle.set_controls_visible(appliance_config.controls_visible);

            if let Some(controls) = app.get_webview_window("controls") {
                let app_for_close = app.handle().clone();
                let renderer_for_close = renderer_handle.clone();
                let profiles_for_close = profile_handle.clone();
                let appliance_for_close = appliance_handle.clone();
                controls.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let app_handle = app_for_close.clone();
                        let renderer = renderer_for_close.clone();
                        let profiles = profiles_for_close.clone();
                        let appliance = appliance_for_close.clone();
                        let _ = thread::Builder::new()
                            .name("junkpile-appliance-window-shutdown".into())
                            .spawn(move || {
                                let result = stop_outputs_and_wait(&renderer);
                                match result {
                                    Ok(()) => appliance.set_event("clean shutdown from controls window"),
                                    Err(error) => appliance.set_error(error),
                                }
                                let _ = appliance.write_status(&renderer, &profiles);
                                appliance.stop();
                                let _ = renderer.send(RenderCommand::Shutdown);
                                app_handle.exit(0);
                            });
                    }
                });
            }

            if appliance_config.auto_start_outputs {
                match start_outputs_for_profile(&initial_profile, &renderer_handle) {
                    Ok(message) => appliance_handle.set_event(message),
                    Err(error) => appliance_handle.set_error(error),
                }
            } else {
                appliance_handle.set_event(format!(
                    "armed '{}' and waiting for output start",
                    initial_profile.label
                ));
            }
            let _ = appliance_handle.write_status(&renderer_handle, &profile_handle);

            if let Some(seconds) = appliance_config.exit_after_seconds {
                let app_handle = app.handle().clone();
                let renderer_for_exit = renderer_handle.clone();
                let profiles_for_exit = profile_handle.clone();
                let appliance_for_exit = appliance_handle.clone();
                thread::Builder::new()
                    .name("junkpile-appliance-exit-timer".into())
                    .spawn(move || {
                        thread::sleep(Duration::from_secs(seconds));
                        let result = stop_outputs_and_wait(&renderer_for_exit);
                        match result {
                            Ok(()) => appliance_for_exit.set_event(format!(
                                "automatic shutdown after {seconds} seconds"
                            )),
                            Err(error) => appliance_for_exit.set_error(error),
                        }
                        let _ = appliance_for_exit
                            .write_status(&renderer_for_exit, &profiles_for_exit);
                        appliance_for_exit.stop();
                        let _ = renderer_for_exit.send(RenderCommand::Shutdown);
                        app_handle.exit(0);
                    })
                    .map_err(std::io::Error::other)?;
            }

            app.manage(renderer_handle);
            app.manage(profile_handle);
            app.manage(appliance_handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_runtime_snapshot,
            get_profile_status,
            get_appliance_status,
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
            reload_appliance_config,
            restore_appliance_config,
            apply_appliance_config,
            write_appliance_status,
            open_appliance_config_folder,
            open_appliance_status_folder,
            hide_controls_window,
            shutdown_appliance,
            reset_router_metrics,
            select_recording_output_folder,
            reset_recording_output_folder,
            open_recordings_folder,
            toggle_renderer_fullscreen,
            show_renderer_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running Junkpile appliance runtime example");
}

fn main() {
    run();
}
