#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod renderer;

use renderer::{ExportConfig, RenderCommand, RendererHandle, RendererInfo};
use tauri::Manager;

#[tauri::command]
fn set_param(
    state: tauri::State<'_, RendererHandle>,
    name: String,
    value: f32,
) -> Result<(), String> {
    if !matches!(
        name.as_str(),
        "animation_speed"
            | "zoom"
            | "rotation"
            | "warp"
            | "fold"
            | "density"
            | "detail"
            | "glow"
            | "hue"
            | "saturation"
            | "exposure"
            | "contrast"
            | "vignette"
            | "grain"
            | "background"
    ) {
        return Err(format!("unknown parameter: {name}"));
    }
    if !value.is_finite() {
        return Err("parameter must be finite".into());
    }
    state.send(RenderCommand::SetParam(name, value));
    Ok(())
}

#[tauri::command]
fn set_toggle(
    state: tauri::State<'_, RendererHandle>,
    name: String,
    enabled: bool,
) -> Result<(), String> {
    if name != "paused" {
        return Err(format!("unknown toggle: {name}"));
    }
    state.send(RenderCommand::SetToggle(name, enabled));
    Ok(())
}

#[tauri::command]
fn apply_preset(state: tauri::State<'_, RendererHandle>, preset: String) {
    state.send(RenderCommand::ApplyPreset(preset));
}

#[tauri::command]
fn set_export_config(
    state: tauri::State<'_, RendererHandle>,
    width: u32,
    height: u32,
    tile_size: u32,
    samples: u32,
) -> Result<(), String> {
    let config = ExportConfig::validated(width, height, tile_size, samples)?;
    state.send(RenderCommand::SetExportConfig(config));
    Ok(())
}

#[tauri::command]
fn export_frame(state: tauri::State<'_, RendererHandle>) -> Result<(), String> {
    state.request_export()
}

#[tauri::command]
fn reset_lab(state: tauri::State<'_, RendererHandle>) {
    state.send(RenderCommand::Reset);
}

#[tauri::command]
fn renderer_info(state: tauri::State<'_, RendererHandle>) -> RendererInfo {
    state.info()
}

#[tauri::command]
fn toggle_renderer_fullscreen(app: tauri::AppHandle) -> Result<bool, String> {
    let window = app
        .get_window("renderer")
        .ok_or_else(|| "renderer window is unavailable".to_string())?;
    let next = !window.is_fullscreen().map_err(|error| error.to_string())?;
    window
        .set_fullscreen(next)
        .map_err(|error| error.to_string())?;
    Ok(next)
}

#[tauri::command]
fn open_export_folder() -> Result<String, String> {
    let directory = renderer::export_directory()?;
    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("could not create export directory: {error}"))?;

    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(target_os = "windows")]
    let mut command = std::process::Command::new("explorer");
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = std::process::Command::new("xdg-open");

    command
        .arg(&directory)
        .spawn()
        .map_err(|error| format!("could not open export directory: {error}"))?;
    Ok(directory.to_string_lossy().into_owned())
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let renderer_window = tauri::window::WindowBuilder::new(app, "renderer")
                .title("Junkpile 25 · Ultra-Resolution Export · Native Surface")
                .inner_size(1280.0, 800.0)
                .min_inner_size(480.0, 300.0)
                .resizable(true)
                .build()?;

            let handle = renderer::start(renderer_window.clone()).map_err(std::io::Error::other)?;
            let resize_handle = handle.clone();
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
                tauri::WindowEvent::Destroyed => resize_handle.send(RenderCommand::Shutdown),
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

            app.manage(handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_param,
            set_toggle,
            apply_preset,
            set_export_config,
            export_frame,
            reset_lab,
            renderer_info,
            toggle_renderer_fullscreen,
            open_export_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running Junkpile 25 ultra-resolution export");
}
