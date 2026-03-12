// =============================================================================
// src-tauri/src/main.rs  (Tauri v1)
// =============================================================================
//
// Minimal single-window entry point.
// Tauri reads tauri.conf.json, creates the window defined there, and serves
// files from devPath/distDir (../src) via the built-in custom-protocol server.
// All application logic lives in src/index.html and src/sketch.js.
// =============================================================================

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
