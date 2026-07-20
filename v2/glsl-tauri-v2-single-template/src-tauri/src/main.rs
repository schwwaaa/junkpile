// =============================================================================
// Tauri v2 entry point — external GLSL single-window baseline
// =============================================================================
//
// Tauri creates the WebView window declared in the v2 configuration and serves
// ../src through frontendDist. Runtime shader loading, compiler diagnostics,
// controls, and drawing remain in the frontend files.
//
// This is still a WebView/WebGL example, not a native wgpu surface. Add Rust
// commands only when a native responsibility is introduced; see the local
// README for the documented architecture.
// =============================================================================

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
