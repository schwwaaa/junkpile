// =============================================================================
// src-tauri/src/main.rs  (Tauri v2)
// =============================================================================
//
// HOW THE FILE SERVING WORKS (v1 vs v2)
// ──────────────────────────────────────
//
// v1: You declared `custom-protocol = ["tauri/custom-protocol"]` in Cargo.toml
//     and set `devPath/distDir` in tauri.conf.json. Tauri used the
//     custom-protocol feature to serve your src/ files via tauri://localhost.
//
// v2: You just set `frontendDist: "../src"` in tauri.conf.json.
//     The Tauri v2 CLI reads that and automatically enables the built-in
//     asset server — no feature flags, no manual wiring. Same result:
//     your files are served via tauri://localhost with no external server.
//
//     `tauri dev`   → CLI spins up built-in hot-reload server from ../src
//     `tauri build` → files are embedded in the binary, served at runtime
//
// This file is intentionally minimal. All app logic lives in src/.
// =============================================================================

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
