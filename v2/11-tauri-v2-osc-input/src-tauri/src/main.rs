#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use rosc::{OscMessage, OscPacket, OscType};
use serde::Serialize;
use std::{collections::BTreeSet, net::{IpAddr, SocketAddr, UdpSocket}, sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex}, thread::{self, JoinHandle}, time::{Duration, SystemTime, UNIX_EPOCH}};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)] struct OscState { runtime: Mutex<Option<OscRuntime>> }
struct OscRuntime { stop: Arc<AtomicBool>, thread: Option<JoinHandle<()>>, info: ListenerInfo }
#[derive(Serialize, Clone, Debug)] #[serde(rename_all="camelCase")]
struct ListenerInfo { running: bool, bind_address: String, port: u16, endpoint: String }
#[derive(Serialize, Clone, Debug)] #[serde(rename_all="camelCase")]
struct OscArgument { kind: String, text: String, numeric: Option<f64> }
#[derive(Serialize, Clone, Debug)] #[serde(rename_all="camelCase")]
struct OscEvent { address: String, args: Vec<OscArgument>, numeric_value: Option<f64>, sender: String, timestamp_ms: u64, bundle_depth: u32 }

fn now_millis()->u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64 }
fn osc_argument(value:&OscType)->OscArgument {
    let (kind,text,numeric)=match value {
        OscType::Int(v)=>("int",v.to_string(),Some(*v as f64)), OscType::Float(v)=>("float",format!("{v:.5}"),Some(*v as f64)),
        OscType::Double(v)=>("double",format!("{v:.5}"),Some(*v)), OscType::Long(v)=>("long",v.to_string(),Some(*v as f64)),
        OscType::String(v)=>("string",v.clone(),None), OscType::Bool(v)=>("bool",v.to_string(),Some(if *v{1.0}else{0.0})),
        OscType::Nil=>("nil","nil".into(),None), OscType::Blob(v)=>("blob",format!("{} bytes",v.len()),None), other=>("other",format!("{other:?}"),None)
    }; OscArgument{kind:kind.into(),text,numeric}
}
fn emit_message(message:OscMessage, app:&AppHandle, sender:SocketAddr, depth:u32){
    let args=message.args.iter().map(osc_argument).collect::<Vec<_>>(); let numeric_value=args.iter().find_map(|a|a.numeric);
    let _=app.emit("osc-event",OscEvent{address:message.addr,args,numeric_value,sender:sender.to_string(),timestamp_ms:now_millis(),bundle_depth:depth});
}
fn dispatch(packet:OscPacket, app:&AppHandle, sender:SocketAddr, depth:u32){ match packet{OscPacket::Message(m)=>emit_message(m,app,sender,depth),OscPacket::Bundle(b)=>for p in b.content{dispatch(p,app,sender,depth.saturating_add(1))}} }
fn stop_runtime(mut runtime:OscRuntime){ runtime.stop.store(true,Ordering::Relaxed); if let Some(t)=runtime.thread.take(){let _=t.join();} }
fn stop_existing(state:&OscState)->Result<(),String>{ let prev=state.runtime.lock().map_err(|_|"OSC listener state is poisoned".to_string())?.take(); if let Some(r)=prev{stop_runtime(r)} Ok(()) }

#[tauri::command]
fn start_osc_listener(bind_address:String, port:u16, app:AppHandle, state:State<'_,OscState>)->Result<ListenerInfo,String>{
    if port==0{return Err("OSC port must be between 1 and 65535".into())} let ip=bind_address.parse::<IpAddr>().map_err(|_|format!("'{bind_address}' is not a valid IP address"))?;
    let endpoint=SocketAddr::new(ip,port); stop_existing(&state)?; let socket=UdpSocket::bind(endpoint).map_err(|e|format!("Could not bind OSC listener to {endpoint}: {e}"))?;
    socket.set_read_timeout(Some(Duration::from_millis(80))).map_err(|e|e.to_string())?; let actual=socket.local_addr().map_err(|e|e.to_string())?;
    let info=ListenerInfo{running:true,bind_address:actual.ip().to_string(),port:actual.port(),endpoint:actual.to_string()};
    let stop=Arc::new(AtomicBool::new(false)); let thread_stop=stop.clone(); let thread_app=app.clone(); let thread_info=info.clone();
    let listener=thread::Builder::new().name("junkpile-osc-listener".into()).spawn(move||{
      let mut buffer=[0u8;65535]; while !thread_stop.load(Ordering::Relaxed){ match socket.recv_from(&mut buffer){
        Ok((size,sender))=>match rosc::decoder::decode_udp(&buffer[..size]){Ok((_,packet))=>dispatch(packet,&thread_app,sender,0),Err(e)=>{let _=thread_app.emit("osc-error",format!("Could not decode OSC packet from {sender}: {e}"));}},
        Err(e) if matches!(e.kind(),std::io::ErrorKind::WouldBlock|std::io::ErrorKind::TimedOut)=>{}, Err(e)=>{let _=thread_app.emit("osc-error",format!("OSC receive error: {e}"));break;}
      }} println!("[osc] listener stopped on {}",thread_info.endpoint);
    }).map_err(|e|e.to_string())?;
    *state.runtime.lock().map_err(|_|"OSC listener state is poisoned".to_string())?=Some(OscRuntime{stop,thread:Some(listener),info:info.clone()}); Ok(info)
}
#[tauri::command] fn stop_osc_listener(state:State<'_,OscState>)->Result<(),String>{stop_existing(&state)}
#[tauri::command] fn get_osc_status(state:State<'_,OscState>)->Result<ListenerInfo,String>{Ok(state.runtime.lock().map_err(|_|"OSC state poisoned".to_string())?.as_ref().map(|r|r.info.clone()).unwrap_or(ListenerInfo{running:false,bind_address:String::new(),port:0,endpoint:String::new()}))}
#[tauri::command] fn get_network_hints(port:u16)->Vec<String>{let mut e=BTreeSet::new();e.insert(format!("127.0.0.1:{port}"));for target in ["8.8.8.8:80","1.1.1.1:80"]{if let Ok(s)=UdpSocket::bind("0.0.0.0:0"){if s.connect(target).is_ok(){if let Ok(a)=s.local_addr(){if !a.ip().is_loopback(){e.insert(format!("{}:{port}",a.ip()));}}}}}e.into_iter().collect()}
#[tauri::command] fn send_test_osc(port:u16,address:String,value:f32)->Result<usize,String>{if port==0{return Err("Start listener first".into())}if !address.starts_with('/'){return Err("OSC addresses must begin with '/'".into())}let packet=OscPacket::Message(OscMessage{addr:address,args:vec![OscType::Float(value)]});let encoded=rosc::encoder::encode(&packet).map_err(|e|e.to_string())?;UdpSocket::bind("127.0.0.1:0").map_err(|e|e.to_string())?.send_to(&encoded,("127.0.0.1",port)).map_err(|e|e.to_string())}
#[tauri::command] fn toggle_fullscreen(app:AppHandle)->Result<bool,String>{let w=app.get_webview_window("main").ok_or("Main window unavailable")?;let n=!w.is_fullscreen().map_err(|e|e.to_string())?;w.set_fullscreen(n).map_err(|e|e.to_string())?;Ok(n)}
fn main(){tauri::Builder::default().manage(OscState::default()).invoke_handler(tauri::generate_handler![start_osc_listener,stop_osc_listener,get_osc_status,get_network_hints,send_test_osc,toggle_fullscreen]).run(tauri::generate_context!()).expect("error while running Tauri application");}
