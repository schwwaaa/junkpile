#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod osc;
mod renderer;

use osc::{OscCommand, OscHandle, OscInfo, OscMapping};
use renderer::{RendererHandle, RendererInfo};
use rosc::{encoder, OscMessage, OscPacket, OscType};
use std::net::UdpSocket;
use tauri::Manager;

#[tauri::command]
fn get_osc_info(state: tauri::State<'_, OscHandle>) -> OscInfo {
    state.info()
}

#[tauri::command]
fn bind_osc_listener(
    state: tauri::State<'_, OscHandle>,
    host: String,
    port: u16,
) -> Result<(), String> {
    let host = host.trim();
    if host.is_empty() {
        return Err("bind host cannot be empty".into());
    }
    if port == 0 {
        return Err("OSC port must be between 1 and 65535".into());
    }
    state.send(OscCommand::Bind(host.to_string(), port));
    Ok(())
}

#[tauri::command]
fn stop_osc_listener(state: tauri::State<'_, OscHandle>) {
    state.send(OscCommand::Stop);
}

#[tauri::command]
fn arm_osc_learn(state: tauri::State<'_, OscHandle>, target: String) -> Result<(), String> {
    if !osc::PARAMETER_NAMES.contains(&target.as_str()) {
        return Err(format!("unknown OSC target: {target}"));
    }
    state.send(OscCommand::ArmLearn(target));
    Ok(())
}

#[tauri::command]
fn cancel_osc_learn(state: tauri::State<'_, OscHandle>) {
    state.send(OscCommand::CancelLearn);
}

#[tauri::command]
fn set_manual_parameter(
    state: tauri::State<'_, OscHandle>,
    target: String,
    value: f32,
) -> Result<(), String> {
    if !osc::PARAMETER_NAMES.contains(&target.as_str()) {
        return Err(format!("unknown OSC target: {target}"));
    }
    if !value.is_finite() {
        return Err("parameter must be finite".into());
    }
    state.send(OscCommand::SetManual(target, value));
    Ok(())
}

#[tauri::command]
fn update_osc_mapping(
    state: tauri::State<'_, OscHandle>,
    mapping: OscMapping,
) -> Result<(), String> {
    if !osc::PARAMETER_NAMES.contains(&mapping.target.as_str()) {
        return Err(format!("unknown OSC target: {}", mapping.target));
    }
    if mapping.address.trim().is_empty() {
        return Err("OSC address cannot be empty".into());
    }
    state.send(OscCommand::UpdateMapping(mapping));
    Ok(())
}

#[tauri::command]
fn delete_osc_mapping(state: tauri::State<'_, OscHandle>, id: u64) {
    state.send(OscCommand::DeleteMapping(id));
}

#[tauri::command]
fn replace_osc_mappings(state: tauri::State<'_, OscHandle>, mappings: Vec<OscMapping>) {
    state.send(OscCommand::ReplaceMappings(mappings));
}

#[tauri::command]
fn clear_osc_mappings(state: tauri::State<'_, OscHandle>) {
    state.send(OscCommand::ClearMappings);
}

#[tauri::command]
fn load_starter_mappings(state: tauri::State<'_, OscHandle>) {
    state.send(OscCommand::LoadStarterMappings);
}

#[tauri::command]
fn reset_osc_parameters(state: tauri::State<'_, OscHandle>) {
    state.send(OscCommand::ResetParameters);
}

#[tauri::command]
fn clear_osc_history(state: tauri::State<'_, OscHandle>) {
    state.send(OscCommand::ClearHistory);
}


#[tauri::command]
fn send_osc_test(host: String, port: u16, address: String, value: f32) -> Result<(), String> {
    if port == 0 {
        return Err("OSC port must be between 1 and 65535".into());
    }
    if !value.is_finite() {
        return Err("test value must be finite".into());
    }
    let address = address.trim();
    if address.is_empty() {
        return Err("OSC address cannot be empty".into());
    }
    let address = if address.starts_with('/') {
        address.to_string()
    } else {
        format!("/{address}")
    };
    let packet = OscPacket::Message(OscMessage {
        addr: address,
        args: vec![OscType::Float(value)],
    });
    let bytes = encoder::encode(&packet).map_err(|error| error.to_string())?;
    let socket = UdpSocket::bind("0.0.0.0:0").map_err(|error| error.to_string())?;
    socket
        .send_to(&bytes, format!("{}:{}", host.trim(), port))
        .map_err(|error| error.to_string())?;
    Ok(())
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
    window.set_fullscreen(next).map_err(|error| error.to_string())?;
    Ok(next)
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let osc_handle = osc::start().map_err(std::io::Error::other)?;
            let renderer_window = tauri::window::WindowBuilder::new(app, "renderer")
                .title("Junkpile wgpu OSC Network Control · GPU Surface")
                .inner_size(1280.0, 720.0)
                .min_inner_size(480.0, 270.0)
                .resizable(true)
                .build()?;

            let renderer_handle = renderer::start(renderer_window.clone(), osc_handle.snapshot())
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
                let close_osc = osc_handle.clone();
                let close_renderer = renderer_handle.clone();
                controls.on_window_event(move |event| {
                    if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                        close_osc.send(OscCommand::Shutdown);
                        close_renderer.send(renderer::RenderCommand::Shutdown);
                        app_handle.exit(0);
                    }
                });
            }

            app.manage(osc_handle);
            app.manage(renderer_handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_osc_info,
            bind_osc_listener,
            stop_osc_listener,
            arm_osc_learn,
            cancel_osc_learn,
            set_manual_parameter,
            update_osc_mapping,
            delete_osc_mapping,
            replace_osc_mappings,
            clear_osc_mappings,
            load_starter_mappings,
            reset_osc_parameters,
            clear_osc_history,
            send_osc_test,
            get_renderer_info,
            toggle_renderer_fullscreen
        ])
        .run(tauri::generate_context!())
        .expect("error running wgpu OSC network control");
}
