#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod renderer;
mod video;

use renderer::{RenderCommand, RendererHandle, RendererInfo};
use std::path::PathBuf;
use tauri::Manager;
use video::{VideoHandle, VideoStatus};

#[tauri::command]
fn get_renderer_info(state: tauri::State<'_, RendererHandle>) -> RendererInfo { state.info() }

#[tauri::command]
fn get_video_status(state: tauri::State<'_, VideoHandle>) -> VideoStatus { state.status() }

#[tauri::command]
fn open_video_file(state: tauri::State<'_, VideoHandle>) -> Result<Option<String>, String> {
    let path = rfd::FileDialog::new()
        .add_filter("Video", &["mp4", "mov", "m4v", "mkv", "webm", "avi", "mpeg", "mpg", "ts"])
        .pick_file();
    if let Some(path) = path {
        let display = path.display().to_string();
        state.open(path);
        Ok(Some(display))
    } else {
        Ok(None)
    }
}

#[tauri::command]
fn open_video_path(state: tauri::State<'_, VideoHandle>, path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    if !path.is_file() { return Err("selected path is not a file".into()); }
    state.open(path);
    Ok(())
}

#[tauri::command]
fn play_video(state: tauri::State<'_, VideoHandle>) { state.play(); }

#[tauri::command]
fn pause_video(state: tauri::State<'_, VideoHandle>) { state.pause(); }

#[tauri::command]
fn stop_video(state: tauri::State<'_, VideoHandle>) { state.stop(); }

#[tauri::command]
fn seek_video(state: tauri::State<'_, VideoHandle>, seconds: f64) -> Result<(), String> {
    if !seconds.is_finite() || seconds < 0.0 { return Err("seek time must be a finite non-negative number".into()); }
    state.seek(seconds);
    Ok(())
}

#[tauri::command]
fn set_playback_rate(state: tauri::State<'_, VideoHandle>, rate: f64) -> Result<(), String> {
    if !rate.is_finite() || !(0.1..=4.0).contains(&rate) { return Err("playback rate must be between 0.1 and 4.0".into()); }
    state.set_rate(rate);
    Ok(())
}

#[tauri::command]
fn set_video_loop(state: tauri::State<'_, VideoHandle>, looping: bool) { state.set_loop(looping); }

#[tauri::command]
fn set_decode_mode(state: tauri::State<'_, VideoHandle>, mode: String) -> Result<(), String> {
    if !matches!(mode.as_str(), "software" | "auto") { return Err("decode mode must be software or auto".into()); }
    state.set_decode_mode(mode);
    Ok(())
}

#[tauri::command]
fn step_video(state: tauri::State<'_, VideoHandle>, direction: i32) -> Result<(), String> {
    if direction != -1 && direction != 1 { return Err("frame-step direction must be -1 or 1".into()); }
    state.step(direction);
    Ok(())
}

#[tauri::command]
fn set_param(state: tauri::State<'_, RendererHandle>, name: String, value: f32) -> Result<(), String> {
    const VALID: &[&str] = &["zoom", "exposure", "contrast", "saturation", "effectStrength", "chroma", "blockSize", "posterize"];
    if !VALID.contains(&name.as_str()) { return Err(format!("unknown parameter: {name}")); }
    if !value.is_finite() { return Err("parameter value must be finite".into()); }
    state.send(RenderCommand::SetParam(name, value));
    Ok(())
}

#[tauri::command]
fn set_mode(state: tauri::State<'_, RendererHandle>, mode: String) -> Result<(), String> {
    if !matches!(mode.as_str(), "clean" | "edge" | "lumaWarp" | "rgbSplit" | "posterize" | "blocks" | "scanlines") {
        return Err("unknown processing mode".into());
    }
    state.send(RenderCommand::SetMode(mode));
    Ok(())
}

#[tauri::command]
fn set_filter_mode(state: tauri::State<'_, RendererHandle>, mode: String) -> Result<(), String> {
    if !matches!(mode.as_str(), "nearest" | "linear") { return Err("filter must be nearest or linear".into()); }
    state.send(RenderCommand::SetFilter(mode));
    Ok(())
}

#[tauri::command]
fn set_fit_mode(state: tauri::State<'_, RendererHandle>, mode: String) -> Result<(), String> {
    if !matches!(mode.as_str(), "contain" | "cover" | "stretch") { return Err("fit must be contain, cover, or stretch".into()); }
    state.send(RenderCommand::SetFit(mode));
    Ok(())
}

#[tauri::command]
fn set_rotation(state: tauri::State<'_, RendererHandle>, rotation: u32) -> Result<(), String> {
    if !matches!(rotation, 0 | 90 | 180 | 270) { return Err("rotation must be 0, 90, 180, or 270".into()); }
    state.send(RenderCommand::SetRotation(rotation));
    Ok(())
}

#[tauri::command]
fn set_mirror(state: tauri::State<'_, RendererHandle>, mirrored: bool) { state.send(RenderCommand::SetMirror(mirrored)); }

#[tauri::command]
fn reset_params(state: tauri::State<'_, RendererHandle>) { state.send(RenderCommand::Reset); }

#[tauri::command]
fn toggle_renderer_fullscreen(app: tauri::AppHandle) -> Result<bool, String> {
    let window = app.get_window("renderer").ok_or_else(|| "renderer window is unavailable".to_string())?;
    let next = !window.is_fullscreen().map_err(|error| error.to_string())?;
    window.set_fullscreen(next).map_err(|error| error.to_string())?;
    Ok(next)
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let video_handle = video::start().map_err(std::io::Error::other)?;
            let renderer_window = tauri::window::WindowBuilder::new(app, "renderer")
                .title("Junkpile wgpu Native Video Decoder · GPU Surface")
                .inner_size(1280.0, 720.0)
                .min_inner_size(480.0, 270.0)
                .resizable(true)
                .build()?;
            let renderer_handle = renderer::start(renderer_window.clone(), video_handle.frame_source())
                .map_err(std::io::Error::other)?;

            let resize_handle = renderer_handle.clone();
            renderer_window.on_window_event(move |event| match event {
                tauri::WindowEvent::Resized(size) => resize_handle.send(RenderCommand::Resize(size.width, size.height)),
                tauri::WindowEvent::ScaleFactorChanged { new_inner_size, .. } => resize_handle.send(RenderCommand::Resize(new_inner_size.width, new_inner_size.height)),
                tauri::WindowEvent::Destroyed => resize_handle.send(RenderCommand::Shutdown),
                _ => {}
            });

            if let Some(controls) = app.get_webview_window("controls") {
                let app_handle = app.handle().clone();
                let close_renderer = renderer_handle.clone();
                let close_video = video_handle.clone();
                controls.on_window_event(move |event| {
                    if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                        close_renderer.send(RenderCommand::Shutdown);
                        close_video.shutdown();
                        app_handle.exit(0);
                    }
                });
            }

            app.manage(video_handle);
            app.manage(renderer_handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_renderer_info, get_video_status, open_video_file, open_video_path,
            play_video, pause_video, stop_video, seek_video, set_playback_rate,
            set_video_loop, set_decode_mode, step_video,
            set_param, set_mode, set_filter_mode, set_fit_mode, set_rotation,
            set_mirror, reset_params, toggle_renderer_fullscreen
        ])
        .run(tauri::generate_context!())
        .expect("error while running native video decoder example");
}
