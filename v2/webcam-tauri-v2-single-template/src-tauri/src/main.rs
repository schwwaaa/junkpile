// =============================================================================
// Tauri v2 entry point — webcam single-window baseline
// =============================================================================
//
// Tauri creates the configured WebView window and serves ../src through the v2
// frontendDist setting. JavaScript owns MediaDevices access, camera lifecycle,
// video texture upload, WebGL effects, and the animation loop.
//
// This project demonstrates a Tauri v2 wrapper around a WebView camera pipeline;
// it does not capture frames in Rust. See the local README for permission,
// extension, and troubleshooting notes.
// =============================================================================

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
