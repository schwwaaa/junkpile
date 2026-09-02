#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio;
mod av;
mod frame;
mod output;
mod output_directory;
mod recording;
mod renderer;

use av::{AvController, AvStatus, AudioFileInfo};
use renderer::{RenderCommand, RendererHandle, RuntimeSnapshot};
use std::{path::PathBuf, process::Command};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
fn get_runtime_snapshot(state: tauri::State<'_, RendererHandle>) -> RuntimeSnapshot {
    state.snapshot()
}

#[tauri::command]
fn get_av_status(state: tauri::State<'_, AvController>) -> AvStatus {
    state.status()
}

#[tauri::command]
fn list_microphones() -> Result<Vec<audio::AudioDeviceInfo>, String> {
    audio::list_input_devices()
}

#[tauri::command]
async fn select_audio_file(
    app: tauri::AppHandle,
    renderer: tauri::State<'_, RendererHandle>,
) -> Result<Option<AudioFileInfo>, String> {
    let selected = app
        .dialog()
        .file()
        .set_title("Choose audio source")
        .blocking_pick_file();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected
        .into_path()
        .map_err(|error| format!("selected audio source is not a local filesystem path: {error}"))?;
    let ffprobe = av::ffprobe_for(&renderer.snapshot().ffmpeg.executable);
    av::probe_audio_file(&ffprobe, &path).map(Some)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn start_av_recording(
    controller: tauri::State<'_, AvController>,
    codec: String,
    width: u32,
    height: u32,
    fps: u32,
    worker_delay_ms: u64,
    audio_mode: String,
    microphone_device: String,
    audio_file: String,
) -> Result<String, String> {
    controller.start_recording(
        codec,
        width,
        height,
        fps,
        worker_delay_ms,
        audio_mode,
        microphone_device,
        audio_file,
    )
}

#[tauri::command]
fn stop_av_recording(controller: tauri::State<'_, AvController>) -> Result<(), String> {
    controller.stop_recording()
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
        .set_title("Choose Junkpile AV recording output folder")
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
    window.set_fullscreen(next).map_err(|error| error.to_string())?;
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
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let renderer_window = tauri::window::WindowBuilder::new(app, "renderer")
                .title("Junkpile · AV Recorder · Native Surface")
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

            let audio_handle = audio::AudioCaptureHandle::start().map_err(std::io::Error::other)?;
            let av_controller = AvController::new(renderer_handle.clone(), audio_handle.clone());

            if let Some(controls) = app.get_webview_window("controls") {
                let app_handle = app.handle().clone();
                let shutdown_audio = audio_handle.clone();
                controls.on_window_event(move |event| {
                    if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                        shutdown_audio.shutdown();
                        app_handle.exit(0);
                    }
                });
            }

            app.manage(renderer_handle);
            app.manage(audio_handle);
            app.manage(av_controller);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_runtime_snapshot,
            get_av_status,
            list_microphones,
            select_audio_file,
            start_av_recording,
            stop_av_recording,
            select_recording_output_folder,
            reset_recording_output_folder,
            open_recordings_folder,
            toggle_renderer_fullscreen
        ])
        .run(tauri::generate_context!())
        .expect("error while running Junkpile AV Recorder");
}

fn main() {
    run();
}
