#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config;
mod frame;
mod preview;
mod renderer;

use config::{PreviewConfigEnvelope, PreviewConfigState, PreviewScaleMode};
use renderer::{RenderCommand, RendererHandle, RuntimeSnapshot};
use tauri::Manager;

#[tauri::command]
fn get_runtime_snapshot(state: tauri::State<'_, RendererHandle>) -> RuntimeSnapshot {
    state.snapshot()
}

#[tauri::command]
fn get_preview_config(
    state: tauri::State<'_, PreviewConfigState>,
) -> Result<PreviewConfigEnvelope, String> {
    state.envelope()
}

#[tauri::command]
fn set_preview_mode(
    state: tauri::State<'_, RendererHandle>,
    mode: PreviewScaleMode,
) -> Result<(), String> {
    state.set_mode(mode)
}

#[tauri::command]
fn set_source_resolution(
    state: tauri::State<'_, RendererHandle>,
    width: u32,
    height: u32,
) -> Result<(), String> {
    state.set_source_resolution(width, height)
}

#[tauri::command]
fn set_preview_enabled(
    app: tauri::AppHandle,
    state: tauri::State<'_, RendererHandle>,
    enabled: bool,
) -> Result<(), String> {
    state.set_enabled(enabled)?;
    apply_preview_window_visibility(&app, enabled)
}

#[tauri::command]
fn reload_preview_config(
    app: tauri::AppHandle,
    config_state: tauri::State<'_, PreviewConfigState>,
    renderer_state: tauri::State<'_, RendererHandle>,
) -> Result<PreviewConfigEnvelope, String> {
    let candidate = config_state.candidate_from_disk()?;
    renderer_state.apply_config(candidate.clone())?;
    apply_preview_window_visibility(&app, candidate.enabled)?;
    config_state.commit(candidate)?;
    config_state.envelope()
}

#[tauri::command]
fn restore_preview_defaults(
    app: tauri::AppHandle,
    config_state: tauri::State<'_, PreviewConfigState>,
    renderer_state: tauri::State<'_, RendererHandle>,
) -> Result<PreviewConfigEnvelope, String> {
    let candidate = config_state.restore_built_in()?;
    renderer_state.apply_config(candidate.clone())?;
    apply_preview_window_visibility(&app, candidate.enabled)?;
    config_state.commit(candidate)?;
    config_state.envelope()
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

fn apply_preview_window_visibility(app: &tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let window = app
        .get_window("renderer")
        .ok_or_else(|| "renderer window is not available".to_string())?;
    if enabled {
        window.show().map_err(|error| error.to_string())?;
        let _ = window.set_focus();
    } else {
        window.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let config_state = PreviewConfigState::load(app.handle())
                .map_err(std::io::Error::other)?;
            let initial_config = config_state.current().map_err(std::io::Error::other)?;

            let renderer_window = tauri::window::WindowBuilder::new(app, "renderer")
                .title("Junkpile 33 · Preview Output Modes · Native Surface")
                .inner_size(1280.0, 720.0)
                .min_inner_size(320.0, 240.0)
                .resizable(true)
                .build()?;

            let renderer_handle = renderer::start(
                renderer_window.clone(),
                initial_config.clone(),
            )
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

            if !initial_config.enabled {
                renderer_window.hide()?;
            }

            if let Some(controls) = app.get_webview_window("controls") {
                let app_handle = app.handle().clone();
                controls.on_window_event(move |event| {
                    if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                        app_handle.exit(0);
                    }
                });
            }

            app.manage(config_state);
            app.manage(renderer_handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_runtime_snapshot,
            get_preview_config,
            set_preview_mode,
            set_source_resolution,
            set_preview_enabled,
            reload_preview_config,
            restore_preview_defaults,
            reset_metrics,
            toggle_renderer_fullscreen
        ])
        .run(tauri::generate_context!())
        .expect("error while running Junkpile preview output modes example");
}

fn main() {
    run();
}
