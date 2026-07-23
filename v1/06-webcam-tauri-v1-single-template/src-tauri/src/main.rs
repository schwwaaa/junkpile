// =============================================================================
// Tauri v1 entry point — webcam single-window baseline
// =============================================================================
//
// Tauri creates the configured WebView window and serves the static frontend.
// Camera enumeration, permission requests, stream lifecycle, video-frame upload,
// WebGL effects, and feedback all run in JavaScript inside the WebView.
//
// Rust does not capture camera frames in this example. Platform permission and
// bundle metadata live in tauri.conf.json / entitlements.plist; see the local
// README before moving camera ownership into native code.
// =============================================================================

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
