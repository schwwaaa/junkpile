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
            | "velocity_dissipation"
            | "dye_dissipation"
            | "viscosity"
            | "vorticity"
            | "force"
            | "radius"
            | "dye_amount"
            | "feedback"
            | "simulation_speed"
            | "emitter_speed"
            | "injector_x"
            | "injector_y"
            | "pressure_iterations"
            | "substeps"
            | "exposure"
            | "bloom"
            | "contrast"
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
fn set_simulation_size(
    state: tauri::State<'_, RendererHandle>,
    size: u32,
) -> Result<(), String> {
    if !matches!(size, 128 | 256 | 512 | 1024 | 2048) {
        return Err("simulation size must be 128, 256, 512, 1024, or 2048".into());
    }
    state.send(RenderCommand::SetSimulationSize(size));
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
fn set_emitter_mode(state: tauri::State<'_, RendererHandle>, mode: u32) -> Result<(), String> {
    if mode > 3 {
        return Err("emitter mode must be between 0 and 3".into());
    }
    state.send(RenderCommand::SetEmitterMode(mode));
    Ok(())
}

#[tauri::command]
fn set_palette(state: tauri::State<'_, RendererHandle>, palette: u32) -> Result<(), String> {
    if palette > 3 {
        return Err("palette must be between 0 and 3".into());
    }
    state.send(RenderCommand::SetPalette(palette));
    Ok(())
}

#[tauri::command]
fn set_view_mode(state: tauri::State<'_, RendererHandle>, mode: u32) -> Result<(), String> {
    if mode > 4 {
        return Err("view mode must be between 0 and 4".into());
    }
    state.send(RenderCommand::SetViewMode(mode));
    Ok(())
}

#[tauri::command]
fn set_paused(state: tauri::State<'_, RendererHandle>, paused: bool) {
    state.send(RenderCommand::SetPaused(paused));
}

#[tauri::command]
fn reset_fluid(state: tauri::State<'_, RendererHandle>) {
    state.send(RenderCommand::ResetFluid);
}

#[tauri::command]
fn reset_params(state: tauri::State<'_, RendererHandle>) {
    state.send(RenderCommand::ResetParams);
}

#[tauri::command]
fn trigger_burst(state: tauri::State<'_, RendererHandle>) {
    state.send(RenderCommand::TriggerBurst);
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
                .title("Junkpile wgpu Compute Fluid Feedback · Native Surface")
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
            set_simulation_size,
            set_resolution_preset,
            set_emitter_mode,
            set_palette,
            set_view_mode,
            set_paused,
            reset_fluid,
            reset_params,
            trigger_burst,
            toggle_renderer_fullscreen
        ])
        .run(tauri::generate_context!())
        .expect("error running wgpu compute fluid feedback");
}
