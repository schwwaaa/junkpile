// =============================================================================
// src-tauri/src/main.rs  (Tauri v1)
// =============================================================================
//
// Two-window WebSocket relay. Identical architecture to the p5 ws v1 template.
// The relay is frontend-agnostic — it doesn't care whether the canvas window
// uses p5.js or raw WebGL. Only the HTML/JS files differ between those two.
//
// ARCHITECTURE
// ─────────────
//   controls.html  ──ws://127.0.0.1:2727──▶  canvas.html
//                  ◀────────────────────────
//                              ▲
//                    Rust WS Relay (this file)
//                    • Listens IPv4 + IPv6
//                    • Tracks client roles
//                    • Broadcasts text to all others
//                    • Forwards binary only to "canvas" role
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

#[derive(Clone, Debug)]
struct Client {
    role: String,
    tx: tokio::sync::mpsc::UnboundedSender<Message>,
}

type ClientMap = Arc<Mutex<HashMap<SocketAddr, Client>>>;

static CLIENTS: Lazy<ClientMap> =
    Lazy::new(|| Arc::new(Mutex::new(HashMap::new())));

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

const PORT: u16 = 2727;

// ---------------------------------------------------------------------------
// Listener
// ---------------------------------------------------------------------------

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

async fn broadcast_text(clients: &ClientMap, sender: SocketAddr, txt: String) {
    let map = clients.lock().await;
    for (addr, c) in map.iter() {
        if *addr != sender {
            let _ = c.tx.send(Message::Text(txt.clone()));
        }
    }
}

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

    let writer = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if ws_tx.send(msg).await.is_err() { break; }
        }
    });

    let clients_r = Arc::clone(&clients);
    let reader = tokio::spawn(async move {
        while let Some(msg) = ws_rx.next().await {
            match msg {
                Ok(Message::Text(txt)) => {
                    if let Ok(parsed) = serde_json::from_str::<HelloMsg>(&txt) {
                        if parsed.r#type == "hello" && !parsed.role.is_empty() {
                            let mut map = clients_r.lock().await;
                            if let Some(c) = map.get_mut(&peer_addr) {
                                c.role = parsed.role.clone();
                                println!("[template] {peer_addr} role='{}'", c.role);
                            }
                        }
                    }
                    broadcast_text(&clients_r, peer_addr, txt).await;
                }
                Ok(Message::Binary(bin)) => {
                    let sent = broadcast_binary(&clients_r, peer_addr, bin).await;
                    if sent == 0 {
                        println!("[template] binary from {peer_addr}, no canvas clients");
                    }
                }
                Ok(Message::Ping(payload)) => { let _ = tx.send(Message::Pong(payload)); }
                Ok(Message::Close(_))      => break,
                Ok(_)                      => {}
                Err(e) => {
                    eprintln!("[template] error from {peer_addr}: {e}");
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

            // tauri::async_runtime::spawn is required here in both v1 and v2.
            // .setup() is called before Tokio's reactor is active on this thread,
            // so tokio::spawn would panic. Tauri's runtime handle dispatches correctly.
            tauri::async_runtime::spawn(async move {
                let addr = format!("127.0.0.1:{PORT}");
                if let Err(e) = run_listener(addr, clients_v4).await {
                    eprintln!("[template] IPv4 error: {e}");
                }
            });

            tauri::async_runtime::spawn(async move {
                let addr = format!("[::1]:{PORT}");
                if let Err(e) = run_listener(addr, clients_v6).await {
                    eprintln!("[template] IPv6 error: {e}");
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
