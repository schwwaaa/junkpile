#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

#[tauri::command]
fn toggle_fullscreen(app: tauri::AppHandle) -> Result<bool, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window is unavailable".to_string())?;

    let next = !window
        .is_fullscreen()
        .map_err(|error| format!("Could not read fullscreen state: {error}"))?;

    window
        .set_fullscreen(next)
        .map_err(|error| format!("Could not change fullscreen state: {error}"))?;

    Ok(next)
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![toggle_fullscreen])
        .run(tauri::generate_context!())
        .expect("error while running Junkpile Tauri v2 Example 00");
}
