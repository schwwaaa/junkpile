#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod frame;
mod network;
mod preview;
mod renderer;

use network::{NetworkConfig, PreflightReport};
use renderer::{RenderCommand, RendererHandle, RuntimeSnapshot};
use tauri::Manager;

#[tauri::command]
fn get_runtime_snapshot(state: tauri::State<'_, RendererHandle>) -> RuntimeSnapshot {
    state.snapshot()
}

#[tauri::command]
fn start_network(
    state: tauri::State<'_, RendererHandle>,
    config: NetworkConfig,
) -> Result<(), String> {
    state.configure_network(config)?;
    state.start_network()
}

#[tauri::command]
fn stop_network(state: tauri::State<'_, RendererHandle>) -> Result<(), String> {
    state.stop_network()
}

#[tauri::command]
fn preflight_network(config: NetworkConfig) -> PreflightReport {
    network::preflight(&config)
}

#[tauri::command]
fn launch_vlc(config: NetworkConfig) -> Result<String, String> {
    network::launch_vlc(&config)
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
                .title("Junkpile 40 · Network Output · Native Surface")
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
            start_network,
            stop_network,
            preflight_network,
            launch_vlc,
            reset_metrics,
            toggle_renderer_fullscreen
        ])
        .run(tauri::generate_context!())
        .expect("error while running Junkpile network output example");
}

fn main() {
    run();
}
