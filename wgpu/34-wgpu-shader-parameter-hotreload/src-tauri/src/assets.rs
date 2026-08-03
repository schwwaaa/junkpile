use crate::config::{ParamsConfig, RenderConfig};
use serde::Serialize;
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};
use tauri::Manager;

const RENDER_JSON: &str = include_str!("../../assets/render.json");
const PARAMS_JSON: &str = include_str!("../../assets/params.json");
const SHADER_01: &str = include_str!("../../assets/shaders/01-kaleido-reactor.wgsl");
const SHADER_02: &str = include_str!("../../assets/shaders/02-plasma-warp.wgsl");
const SHADER_03: &str = include_str!("../../assets/shaders/03-infinite-tunnel.wgsl");
const SHADER_04: &str = include_str!("../../assets/shaders/04-voronoi-storm.wgsl");
const SHADER_05: &str = include_str!("../../assets/shaders/05-fractal-nebula.wgsl");
const SHADER_06: &str = include_str!("../../assets/shaders/06-mandelbrot-reactor.wgsl");
const SHADER_07: &str = include_str!("../../assets/shaders/07-raymarch-lattice.wgsl");
const SHADER_08: &str = include_str!("../../assets/shaders/08-caustic-engine.wgsl");
const SHADER_09: &str = include_str!("../../assets/shaders/09-hyperbolic-grid.wgsl");
const SHADER_10: &str = include_str!("../../assets/shaders/10-interference-array.wgsl");
const SHADER_11: &str = include_str!("../../assets/shaders/11-volumetric-storm.wgsl");
const SHADER_12: &str = include_str!("../../assets/shaders/12-recursive-glyph-field.wgsl");

#[derive(Debug, Clone)]
pub struct RuntimeBundle {
    pub render: RenderConfig,
    pub params: ParamsConfig,
    pub shader_sources: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetPaths {
    pub root: String,
    pub render_json: String,
    pub params_json: String,
    pub shaders_directory: String,
}

#[derive(Clone)]
pub struct RuntimeAssets {
    root: PathBuf,
}

impl RuntimeAssets {
    pub fn initialize(app: &tauri::AppHandle) -> Result<Self, String> {
        let root = app
            .path()
            .app_config_dir()
            .map_err(|error| format!("could not resolve application config directory: {error}"))?
            .join("shader-parameter-hotreload-v2");
        let assets = Self { root };
        assets.ensure_built_ins(false)?;
        Ok(assets)
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn paths(&self) -> AssetPaths {
        AssetPaths {
            root: self.root.display().to_string(),
            render_json: self.root.join("render.json").display().to_string(),
            params_json: self.root.join("params.json").display().to_string(),
            shaders_directory: self.root.join("shaders").display().to_string(),
        }
    }

    pub fn load_bundle(&self) -> Result<RuntimeBundle, String> {
        let render_path = self.root.join("render.json");
        let params_path = self.root.join("params.json");
        let render_text = read_text(&render_path)?;
        let params_text = read_text(&params_path)?;
        let render: RenderConfig = serde_json::from_str(&render_text).map_err(|error| {
            format!("invalid render.json at {}: {error}", render_path.display())
        })?;
        render.validate()?;
        let params: ParamsConfig = serde_json::from_str(&params_text).map_err(|error| {
            format!("invalid params.json at {}: {error}", params_path.display())
        })?;
        params.validate(&render)?;

        let mut shader_sources = BTreeMap::new();
        for relative in &render.frag_variants {
            let path = self.root.join(relative);
            let source = read_text(&path)?;
            validate_wgsl(relative, &source)?;
            shader_sources.insert(relative.clone(), source);
        }

        Ok(RuntimeBundle {
            render,
            params,
            shader_sources,
        })
    }

    pub fn restore_all(&self) -> Result<(), String> {
        self.ensure_built_ins(true)
    }

    pub fn restore_active_shader(&self, active: &str) -> Result<(), String> {
        let source = built_in_shader(active)
            .ok_or_else(|| format!("no built-in shader exists for '{active}'"))?;
        let path = self.root.join(active);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("could not create {}: {error}", parent.display()))?;
        }
        fs::write(&path, source)
            .map_err(|error| format!("could not restore {}: {error}", path.display()))
    }

    pub fn toggle_valid_edit(&self, active: &str) -> Result<String, String> {
        let path = self.root.join(active);
        let source = read_text(&path)?;
        let from = "const LIVE_EDIT_TINT: f32 = 0.0;";
        let to = "const LIVE_EDIT_TINT: f32 = 1.0;";
        let (updated, state) = if source.contains(from) {
            (source.replacen(from, to, 1), "enabled")
        } else if source.contains(to) {
            (source.replacen(to, from, 1), "disabled")
        } else {
            return Err(format!(
                "{} does not contain the LIVE_EDIT_TINT test constant",
                path.display()
            ));
        };
        fs::write(&path, updated)
            .map_err(|error| format!("could not write {}: {error}", path.display()))?;
        Ok(format!("valid live-edit tint {state} in {active}"))
    }

    pub fn write_invalid_shader(&self, active: &str) -> Result<(), String> {
        let path = self.root.join(active);
        let source = read_text(&path)?;
        let invalid = format!(
            "{source}\n\n// Intentional Example 34 validation failure\nthis is not valid WGSL syntax\n"
        );
        fs::write(&path, invalid)
            .map_err(|error| format!("could not write {}: {error}", path.display()))
    }

    fn ensure_built_ins(&self, overwrite: bool) -> Result<(), String> {
        fs::create_dir_all(self.root.join("shaders")).map_err(|error| {
            format!("could not create runtime asset directory {}: {error}", self.root.display())
        })?;
        for (relative, contents) in built_in_files() {
            let path = self.root.join(relative);
            if overwrite || !path.exists() {
                if let Some(parent) = path.parent() {
                    fs::create_dir_all(parent).map_err(|error| {
                        format!("could not create {}: {error}", parent.display())
                    })?;
                }
                fs::write(&path, contents)
                    .map_err(|error| format!("could not write {}: {error}", path.display()))?;
            }
        }
        Ok(())
    }
}

fn read_text(path: &Path) -> Result<String, String> {
    fs::read_to_string(path)
        .map_err(|error| format!("could not read {}: {error}", path.display()))
}

fn validate_wgsl(label: &str, source: &str) -> Result<(), String> {
    let module = naga::front::wgsl::parse_str(source)
        .map_err(|error| format!("WGSL parse failed in {label}:\n{}", error.emit_to_string(source)))?;
    naga::valid::Validator::new(
        naga::valid::ValidationFlags::all(),
        naga::valid::Capabilities::all(),
    )
    .subgroup_stages(naga::valid::ShaderStages::all())
    .subgroup_operations(naga::valid::SubgroupOperationSet::all())
    .validate(&module)
    .map_err(|error| format!("WGSL validation failed in {label}:\n{}", error.emit_to_string(source)))?;

    for required in [
        "@vertex",
        "fn vs_main",
        "@fragment",
        "fn fs_main",
        "@group(0) @binding(0)",
        "params: vec4<f32>",
    ] {
        if !source.contains(required) {
            return Err(format!(
                "WGSL contract failed in {label}: missing required text '{required}'"
            ));
        }
    }
    Ok(())
}

fn built_in_files() -> [(&'static str, &'static str); 14] {
    [
        ("render.json", RENDER_JSON),
        ("params.json", PARAMS_JSON),
        ("shaders/01-kaleido-reactor.wgsl", SHADER_01),
        ("shaders/02-plasma-warp.wgsl", SHADER_02),
        ("shaders/03-infinite-tunnel.wgsl", SHADER_03),
        ("shaders/04-voronoi-storm.wgsl", SHADER_04),
        ("shaders/05-fractal-nebula.wgsl", SHADER_05),
        ("shaders/06-mandelbrot-reactor.wgsl", SHADER_06),
        ("shaders/07-raymarch-lattice.wgsl", SHADER_07),
        ("shaders/08-caustic-engine.wgsl", SHADER_08),
        ("shaders/09-hyperbolic-grid.wgsl", SHADER_09),
        ("shaders/10-interference-array.wgsl", SHADER_10),
        ("shaders/11-volumetric-storm.wgsl", SHADER_11),
        ("shaders/12-recursive-glyph-field.wgsl", SHADER_12),
    ]
}

fn built_in_shader(relative: &str) -> Option<&'static str> {
    built_in_files()
        .into_iter()
        .find_map(|(path, source)| (path == relative).then_some(source))
}
