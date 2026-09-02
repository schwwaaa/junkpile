#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio;
mod config;
mod preview;
mod renderer;

use audio::{AudioAnalysisFrame, AudioDeviceInfo, AudioHandle, AudioSnapshot};
use config::PreviewScaleMode;
use renderer::{RenderCommand, RendererHandle, RendererSnapshot};
use tauri::Manager;

#[tauri::command]
fn list_audio_inputs() -> Result<Vec<AudioDeviceInfo>, String> {
    audio::list_input_devices()
}

#[tauri::command]
fn get_audio_snapshot(state: tauri::State<'_, AudioHandle>) -> AudioSnapshot {
    state.snapshot()
}

#[tauri::command]
fn get_audio_analysis_frame(state: tauri::State<'_, AudioHandle>) -> AudioAnalysisFrame {
    state.analysis_frame()
}

#[tauri::command]
fn start_microphone(device_name: String, state: tauri::State<'_, AudioHandle>) -> Result<(), String> {
    state.start_input(device_name)
}

#[tauri::command]
fn stop_microphone(state: tauri::State<'_, AudioHandle>) -> Result<(), String> {
    state.stop_input()
}

#[tauri::command]
fn set_audio_parameter(
    name: String,
    value: f32,
    state: tauri::State<'_, AudioHandle>,
) -> Result<(), String> {
    match name.as_str() {
        "gain" => state.set_gain(value),
        "smoothing" => state.set_smoothing(value),
        "beatThreshold" => state.set_beat_threshold(value),
        "beatHoldMs" => state.set_beat_hold(value.round().max(0.0) as u32),
        _ => Err(format!("unknown audio parameter '{name}'")),
    }
}

#[tauri::command]
fn get_renderer_snapshot(state: tauri::State<'_, RendererHandle>) -> RendererSnapshot {
    state.snapshot()
}

#[tauri::command]
fn set_visual_mode(mode: u32, state: tauri::State<'_, RendererHandle>) -> Result<(), String> {
    state.set_visual_mode(mode)
}

#[tauri::command]
fn set_visual_parameter(
    name: String,
    value: f32,
    state: tauri::State<'_, RendererHandle>,
) -> Result<(), String> {
    state.set_visual_parameter(name, value)
}

#[tauri::command]
fn set_demo_when_idle(enabled: bool, state: tauri::State<'_, RendererHandle>) -> Result<(), String> {
    state.set_demo_when_idle(enabled)
}

#[tauri::command]
fn set_render_resolution(
    width: u32,
    height: u32,
    state: tauri::State<'_, RendererHandle>,
) -> Result<(), String> {
    state.set_resolution(width, height)
}

#[tauri::command]
fn set_preview_mode(mode: String, state: tauri::State<'_, RendererHandle>) -> Result<(), String> {
    let mode = match mode.as_str() {
        "fit" => PreviewScaleMode::Fit,
        "fill" => PreviewScaleMode::Fill,
        "stretch" => PreviewScaleMode::Stretch,
        "pixel" => PreviewScaleMode::Pixel,
        _ => return Err(format!("unknown preview mode '{mode}'")),
    };
    state.set_preview_mode(mode)
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

#[tauri::command]
fn reset_diagnostics(
    audio: tauri::State<'_, AudioHandle>,
    renderer: tauri::State<'_, RendererHandle>,
) -> Result<(), String> {
    audio.reset_metrics()?;
    renderer.send(RenderCommand::ResetMetrics)
}

fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let audio_handle = AudioHandle::start().map_err(std::io::Error::other)?;
            let renderer_window = tauri::window::WindowBuilder::new(app, "renderer")
                .title("Junkpile · Audio Reactive FFT · Native wgpu")
                .inner_size(1280.0, 720.0)
                .min_inner_size(320.0, 240.0)
                .resizable(true)
                .build()?;

            let renderer_handle = renderer::start(renderer_window.clone(), audio_handle.shared())
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

            app.manage(audio_handle);
            app.manage(renderer_handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_audio_inputs,
            get_audio_snapshot,
            get_audio_analysis_frame,
            start_microphone,
            stop_microphone,
            set_audio_parameter,
            get_renderer_snapshot,
            set_visual_mode,
            set_visual_parameter,
            set_demo_when_idle,
            set_render_resolution,
            set_preview_mode,
            toggle_renderer_fullscreen,
            reset_diagnostics
        ])
        .run(tauri::generate_context!())
        .expect("error while running Junkpile wgpu audio-reactive FFT");
}

fn main() {
    run();
}
