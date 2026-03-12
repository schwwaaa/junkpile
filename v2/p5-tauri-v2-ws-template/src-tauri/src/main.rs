// =============================================================================
// src-tauri/src/main.rs  (Tauri v2)
// =============================================================================
//
// This is the heart of the two-window architecture. When the Tauri app starts,
// this Rust binary launches a WebSocket relay server embedded in the app.
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
//  1. Both windows connect to ws://127.0.0.1:2727 on startup.
//  2. Each sends a hello:  { "type": "hello", "role": "controls"|"canvas" }
//  3. Slider changes send: { "type": "param", "name": "speed", "value": 0.75 }
//  4. Relay broadcasts text messages to ALL OTHER connected clients.
//  5. Binary messages are forwarded ONLY to "canvas" role clients.
//
// TAURI v1 → v2 CHANGES IN THIS FILE
// ─────────────────────────────────────
// main.rs is essentially identical between v1 and v2.
// tauri::async_runtime::spawn is correct in both — .setup() runs before
// the Tokio reactor is active on the calling thread, so tokio::spawn
// would panic. The real differences are in Cargo.toml and tauri.conf.json.
//
// All relay logic below is byte-for-byte identical to the v1 version.
//
// (Previously documented as having one change here — that was incorrect.)

//
// =============================================================================

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

/// One connected WebSocket client.
/// role: set by the hello handshake ("controls" | "canvas" | "unknown")
/// tx:   channel sender — push a Message here to send it to this client's socket
#[derive(Clone, Debug)]
struct Client {
    role: String,
    tx: tokio::sync::mpsc::UnboundedSender<Message>,
}

/// Thread-safe map of all connected clients, keyed by socket address.
type ClientMap = Arc<Mutex<HashMap<SocketAddr, Client>>>;

/// Global singleton — shared across all connection handler tasks.
static CLIENTS: Lazy<ClientMap> =
    Lazy::new(|| Arc::new(Mutex::new(HashMap::new())));

/// JSON shape of the hello handshake message.
#[derive(Deserialize, Debug)]
struct HelloMsg {
    #[serde(default)]
    r#type: String,
    #[serde(default)]
    role: String,
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/// WebSocket port — must match WS_URL in controls.js and canvas.js.
const PORT: u16 = 2727;

// ---------------------------------------------------------------------------
// WebSocket listener
// ---------------------------------------------------------------------------

/// Binds a TCP listener and accepts WebSocket connections forever.
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

/// Broadcast text to every client except the sender.
async fn broadcast_text(clients: &ClientMap, sender: SocketAddr, txt: String) {
    let map = clients.lock().await;
    for (addr, c) in map.iter() {
        if *addr != sender {
            let _ = c.tx.send(Message::Text(txt.clone()));
        }
    }
}

/// Forward binary data only to "canvas" role clients.
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
/// Split into writer + reader tasks to avoid deadlocks.
async fn handle_ws(
    stream: tokio::net::TcpStream,
    peer_addr: SocketAddr,
    clients: ClientMap,
) -> Result<(), String> {
    let ws_stream = accept_async(stream).await.map_err(|e| e.to_string())?;
    let (mut ws_tx, mut ws_rx) = ws_stream.split();

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Message>();

    {
        let mut map = clients.lock().await;
        map.insert(peer_addr, Client { role: "unknown".to_string(), tx: tx.clone() });
    }
    println!("[template] {peer_addr} connected (role: unknown)");

    // ── Writer task ──────────────────────────────────────────────────────────
    let writer = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if ws_tx.send(msg).await.is_err() {
                break;
            }
        }
    });

    // ── Reader task ──────────────────────────────────────────────────────────
    let clients_r = Arc::clone(&clients);
    let reader = tokio::spawn(async move {
        while let Some(msg) = ws_rx.next().await {
            match msg {
                Ok(Message::Text(txt)) => {
                    // Update role on hello handshake
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
                    broadcast_text(&clients_r, peer_addr, txt).await;
                }

                Ok(Message::Binary(bin)) => {
                    let sent = broadcast_binary(&clients_r, peer_addr, bin).await;
                    if sent == 0 {
                        println!("[template] binary from {peer_addr}, but no canvas clients connected");
                    }
                }

                Ok(Message::Ping(payload)) => {
                    let _ = tx.send(Message::Pong(payload));
                }

                Ok(Message::Close(_)) => break,

                Ok(_) => {}

                Err(e) => {
                    eprintln!("[template] receive error from {peer_addr}: {e}");
                    break;
                }
            }
        }

        clients_r.lock().await.remove(&peer_addr);
        println!("[template] {peer_addr} disconnected");
        Ok::<(), ()>(())
    });

    let _ = tokio::join!(writer, reader);
    Ok(())
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

fn main() {
    tauri::Builder::default()
        .setup(|_app| {
            println!("[template] starting WebSocket relay on port {PORT}");

            let clients_v4 = Arc::clone(&CLIENTS);
            let clients_v6 = Arc::clone(&CLIENTS);

            // ── SPAWN NOTE (v1 and v2 are identical here) ────────────────────
            //
            // tauri::async_runtime::spawn is the correct API in BOTH v1 and v2.
            //
            // The .setup() callback is invoked by the Tauri/tao event loop
            // before the Tokio runtime context is active on the calling thread.
            // Calling tokio::spawn directly here panics with:
            //   "there is no reactor running, must be called from the context
            //    of a Tokio 1.x runtime"
            //
            // tauri::async_runtime::spawn works because Tauri internally holds
            // a handle to its Tokio runtime and dispatches the task correctly
            // regardless of which thread .setup() is called from.
            //
            // This is unchanged between v1 and v2.
            // ────────────────────────────────────────────────────────────────

            // IPv4 listener — standard loopback
            tauri::async_runtime::spawn(async move {
                let addr = format!("127.0.0.1:{PORT}");
                if let Err(e) = run_listener(addr, clients_v4).await {
                    eprintln!("[template] IPv4 listener error: {e}");
                }
            });

            // IPv6 listener — macOS/Linux WebViews sometimes connect via ::1
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
