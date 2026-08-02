#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config;
mod renderer;

use config::{ConfigHandle, ConfigStatus};
use renderer::{RenderCommand, RendererHandle, RendererInfo};
use tauri::Manager;

#[tauri::command]
fn get_renderer_info(state: tauri::State<'_, RendererHandle>) -> RendererInfo {
    state.info()
}

#[tauri::command]
fn get_config_status(state: tauri::State<'_, ConfigHandle>) -> ConfigStatus {
    state.status()
}

#[tauri::command]
fn reload_config(state: tauri::State<'_, ConfigHandle>) -> Result<ConfigStatus, String> {
    state.reload("manual reload")
}

#[tauri::command]
fn write_demo_config(state: tauri::State<'_, ConfigHandle>, mode: String) -> Result<(), String> {
    state.write_demo(&mode)
}

#[tauri::command]
fn restore_default_config(state: tauri::State<'_, ConfigHandle>) -> Result<(), String> {
    state.restore_defaults()
}

#[tauri::command]
fn open_config_folder(state: tauri::State<'_, ConfigHandle>) -> Result<(), String> {
    state.open_directory()
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
                .title("Junkpile 26 · I/O Config Foundation · Native Surface")
                .inner_size(1280.0, 720.0)
                .min_inner_size(480.0, 270.0)
                .resizable(true)
                .build()?;

            let renderer_handle =
                renderer::start(renderer_window.clone()).map_err(std::io::Error::other)?;
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

            let config_handle = ConfigHandle::start(app.handle().clone(), renderer_handle.clone())
                .map_err(std::io::Error::other)?;

            if let Some(controls) = app.get_webview_window("controls") {
                let app_handle = app.handle().clone();
                controls.on_window_event(move |event| {
                    if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                        app_handle.exit(0);
                    }
                });
            }

            app.manage(renderer_handle);
            app.manage(config_handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_renderer_info,
            get_config_status,
            reload_config,
            write_demo_config,
            restore_default_config,
            open_config_folder,
            toggle_renderer_fullscreen
        ])
        .run(tauri::generate_context!())
        .expect("error while running Junkpile I/O config foundation");
}

fn main() {
    run();
}
