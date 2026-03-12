// =============================================================================
// src-tauri/src/main.rs  (Tauri v2)
// =============================================================================
//
// Minimal entry point. Tauri reads tauri.conf.json, creates the window,
// and serves src/ files via its built-in asset server (tauri://localhost).
// No external server required. All app logic lives in src/.
// =============================================================================

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
