#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod renderer;
mod scene;

use renderer::{RenderCommand, RendererHandle, RendererInfo};
use tauri::Manager;

#[tauri::command]
fn get_renderer_info(state: tauri::State<'_, RendererHandle>) -> RendererInfo {
    state.info()
}

#[tauri::command]
fn open_gltf_file(state: tauri::State<'_, RendererHandle>) -> Result<Option<String>, String> {
    let selected = rfd::FileDialog::new()
        .add_filter("glTF scene", &["gltf", "glb"])
        .pick_file();
    if let Some(path) = selected {
        let path_string = path.to_string_lossy().into_owned();
        state.send(RenderCommand::LoadPath(path_string.clone()));
        Ok(Some(path_string))
    } else {
        Ok(None)
    }
}

#[tauri::command]
fn open_gltf_path(
    state: tauri::State<'_, RendererHandle>,
    path: String,
) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("path cannot be empty".into());
    }
    state.send(RenderCommand::LoadPath(trimmed.to_string()));
    Ok(())
}

#[tauri::command]
fn load_sample_scene(state: tauri::State<'_, RendererHandle>) {
    state.send(RenderCommand::LoadSample);
}

#[tauri::command]
fn set_param(
    state: tauri::State<'_, RendererHandle>,
    name: String,
    value: f32,
) -> Result<(), String> {
    if !matches!(
        name.as_str(),
        "camera_yaw"
            | "camera_pitch"
            | "camera_distance"
            | "camera_fov"
            | "auto_orbit"
            | "exposure"
            | "light_azimuth"
            | "light_elevation"
            | "light_intensity"
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
fn set_view_mode(
    state: tauri::State<'_, RendererHandle>,
    mode: String,
) -> Result<(), String> {
    if !matches!(mode.as_str(), "lit" | "normals" | "uv" | "materials") {
        return Err(format!("unknown view mode: {mode}"));
    }
    state.send(RenderCommand::SetViewMode(mode));
    Ok(())
}

#[tauri::command]
fn set_backface_culling(state: tauri::State<'_, RendererHandle>, enabled: bool) {
    state.send(RenderCommand::SetBackfaceCulling(enabled));
}

#[tauri::command]
fn reset_camera(state: tauri::State<'_, RendererHandle>) {
    state.send(RenderCommand::ResetCamera);
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

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let renderer_window = tauri::window::WindowBuilder::new(app, "renderer")
                .title("Junkpile 21 · glTF Scene Loader · Native Surface")
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
            get_renderer_info,
            open_gltf_file,
            open_gltf_path,
            load_sample_scene,
            set_param,
            set_view_mode,
            set_backface_culling,
            reset_camera,
            toggle_renderer_fullscreen
        ])
        .run(tauri::generate_context!())
        .expect("error running Junkpile glTF scene loader");
}
