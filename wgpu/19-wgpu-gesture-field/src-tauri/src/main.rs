mod gesture;
mod renderer;

use gesture::{GestureHandle, GesturePoint};
use serde::Serialize;
use tauri::Manager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    gesture: gesture::GestureInfo,
    renderer: renderer::RendererInfo,
}

#[tauri::command]
fn get_app_info(gesture: tauri::State<'_, GestureHandle>, renderer: tauri::State<'_, renderer::RendererHandle>) -> AppInfo {
    AppInfo { gesture: gesture.info(), renderer: renderer.info() }
}

#[tauri::command]
fn push_gesture_point(gesture: tauri::State<'_, GestureHandle>, point: GesturePoint) { gesture.push(point); }

#[tauri::command]
fn set_gesture_parameter(gesture: tauri::State<'_, GestureHandle>, name: String, value: f32) -> Result<(), String> {
    gesture.set_parameter(&name, value)
}

#[tauri::command]
fn clear_gesture(gesture: tauri::State<'_, GestureHandle>) { gesture.clear(); }
#[tauri::command]
fn start_gesture_recording(gesture: tauri::State<'_, GestureHandle>) { gesture.start_recording(); }
#[tauri::command]
fn stop_gesture_recording(gesture: tauri::State<'_, GestureHandle>) { gesture.stop_recording(); }
#[tauri::command]
fn play_gesture_recording(gesture: tauri::State<'_, GestureHandle>) { gesture.play(); }
#[tauri::command]
fn stop_gesture_playback(gesture: tauri::State<'_, GestureHandle>) { gesture.stop_playback(); }

#[tauri::command]
fn toggle_renderer_fullscreen(app: tauri::AppHandle) -> Result<bool, String> {
    let window = app.get_window("renderer").ok_or_else(|| "renderer window unavailable".to_string())?;
    let next = !window.is_fullscreen().map_err(|error| error.to_string())?;
    window.set_fullscreen(next).map_err(|error| error.to_string())?;
    Ok(next)
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let gesture = GestureHandle::new();
            let renderer_window = tauri::window::WindowBuilder::new(app, "renderer")
                .title("Junkpile 19.2 · Gesture Field · Native wgpu Surface")
                .inner_size(1280.0, 720.0).min_inner_size(480.0, 270.0).resizable(true).build()?;
            let renderer = renderer::start(renderer_window.clone(), gesture.snapshot()).map_err(std::io::Error::other)?;
            let resize = renderer.clone();
            renderer_window.on_window_event(move |event| match event {
                tauri::WindowEvent::Resized(size) => resize.send(renderer::RenderCommand::Resize(size.width, size.height)),
                tauri::WindowEvent::ScaleFactorChanged { new_inner_size, .. } => resize.send(renderer::RenderCommand::Resize(new_inner_size.width, new_inner_size.height)),
                tauri::WindowEvent::Destroyed => resize.send(renderer::RenderCommand::Shutdown),
                _ => {}
            });
            if let Some(controls) = app.get_webview_window("controls") {
                let app_handle = app.handle().clone();
                let close_renderer = renderer.clone();
                controls.on_window_event(move |event| {
                    if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                        close_renderer.send(renderer::RenderCommand::Shutdown);
                        app_handle.exit(0);
                    }
                });
            }
            app.manage(gesture); app.manage(renderer); Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_info, push_gesture_point, set_gesture_parameter, clear_gesture,
            start_gesture_recording, stop_gesture_recording, play_gesture_recording,
            stop_gesture_playback, toggle_renderer_fullscreen
        ])
        .run(tauri::generate_context!())
        .expect("error while running gesture field example");
}
