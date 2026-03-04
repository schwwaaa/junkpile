// =============================================================================
// src-tauri/src/main.rs
// =============================================================================
//
// This is the heart of the two-window architecture. When the Tauri app starts,
// this Rust binary launches a WebSocket relay server embedded in the app itself.
//
// ARCHITECTURE OVERVIEW
// ─────────────────────
//
//   ┌─────────────────────┐         WebSocket         ┌─────────────────────┐
//   │   controls.html     │  ──── ws://127.0.0.1 ───▶ │    canvas.html      │
//   │   (control window)  │        port 2727          │   (visual window)   │
//   │                     │  ◀──────────────────────  │                     │
//   │  p5.js sliders      │                           │  p5.js GLSL shader  │
//   │  sends params →     │                           │  receives params ←  │
//   └─────────────────────┘                           └─────────────────────┘
//                                        ▲
//                           ┌────────────┴────────────┐
//                           │   Rust WS Relay         │
//                           │   (this file)           │
//                           │                         │
//                           │  • Listens IPv4 + IPv6  │
//                           │  • Tracks client roles  │
//                           │  • Routes messages      │
//                           └─────────────────────────┘
//
// MESSAGE FLOW
// ────────────
//
//  1. Both windows connect to ws://127.0.0.1:2727 on startup.
//
//  2. Each window sends a "hello" handshake identifying its role:
//       controls window → { "type": "hello", "role": "controls" }
//       canvas window   → { "type": "hello", "role": "canvas"   }
//
//  3. When the controls window changes a slider, it sends a JSON message:
//       { "type": "param", "name": "speed", "value": 0.75 }
//
//  4. The relay receives this text message and broadcasts it to ALL OTHER
//     connected clients (i.e., the canvas window receives it).
//
//  5. Binary messages (e.g., frame data) are forwarded ONLY to "canvas" role clients.
//     This matches the huff project pattern.
//
// HOW TO EXTEND THIS FOR YOUR OWN PROJECT
// ────────────────────────────────────────
//  • The relay is intentionally generic — you don't need to modify it for
//    most use cases. Just change the messages you send from JavaScript.
//  • To add more windows: add them in tauri.conf.json, then give each one
//    its own role string in the hello handshake.
//  • To filter which windows receive which messages: modify broadcast_text()
//    below to inspect the message content and route accordingly.
//  • To change the port: update PORT below AND in both HTML files.
//
// =============================================================================

// Suppress the console window on Windows in release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{collections::HashMap, net::SocketAddr, sync::Arc};

use futures_util::{SinkExt, StreamExt};
use once_cell::sync::Lazy;
use serde::Deserialize;
use tokio::{net::TcpListener, sync::Mutex};
use tokio_tungstenite::{accept_async, tungstenite::Message};

// ---------------------------------------------------------------------------
// Data structures
// ---------------------------------------------------------------------------

/// Represents one connected WebSocket client.
/// Each client has:
///   - a `role` string (set by the hello handshake, default "unknown")
///   - a `tx` channel sender used to push outgoing messages to its writer task
#[derive(Clone, Debug)]
struct Client {
    role: String, // "controls" | "canvas" | "unknown"
    tx: tokio::sync::mpsc::UnboundedSender<Message>,
}

/// Thread-safe map of all currently connected clients, keyed by socket address.
type ClientMap = Arc<Mutex<HashMap<SocketAddr, Client>>>;

/// Global singleton client map — shared across all connection handler tasks.
static CLIENTS: Lazy<ClientMap> =
    Lazy::new(|| Arc::new(Mutex::new(HashMap::new())));

/// The JSON shape of the hello handshake message.
/// Both windows send this immediately after connecting.
#[derive(Deserialize, Debug)]
struct HelloMsg {
    #[serde(default)]
    r#type: String, // must equal "hello"
    #[serde(default)]
    role: String,   // "controls" or "canvas"
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/// The WebSocket port. Must match the port used in controls.js and canvas.js.
const PORT: u16 = 2727;

// ---------------------------------------------------------------------------
// WebSocket listener
// ---------------------------------------------------------------------------

/// Binds a TCP listener on `bind_addr` and accepts WebSocket connections forever.
/// Each accepted connection spawns a new async task via `handle_ws`.
async fn run_listener(bind_addr: String, clients: ClientMap) -> Result<(), String> {
    let listener = TcpListener::bind(&bind_addr)
        .await
        .map_err(|e| e.to_string())?;
    println!("[template] listening on ws://{bind_addr}");
    loop {
        let (stream, peer_addr) = listener.accept().await.map_err(|e| e.to_string())?;
        let clients = Arc::clone(&clients);
        tokio::spawn(async move {
            if let Err(e) = handle_ws(stream, peer_addr, clients).await {
                eprintln!("[template] client {peer_addr} error: {e}");
            }
        });
    }
}

// ---------------------------------------------------------------------------
// Message routing
// ---------------------------------------------------------------------------

/// Broadcast a text message to every client EXCEPT the sender.
/// This is the primary message path — all parameter updates travel this way.
async fn broadcast_text(clients: &ClientMap, sender: SocketAddr, txt: String) {
    let map = clients.lock().await;
    for (addr, c) in map.iter() {
        if *addr != sender {
            // `tx.send` is non-blocking — it puts the message in the client's
            // outbound channel; the writer task (below) drains it to the socket.
            let _ = c.tx.send(Message::Text(txt.clone()));
        }
    }
}

/// Forward binary data ONLY to clients whose role is "canvas".
/// Useful for streaming raw pixel/audio data without flooding control windows.
async fn broadcast_binary(clients: &ClientMap, sender: SocketAddr, bin: Vec<u8>) -> usize {
    let map = clients.lock().await;
    let mut sent = 0usize;
    for (addr, c) in map.iter() {
        if *addr != sender && c.role == "canvas" {
            let _ = c.tx.send(Message::Binary(bin.clone()));
            sent += 1;
        }
    }
    sent
}

// ---------------------------------------------------------------------------
// Per-connection handler
// ---------------------------------------------------------------------------

/// Manages the full lifecycle of a single WebSocket connection.
///
/// The connection is split into two independent async tasks:
///   - `writer`: drains the outbound channel → socket
///   - `reader`: reads incoming messages → routes them
///
/// This split avoids deadlocks: the reader never needs to hold the ClientMap
/// lock while also waiting to write to the same socket.
async fn handle_ws(
    stream: tokio::net::TcpStream,
    peer_addr: SocketAddr,
    clients: ClientMap,
) -> Result<(), String> {
    // Perform the WebSocket handshake
    let ws_stream = accept_async(stream).await.map_err(|e| e.to_string())?;
    let (mut ws_tx, mut ws_rx) = ws_stream.split();

    // Create an unbounded channel for this client's outgoing messages.
    // Other tasks push to `tx`; this task's `writer` drains `rx` → socket.
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Message>();

    // Register this client with an "unknown" role (updated on hello).
    {
        let mut map = clients.lock().await;
        map.insert(peer_addr, Client { role: "unknown".to_string(), tx: tx.clone() });
    }
    println!("[template] {peer_addr} connected (role: unknown)");

    // ── Writer task ─────────────────────────────────────────────────────────
    // Drains the outbound channel and sends each message to the WebSocket.
    // Terminates when the channel is closed (i.e., reader task ends).
    let writer = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if ws_tx.send(msg).await.is_err() {
                break; // Socket closed — stop writing
            }
        }
    });

    // ── Reader task ─────────────────────────────────────────────────────────
    // Reads incoming messages from the WebSocket and routes them.
    let clients_r = Arc::clone(&clients);
    let reader = tokio::spawn(async move {
        while let Some(msg) = ws_rx.next().await {
            match msg {
                Ok(Message::Text(txt)) => {
                    // Check if this is a hello handshake — if so, update the role.
                    // All other text messages are broadcast as-is.
                    if let Ok(parsed) = serde_json::from_str::<HelloMsg>(&txt) {
                        if parsed.r#type == "hello" && !parsed.role.is_empty() {
                            let mut map = clients_r.lock().await;
                            if let Some(c) = map.get_mut(&peer_addr) {
                                c.role = parsed.role.clone();
                                println!(
                                    "[template] {peer_addr} identified as role='{}'",
                                    c.role
                                );
                            }
                        }
                    }
                    // Broadcast to all other clients regardless of message type
                    broadcast_text(&clients_r, peer_addr, txt).await;
                }

                Ok(Message::Binary(bin)) => {
                    // Binary messages are only forwarded to "canvas" role clients.
                    // Useful for streaming image/audio data in advanced use cases.
                    let sent = broadcast_binary(&clients_r, peer_addr, bin).await;
                    if sent == 0 {
                        println!("[template] binary from {peer_addr}, but no canvas clients connected yet");
                    }
                }

                // WebSocket protocol: respond to Ping with Pong
                Ok(Message::Ping(payload)) => {
                    let _ = tx.send(Message::Pong(payload));
                }

                Ok(Message::Close(_)) => break, // Client closed the connection gracefully

                Ok(_) => {} // Ignore other message types (Pong, Frame, etc.)

                Err(e) => {
                    eprintln!("[template] receive error from {peer_addr}: {e}");
                    break;
                }
            }
        }

        // Clean up: remove this client from the map when the reader ends
        clients_r.lock().await.remove(&peer_addr);
        println!("[template] {peer_addr} disconnected");
        Ok::<(), ()>(())
    });

    // Wait for both tasks to complete (they end together when the socket closes)
    let _ = tokio::join!(writer, reader);
    Ok(())
}

// ---------------------------------------------------------------------------
// Tauri application entry point
// ---------------------------------------------------------------------------

fn main() {
    // `tauri::Builder::default()` sets up the Tauri runtime.
    // The `.setup()` callback runs once after the app initialises — this is
    // where we launch the WebSocket relay as background async tasks.
    tauri::Builder::default()
        .setup(|_app| {
            println!("[template] starting WebSocket relay on port {PORT}");

            // Clone the global client map for each listener task
            let clients_v4 = Arc::clone(&CLIENTS);
            let clients_v6 = Arc::clone(&CLIENTS);

            // Spawn an IPv4 listener (127.0.0.1) — standard loopback
            tauri::async_runtime::spawn(async move {
                let addr = format!("127.0.0.1:{PORT}");
                if let Err(e) = run_listener(addr, clients_v4).await {
                    eprintln!("[template] IPv4 listener error: {e}");
                }
            });

            // Spawn an IPv6 listener (::1) — covers macOS/Linux where the
            // WebView may connect via IPv6 loopback instead of IPv4.
            tauri::async_runtime::spawn(async move {
                let addr = format!("[::1]:{PORT}");
                if let Err(e) = run_listener(addr, clients_v6).await {
                    eprintln!("[template] IPv6 listener error: {e}");
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
