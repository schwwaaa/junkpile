use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const DEFAULT_PROFILE_JSON: &str = include_str!("../../config/io-profiles.json");

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ProfileFile {
    pub schema_version: u32,
    pub default_profile: String,
    pub hot_reload: HotReloadConfig,
    pub profiles: Vec<IoProfile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct HotReloadConfig {
    pub enabled: bool,
    pub debounce_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct IoProfile {
    pub id: String,
    pub label: String,
    pub description: String,
    pub frame: FrameProfile,
    pub recording: RecordingRoute,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FrameProfile {
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RecordingRoute {
    pub enabled: bool,
    pub codec: RecordingCodec,
    pub fps: u32,
    pub worker_delay_ms: u64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RecordingCodec {
    H264,
    Prores,
}

impl RecordingCodec {
    pub fn as_renderer_value(self) -> &'static str {
        match self {
            Self::H264 => "h264",
            Self::Prores => "prores",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::H264 => "H.264 / MP4",
            Self::Prores => "ProRes 422 HQ / MOV",
        }
    }
}

impl ProfileFile {
    pub fn built_in() -> Self {
        serde_json::from_str(DEFAULT_PROFILE_JSON)
            .expect("built-in I/O profile configuration must be valid")
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != 1 {
            return Err(format!(
                "unsupported schemaVersion {}; expected 1",
                self.schema_version
            ));
        }
        if !(50..=5_000).contains(&self.hot_reload.debounce_ms) {
            return Err("hotReload.debounceMs must be between 50 and 5000".into());
        }
        if self.profiles.is_empty() {
            return Err("profiles must contain at least one I/O profile".into());
        }

        let mut ids = HashSet::new();
        for profile in &self.profiles {
            profile.validate()?;
            if !ids.insert(profile.id.clone()) {
                return Err(format!("duplicate profile id: {}", profile.id));
            }
        }
        if !ids.contains(&self.default_profile) {
            return Err(format!(
                "defaultProfile '{}' does not match any profile id",
                self.default_profile
            ));
        }
        Ok(())
    }

    pub fn profile(&self, id: &str) -> Option<&IoProfile> {
        self.profiles.iter().find(|profile| profile.id == id)
    }
}

impl IoProfile {
    pub fn validate(&self) -> Result<(), String> {
        validate_token("profile.id", &self.id)?;
        validate_text("profile.label", &self.label, 80)?;
        validate_text("profile.description", &self.description, 240)?;
        validate_dimensions(self.frame.width, self.frame.height)?;
        if !matches!(self.recording.fps, 24 | 30 | 60) {
            return Err(format!(
                "profile '{}' recording.fps must be 24, 30, or 60",
                self.id
            ));
        }
        if self.frame.width >= 7680 && self.recording.fps > 30 {
            return Err(format!(
                "profile '{}' cannot use 8K above 30 fps",
                self.id
            ));
        }
        if self.recording.worker_delay_ms > 500 {
            return Err(format!(
                "profile '{}' recording.workerDelayMs must be 0 to 500",
                self.id
            ));
        }
        Ok(())
    }
}

fn validate_dimensions(width: u32, height: u32) -> Result<(), String> {
    if !(64..=7680).contains(&width) || !(64..=4320).contains(&height) {
        return Err(format!(
            "frame dimensions must be between 64×64 and 7680×4320; got {width}×{height}"
        ));
    }
    if width % 2 != 0 || height % 2 != 0 {
        return Err(format!(
            "frame dimensions must be even for FFmpeg compatibility; got {width}×{height}"
        ));
    }
    Ok(())
}

fn validate_token(name: &str, value: &str) -> Result<(), String> {
    let valid = !value.is_empty()
        && value.len() <= 64
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'));
    if !valid {
        return Err(format!(
            "{name} must contain 1 to 64 ASCII letters, numbers, '-' or '_'"
        ));
    }
    Ok(())
}

fn validate_text(name: &str, value: &str, maximum: usize) -> Result<(), String> {
    let count = value.trim().chars().count();
    if count == 0 || count > maximum {
        return Err(format!("{name} must contain 1 to {maximum} characters"));
    }
    Ok(())
}
