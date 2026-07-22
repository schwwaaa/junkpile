#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod renderer;

use renderer::{RenderCommand, RendererHandle, RendererInfo};
use tauri::Manager;

#[tauri::command]
fn get_renderer_info(state: tauri::State<'_, RendererHandle>) -> RendererInfo {
    state.info()
}

#[tauri::command]
fn set_param(
    state: tauri::State<'_, RendererHandle>,
    name: String,
    value: f32,
) -> Result<(), String> {
    if !matches!(
        name.as_str(),
        "render_scale"
            | "max_steps"
            | "max_distance"
            | "epsilon"
            | "shadow_softness"
            | "shape_scale"
            | "twist"
            | "repetition"
            | "morph"
            | "fog_density"
            | "glow"
            | "ao_strength"
            | "exposure"
            | "speed"
            | "auto_orbit"
            | "camera_yaw"
            | "camera_pitch"
            | "camera_distance"
            | "camera_fov"
            | "bloom"
            | "chromatic"
            | "vignette"
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
fn set_resolution_preset(
    state: tauri::State<'_, RendererHandle>,
    preset: String,
) -> Result<(), String> {
    if !matches!(preset.as_str(), "window" | "1080p" | "4k" | "8k") {
        return Err(format!("unknown resolution preset: {preset}"));
    }
    state.send(RenderCommand::SetResolutionPreset(preset));
    Ok(())
}

#[tauri::command]
fn set_scene(state: tauri::State<'_, RendererHandle>, scene: u32) -> Result<(), String> {
    if scene > 3 {
        return Err("scene must be between 0 and 3".into());
    }
    state.send(RenderCommand::SetScene(scene));
    Ok(())
}

#[tauri::command]
fn set_paused(state: tauri::State<'_, RendererHandle>, paused: bool) {
    state.send(RenderCommand::SetPaused(paused));
}

#[tauri::command]
fn set_shadows(state: tauri::State<'_, RendererHandle>, enabled: bool) {
    state.send(RenderCommand::SetShadows(enabled));
}

#[tauri::command]
fn set_ambient_occlusion(state: tauri::State<'_, RendererHandle>, enabled: bool) {
    state.send(RenderCommand::SetAmbientOcclusion(enabled));
}

#[tauri::command]
fn reset_params(state: tauri::State<'_, RendererHandle>) {
    state.send(RenderCommand::Reset);
}

#[tauri::command]
fn toggle_renderer_fullscreen(app: tauri::AppHandle) -> Result<bool, String> {
    let window = app
        .get_window("renderer")
        .ok_or_else(|| "renderer window not found".to_string())?;
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
                .title("Junkpile wgpu Volumetric Raymarcher · Native Surface")
                .inner_size(1280.0, 720.0)
                .min_inner_size(480.0, 270.0)
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
                tauri::WindowEvent::Destroyed => {
                    resize_handle.send(RenderCommand::Shutdown);
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

            app.manage(handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_renderer_info,
            set_param,
            set_resolution_preset,
            set_scene,
            set_paused,
            set_shadows,
            set_ambient_occlusion,
            reset_params,
            toggle_renderer_fullscreen
        ])
        .run(tauri::generate_context!())
        .expect("error running wgpu volumetric raymarcher");
}
