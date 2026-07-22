#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio;
mod audio_router;
mod camera;
mod gesture;
mod midi;
mod osc;
mod renderer;
mod video;
mod video_audio;

use audio::{AudioCommand, AudioHandle};
use audio_router::{AudioRouterCommand, AudioRouterHandle};
use camera::{CameraDevice, CameraHandle};
use gesture::{GestureHandle, GesturePoint};
use midi::{MidiCommand, MidiHandle};
use osc::{OscCommand, OscHandle};
use renderer::{RenderCommand, RendererHandle};
use rosc::{encoder, OscMessage, OscPacket, OscType};
use serde::Serialize;
use std::{net::UdpSocket, path::PathBuf};
use tauri::Manager;
use video::VideoHandle;
use video_audio::{VideoAudioCommand, VideoAudioHandle};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioSystemInfo {
    router: audio_router::AudioRouterInfo,
    microphone: audio::AudioInfo,
    video: video_audio::VideoAudioInfo,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    build: String,
    renderer: renderer::RendererInfo,
    camera: camera::CameraStatus,
    camera_devices: Vec<CameraDevice>,
    video: video::VideoStatus,
    audio: AudioSystemInfo,
    midi: midi::MidiInfo,
    osc: osc::OscInfo,
    gesture: gesture::GestureInfo,
}

#[tauri::command]
fn get_app_info(
    renderer: tauri::State<'_, RendererHandle>,
    camera: tauri::State<'_, CameraHandle>,
    video: tauri::State<'_, VideoHandle>,
    microphone_audio: tauri::State<'_, AudioHandle>,
    video_audio: tauri::State<'_, VideoAudioHandle>,
    audio_router: tauri::State<'_, AudioRouterHandle>,
    midi: tauri::State<'_, MidiHandle>,
    osc: tauri::State<'_, OscHandle>,
    gesture: tauri::State<'_, GestureHandle>,
) -> AppInfo {
    AppInfo {
        build: "20.1".into(),
        renderer: renderer.info(),
        camera: camera.status(),
        camera_devices: camera.devices(),
        video: video.status(),
        audio: AudioSystemInfo {
            router: audio_router.info(),
            microphone: microphone_audio.info(),
            video: video_audio.info(),
        },
        midi: midi.info(),
        osc: osc.info(),
        gesture: gesture.info(),
    }
}

#[tauri::command]
fn refresh_cameras(state: tauri::State<'_, CameraHandle>) {
    state.refresh();
}

#[tauri::command]
fn start_camera(
    state: tauri::State<'_, CameraHandle>,
    slot: usize,
    profile: String,
) -> Result<(), String> {
    if !matches!(profile.as_str(), "lowLatency" | "balanced" | "speed" | "quality") {
        return Err("profile must be lowLatency, balanced, speed, or quality".into());
    }
    state.start_camera(slot, profile);
    Ok(())
}

#[tauri::command]
fn stop_camera(state: tauri::State<'_, CameraHandle>) {
    state.stop_camera();
}

#[tauri::command]
fn open_video_file(
    video: tauri::State<'_, VideoHandle>,
    video_audio: tauri::State<'_, VideoAudioHandle>,
) -> Result<Option<String>, String> {
    let path = rfd::FileDialog::new()
        .add_filter(
            "Video",
            &["mp4", "mov", "m4v", "mkv", "webm", "avi", "mpeg", "mpg", "ts"],
        )
        .pick_file();
    if let Some(path) = path {
        let display = path.display().to_string();
        video_audio.send(VideoAudioCommand::Open(path.clone()));
        video.open(path);
        Ok(Some(display))
    } else {
        Ok(None)
    }
}

#[tauri::command]
fn open_video_path(
    video: tauri::State<'_, VideoHandle>,
    video_audio: tauri::State<'_, VideoAudioHandle>,
    path: String,
) -> Result<(), String> {
    let path = PathBuf::from(path);
    if !path.is_file() {
        return Err("selected path is not a file".into());
    }
    video_audio.send(VideoAudioCommand::Open(path.clone()));
    video.open(path);
    Ok(())
}

#[tauri::command]
fn play_video(
    video: tauri::State<'_, VideoHandle>,
    video_audio: tauri::State<'_, VideoAudioHandle>,
) {
    let position = video.status().position_seconds;
    video_audio.send(VideoAudioCommand::Play(position));
    video.play();
}

#[tauri::command]
fn pause_video(
    video: tauri::State<'_, VideoHandle>,
    video_audio: tauri::State<'_, VideoAudioHandle>,
) {
    video_audio.send(VideoAudioCommand::Pause);
    video.pause();
}

#[tauri::command]
fn stop_video(
    video: tauri::State<'_, VideoHandle>,
    video_audio: tauri::State<'_, VideoAudioHandle>,
) {
    video_audio.send(VideoAudioCommand::Stop);
    video.stop();
}

#[tauri::command]
fn seek_video(
    video: tauri::State<'_, VideoHandle>,
    video_audio: tauri::State<'_, VideoAudioHandle>,
    seconds: f64,
) -> Result<(), String> {
    if !seconds.is_finite() {
        return Err("seek position must be finite".into());
    }
    let status = video.status();
    let target = seconds.clamp(0.0, status.duration_seconds.max(0.0));
    video_audio.send(VideoAudioCommand::Seek {
        seconds: target,
        playing: status.playing,
    });
    video.seek(target);
    Ok(())
}

#[tauri::command]
fn step_video(
    video: tauri::State<'_, VideoHandle>,
    video_audio: tauri::State<'_, VideoAudioHandle>,
    direction: i32,
) {
    let status = video.status();
    let frame_seconds = 1.0 / status.source_fps.max(1.0);
    let target = (status.position_seconds + frame_seconds * direction.signum() as f64)
        .clamp(0.0, status.duration_seconds.max(0.0));
    video_audio.send(VideoAudioCommand::Seek {
        seconds: target,
        playing: false,
    });
    video.step(direction);
}

#[tauri::command]
fn set_video_rate(
    video: tauri::State<'_, VideoHandle>,
    video_audio: tauri::State<'_, VideoAudioHandle>,
    rate: f64,
) -> Result<(), String> {
    if !rate.is_finite() {
        return Err("playback rate must be finite".into());
    }
    let status = video.status();
    let clamped = rate.clamp(0.25, 4.0);
    video_audio.send(VideoAudioCommand::SetRate {
        rate: clamped,
        position: status.position_seconds,
        playing: status.playing,
    });
    video.set_rate(clamped);
    Ok(())
}

#[tauri::command]
fn set_video_decode_mode(
    video: tauri::State<'_, VideoHandle>,
    mode: String,
) -> Result<(), String> {
    if !matches!(mode.as_str(), "software" | "auto") {
        return Err("decode mode must be software or auto".into());
    }
    video.set_decode_mode(mode);
    Ok(())
}

#[tauri::command]
fn set_video_loop(
    video: tauri::State<'_, VideoHandle>,
    video_audio: tauri::State<'_, VideoAudioHandle>,
    looping: bool,
) {
    video_audio.send(VideoAudioCommand::SetLoop(looping));
    video.set_loop(looping);
}

#[tauri::command]
fn refresh_audio_devices(state: tauri::State<'_, AudioHandle>) {
    state.send(AudioCommand::RefreshDevices);
}

#[tauri::command]
fn select_audio_device(state: tauri::State<'_, AudioHandle>, name: String) {
    state.send(AudioCommand::SelectDevice(name));
}

#[tauri::command]
fn start_audio(state: tauri::State<'_, AudioHandle>) {
    state.send(AudioCommand::Start);
}

#[tauri::command]
fn stop_audio(state: tauri::State<'_, AudioHandle>) {
    state.send(AudioCommand::Stop);
}

#[tauri::command]
fn set_audio_fft_source(
    state: tauri::State<'_, AudioRouterHandle>,
    source: String,
) -> Result<(), String> {
    if !matches!(source.as_str(), "microphone" | "video" | "mix") {
        return Err("audio FFT source must be microphone, video, or mix".into());
    }
    state.send(AudioRouterCommand::SetSource(source));
    Ok(())
}

#[tauri::command]
fn set_video_audio_preview(
    state: tauri::State<'_, VideoAudioHandle>,
    enabled: bool,
) {
    state.send(VideoAudioCommand::SetPreview(enabled));
}

#[tauri::command]
fn refresh_midi_ports(state: tauri::State<'_, MidiHandle>) {
    state.send(MidiCommand::RefreshPorts);
}

#[tauri::command]
fn connect_midi(state: tauri::State<'_, MidiHandle>, name: String) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("select a MIDI input".into());
    }
    state.send(MidiCommand::Connect(name));
    state.send(MidiCommand::LoadStarterMappings);
    Ok(())
}

#[tauri::command]
fn disconnect_midi(state: tauri::State<'_, MidiHandle>) {
    state.send(MidiCommand::Disconnect);
}

#[tauri::command]
fn bind_osc(
    state: tauri::State<'_, OscHandle>,
    host: String,
    port: u16,
) -> Result<(), String> {
    if port == 0 {
        return Err("OSC port must be between 1 and 65535".into());
    }
    state.send(OscCommand::Bind(host, port));
    state.send(OscCommand::LoadStarterMappings);
    Ok(())
}

#[tauri::command]
fn stop_osc(state: tauri::State<'_, OscHandle>) {
    state.send(OscCommand::Stop);
}

#[tauri::command]
fn send_osc_test(host: String, port: u16, address: String, value: f32) -> Result<(), String> {
    if port == 0 || !value.is_finite() {
        return Err("invalid OSC test arguments".into());
    }
    let address = if address.trim().starts_with('/') {
        address.trim().to_string()
    } else {
        format!("/{}", address.trim())
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
fn push_gesture_point(state: tauri::State<'_, GestureHandle>, point: GesturePoint) {
    state.push(point);
}

#[tauri::command]
fn clear_gesture(state: tauri::State<'_, GestureHandle>) {
    state.clear();
}

#[tauri::command]
fn set_compositor_param(
    state: tauri::State<'_, RendererHandle>,
    name: String,
    value: f32,
) -> Result<(), String> {
    const VALID: &[&str] = &[
        "sourceMix",
        "feedback",
        "displacement",
        "chroma",
        "exposure",
        "contrast",
        "audioGain",
        "gestureGain",
    ];
    if !VALID.contains(&name.as_str()) {
        return Err(format!("unknown compositor parameter: {name}"));
    }
    if !value.is_finite() {
        return Err("parameter must be finite".into());
    }
    state.send(RenderCommand::SetParam(name, value));
    Ok(())
}

#[tauri::command]
fn set_compositor_mode(
    state: tauri::State<'_, RendererHandle>,
    mode: String,
) -> Result<(), String> {
    if !matches!(mode.as_str(), "blend" | "difference" | "multiply" | "lumaKey") {
        return Err("mode must be blend, difference, multiply, or lumaKey".into());
    }
    state.send(RenderCommand::SetMode(mode));
    Ok(())
}

#[tauri::command]
fn reset_compositor(state: tauri::State<'_, RendererHandle>) {
    state.send(RenderCommand::Reset);
}

#[tauri::command]
fn toggle_renderer_fullscreen(app: tauri::AppHandle) -> Result<bool, String> {
    let window = app
        .get_window("renderer")
        .ok_or_else(|| "renderer window unavailable".to_string())?;
    let next = !window.is_fullscreen().map_err(|error| error.to_string())?;
    window
        .set_fullscreen(next)
        .map_err(|error| error.to_string())?;
    Ok(next)
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let camera = camera::start().map_err(std::io::Error::other)?;
            let video = video::start().map_err(std::io::Error::other)?;
            let microphone_audio = audio::start().map_err(std::io::Error::other)?;
            let video_audio = video_audio::start().map_err(std::io::Error::other)?;
            let audio_router = audio_router::start(
                microphone_audio.snapshot(),
                video_audio.snapshot(),
            )
            .map_err(std::io::Error::other)?;
            let midi = midi::start().map_err(std::io::Error::other)?;
            let osc = osc::start().map_err(std::io::Error::other)?;
            let gesture = GestureHandle::new();

            osc.send(OscCommand::LoadStarterMappings);
            osc.send(OscCommand::Bind("0.0.0.0".into(), 9000));
            midi.send(MidiCommand::LoadStarterMappings);

            let renderer_window = tauri::window::WindowBuilder::new(app, "renderer")
                .title("Junkpile 20.1 · Multi-Input Compositor · Native wgpu Surface")
                .inner_size(1280.0, 720.0)
                .min_inner_size(480.0, 270.0)
                .resizable(true)
                .build()?;

            let renderer = renderer::start(
                renderer_window.clone(),
                renderer::InputSources {
                    camera: camera.frame_source(),
                    video: video.frame_source(),
                    audio: audio_router.snapshot(),
                    midi: midi.snapshot(),
                    osc: osc.snapshot(),
                    gesture: gesture.snapshot(),
                },
            )
            .map_err(std::io::Error::other)?;

            let resize = renderer.clone();
            renderer_window.on_window_event(move |event| match event {
                tauri::WindowEvent::Resized(size) => {
                    resize.send(RenderCommand::Resize(size.width, size.height))
                }
                tauri::WindowEvent::ScaleFactorChanged { new_inner_size, .. } => {
                    resize.send(RenderCommand::Resize(
                        new_inner_size.width,
                        new_inner_size.height,
                    ))
                }
                tauri::WindowEvent::Destroyed => resize.send(RenderCommand::Shutdown),
                _ => {}
            });

            if let Some(controls) = app.get_webview_window("controls") {
                let app_handle = app.handle().clone();
                let close_renderer = renderer.clone();
                let close_camera = camera.clone();
                let close_video = video.clone();
                let close_microphone_audio = microphone_audio.clone();
                let close_video_audio = video_audio.clone();
                let close_audio_router = audio_router.clone();
                let close_midi = midi.clone();
                let close_osc = osc.clone();
                controls.on_window_event(move |event| {
                    if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                        close_renderer.send(RenderCommand::Shutdown);
                        close_camera.shutdown();
                        close_video.shutdown();
                        close_microphone_audio.send(AudioCommand::Shutdown);
                        close_video_audio.send(VideoAudioCommand::Shutdown);
                        close_audio_router.send(AudioRouterCommand::Shutdown);
                        close_midi.send(MidiCommand::Shutdown);
                        close_osc.send(OscCommand::Shutdown);
                        app_handle.exit(0);
                    }
                });
            }

            app.manage(camera);
            app.manage(video);
            app.manage(microphone_audio);
            app.manage(video_audio);
            app.manage(audio_router);
            app.manage(midi);
            app.manage(osc);
            app.manage(gesture);
            app.manage(renderer);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_info,
            refresh_cameras,
            start_camera,
            stop_camera,
            open_video_file,
            open_video_path,
            play_video,
            pause_video,
            stop_video,
            seek_video,
            step_video,
            set_video_rate,
            set_video_decode_mode,
            set_video_loop,
            refresh_audio_devices,
            select_audio_device,
            start_audio,
            stop_audio,
            set_audio_fft_source,
            set_video_audio_preview,
            refresh_midi_ports,
            connect_midi,
            disconnect_midi,
            bind_osc,
            stop_osc,
            send_osc_test,
            push_gesture_point,
            clear_gesture,
            set_compositor_param,
            set_compositor_mode,
            reset_compositor,
            toggle_renderer_fullscreen
        ])
        .run(tauri::generate_context!())
        .expect("error while running multi-input compositor");
}
