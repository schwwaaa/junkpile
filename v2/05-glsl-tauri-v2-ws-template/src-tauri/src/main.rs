#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{collections::HashMap, net::SocketAddr, sync::Arc};

use futures_util::{SinkExt, StreamExt};
use once_cell::sync::Lazy;
use serde::Deserialize;
use tauri::Manager;
use tokio::{net::TcpListener, sync::Mutex};
use tokio_tungstenite::{accept_async, tungstenite::Message};

const PORT: u16 = 2727;

#[derive(Clone, Debug)]
struct Client {
    role: String,
    tx: tokio::sync::mpsc::UnboundedSender<Message>,
}

type ClientMap = Arc<Mutex<HashMap<SocketAddr, Client>>>;

static CLIENTS: Lazy<ClientMap> =
    Lazy::new(|| Arc::new(Mutex::new(HashMap::new())));

#[derive(Deserialize, Debug)]
struct HelloMessage {
    #[serde(default)]
    r#type: String,
    #[serde(default)]
    role: String,
}

#[tauri::command]
fn toggle_canvas_fullscreen(app: tauri::AppHandle) -> Result<bool, String> {
    let window = app
        .get_webview_window("canvas")
        .ok_or_else(|| "The canvas WebView window is unavailable.".to_string())?;

    let next_state = !window
        .is_fullscreen()
        .map_err(|error| format!("Could not read canvas fullscreen state: {error}"))?;

    window
        .set_fullscreen(next_state)
        .map_err(|error| format!("Could not change canvas fullscreen state: {error}"))?;

    Ok(next_state)
}

async fn run_listener(bind_address: String, clients: ClientMap) -> Result<(), String> {
    let listener = TcpListener::bind(&bind_address)
        .await
        .map_err(|error| format!("Could not bind {bind_address}: {error}"))?;

    println!("[junkpile-05] listening on ws://{bind_address}");

    loop {
        let (stream, peer_address) = listener
            .accept()
            .await
            .map_err(|error| format!("Accept failed on {bind_address}: {error}"))?;
        let clients = Arc::clone(&clients);

        tokio::spawn(async move {
            if let Err(error) = handle_websocket(stream, peer_address, clients).await {
                eprintln!("[junkpile-05] client {peer_address} error: {error}");
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

async fn broadcast_binary(clients: &ClientMap, sender: SocketAddr, bytes: Vec<u8>) -> usize {
    let map = clients.lock().await;
    let mut recipient_count = 0;

    for (address, client) in map.iter() {
        if *address != sender && client.role == "canvas" {
            let _ = client.tx.send(Message::Binary(bytes.clone()));
            recipient_count += 1;
        }
    }

    recipient_count
}

async fn handle_websocket(
    stream: tokio::net::TcpStream,
    peer_address: SocketAddr,
    clients: ClientMap,
) -> Result<(), String> {
    let websocket = accept_async(stream)
        .await
        .map_err(|error| error.to_string())?;
    let (mut socket_writer, mut socket_reader) = websocket.split();
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Message>();

    {
        let mut map = clients.lock().await;
        map.insert(
            peer_address,
            Client {
                role: "unknown".to_string(),
                tx: tx.clone(),
            },
        );
    }

    println!("[junkpile-05] {peer_address} connected");

    let writer_task = tokio::spawn(async move {
        while let Some(message) = rx.recv().await {
            if socket_writer.send(message).await.is_err() {
                break;
            }
        }
    });

    let reader_clients = Arc::clone(&clients);
    let reader_task = tokio::spawn(async move {
        while let Some(result) = socket_reader.next().await {
            match result {
                Ok(Message::Text(text)) => {
                    if let Ok(hello) = serde_json::from_str::<HelloMessage>(&text) {
                        if hello.r#type == "hello" && !hello.role.is_empty() {
                            let mut map = reader_clients.lock().await;
                            if let Some(client) = map.get_mut(&peer_address) {
                                client.role = hello.role.clone();
                                println!(
                                    "[junkpile-05] {peer_address} identified as '{}'",
                                    client.role
                                );
                            }
                        }
                    }

                    broadcast_text(&reader_clients, peer_address, text).await;
                }
                Ok(Message::Binary(bytes)) => {
                    let recipients =
                        broadcast_binary(&reader_clients, peer_address, bytes).await;
                    if recipients == 0 {
                        println!(
                            "[junkpile-05] binary message from {peer_address} had no canvas recipient"
                        );
                    }
                }
                Ok(Message::Ping(payload)) => {
                    let _ = tx.send(Message::Pong(payload));
                }
                Ok(Message::Close(_)) => break,
                Ok(_) => {}
                Err(error) => {
                    eprintln!("[junkpile-05] receive error from {peer_address}: {error}");
                    break;
                }
            }
        }

        reader_clients.lock().await.remove(&peer_address);
        println!("[junkpile-05] {peer_address} disconnected");
    });

    let _ = tokio::join!(writer_task, reader_task);
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .setup(|_app| {
            println!("[junkpile-05] starting embedded WebSocket relay on port {PORT}");

            let ipv4_clients = Arc::clone(&CLIENTS);
            let ipv6_clients = Arc::clone(&CLIENTS);

            tauri::async_runtime::spawn(async move {
                let address = format!("127.0.0.1:{PORT}");
                if let Err(error) = run_listener(address, ipv4_clients).await {
                    eprintln!("[junkpile-05] IPv4 listener error: {error}");
                }
            });

            tauri::async_runtime::spawn(async move {
                let address = format!("[::1]:{PORT}");
                if let Err(error) = run_listener(address, ipv6_clients).await {
                    eprintln!("[junkpile-05] IPv6 listener error: {error}");
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![toggle_canvas_fullscreen])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
