#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio;
mod renderer;

use audio::{AudioCommand, AudioHandle, AudioInfo};
use renderer::{RenderCommand, RendererHandle, RendererInfo};
use tauri::Manager;

#[tauri::command]
fn get_audio_info(state: tauri::State<'_, AudioHandle>) -> AudioInfo {
    state.info()
}

#[tauri::command]
fn refresh_audio_devices(state: tauri::State<'_, AudioHandle>) {
    state.send(AudioCommand::RefreshDevices);
}

#[tauri::command]
fn select_audio_device(state: tauri::State<'_, AudioHandle>, name: String) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("audio device name cannot be empty".into());
    }
    state.send(AudioCommand::SelectDevice(name));
    Ok(())
}

#[tauri::command]
fn start_audio(state: tauri::State<'_, AudioHandle>) {
    state.send(AudioCommand::Start);
}

#[tauri::command]
fn stop_audio(state: tauri::State<'_, AudioHandle>) {
    state.send(AudioCommand::Stop);
}

#[tauri::command]
fn set_fft_size(state: tauri::State<'_, AudioHandle>, size: usize) -> Result<(), String> {
    if !matches!(size, 1024 | 2048 | 4096 | 8192) {
        return Err("FFT size must be 1024, 2048, 4096, or 8192".into());
    }
    state.send(AudioCommand::SetFftSize(size));
    Ok(())
}

#[tauri::command]
fn set_analysis_param(
    state: tauri::State<'_, AudioHandle>,
    name: String,
    value: f32,
) -> Result<(), String> {
    if !matches!(
        name.as_str(),
        "smoothing" | "input_gain" | "gate" | "transient_sensitivity"
    ) {
        return Err(format!("unknown audio-analysis parameter: {name}"));
    }
    if !value.is_finite() {
        return Err("parameter must be finite".into());
    }
    state.send(AudioCommand::SetAnalysisParam(name, value));
    Ok(())
}

#[tauri::command]
fn get_renderer_info(state: tauri::State<'_, RendererHandle>) -> RendererInfo {
    state.info()
}

#[tauri::command]
fn set_render_param(
    state: tauri::State<'_, RendererHandle>,
    name: String,
    value: f32,
) -> Result<(), String> {
    if !matches!(
        name.as_str(),
        "spectrum_gain"
            | "waveform_gain"
            | "exposure"
            | "hue"
            | "line_width"
            | "zoom"
            | "rotation"
    ) {
        return Err(format!("unknown render parameter: {name}"));
    }
    if !value.is_finite() {
        return Err("parameter must be finite".into());
    }
    state.send(RenderCommand::SetParam(name, value));
    Ok(())
}

#[tauri::command]
fn set_visualization_mode(
    state: tauri::State<'_, RendererHandle>,
    mode: u32,
) -> Result<(), String> {
    if mode > 3 {
        return Err("visualization mode must be between 0 and 3".into());
    }
    state.send(RenderCommand::SetMode(mode));
    Ok(())
}

#[tauri::command]
fn reset_visual_params(state: tauri::State<'_, RendererHandle>) {
    state.send(RenderCommand::ResetParams);
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

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let audio_handle = audio::start().map_err(std::io::Error::other)?;
            let renderer_window = tauri::window::WindowBuilder::new(app, "renderer")
                .title("Junkpile wgpu Audio Reactive Spectrum · GPU Surface")
                .inner_size(1280.0, 720.0)
                .min_inner_size(480.0, 270.0)
                .resizable(true)
                .build()?;

            let renderer_handle = renderer::start(renderer_window.clone(), audio_handle.snapshot())
                .map_err(std::io::Error::other)?;
            let resize_handle = renderer_handle.clone();
            renderer_window.on_window_event(move |event| match event {
                tauri::WindowEvent::Resized(size) => {
                    resize_handle.send(RenderCommand::Resize(size.width, size.height));
                }
                tauri::WindowEvent::ScaleFactorChanged { new_inner_size, .. } => {
                    resize_handle.send(RenderCommand::Resize(
                        new_inner_size.width,
                        new_inner_size.height,
                    ));
                }
                tauri::WindowEvent::Destroyed => {
                    resize_handle.send(RenderCommand::Shutdown);
                }
                _ => {}
            });

            if let Some(controls) = app.get_webview_window("controls") {
                let app_handle = app.handle().clone();
                let close_audio = audio_handle.clone();
                let close_renderer = renderer_handle.clone();
                controls.on_window_event(move |event| {
                    if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                        close_audio.send(AudioCommand::Shutdown);
                        close_renderer.send(RenderCommand::Shutdown);
                        app_handle.exit(0);
                    }
                });
            }

            app.manage(audio_handle);
            app.manage(renderer_handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_audio_info,
            refresh_audio_devices,
            select_audio_device,
            start_audio,
            stop_audio,
            set_fft_size,
            set_analysis_param,
            get_renderer_info,
            set_render_param,
            set_visualization_mode,
            reset_visual_params,
            toggle_renderer_fullscreen
        ])
        .run(tauri::generate_context!())
        .expect("error running wgpu audio reactive spectrum");
}
