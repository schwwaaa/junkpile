#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod frame;
mod ndi;
mod preview;
mod renderer;

use ndi::NdiConfig;
use renderer::{RenderCommand, RendererHandle, RuntimeSnapshot};
use tauri::Manager;

#[tauri::command]
fn get_runtime_snapshot(state: tauri::State<'_, RendererHandle>) -> RuntimeSnapshot {
    state.snapshot()
}

#[tauri::command]
fn start_ndi(
    state: tauri::State<'_, RendererHandle>,
    config: NdiConfig,
) -> Result<(), String> {
    state.configure_ndi(config)?;
    state.start_ndi()
}

#[tauri::command]
fn stop_ndi(state: tauri::State<'_, RendererHandle>) -> Result<(), String> {
    state.stop_ndi()
}

#[tauri::command]
fn reset_metrics(state: tauri::State<'_, RendererHandle>) -> Result<(), String> {
    state.send(RenderCommand::ResetMetrics)
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

fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let renderer_window = tauri::window::WindowBuilder::new(app, "renderer")
                .title("Junkpile 32 · NDI Sender · Native Surface")
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
            start_ndi,
            stop_ndi,
            reset_metrics,
            toggle_renderer_fullscreen
        ])
        .run(tauri::generate_context!())
        .expect("error while running Junkpile NDI sender example");
}

fn main() {
    run();
}
