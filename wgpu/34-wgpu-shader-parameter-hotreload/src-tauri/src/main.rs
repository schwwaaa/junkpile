#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod assets;
mod config;
mod frame;
mod preview;
mod renderer;
mod watcher;

use assets::{AssetPaths, RuntimeAssets};
use renderer::{RenderCommand, RendererHandle, RuntimeSnapshot};
use std::process::Command;
use tauri::Manager;
use watcher::HotReloadGuard;

#[tauri::command]
fn get_runtime_snapshot(state: tauri::State<'_, RendererHandle>) -> RuntimeSnapshot {
    state.snapshot()
}

#[tauri::command]
fn get_asset_paths(state: tauri::State<'_, RuntimeAssets>) -> AssetPaths {
    state.paths()
}

#[tauri::command]
fn reload_assets(
    assets: tauri::State<'_, RuntimeAssets>,
    renderer: tauri::State<'_, RendererHandle>,
) -> Result<(), String> {
    let bundle = assets.load_bundle()?;
    renderer.apply_bundle(bundle, "manual reload")
}

#[tauri::command]
fn restore_all_assets(state: tauri::State<'_, RuntimeAssets>) -> Result<(), String> {
    state.restore_all()
}

#[tauri::command]
fn restore_active_shader(
    assets: tauri::State<'_, RuntimeAssets>,
    renderer: tauri::State<'_, RendererHandle>,
) -> Result<(), String> {
    let active = renderer.snapshot().shader.active_shader;
    assets.restore_active_shader(&active)
}

#[tauri::command]
fn toggle_valid_shader_edit(
    assets: tauri::State<'_, RuntimeAssets>,
    renderer: tauri::State<'_, RendererHandle>,
) -> Result<String, String> {
    let active = renderer.snapshot().shader.active_shader;
    assets.toggle_valid_edit(&active)
}

#[tauri::command]
fn write_invalid_shader(
    assets: tauri::State<'_, RuntimeAssets>,
    renderer: tauri::State<'_, RendererHandle>,
) -> Result<(), String> {
    let active = renderer.snapshot().shader.active_shader;
    assets.write_invalid_shader(&active)
}

#[tauri::command]
fn cycle_shader(
    state: tauri::State<'_, RendererHandle>,
    direction: i32,
) -> Result<(), String> {
    state.cycle_shader(direction.signum())
}

#[tauri::command]
fn cycle_profile(
    state: tauri::State<'_, RendererHandle>,
    direction: i32,
) -> Result<(), String> {
    state.cycle_profile(direction.signum())
}

#[tauri::command]
fn set_parameter(
    state: tauri::State<'_, RendererHandle>,
    name: String,
    value: f32,
) -> Result<(), String> {
    state.set_parameter(name, value)
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

#[tauri::command]
fn open_assets_folder(state: tauri::State<'_, RuntimeAssets>) -> Result<(), String> {
    let path = state.root();
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(path);
        command
    };
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("explorer");
        command.arg(path);
        command
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(path);
        command
    };
    command
        .spawn()
        .map_err(|error| format!("could not open {}: {error}", path.display()))?;
    Ok(())
}

fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let assets = RuntimeAssets::initialize(app.handle()).map_err(std::io::Error::other)?;
            let initial_bundle = assets.load_bundle().map_err(std::io::Error::other)?;

            let renderer_window = tauri::window::WindowBuilder::new(app, "renderer")
                .title("Junkpile 34 · WGSL Stress Lab · Native Surface")
                .inner_size(1280.0, 720.0)
                .min_inner_size(320.0, 240.0)
                .resizable(true)
                .build()?;

            let renderer_handle = renderer::start(renderer_window.clone(), initial_bundle)
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

            let watcher = HotReloadGuard::start(assets.clone(), renderer_handle.clone())
                .map_err(std::io::Error::other)?;

            if let Some(controls) = app.get_webview_window("controls") {
                let app_handle = app.handle().clone();
                controls.on_window_event(move |event| {
                    if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                        app_handle.exit(0);
                    }
                });
            }

            app.manage(assets);
            app.manage(renderer_handle);
            app.manage(watcher);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_runtime_snapshot,
            get_asset_paths,
            reload_assets,
            restore_all_assets,
            restore_active_shader,
            toggle_valid_shader_edit,
            write_invalid_shader,
            cycle_shader,
            cycle_profile,
            set_parameter,
            reset_metrics,
            toggle_renderer_fullscreen,
            open_assets_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running Junkpile shader parameter hot reload example");
}

fn main() {
    run();
}
