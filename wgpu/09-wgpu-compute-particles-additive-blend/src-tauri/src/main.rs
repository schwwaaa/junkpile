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
        "field_strength"
            | "turbulence"
            | "drag"
            | "speed"
            | "particle_size"
            | "exposure"
            | "substeps"
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
fn set_particle_count(
    state: tauri::State<'_, RendererHandle>,
    count: u32,
) -> Result<(), String> {
    if count == 0 {
        return Err("particle count must be greater than zero".into());
    }
    state.send(RenderCommand::SetParticleCount(count));
    Ok(())
}

#[tauri::command]
fn set_paused(state: tauri::State<'_, RendererHandle>, paused: bool) {
    state.send(RenderCommand::SetPaused(paused));
}

#[tauri::command]
fn reset_particles(state: tauri::State<'_, RendererHandle>) {
    state.send(RenderCommand::ResetParticles);
}

#[tauri::command]
fn reset_params(state: tauri::State<'_, RendererHandle>) {
    state.send(RenderCommand::ResetParams);
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

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let renderer_window = tauri::window::WindowBuilder::new(app, "renderer")
                .title("Junkpile wgpu Compute Particles · Native Surface")
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
            set_particle_count,
            set_paused,
            reset_particles,
            reset_params,
            toggle_renderer_fullscreen
        ])
        .run(tauri::generate_context!())
        .expect("error running wgpu compute particles");
}
