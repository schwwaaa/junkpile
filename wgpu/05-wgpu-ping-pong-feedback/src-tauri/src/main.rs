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
    const VALID: &[&str] = &[
        "decay",
        "zoom",
        "rotation",
        "shift_x",
        "shift_y",
        "injection",
        "gain",
        "saturation",
        "source_scale",
    ];

    if !VALID.contains(&name.as_str()) {
        return Err(format!("unknown parameter: {name}"));
    }
    if !value.is_finite() {
        return Err("parameter value must be finite".into());
    }

    state.send(RenderCommand::SetParam(name, value));
    Ok(())
}

#[tauri::command]
fn clear_feedback(state: tauri::State<'_, RendererHandle>) {
    state.send(RenderCommand::Clear);
}

#[tauri::command]
fn reset_params(state: tauri::State<'_, RendererHandle>) {
    state.send(RenderCommand::Reset);
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
                .title("Junkpile wgpu Ping-Pong Feedback · Native Surface")
                .inner_size(1280.0, 720.0)
                .min_inner_size(480.0, 270.0)
                .resizable(true)
                .build()?;

            let handle = renderer::start(renderer_window.clone())
                .map_err(std::io::Error::other)?;
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
            clear_feedback,
            reset_params,
            toggle_renderer_fullscreen
        ])
        .run(tauri::generate_context!())
        .expect("error while running ping-pong feedback example");
}
