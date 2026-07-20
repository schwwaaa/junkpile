// =============================================================================
// Tauri v1 entry point — external GLSL single-window baseline
// =============================================================================
//
// Tauri creates the window declared in tauri.conf.json and serves ../src as the
// bundled frontend. The runtime shader loader, compiler, controls, and render
// loop all live in src/index.html, src/sketch.js, and src/shader.frag.
//
// There are no Tauri commands in this baseline. Keep main.rs minimal unless a
// native integration is genuinely required; see the local README for the full
// architecture and extension path.
// =============================================================================

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
