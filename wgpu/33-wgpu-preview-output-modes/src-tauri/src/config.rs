use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::PathBuf,
    sync::RwLock,
};
use tauri::Manager;

const DEFAULT_CONFIG_JSON: &str = include_str!("../../config/preview.json");

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PreviewScaleMode {
    Fit,
    Fill,
    Stretch,
    Pixel,
}

impl PreviewScaleMode {
    pub fn as_u32(self) -> u32 {
        match self {
            Self::Fit => 0,
            Self::Fill => 1,
            Self::Stretch => 2,
            Self::Pixel => 3,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Fit => "fit",
            Self::Fill => "fill",
            Self::Stretch => "stretch",
            Self::Pixel => "pixel",
        }
    }
}

impl Default for PreviewScaleMode {
    fn default() -> Self {
        Self::Fit
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SourceConfig {
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PreviewHotkeys {
    pub fit: Vec<String>,
    pub fill: Vec<String>,
    pub stretch: Vec<String>,
    pub pixel: Vec<String>,
    pub toggle_preview: Vec<String>,
    pub fullscreen: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PreviewConfig {
    pub schema_version: u32,
    pub enabled: bool,
    pub scale_mode: PreviewScaleMode,
    pub source: SourceConfig,
    pub hotkeys: PreviewHotkeys,
}

impl PreviewConfig {
    pub fn built_in() -> Result<Self, String> {
        let config: Self = serde_json::from_str(DEFAULT_CONFIG_JSON)
            .map_err(|error| format!("built-in preview configuration is invalid: {error}"))?;
        config.validate()?;
        Ok(config)
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != 1 {
            return Err(format!(
                "unsupported preview schema version {}; expected 1",
                self.schema_version
            ));
        }
        if self.source.width < 16 || self.source.height < 16 {
            return Err("source width and height must both be at least 16 pixels".into());
        }
        if self.source.width > 16_384 || self.source.height > 16_384 {
            return Err("source dimensions may not exceed 16384 pixels in this example".into());
        }
        for (label, keys) in [
            ("fit", &self.hotkeys.fit),
            ("fill", &self.hotkeys.fill),
            ("stretch", &self.hotkeys.stretch),
            ("pixel", &self.hotkeys.pixel),
            ("toggle_preview", &self.hotkeys.toggle_preview),
            ("fullscreen", &self.hotkeys.fullscreen),
        ] {
            if keys.is_empty() {
                return Err(format!("hotkeys.{label} must contain at least one KeyboardEvent.code value"));
            }
            if keys.iter().any(|key| key.trim().is_empty()) {
                return Err(format!("hotkeys.{label} contains an empty key code"));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewConfigEnvelope {
    pub config: PreviewConfig,
    pub path: String,
}

pub struct PreviewConfigState {
    path: PathBuf,
    current: RwLock<PreviewConfig>,
}

impl PreviewConfigState {
    pub fn load(app: &tauri::AppHandle) -> Result<Self, String> {
        let directory = app
            .path()
            .app_config_dir()
            .map_err(|error| format!("could not resolve the application config directory: {error}"))?;
        fs::create_dir_all(&directory)
            .map_err(|error| format!("could not create {}: {error}", directory.display()))?;
        let path = directory.join("preview.json");
        if !path.exists() {
            fs::write(&path, DEFAULT_CONFIG_JSON)
                .map_err(|error| format!("could not create {}: {error}", path.display()))?;
        }
        let config = Self::read_file(&path)?;
        Ok(Self {
            path,
            current: RwLock::new(config),
        })
    }

    fn read_file(path: &PathBuf) -> Result<PreviewConfig, String> {
        let text = fs::read_to_string(path)
            .map_err(|error| format!("could not read {}: {error}", path.display()))?;
        let config: PreviewConfig = serde_json::from_str(&text)
            .map_err(|error| format!("invalid preview configuration in {}: {error}", path.display()))?;
        config.validate()?;
        Ok(config)
    }

    pub fn candidate_from_disk(&self) -> Result<PreviewConfig, String> {
        Self::read_file(&self.path)
    }

    pub fn commit(&self, config: PreviewConfig) -> Result<(), String> {
        let mut current = self
            .current
            .write()
            .map_err(|_| "preview configuration state is poisoned".to_string())?;
        *current = config;
        Ok(())
    }

    pub fn current(&self) -> Result<PreviewConfig, String> {
        self.current
            .read()
            .map_err(|_| "preview configuration state is poisoned".to_string())
            .map(|config| config.clone())
    }

    pub fn envelope(&self) -> Result<PreviewConfigEnvelope, String> {
        Ok(PreviewConfigEnvelope {
            config: self.current()?,
            path: self.path.display().to_string(),
        })
    }

    pub fn restore_built_in(&self) -> Result<PreviewConfig, String> {
        let config = PreviewConfig::built_in()?;
        let text = serde_json::to_string_pretty(&config)
            .map_err(|error| format!("could not serialize built-in configuration: {error}"))?;
        fs::write(&self.path, format!("{text}\n"))
            .map_err(|error| format!("could not write {}: {error}", self.path.display()))?;
        Ok(config)
    }
}
