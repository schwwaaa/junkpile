#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod camera;
mod renderer;

use camera::{CameraDevice, CameraHandle, CameraStatus};
use renderer::{RenderCommand, RendererHandle, RendererInfo};
use tauri::Manager;

#[tauri::command]
fn get_renderer_info(state: tauri::State<'_, RendererHandle>) -> RendererInfo { state.info() }

#[tauri::command]
fn get_camera_status(state: tauri::State<'_, CameraHandle>) -> CameraStatus { state.status() }

#[tauri::command]
fn list_cameras(state: tauri::State<'_, CameraHandle>) -> Vec<CameraDevice> { state.devices() }

#[tauri::command]
fn refresh_cameras(state: tauri::State<'_, CameraHandle>) { state.refresh(); }

#[tauri::command]
fn start_camera(state: tauri::State<'_, CameraHandle>, slot: usize, profile: String) -> Result<(), String> {
    if !matches!(profile.as_str(), "lowLatency" | "balanced" | "speed" | "quality") {
        return Err("profile must be lowLatency, balanced, speed, or quality".into());
    }
    state.start_camera(slot, profile);
    Ok(())
}

#[tauri::command]
fn stop_camera(state: tauri::State<'_, CameraHandle>) { state.stop_camera(); }

#[tauri::command]
fn set_param(state: tauri::State<'_, RendererHandle>, name: String, value: f32) -> Result<(), String> {
    const VALID: &[&str] = &["zoom", "exposure", "contrast", "saturation", "effectStrength", "chroma", "blockSize", "posterize"];
    if !VALID.contains(&name.as_str()) { return Err(format!("unknown parameter: {name}")); }
    if !value.is_finite() { return Err("parameter value must be finite".into()); }
    state.send(RenderCommand::SetParam(name, value));
    Ok(())
}

#[tauri::command]
fn set_mode(state: tauri::State<'_, RendererHandle>, mode: String) -> Result<(), String> {
    if !matches!(mode.as_str(), "clean" | "edge" | "lumaWarp" | "rgbSplit" | "posterize" | "blocks" | "scanlines") {
        return Err("unknown processing mode".into());
    }
    state.send(RenderCommand::SetMode(mode));
    Ok(())
}

#[tauri::command]
fn set_filter_mode(state: tauri::State<'_, RendererHandle>, mode: String) -> Result<(), String> {
    if !matches!(mode.as_str(), "nearest" | "linear") { return Err("filter must be nearest or linear".into()); }
    state.send(RenderCommand::SetFilter(mode));
    Ok(())
}

#[tauri::command]
fn set_fit_mode(state: tauri::State<'_, RendererHandle>, mode: String) -> Result<(), String> {
    if !matches!(mode.as_str(), "contain" | "cover" | "stretch") { return Err("fit must be contain, cover, or stretch".into()); }
    state.send(RenderCommand::SetFit(mode));
    Ok(())
}

#[tauri::command]
fn set_rotation(state: tauri::State<'_, RendererHandle>, rotation: u32) -> Result<(), String> {
    if !matches!(rotation, 0 | 90 | 180 | 270) { return Err("rotation must be 0, 90, 180, or 270".into()); }
    state.send(RenderCommand::SetRotation(rotation));
    Ok(())
}

#[tauri::command]
fn set_mirror(state: tauri::State<'_, RendererHandle>, mirrored: bool) { state.send(RenderCommand::SetMirror(mirrored)); }

#[tauri::command]
fn reset_params(state: tauri::State<'_, RendererHandle>) { state.send(RenderCommand::Reset); }

#[tauri::command]
fn toggle_renderer_fullscreen(app: tauri::AppHandle) -> Result<bool, String> {
    let window = app.get_window("renderer").ok_or_else(|| "renderer window is unavailable".to_string())?;
    let next = !window.is_fullscreen().map_err(|error| error.to_string())?;
    window.set_fullscreen(next).map_err(|error| error.to_string())?;
    Ok(next)
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let camera_handle = camera::start().map_err(std::io::Error::other)?;
            let renderer_window = tauri::window::WindowBuilder::new(app, "renderer")
                .title("Junkpile wgpu Native Webcam · GPU Surface")
                .inner_size(1280.0, 720.0)
                .min_inner_size(480.0, 270.0)
                .resizable(true)
                .build()?;
            let renderer_handle = renderer::start(renderer_window.clone(), camera_handle.frame_source())
                .map_err(std::io::Error::other)?;

            let resize_handle = renderer_handle.clone();
            renderer_window.on_window_event(move |event| match event {
                tauri::WindowEvent::Resized(size) => resize_handle.send(RenderCommand::Resize(size.width, size.height)),
                tauri::WindowEvent::ScaleFactorChanged { new_inner_size, .. } => resize_handle.send(RenderCommand::Resize(new_inner_size.width, new_inner_size.height)),
                tauri::WindowEvent::Destroyed => resize_handle.send(RenderCommand::Shutdown),
                _ => {}
            });

            if let Some(controls) = app.get_webview_window("controls") {
                let app_handle = app.handle().clone();
                let close_renderer = renderer_handle.clone();
                let close_camera = camera_handle.clone();
                controls.on_window_event(move |event| {
                    if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                        close_renderer.send(RenderCommand::Shutdown);
                        close_camera.shutdown();
                        app_handle.exit(0);
                    }
                });
            }

            app.manage(camera_handle);
            app.manage(renderer_handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_renderer_info, get_camera_status, list_cameras, refresh_cameras, start_camera, stop_camera,
            set_param, set_mode, set_filter_mode, set_fit_mode, set_rotation, set_mirror,
            reset_params, toggle_renderer_fullscreen
        ])
        .run(tauri::generate_context!())
        .expect("error while running native webcam example");
}
