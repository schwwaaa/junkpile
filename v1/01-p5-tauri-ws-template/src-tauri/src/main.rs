#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{collections::HashMap, net::SocketAddr, sync::Arc};

use futures_util::{SinkExt, StreamExt};
use once_cell::sync::Lazy;
use serde::Deserialize;
use serde_json::json;
use tauri::Manager;
use tokio::{net::TcpListener, sync::Mutex};
use tokio_tungstenite::{accept_async, tungstenite::Message};

#[derive(Clone, Debug)]
struct Client {
    role: String,
    tx: tokio::sync::mpsc::UnboundedSender<Message>,
}

type ClientMap = Arc<Mutex<HashMap<SocketAddr, Client>>>;

static CLIENTS: Lazy<ClientMap> = Lazy::new(|| Arc::new(Mutex::new(HashMap::new())));

#[derive(Deserialize, Debug)]
struct HelloMessage {
    #[serde(default)]
    r#type: String,
    #[serde(default)]
    role: String,
}

const PORT: u16 = 2727;

async fn run_listener(bind_addr: String, clients: ClientMap) -> Result<(), String> {
    let listener = TcpListener::bind(&bind_addr)
        .await
        .map_err(|error| error.to_string())?;
    println!("[junkpile 01] listening on ws://{bind_addr}");

    loop {
        let (stream, peer_addr) = listener.accept().await.map_err(|error| error.to_string())?;
        let clients = Arc::clone(&clients);
        tokio::spawn(async move {
            if let Err(error) = handle_ws(stream, peer_addr, clients).await {
                eprintln!("[junkpile 01] client {peer_addr} error: {error}");
            }
        });
    }
}

async fn broadcast_text(clients: &ClientMap, sender: SocketAddr, text: String) {
    let map = clients.lock().await;
    for (address, client) in map.iter() {
        if *address != sender {
            let _ = client.tx.send(Message::Text(text.clone()));
        }
    }
}

async fn broadcast_all_text(clients: &ClientMap, text: String) {
    let map = clients.lock().await;
    for client in map.values() {
        let _ = client.tx.send(Message::Text(text.clone()));
    }
}

async fn broadcast_presence(clients: &ClientMap) {
    let (controls, canvas, unknown, total) = {
        let map = clients.lock().await;
        let controls = map.values().filter(|client| client.role == "controls").count();
        let canvas = map.values().filter(|client| client.role == "canvas").count();
        let unknown = map.values().filter(|client| client.role == "unknown").count();
        (controls, canvas, unknown, map.len())
    };

    let message = json!({
        "type": "presence",
        "controls": controls,
        "canvas": canvas,
        "unknown": unknown,
        "total": total
    })
    .to_string();

    broadcast_all_text(clients, message).await;
}

async fn broadcast_binary(clients: &ClientMap, sender: SocketAddr, bytes: Vec<u8>) -> usize {
    let map = clients.lock().await;
    let mut sent = 0usize;
    for (address, client) in map.iter() {
        if *address != sender && client.role == "canvas" {
            let _ = client.tx.send(Message::Binary(bytes.clone()));
            sent += 1;
        }
    }
    sent
}

async fn handle_ws(
    stream: tokio::net::TcpStream,
    peer_addr: SocketAddr,
    clients: ClientMap,
) -> Result<(), String> {
    let ws_stream = accept_async(stream).await.map_err(|error| error.to_string())?;
    let (mut ws_tx, mut ws_rx) = ws_stream.split();
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Message>();

    {
        let mut map = clients.lock().await;
        map.insert(
            peer_addr,
            Client {
                role: "unknown".to_string(),
                tx: tx.clone(),
            },
        );
    }
    broadcast_presence(&clients).await;

    let writer = tokio::spawn(async move {
        while let Some(message) = rx.recv().await {
            if ws_tx.send(message).await.is_err() {
                break;
            }
        }
    });

    let reader_clients = Arc::clone(&clients);
    let reader = tokio::spawn(async move {
        while let Some(message) = ws_rx.next().await {
            match message {
                Ok(Message::Text(text)) => {
                    if let Ok(hello) = serde_json::from_str::<HelloMessage>(&text) {
                        if hello.r#type == "hello" && !hello.role.is_empty() {
                            {
                                let mut map = reader_clients.lock().await;
                                if let Some(client) = map.get_mut(&peer_addr) {
                                    client.role = hello.role.clone();
                                }
                            }
                            println!(
                                "[junkpile 01] {peer_addr} identified as role='{}'",
                                hello.role
                            );
                            broadcast_presence(&reader_clients).await;
                        }
                    }
                    broadcast_text(&reader_clients, peer_addr, text).await;
                }
                Ok(Message::Binary(bytes)) => {
                    let sent = broadcast_binary(&reader_clients, peer_addr, bytes).await;
                    if sent == 0 {
                        println!(
                            "[junkpile 01] binary data arrived before a canvas client connected"
                        );
                    }
                }
                Ok(Message::Ping(payload)) => {
                    let _ = tx.send(Message::Pong(payload));
                }
                Ok(Message::Close(_)) => break,
                Ok(_) => {}
                Err(error) => {
                    eprintln!("[junkpile 01] receive error from {peer_addr}: {error}");
                    break;
                }
            }
        }

        reader_clients.lock().await.remove(&peer_addr);
        broadcast_presence(&reader_clients).await;
        println!("[junkpile 01] {peer_addr} disconnected");
    });

    let _ = tokio::join!(writer, reader);
    Ok(())
}

fn canvas_window(app: &tauri::AppHandle) -> Result<tauri::Window, String> {
    app.get_window("canvas")
        .ok_or_else(|| "canvas window is unavailable".to_string())
}

#[tauri::command]
fn toggle_canvas_fullscreen(app: tauri::AppHandle) -> Result<bool, String> {
    let window = canvas_window(&app)?;
    let next = !window.is_fullscreen().map_err(|error| error.to_string())?;
    window
        .set_fullscreen(next)
        .map_err(|error| error.to_string())?;
    Ok(next)
}

#[tauri::command]
fn show_canvas(app: tauri::AppHandle) -> Result<(), String> {
    let window = canvas_window(&app)?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

#[tauri::command]
fn focus_canvas(app: tauri::AppHandle) -> Result<(), String> {
    canvas_window(&app)?
        .set_focus()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn toggle_current_fullscreen(window: tauri::Window) -> Result<bool, String> {
    let next = !window.is_fullscreen().map_err(|error| error.to_string())?;
    window
        .set_fullscreen(next)
        .map_err(|error| error.to_string())?;
    Ok(next)
}

fn main() {
    tauri::Builder::default()
        .setup(|_app| {
            let clients_v4 = Arc::clone(&CLIENTS);
            let clients_v6 = Arc::clone(&CLIENTS);

            tauri::async_runtime::spawn(async move {
                let address = format!("127.0.0.1:{PORT}");
                if let Err(error) = run_listener(address, clients_v4).await {
                    eprintln!("[junkpile 01] IPv4 listener error: {error}");
                }
            });

            tauri::async_runtime::spawn(async move {
                let address = format!("[::1]:{PORT}");
                if let Err(error) = run_listener(address, clients_v6).await {
                    eprintln!("[junkpile 01] IPv6 listener error: {error}");
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            toggle_canvas_fullscreen,
            show_canvas,
            focus_canvas,
            toggle_current_fullscreen
        ])
        .run(tauri::generate_context!())
        .expect("error while running Junkpile Example 01");
}
