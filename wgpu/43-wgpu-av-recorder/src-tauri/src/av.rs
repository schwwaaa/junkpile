use crate::{
    audio::{AudioCaptureHandle, MicCaptureStatus},
    recording::RecordingState,
    renderer::RendererHandle,
};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex, RwLock},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AudioSourceMode {
    None,
    Microphone,
    File,
}

impl AudioSourceMode {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value.to_ascii_lowercase().as_str() {
            "none" => Ok(Self::None),
            "microphone" | "mic" => Ok(Self::Microphone),
            "file" | "audio-file" => Ok(Self::File),
            _ => Err(format!("unknown audio source mode: {value}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AudioFileInfo {
    pub valid: bool,
    pub path: String,
    pub codec: String,
    pub sample_rate: u32,
    pub channels: u32,
    pub duration_seconds: f64,
    pub error: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvStatus {
    pub state: String,
    pub audio_mode: String,
    pub audio_description: String,
    pub selected_audio_file: AudioFileInfo,
    pub mic: MicCaptureStatus,
    pub video_intermediate: String,
    pub final_output: String,
    pub mux_log: String,
    pub last_error: String,
}

impl Default for AvStatus {
    fn default() -> Self {
        Self {
            state: "idle".into(),
            audio_mode: "none".into(),
            audio_description: "Video only".into(),
            selected_audio_file: AudioFileInfo::default(),
            mic: MicCaptureStatus::default(),
            video_intermediate: String::new(),
            final_output: String::new(),
            mux_log: String::new(),
            last_error: String::new(),
        }
    }
}

#[derive(Debug, Clone)]
struct ActiveSession {
    audio_mode: AudioSourceMode,
    codec: String,
    video_path: PathBuf,
    audio_path: Option<PathBuf>,
    audio_channels: u32,
    mic_temp_path: Option<PathBuf>,
}

#[derive(Clone)]
pub struct AvController {
    renderer: RendererHandle,
    audio: AudioCaptureHandle,
    status: Arc<RwLock<AvStatus>>,
    session: Arc<Mutex<Option<ActiveSession>>>,
}

impl AvController {
    pub fn new(renderer: RendererHandle, audio: AudioCaptureHandle) -> Self {
        Self {
            renderer,
            audio,
            status: Arc::new(RwLock::new(AvStatus::default())),
            session: Arc::new(Mutex::new(None)),
        }
    }

    pub fn status(&self) -> AvStatus {
        let mut status = self.status.read().expect("AV status lock poisoned").clone();
        status.mic = self.audio.status();
        status
    }

    #[allow(clippy::too_many_arguments)]
    pub fn start_recording(
        &self,
        codec: String,
        width: u32,
        height: u32,
        fps: u32,
        worker_delay_ms: u64,
        audio_mode: String,
        microphone_device: String,
        audio_file: String,
    ) -> Result<String, String> {
        let mode = AudioSourceMode::parse(&audio_mode)?;
        {
            let session = self.session.lock().map_err(|_| "AV session lock poisoned".to_string())?;
            if session.is_some() {
                return Err("an AV recording is already active or finalizing".into());
            }
        }

        let snapshot = self.renderer.snapshot();
        if matches!(snapshot.recording.state, RecordingState::Recording | RecordingState::Finalizing) {
            return Err("the video recorder is already active or finalizing".into());
        }

        let output_dir = PathBuf::from(snapshot.recording.output_directory);
        crate::output_directory::ensure_writable_directory(&output_dir)?;

        let mut audio_path = None;
        let mut audio_channels = 0;
        let mut mic_temp_path = None;
        let mut audio_description = "Video only".to_string();

        match mode {
            AudioSourceMode::None => {}
            AudioSourceMode::Microphone => {
                let path = output_dir.join(format!(
                    ".junkpile-av-mic-{}-{}.wav",
                    std::process::id(),
                    now_millis()
                ));
                self.audio.start_capture(microphone_device.clone(), path.clone())?;
                audio_channels = u32::from(self.audio.status().channels);
                mic_temp_path = Some(path.clone());
                audio_path = Some(path);
                audio_description = if microphone_device.trim().is_empty() {
                    "Default microphone".into()
                } else {
                    microphone_device
                };
            }
            AudioSourceMode::File => {
                let path = PathBuf::from(&audio_file);
                let info = probe_audio_file(&ffprobe_for(&snapshot.ffmpeg.executable), &path)?;
                if !info.valid {
                    return Err(info.error);
                }
                audio_description = format!(
                    "{} · {} Hz · {} ch",
                    info.codec, info.sample_rate, info.channels
                );
                audio_channels = info.channels;
                audio_path = Some(path.clone());
                self.status.write().expect("AV status lock poisoned").selected_audio_file = info;
            }
        }

        let video_path = match self.renderer.start_recording(
            codec.clone(),
            width,
            height,
            fps,
            worker_delay_ms,
        ) {
            Ok(path) => PathBuf::from(path),
            Err(error) => {
                if mode == AudioSourceMode::Microphone {
                    let _ = self.audio.stop_capture();
                }
                if let Some(path) = mic_temp_path.as_ref() {
                    let _ = fs::remove_file(path);
                }
                return Err(error);
            }
        };

        let session = ActiveSession {
            audio_mode: mode.clone(),
            codec: codec.clone(),
            video_path: video_path.clone(),
            audio_path,
            audio_channels,
            mic_temp_path,
        };
        *self.session.lock().map_err(|_| "AV session lock poisoned".to_string())? = Some(session);

        let mut status = self.status.write().expect("AV status lock poisoned");
        status.state = "recording".into();
        status.audio_mode = match mode {
            AudioSourceMode::None => "none",
            AudioSourceMode::Microphone => "microphone",
            AudioSourceMode::File => "file",
        }
        .into();
        status.audio_description = audio_description;
        status.video_intermediate = video_path.to_string_lossy().into_owned();
        status.final_output.clear();
        status.mux_log.clear();
        status.last_error.clear();
        Ok(video_path.to_string_lossy().into_owned())
    }

    pub fn stop_recording(&self) -> Result<(), String> {
        let session = self
            .session
            .lock()
            .map_err(|_| "AV session lock poisoned".to_string())?
            .clone()
            .ok_or_else(|| "no AV recording is active".to_string())?;

        if session.audio_mode == AudioSourceMode::Microphone {
            if let Err(error) = self.audio.stop_capture() {
                self.status.write().expect("AV status lock poisoned").last_error = error;
            }
        }
        self.renderer.stop_recording()?;
        self.status.write().expect("AV status lock poisoned").state = "finalizing".into();

        let renderer = self.renderer.clone();
        let status = Arc::clone(&self.status);
        let session_slot = Arc::clone(&self.session);
        thread::Builder::new()
            .name("junkpile-av-finalizer".into())
            .spawn(move || {
                let result = finalize_session(&renderer, &session);
                let mut state = status.write().expect("AV status lock poisoned");
                match result {
                    Ok((final_path, log)) => {
                        state.state = "complete".into();
                        state.final_output = final_path.to_string_lossy().into_owned();
                        state.mux_log = log;
                        state.last_error.clear();
                    }
                    Err(error) => {
                        state.state = "error".into();
                        state.last_error = error;
                    }
                }
                if let Ok(mut slot) = session_slot.lock() {
                    *slot = None;
                }
            })
            .map_err(|error| format!("could not start AV finalizer: {error}"))?;
        Ok(())
    }
}

fn finalize_session(
    renderer: &RendererHandle,
    session: &ActiveSession,
) -> Result<(PathBuf, String), String> {
    let deadline = std::time::Instant::now() + Duration::from_secs(600);
    loop {
        let snapshot = renderer.snapshot();
        match snapshot.recording.state {
            RecordingState::Complete => break,
            RecordingState::Error => {
                return Err(if snapshot.recording.last_error.is_empty() {
                    "video recording failed during finalization".into()
                } else {
                    snapshot.recording.last_error
                });
            }
            _ if std::time::Instant::now() >= deadline => {
                return Err("video recording did not finalize within 10 minutes".into());
            }
            _ => thread::sleep(Duration::from_millis(200)),
        }
    }

    if session.audio_mode == AudioSourceMode::None {
        return Ok((session.video_path.clone(), "Video-only recording complete; no mux required.".into()));
    }

    let audio_path = session
        .audio_path
        .as_ref()
        .ok_or_else(|| "audio source path is missing during finalization".to_string())?;
    let final_path = final_output_path(&session.video_path);
    let ffmpeg = renderer.snapshot().ffmpeg.executable;
    let mut command = Command::new(&ffmpeg);
    command.args(["-hide_banner", "-loglevel", "warning", "-y", "-i"]);
    command.arg(&session.video_path);
    if session.audio_mode == AudioSourceMode::File {
        command.args(["-stream_loop", "-1"]);
    }
    command.arg("-i").arg(audio_path);
    command.args(["-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy"]);
    if session.audio_channels == 1 {
        // Some one-channel CoreAudio/WAV sources are tagged as a lone front-left (FL)
        // channel. FFmpeg's AAC encoder rejects that layout; normalize it to canonical mono.
        command.args(["-ac:a", "1"]);
    }
    if session.codec.eq_ignore_ascii_case("prores") || session.video_path.extension().and_then(|v| v.to_str()) == Some("mov") {
        command.args(["-c:a", "pcm_s24le", "-ar", "48000"]);
    } else {
        command.args(["-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-movflags", "+faststart"]);
    }
    command.arg("-shortest").arg(&final_path);

    let output = command
        .output()
        .map_err(|error| format!("could not run FFmpeg AV mux: {error}"))?;
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !output.status.success() {
        return Err(format!(
            "FFmpeg AV mux failed with {}: {}",
            output.status,
            if stderr.is_empty() { "no diagnostics" } else { &stderr }
        ));
    }
    if !final_path.exists() || fs::metadata(&final_path).map(|m| m.len()).unwrap_or(0) == 0 {
        return Err("FFmpeg reported success but the final AV file is missing or empty".into());
    }

    let _ = fs::remove_file(&session.video_path);
    if let Some(path) = session.mic_temp_path.as_ref() {
        let _ = fs::remove_file(path);
    }
    Ok((
        final_path,
        if stderr.is_empty() {
            "AV mux complete. Video stream was copied without re-encoding.".into()
        } else {
            stderr
        },
    ))
}

pub fn probe_audio_file(ffprobe: &str, path: &Path) -> Result<AudioFileInfo, String> {
    if !path.exists() {
        return Err(format!("audio source does not exist: {}", path.display()));
    }
    let output = Command::new(ffprobe)
        .args([
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=codec_name,sample_rate,channels:format=duration",
            "-of",
            "json",
        ])
        .arg(path)
        .output()
        .map_err(|error| format!("could not run ffprobe: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "ffprobe could not inspect {}: {}",
            path.display(),
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let value: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("could not parse ffprobe audio result: {error}"))?;
    let stream = value
        .get("streams")
        .and_then(|streams| streams.as_array())
        .and_then(|streams| streams.first())
        .ok_or_else(|| format!("no audio stream found in {}", path.display()))?;
    let codec = stream.get("codec_name").and_then(|v| v.as_str()).unwrap_or("unknown").to_string();
    let sample_rate = stream
        .get("sample_rate")
        .and_then(|v| v.as_str())
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(0);
    let channels = stream.get("channels").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
    let duration_seconds = value
        .get("format")
        .and_then(|f| f.get("duration"))
        .and_then(|v| v.as_str())
        .and_then(|v| v.parse::<f64>().ok())
        .unwrap_or(0.0);
    Ok(AudioFileInfo {
        valid: true,
        path: path.to_string_lossy().into_owned(),
        codec,
        sample_rate,
        channels,
        duration_seconds,
        error: String::new(),
    })
}

pub fn ffprobe_for(ffmpeg: &str) -> String {
    let path = PathBuf::from(ffmpeg);
    if path.components().count() > 1 {
        if let Some(parent) = path.parent() {
            let candidate = parent.join(if cfg!(windows) { "ffprobe.exe" } else { "ffprobe" });
            if candidate.exists() {
                return candidate.to_string_lossy().into_owned();
            }
        }
    }
    "ffprobe".into()
}

fn final_output_path(video_path: &Path) -> PathBuf {
    let parent = video_path.parent().unwrap_or_else(|| Path::new("."));
    let stem = video_path.file_stem().and_then(|v| v.to_str()).unwrap_or("junkpile-av-recording");
    let extension = video_path.extension().and_then(|v| v.to_str()).unwrap_or("mp4");
    parent.join(format!("{stem}-audio.{extension}"))
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}
