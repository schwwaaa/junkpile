#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod assets;
mod config;
mod frame;
mod preview;
mod renderer;
mod watcher;

use assets::{AssetPaths, RuntimeAssets};
use renderer::{RenderCommand, RendererHandle, RuntimeSnapshot};
use serde::Serialize;
use std::{fs, path::{Path, PathBuf}, process::Command, time::Instant};
use tauri::Manager;
use watcher::HotReloadGuard;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EditorDocument {
    path: String,
    label: String,
    source: String,
    is_preset: bool,
}

#[tauri::command]
fn get_runtime_snapshot(state: tauri::State<'_, RendererHandle>) -> RuntimeSnapshot {
    state.snapshot()
}

#[tauri::command]
fn get_asset_paths(state: tauri::State<'_, RuntimeAssets>) -> AssetPaths {
    state.paths()
}

#[tauri::command]
fn get_initial_document(
    assets: tauri::State<'_, RuntimeAssets>,
    renderer: tauri::State<'_, RendererHandle>,
) -> Result<EditorDocument, String> {
    let active = renderer.snapshot().shader.active_shader;
    document_for_preset(assets.inner(), &active)
}

#[tauri::command]
fn load_preset(
    shader: String,
    assets: tauri::State<'_, RuntimeAssets>,
    renderer: tauri::State<'_, RendererHandle>,
) -> Result<EditorDocument, String> {
    renderer.select_shader(shader.clone())?;
    document_for_preset(assets.inner(), &shader)
}

#[tauri::command]
fn compile_shader_source(
    source: String,
    label: String,
    renderer: tauri::State<'_, RendererHandle>,
) -> Result<String, String> {
    let started = Instant::now();
    renderer.compile_source(source, label.clone())?;
    Ok(format!(
        "Compiled {label} successfully in {:.2} ms",
        started.elapsed().as_secs_f64() * 1000.0
    ))
}

#[tauri::command]
fn open_shader_file(
    renderer: tauri::State<'_, RendererHandle>,
) -> Result<Option<EditorDocument>, String> {
    let Some(path) = rfd::FileDialog::new()
        .add_filter("WGSL shader", &["wgsl"])
        .pick_file()
    else {
        return Ok(None);
    };
    let source = read_text(&path)?;
    let label = file_label(&path);
    renderer.compile_source(source.clone(), label.clone())?;
    Ok(Some(EditorDocument {
        path: path.display().to_string(),
        label,
        source,
        is_preset: false,
    }))
}

#[tauri::command]
fn save_shader_file(path: String, source: String) -> Result<EditorDocument, String> {
    let target = if path.trim().is_empty() {
        choose_shader_save_path(None)?
    } else {
        PathBuf::from(path)
    };
    write_shader(&target, &source)?;
    Ok(EditorDocument {
        path: target.display().to_string(),
        label: file_label(&target),
        source,
        is_preset: false,
    })
}

#[tauri::command]
fn save_shader_as(source: String) -> Result<Option<EditorDocument>, String> {
    let Some(target) = rfd::FileDialog::new()
        .add_filter("WGSL shader", &["wgsl"])
        .set_file_name("junkpile-shader.wgsl")
        .save_file()
    else {
        return Ok(None);
    };
    let target = ensure_extension(target, "wgsl");
    write_shader(&target, &source)?;
    Ok(Some(EditorDocument {
        path: target.display().to_string(),
        label: file_label(&target),
        source,
        is_preset: false,
    }))
}

#[tauri::command]
fn restore_current_preset(
    assets: tauri::State<'_, RuntimeAssets>,
    renderer: tauri::State<'_, RendererHandle>,
) -> Result<EditorDocument, String> {
    let active = renderer.snapshot().shader.active_shader;
    assets.restore_active_shader(&active)?;
    let document = document_for_preset(assets.inner(), &active)?;
    renderer.compile_source(document.source.clone(), document.label.clone())?;
    Ok(document)
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
fn toggle_time_pause(state: tauri::State<'_, RendererHandle>) -> Result<bool, String> {
    state.toggle_pause()
}

#[tauri::command]
fn reset_shader_time(state: tauri::State<'_, RendererHandle>) -> Result<(), String> {
    state.reset_time()
}

#[tauri::command]
fn export_png(
    width: u32,
    height: u32,
    state: tauri::State<'_, RendererHandle>,
) -> Result<Option<String>, String> {
    let Some(path) = rfd::FileDialog::new()
        .add_filter("PNG image", &["png"])
        .set_file_name(format!("junkpile-wgsl-{width}x{height}.png"))
        .save_file()
    else {
        return Ok(None);
    };
    let path = ensure_extension(path, "png");
    state.export_still(width, height, path).map(Some)
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
    window.set_fullscreen(next).map_err(|error| error.to_string())?;
    Ok(next)
}

#[tauri::command]
fn open_assets_folder(state: tauri::State<'_, RuntimeAssets>) -> Result<(), String> {
    open_path(state.root())
}

fn document_for_preset(assets: &RuntimeAssets, relative: &str) -> Result<EditorDocument, String> {
    let path = assets.root().join(relative);
    Ok(EditorDocument {
        path: path.display().to_string(),
        label: relative.to_string(),
        source: read_text(&path)?,
        is_preset: true,
    })
}

fn read_text(path: &Path) -> Result<String, String> {
    fs::read_to_string(path).map_err(|error| format!("could not read {}: {error}", path.display()))
}

fn write_shader(path: &Path, source: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("could not create {}: {error}", parent.display()))?;
    }
    fs::write(path, source).map_err(|error| format!("could not write {}: {error}", path.display()))
}

fn choose_shader_save_path(path: Option<&Path>) -> Result<PathBuf, String> {
    let mut dialog = rfd::FileDialog::new().add_filter("WGSL shader", &["wgsl"]);
    if let Some(path) = path {
        if let Some(parent) = path.parent() {
            dialog = dialog.set_directory(parent);
        }
        if let Some(name) = path.file_name().and_then(|value| value.to_str()) {
            dialog = dialog.set_file_name(name);
        }
    } else {
        dialog = dialog.set_file_name("junkpile-shader.wgsl");
    }
    dialog
        .save_file()
        .map(|path| ensure_extension(path, "wgsl"))
        .ok_or_else(|| "save cancelled".to_string())
}

fn ensure_extension(mut path: PathBuf, extension: &str) -> PathBuf {
    if path.extension().and_then(|value| value.to_str()) != Some(extension) {
        path.set_extension(extension);
    }
    path
}

fn file_label(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("untitled.wgsl")
        .to_string()
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
            let assets = RuntimeAssets::initialize(app.handle()).map_err(std::io::Error::other)?;
            let initial_bundle = assets.load_bundle().map_err(std::io::Error::other)?;

            let renderer_window = tauri::window::WindowBuilder::new(app, "renderer")
                .title("Junkpile · WGSL Shader Playground · Native Surface")
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
            get_initial_document,
            load_preset,
            compile_shader_source,
            open_shader_file,
            save_shader_file,
            save_shader_as,
            restore_current_preset,
            cycle_profile,
            set_parameter,
            toggle_time_pause,
            reset_shader_time,
            export_png,
            reset_metrics,
            toggle_renderer_fullscreen,
            open_assets_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running Junkpile WGSL shader playground");
}

fn main() {
    run();
}
