#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod assets;
mod config;
mod frame;
mod preview;
mod renderer;
mod runtime;
mod watcher;

use assets::{AssetPaths, RuntimeAssets};
use renderer::{RenderCommand, RendererHandle, RuntimeSnapshot};
use runtime::{
    load_runtime_config, LogLevel, RuntimeBootstrap, RuntimeInfrastructureSnapshot,
    RuntimeServices, RuntimeStateGuard,
};
use serde_json::json;
use std::{path::Path, process::Command};
use tauri::Manager;
use watcher::HotReloadGuard;

#[tauri::command]
fn get_runtime_snapshot(state: tauri::State<'_, RendererHandle>) -> RuntimeSnapshot {
    state.snapshot()
}

#[tauri::command]
fn get_runtime_infrastructure(
    state: tauri::State<'_, RuntimeServices>,
) -> RuntimeInfrastructureSnapshot {
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
    runtime: tauri::State<'_, RuntimeServices>,
) -> Result<(), String> {
    let bundle = assets.load_bundle()?;
    renderer.apply_bundle(bundle, "manual reload")?;
    runtime.logger().log(
        LogLevel::Info,
        "shader",
        "manual_reload",
        "manual asset reload completed",
        json!({ "root": assets.root().display().to_string() }),
    );
    Ok(())
}

#[tauri::command]
fn restore_all_assets(
    state: tauri::State<'_, RuntimeAssets>,
    runtime: tauri::State<'_, RuntimeServices>,
) -> Result<(), String> {
    state.restore_all()?;
    runtime.logger().log(
        LogLevel::Warn,
        "assets",
        "builtins_restored",
        "all built-in runtime assets were restored",
        json!({ "root": state.root().display().to_string() }),
    );
    Ok(())
}

#[tauri::command]
fn restore_active_shader(
    assets: tauri::State<'_, RuntimeAssets>,
    renderer: tauri::State<'_, RendererHandle>,
    runtime: tauri::State<'_, RuntimeServices>,
) -> Result<(), String> {
    let active = renderer.snapshot().shader.active_shader;
    assets.restore_active_shader(&active)?;
    runtime.logger().log(
        LogLevel::Info,
        "shader",
        "active_shader_restored",
        "active built-in shader source restored",
        json!({ "shader": active }),
    );
    Ok(())
}

#[tauri::command]
fn toggle_valid_shader_edit(
    assets: tauri::State<'_, RuntimeAssets>,
    renderer: tauri::State<'_, RendererHandle>,
    runtime: tauri::State<'_, RuntimeServices>,
) -> Result<String, String> {
    let active = renderer.snapshot().shader.active_shader;
    let message = assets.toggle_valid_edit(&active)?;
    runtime.logger().log(
        LogLevel::Info,
        "shader",
        "valid_edit_written",
        message.clone(),
        json!({ "shader": active }),
    );
    Ok(message)
}

#[tauri::command]
fn write_invalid_shader(
    assets: tauri::State<'_, RuntimeAssets>,
    renderer: tauri::State<'_, RendererHandle>,
    runtime: tauri::State<'_, RuntimeServices>,
) -> Result<(), String> {
    let active = renderer.snapshot().shader.active_shader;
    assets.write_invalid_shader(&active)?;
    runtime.logger().log(
        LogLevel::Warn,
        "shader",
        "invalid_edit_written",
        "intentional invalid WGSL source written for last-known-good testing",
        json!({ "shader": active }),
    );
    Ok(())
}

#[tauri::command]
fn cycle_shader(
    state: tauri::State<'_, RendererHandle>,
    runtime: tauri::State<'_, RuntimeServices>,
    direction: i32,
) -> Result<(), String> {
    state.cycle_shader(direction.signum())?;
    let snapshot = state.snapshot();
    runtime.logger().log(
        LogLevel::Info,
        "selection",
        "shader_selected",
        "runtime shader selection changed",
        json!({ "shader": snapshot.shader.active_shader }),
    );
    Ok(())
}

#[tauri::command]
fn cycle_profile(
    state: tauri::State<'_, RendererHandle>,
    runtime: tauri::State<'_, RuntimeServices>,
    direction: i32,
) -> Result<(), String> {
    state.cycle_profile(direction.signum())?;
    let snapshot = state.snapshot();
    runtime.logger().log(
        LogLevel::Info,
        "selection",
        "profile_selected",
        "runtime profile selection changed",
        json!({
            "shader": snapshot.shader.active_shader,
            "profile": snapshot.shader.active_profile,
        }),
    );
    Ok(())
}

#[tauri::command]
fn set_parameter(
    state: tauri::State<'_, RendererHandle>,
    runtime: tauri::State<'_, RuntimeServices>,
    name: String,
    value: f32,
) -> Result<(), String> {
    state.set_parameter(name.clone(), value)?;
    runtime.logger().log(
        LogLevel::Debug,
        "parameter",
        "target_changed",
        "parameter target changed",
        json!({ "name": name, "value": value }),
    );
    Ok(())
}

#[tauri::command]
fn force_save_runtime_state(
    renderer: tauri::State<'_, RendererHandle>,
    runtime: tauri::State<'_, RuntimeServices>,
) -> Result<bool, String> {
    runtime.save_snapshot(&renderer.snapshot(), true)
}

#[tauri::command]
fn clear_runtime_state(runtime: tauri::State<'_, RuntimeServices>) -> Result<(), String> {
    runtime.clear_persisted_state()
}

#[tauri::command]
fn prepare_custom_asset_root(
    path: String,
    clone_current_assets: bool,
    assets: tauri::State<'_, RuntimeAssets>,
    renderer: tauri::State<'_, RendererHandle>,
    runtime: tauri::State<'_, RuntimeServices>,
) -> Result<(), String> {
    let target = std::path::PathBuf::from(path.trim());
    if clone_current_assets {
        assets.clone_active_assets_to(&target)?;
    }
    runtime.set_next_asset_root(target, &renderer)
}

#[tauri::command]
fn use_default_asset_root_next_launch(
    renderer: tauri::State<'_, RendererHandle>,
    runtime: tauri::State<'_, RuntimeServices>,
) -> Result<(), String> {
    runtime.clear_asset_root_override(&renderer)
}

#[tauri::command]
fn emit_runtime_log(
    runtime: tauri::State<'_, RuntimeServices>,
    level: String,
) -> Result<(), String> {
    let level = match level.as_str() {
        "debug" => LogLevel::Debug,
        "info" => LogLevel::Info,
        "warn" => LogLevel::Warn,
        "error" => LogLevel::Error,
        other => return Err(format!("unknown log level '{other}'")),
    };
    runtime.logger().log(
        level,
        "diagnostic",
        "manual_test",
        "manual structured log test event",
        json!({ "requestedLevel": level.as_str() }),
    );
    Ok(())
}

#[tauri::command]
fn clear_log_view(runtime: tauri::State<'_, RuntimeServices>) -> Result<(), String> {
    runtime.logger().clear_memory();
    Ok(())
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
    open_path(state.root())
}

#[tauri::command]
fn open_log_file(state: tauri::State<'_, RuntimeServices>) -> Result<(), String> {
    let logger = state.logger();
    open_path(logger.file_path())
}

#[tauri::command]
fn open_state_folder(state: tauri::State<'_, RuntimeServices>) -> Result<(), String> {
    let parent = state
        .state_file()
        .parent()
        .ok_or_else(|| "runtime state file has no parent directory".to_string())?;
    open_path(parent)
}

fn open_path(path: &Path) -> Result<(), String> {
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
            let bootstrap = RuntimeBootstrap::resolve(app.handle()).map_err(std::io::Error::other)?;
            let saved_state = bootstrap.saved_state.clone();
            let active_asset_root = bootstrap.active_asset_root.clone();
            let assets = RuntimeAssets::initialize_at(active_asset_root)
                .map_err(std::io::Error::other)?;
            let initial_bundle = assets.load_bundle().map_err(std::io::Error::other)?;
            let (runtime_config, base_runtime_config, platform_runtime_config) =
                load_runtime_config(assets.root()).map_err(std::io::Error::other)?;
            let runtime = RuntimeServices::initialize(
                bootstrap,
                runtime_config,
                base_runtime_config,
                platform_runtime_config,
            )
            .map_err(std::io::Error::other)?;

            let renderer_window = tauri::window::WindowBuilder::new(app, "renderer")
                .title("Junkpile 35 · Assets, State + Logging · Native Surface")
                .inner_size(1280.0, 720.0)
                .min_inner_size(320.0, 240.0)
                .resizable(true)
                .build()?;

            let renderer_handle = renderer::start(renderer_window.clone(), initial_bundle)
                .map_err(std::io::Error::other)?;
            runtime.restore_saved_state(saved_state.as_ref(), &renderer_handle);

            let resize_handle = renderer_handle.clone();
            let shutdown_runtime = runtime.clone();
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
                    shutdown_runtime.logger().log(
                        LogLevel::Info,
                        "runtime",
                        "renderer_destroyed",
                        "native renderer window was destroyed",
                        json!({}),
                    );
                }
                _ => {}
            });

            let watcher = HotReloadGuard::start(
                assets.clone(),
                renderer_handle.clone(),
                runtime.logger(),
            )
            .map_err(std::io::Error::other)?;
            let state_guard = RuntimeStateGuard::start(runtime.clone(), renderer_handle.clone())
                .map_err(std::io::Error::other)?;

            if let Some(controls) = app.get_webview_window("controls") {
                let app_handle = app.handle().clone();
                let close_runtime = runtime.clone();
                let close_renderer = renderer_handle.clone();
                controls.on_window_event(move |event| {
                    if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                        let _ = close_runtime.save_snapshot(&close_renderer.snapshot(), true);
                        close_runtime.logger().log(
                            LogLevel::Info,
                            "runtime",
                            "shutdown",
                            "controls window requested application shutdown",
                            json!({}),
                        );
                        app_handle.exit(0);
                    }
                });
            }

            app.manage(assets);
            app.manage(renderer_handle);
            app.manage(runtime);
            app.manage(watcher);
            app.manage(state_guard);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_runtime_snapshot,
            get_runtime_infrastructure,
            get_asset_paths,
            reload_assets,
            restore_all_assets,
            restore_active_shader,
            toggle_valid_shader_edit,
            write_invalid_shader,
            cycle_shader,
            cycle_profile,
            set_parameter,
            force_save_runtime_state,
            clear_runtime_state,
            prepare_custom_asset_root,
            use_default_asset_root_next_launch,
            emit_runtime_log,
            clear_log_view,
            reset_metrics,
            toggle_renderer_fullscreen,
            open_assets_folder,
            open_log_file,
            open_state_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running Junkpile assets, state, and logging example");
}

fn main() {
    run();
}
