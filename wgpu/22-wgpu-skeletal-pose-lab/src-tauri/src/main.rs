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
        .add_filter("glTF character", &["gltf", "glb"])
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
fn set_view_mode(state: tauri::State<'_, RendererHandle>, mode: String) -> Result<(), String> {
    if !matches!(mode.as_str(), "lit" | "weights" | "joints" | "normals") {
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
fn set_show_skeleton(state: tauri::State<'_, RendererHandle>, enabled: bool) {
    state.send(RenderCommand::SetShowSkeleton(enabled));
}

#[tauri::command]
fn set_animation(state: tauri::State<'_, RendererHandle>, index: usize) {
    state.send(RenderCommand::SetAnimation(index));
}

#[tauri::command]
fn set_animation_playing(state: tauri::State<'_, RendererHandle>, playing: bool) {
    state.send(RenderCommand::SetAnimationPlaying(playing));
}

#[tauri::command]
fn set_animation_loop(state: tauri::State<'_, RendererHandle>, looping: bool) {
    state.send(RenderCommand::SetAnimationLoop(looping));
}

#[tauri::command]
fn set_animation_time(
    state: tauri::State<'_, RendererHandle>,
    time: f32,
) -> Result<(), String> {
    if !time.is_finite() {
        return Err("animation time must be finite".into());
    }
    state.send(RenderCommand::SetAnimationTime(time));
    Ok(())
}

#[tauri::command]
fn set_animation_speed(
    state: tauri::State<'_, RendererHandle>,
    speed: f32,
) -> Result<(), String> {
    if !speed.is_finite() {
        return Err("animation speed must be finite".into());
    }
    state.send(RenderCommand::SetAnimationSpeed(speed));
    Ok(())
}

#[tauri::command]
fn set_animation_blend(
    state: tauri::State<'_, RendererHandle>,
    blend: f32,
) -> Result<(), String> {
    if !blend.is_finite() {
        return Err("animation blend must be finite".into());
    }
    state.send(RenderCommand::SetAnimationBlend(blend));
    Ok(())
}

#[tauri::command]
fn select_joint(state: tauri::State<'_, RendererHandle>, index: usize) {
    state.send(RenderCommand::SelectJoint(index));
}

#[tauri::command]
fn set_joint_rotation(
    state: tauri::State<'_, RendererHandle>,
    x: f32,
    y: f32,
    z: f32,
) -> Result<(), String> {
    if !x.is_finite() || !y.is_finite() || !z.is_finite() {
        return Err("joint rotation must be finite".into());
    }
    state.send(RenderCommand::SetJointRotation(x, y, z));
    Ok(())
}

#[tauri::command]
fn reset_selected_joint(state: tauri::State<'_, RendererHandle>) {
    state.send(RenderCommand::ResetSelectedJoint);
}

#[tauri::command]
fn reset_pose(state: tauri::State<'_, RendererHandle>) {
    state.send(RenderCommand::ResetPose);
}

#[tauri::command]
fn apply_pose_preset(
    state: tauri::State<'_, RendererHandle>,
    name: String,
) -> Result<(), String> {
    if !matches!(name.as_str(), "wave" | "s_curve" | "twist") {
        return Err(format!("unknown pose preset: {name}"));
    }
    state.send(RenderCommand::ApplyPosePreset(name));
    Ok(())
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
    window.set_fullscreen(next).map_err(|error| error.to_string())?;
    Ok(next)
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let renderer_window = tauri::window::WindowBuilder::new(app, "renderer")
                .title("Junkpile 22 · Skeletal Pose Lab · Native Surface")
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
            load_sample_scene,
            set_param,
            set_view_mode,
            set_backface_culling,
            set_show_skeleton,
            set_animation,
            set_animation_playing,
            set_animation_loop,
            set_animation_time,
            set_animation_speed,
            set_animation_blend,
            select_joint,
            set_joint_rotation,
            reset_selected_joint,
            reset_pose,
            apply_pose_preset,
            reset_camera,
            toggle_renderer_fullscreen
        ])
        .run(tauri::generate_context!())
        .expect("error running Junkpile skeletal pose lab");
}
