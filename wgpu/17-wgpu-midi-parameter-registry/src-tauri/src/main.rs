#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod midi;
mod renderer;

use midi::{MidiCommand, MidiHandle, MidiInfo, MidiMapping};
use renderer::{RendererHandle, RendererInfo};
use tauri::Manager;

#[tauri::command]
fn get_midi_info(state: tauri::State<'_, MidiHandle>) -> MidiInfo {
    state.info()
}

#[tauri::command]
fn refresh_midi_ports(state: tauri::State<'_, MidiHandle>) {
    state.send(MidiCommand::RefreshPorts);
}

#[tauri::command]
fn connect_midi_port(state: tauri::State<'_, MidiHandle>, name: String) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("MIDI port name cannot be empty".into());
    }
    state.send(MidiCommand::Connect(name));
    Ok(())
}

#[tauri::command]
fn disconnect_midi(state: tauri::State<'_, MidiHandle>) {
    state.send(MidiCommand::Disconnect);
}

#[tauri::command]
fn arm_midi_learn(state: tauri::State<'_, MidiHandle>, target: String) -> Result<(), String> {
    if !midi::PARAMETER_NAMES.contains(&target.as_str()) {
        return Err(format!("unknown MIDI target: {target}"));
    }
    state.send(MidiCommand::ArmLearn(target));
    Ok(())
}

#[tauri::command]
fn cancel_midi_learn(state: tauri::State<'_, MidiHandle>) {
    state.send(MidiCommand::CancelLearn);
}

#[tauri::command]
fn set_manual_parameter(
    state: tauri::State<'_, MidiHandle>,
    target: String,
    value: f32,
) -> Result<(), String> {
    if !midi::PARAMETER_NAMES.contains(&target.as_str()) {
        return Err(format!("unknown MIDI target: {target}"));
    }
    if !value.is_finite() {
        return Err("parameter must be finite".into());
    }
    state.send(MidiCommand::SetManual(target, value));
    Ok(())
}

#[tauri::command]
fn update_midi_mapping(
    state: tauri::State<'_, MidiHandle>,
    mapping: MidiMapping,
) -> Result<(), String> {
    if !midi::PARAMETER_NAMES.contains(&mapping.target.as_str()) {
        return Err(format!("unknown MIDI target: {}", mapping.target));
    }
    state.send(MidiCommand::UpdateMapping(mapping));
    Ok(())
}

#[tauri::command]
fn delete_midi_mapping(state: tauri::State<'_, MidiHandle>, id: u64) {
    state.send(MidiCommand::DeleteMapping(id));
}

#[tauri::command]
fn replace_midi_mappings(
    state: tauri::State<'_, MidiHandle>,
    mappings: Vec<MidiMapping>,
) {
    state.send(MidiCommand::ReplaceMappings(mappings));
}

#[tauri::command]
fn clear_midi_mappings(state: tauri::State<'_, MidiHandle>) {
    state.send(MidiCommand::ClearMappings);
}

#[tauri::command]
fn load_starter_mappings(state: tauri::State<'_, MidiHandle>) {
    state.send(MidiCommand::LoadStarterMappings);
}

#[tauri::command]
fn reset_midi_parameters(state: tauri::State<'_, MidiHandle>) {
    state.send(MidiCommand::ResetParameters);
}

#[tauri::command]
fn get_renderer_info(state: tauri::State<'_, RendererHandle>) -> RendererInfo {
    state.info()
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
            let midi_handle = midi::start().map_err(std::io::Error::other)?;
            let renderer_window = tauri::window::WindowBuilder::new(app, "renderer")
                .title("Junkpile wgpu MIDI Parameter Registry · GPU Surface")
                .inner_size(1280.0, 720.0)
                .min_inner_size(480.0, 270.0)
                .resizable(true)
                .build()?;

            let renderer_handle = renderer::start(renderer_window.clone(), midi_handle.snapshot())
                .map_err(std::io::Error::other)?;
            let resize_handle = renderer_handle.clone();
            renderer_window.on_window_event(move |event| match event {
                tauri::WindowEvent::Resized(size) => {
                    resize_handle.send(renderer::RenderCommand::Resize(size.width, size.height));
                }
                tauri::WindowEvent::ScaleFactorChanged { new_inner_size, .. } => {
                    resize_handle.send(renderer::RenderCommand::Resize(
                        new_inner_size.width,
                        new_inner_size.height,
                    ));
                }
                tauri::WindowEvent::Destroyed => {
                    resize_handle.send(renderer::RenderCommand::Shutdown);
                }
                _ => {}
            });

            if let Some(controls) = app.get_webview_window("controls") {
                let app_handle = app.handle().clone();
                let close_midi = midi_handle.clone();
                let close_renderer = renderer_handle.clone();
                controls.on_window_event(move |event| {
                    if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                        close_midi.send(MidiCommand::Shutdown);
                        close_renderer.send(renderer::RenderCommand::Shutdown);
                        app_handle.exit(0);
                    }
                });
            }

            app.manage(midi_handle);
            app.manage(renderer_handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_midi_info,
            refresh_midi_ports,
            connect_midi_port,
            disconnect_midi,
            arm_midi_learn,
            cancel_midi_learn,
            set_manual_parameter,
            update_midi_mapping,
            delete_midi_mapping,
            replace_midi_mappings,
            clear_midi_mappings,
            load_starter_mappings,
            reset_midi_parameters,
            get_renderer_info,
            toggle_renderer_fullscreen
        ])
        .run(tauri::generate_context!())
        .expect("error running wgpu MIDI parameter registry");
}
