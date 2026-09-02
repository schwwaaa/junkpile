use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Component, Path},
};

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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FragHotkeys {
    pub next: Vec<String>,
    pub prev: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RenderConfig {
    pub schema_version: u32,
    pub frag_variants: Vec<String>,
    pub active_frag: String,
    pub frag_hotkeys: FragHotkeys,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ParamDefinition {
    pub name: String,
    #[serde(rename = "type")]
    pub param_type: String,
    pub default: f32,
    pub min: f32,
    pub max: f32,
    pub smoothing: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProfileHotkeys {
    pub next: Vec<String>,
    pub prev: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ShaderProfile {
    pub uniforms: BTreeMap<String, f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ParamsConfig {
    pub version: u32,
    pub params: Vec<ParamDefinition>,
    pub profile_hotkeys: ProfileHotkeys,
    pub shader_profiles: BTreeMap<String, BTreeMap<String, ShaderProfile>>,
    pub active_shader_profiles: BTreeMap<String, String>,
}

impl RenderConfig {
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != 1 {
            return Err(format!(
                "unsupported render.json schema version {}; expected 1",
                self.schema_version
            ));
        }
        if self.frag_variants.is_empty() {
            return Err("render.json frag_variants must contain at least one shader".into());
        }
        let mut unique = BTreeSet::new();
        for path in &self.frag_variants {
            validate_relative_asset_path(path, "shader")?;
            if !path.ends_with(".wgsl") {
                return Err(format!("shader variant must end in .wgsl: {path}"));
            }
            if !unique.insert(path.clone()) {
                return Err(format!("duplicate shader variant: {path}"));
            }
        }
        if !self.frag_variants.contains(&self.active_frag) {
            return Err(format!(
                "active_frag '{}' is not present in frag_variants",
                self.active_frag
            ));
        }
        validate_hotkey_list("frag_hotkeys.next", &self.frag_hotkeys.next)?;
        validate_hotkey_list("frag_hotkeys.prev", &self.frag_hotkeys.prev)?;
        Ok(())
    }
}

impl ParamsConfig {
    pub fn validate(&self, render: &RenderConfig) -> Result<(), String> {
        if self.version != 1 {
            return Err(format!(
                "unsupported params.json version {}; expected 1",
                self.version
            ));
        }
        validate_hotkey_list("profile_hotkeys.next", &self.profile_hotkeys.next)?;
        validate_hotkey_list("profile_hotkeys.prev", &self.profile_hotkeys.prev)?;

        let supported = ["u_gain", "u_zoom", "u_spin", "u_complexity"];
        let mut names = BTreeSet::new();
        for param in &self.params {
            if !supported.contains(&param.name.as_str()) {
                return Err(format!(
                    "unsupported parameter '{}'; this example's fixed uniform contract supports u_gain, u_zoom, u_spin, and u_complexity",
                    param.name
                ));
            }
            if !names.insert(param.name.clone()) {
                return Err(format!("duplicate parameter definition: {}", param.name));
            }
            if param.param_type != "float" {
                return Err(format!(
                    "parameter '{}' has type '{}'; only float is supported",
                    param.name, param.param_type
                ));
            }
            if !param.min.is_finite()
                || !param.max.is_finite()
                || !param.default.is_finite()
                || !param.smoothing.is_finite()
            {
                return Err(format!("parameter '{}' contains a non-finite value", param.name));
            }
            if param.max <= param.min {
                return Err(format!("parameter '{}' max must be greater than min", param.name));
            }
            if !(param.min..=param.max).contains(&param.default) {
                return Err(format!(
                    "parameter '{}' default {} is outside {}..{}",
                    param.name, param.default, param.min, param.max
                ));
            }
            if !(0.0..=0.999).contains(&param.smoothing) {
                return Err(format!(
                    "parameter '{}' smoothing must be between 0.0 and 0.999",
                    param.name
                ));
            }
        }
        for required in supported {
            if !names.contains(required) {
                return Err(format!("params.json is missing required parameter '{required}'"));
            }
        }

        for shader in self.shader_profiles.keys() {
            if !render.frag_variants.contains(shader) {
                return Err(format!(
                    "shader_profiles references '{shader}', which is not in render.json frag_variants"
                ));
            }
        }
        for shader in &render.frag_variants {
            let profiles = self.shader_profiles.get(shader).ok_or_else(|| {
                format!("shader_profiles is missing an entry for '{shader}'")
            })?;
            if profiles.is_empty() {
                return Err(format!("shader '{shader}' must define at least one profile"));
            }
            for (profile_name, profile) in profiles {
                if profile_name.trim().is_empty() {
                    return Err(format!("shader '{shader}' contains an empty profile name"));
                }
                for (param_name, value) in &profile.uniforms {
                    let definition = self
                        .params
                        .iter()
                        .find(|param| &param.name == param_name)
                        .ok_or_else(|| {
                            format!(
                                "profile '{profile_name}' for '{shader}' references unknown parameter '{param_name}'"
                            )
                        })?;
                    if !value.is_finite() || *value < definition.min || *value > definition.max {
                        return Err(format!(
                            "profile '{profile_name}' value {} for '{}' is outside {}..{}",
                            value, param_name, definition.min, definition.max
                        ));
                    }
                }
            }
            let active = self.active_shader_profiles.get(shader).ok_or_else(|| {
                format!("active_shader_profiles is missing an entry for '{shader}'")
            })?;
            if !profiles.contains_key(active) {
                return Err(format!(
                    "active profile '{active}' for '{shader}' does not exist"
                ));
            }
        }
        Ok(())
    }
}

fn validate_hotkey_list(label: &str, keys: &[String]) -> Result<(), String> {
    if keys.is_empty() {
        return Err(format!("{label} must contain at least one KeyboardEvent.code value"));
    }
    if keys.iter().any(|key| key.trim().is_empty()) {
        return Err(format!("{label} contains an empty key code"));
    }
    Ok(())
}

fn validate_relative_asset_path(value: &str, label: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err(format!("{label} path may not be empty"));
    }
    let path = Path::new(value);
    if path.is_absolute() {
        return Err(format!("{label} path must be relative: {value}"));
    }
    if path
        .components()
        .any(|component| matches!(component, Component::ParentDir | Component::RootDir | Component::Prefix(_)))
    {
        return Err(format!("{label} path may not escape the asset root: {value}"));
    }
    Ok(())
}
