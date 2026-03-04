// =============================================================================
// src-tauri/src/main.rs
// =============================================================================
//
// Single-window Tauri application.
//
// ARCHITECTURE OVERVIEW
// ─────────────────────
// In a single-window app, there is no inter-window communication problem.
// The controls (sliders) and the p5.js canvas live in the same HTML page.
// Parameter changes update a plain JavaScript object — no WebSocket relay
// is needed at all.
//
//   ┌──────────────────────────────────────────────────┐
//   │              index.html (one window)             │
//   │                                                  │
//   │   ┌──────────────┐      ┌──────────────────────┐ │
//   │   │   Controls   │ ───▶ │   p5.js WEBGL        │ │
//   │   │   (sliders)  │      │   Fragment Shader    │ │
//   │   │              │      │                      │ │
//   │   │  direct JS   │      │  reads params{}      │ │
//   │   │  object      │      │  every frame         │ │
//   │   └──────────────┘      └──────────────────────┘ │
//   └──────────────────────────────────────────────────┘
//
// This file is intentionally minimal — Tauri just launches the window and
// stays out of the way. All application logic lives in index.html / sketch.js.
//
// WHEN TO USE THE TWO-WINDOW TEMPLATE INSTEAD
// ─────────────────────────────────────────────
// Use the two-window (WebSocket relay) template when you need:
//   • A fullscreen output window separate from the controls UI
//   • The visual to run on a second monitor / projector
//   • Controls and visuals that can be on different machines
//
// Use this single-window template when you need:
//   • Everything in one place — simpler, fewer moving parts
//   • Embedded controls that overlay or sit beside the canvas
//   • A self-contained creative tool or instrument
//
// =============================================================================

// Suppress the console window on Windows in release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // That's it. Tauri reads tauri.conf.json, creates the window(s) defined
    // there, and serves the files from the src/ directory.
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
