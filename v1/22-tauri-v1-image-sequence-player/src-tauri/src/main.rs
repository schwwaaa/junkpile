#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{fs, path::{Path, PathBuf}};

fn is_image(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| matches!(value.to_ascii_lowercase().as_str(), "png" | "jpg" | "jpeg" | "webp" | "bmp" | "gif" | "tif" | "tiff"))
        .unwrap_or(false)
}

fn collect_images(dir: &Path, recursive: bool, out: &mut Vec<PathBuf>) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|error| format!("Could not read {}: {error}", dir.display()))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("Could not read directory entry: {error}"))?;
        let path = entry.path();
        if path.is_dir() && recursive {
            collect_images(&path, true, out)?;
        } else if path.is_file() && is_image(&path) {
            out.push(path);
        }
    }
    Ok(())
}

#[tauri::command]
fn scan_sequence_directory(path: String, recursive: bool) -> Result<Vec<String>, String> {
    let root = PathBuf::from(path);
    if !root.is_dir() {
        return Err("The selected path is not a directory.".into());
    }
    let mut images = Vec::new();
    collect_images(&root, recursive, &mut images)?;
    Ok(images.into_iter().map(|value| value.to_string_lossy().into_owned()).collect())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![scan_sequence_directory])
        .run(tauri::generate_context!())
        .expect("error while running Junkpile Example 22");
}
