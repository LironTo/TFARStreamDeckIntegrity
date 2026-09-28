//! Arma 3 extension: bridges the SQF addon and the Stream Deck plugin over a local WebSocket.
//! Protocol v1 — see docs/protocol.md.
//!
//! SQF → extension (callExtension, all return immediately):
//!   "version"            → crate version
//!   "start" [port]       → starts the WS server on 127.0.0.1:port (background threads)
//!   "stop"               → stops the server
//!   "state" [json]       → caches the full `state` JSON and broadcasts it to all clients
//!   "status"             → "running:<port>:<clients>" or "stopped"
//! Extension → SQF (ExtensionCallback, name "tfar_sd"):
//!   "setChannel" data `["sw",3]`   — validated command from the plugin
//!   "requestState" data none       — plugin asked for a fresh state
//!   "log" data `"<message>"`       — diagnostics for diag_log
//! Diagnostics are also appended to `%LOCALAPPDATA%\Arma 3\tfar_sd.log`.

use std::net::{Shutdown, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use arma_rs::{arma, Context, Extension, Value};
use serde_json::Value as Json;
use tungstenite::protocol::Role;
use tungstenite::{Message, WebSocket};

pub const PROTOCOL_VERSION: u64 = 1;
const CALLBACK_NAME: &str = "tfar_sd";
const POLL_INTERVAL: Duration = Duration::from_millis(50);
const RADIO_KINDS: [&str; 5] = ["sw", "lr", "lrBackpack", "lrVehicle", "intercom"];

/// Sent to clients until SQF has pushed a real state (e.g. no mission running).
const OFFLINE_STATE: &str = r#"{"type":"state","v":1,"inGame":false,"sw":{"present":false},"lr":{"present":false},"lrBackpack":{"present":false},"lrVehicle":{"present":false},"intercom":{"present":false}}"#;

#[arma]
fn init() -> Extension {
    Extension::build()
        .command("version", version)
        .command("start", start)
        .command("stop", stop)
        .command("state", state)
        .command("status", status)
        .finish()
}

/// The extension wrapped in arma-rs' test harness, for `examples/harness.rs` (runs outside Arma).
#[doc(hidden)]
pub fn harness_extension() -> arma_rs::testing::Extension {
    init().testing()
}

struct Server {
    port: u16,
    stop: Arc<AtomicBool>,
    listener: Option<JoinHandle<()>>,
}

/// Item queued for a client's writer thread; `None` tells the writer to exit.
type Outbound = Option<String>;

struct Client {
    id: u64,
    tx: Sender<Outbound>,
    /// Clone of the socket, used by `stop` to unblock the reader thread.
    socket: TcpStream,
}

struct Shared {
    /// Latest full state JSON from SQF.
    last_state: Mutex<String>,
    /// Connected clients (each has a reader and a writer thread).
    clients: Mutex<Vec<Client>>,
}

fn shared() -> &'static Shared {
    static SHARED: OnceLock<Shared> = OnceLock::new();
    SHARED.get_or_init(|| Shared {
        last_state: Mutex::new(OFFLINE_STATE.to_string()),
        clients: Mutex::new(Vec::new()),
    })
}

fn server() -> &'static Mutex<Option<Server>> {
    static SERVER: OnceLock<Mutex<Option<Server>>> = OnceLock::new();
    SERVER.get_or_init(|| Mutex::new(None))
}

/// Locks without ever panicking on poison (a panicked thread must not take the game down).
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Diagnostics file: `%LOCALAPPDATA%\Arma 3\tfar_sd.log` (truncated on `start`).
fn log_path() -> Option<std::path::PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|d| std::path::Path::new(&d).join("Arma 3").join("tfar_sd.log"))
}

fn file_log(msg: &str) {
    use std::io::Write;
    let Some(path) = log_path() else { return };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or_default();
    static FILE_LOCK: Mutex<()> = Mutex::new(());
    let _guard = lock(&FILE_LOCK);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = f.write_all(format!("{ts:.3} {msg}\n").as_bytes());
    }
}

/// Logs to the file and to SQF (ExtensionCallback "log").
fn log(ctx: &Context, msg: String) {
    file_log(&msg);
    let _ = ctx.callback_data(CALLBACK_NAME, "log", msg);
}

pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

pub fn status() -> String {
    match lock(server()).as_ref() {
        Some(s) => format!("running:{}:{}", s.port, lock(&shared().clients).len()),
        None => "stopped".to_string(),
    }
}

pub fn start(ctx: Context, port: u16) -> Result<String, String> {
    let mut guard = lock(server());
    if let Some(s) = guard.as_ref() {
        return Ok(format!("already running on {}", s.port));
    }
    if let Some(path) = log_path() {
        let _ = std::fs::write(path, "");
    }
    // Localhost only, never 0.0.0.0.
    let listener = TcpListener::bind(("127.0.0.1", port)).map_err(|e| format!("bind 127.0.0.1:{port} failed: {e}"))?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    file_log(&format!("tfar_sd {} listening on 127.0.0.1:{port}", version()));

    let stop = Arc::new(AtomicBool::new(false));
    let ctx = Arc::new(ctx);
    let thread_stop = stop.clone();
    let handle = thread::Builder::new()
        .name("tfar_sd-listener".into())
        .spawn(move || accept_loop(listener, thread_stop, ctx))
        .map_err(|e| e.to_string())?;

    *guard = Some(Server { port, stop, listener: Some(handle) });
    Ok(format!("started on {port}"))
}

pub fn stop() -> &'static str {
    let taken = lock(server()).take();
    match taken {
        Some(mut s) => {
            s.stop.store(true, Ordering::SeqCst);
            if let Some(h) = s.listener.take() {
                let _ = h.join(); // exits within one POLL_INTERVAL
            }
            for c in lock(&shared().clients).drain(..) {
                let _ = c.tx.send(None);
                let _ = c.socket.shutdown(Shutdown::Both); // unblocks the reader
            }
            *lock(&shared().last_state) = OFFLINE_STATE.to_string();
            file_log("stopped");
            "stopped"
        }
        None => "not running",
    }
}

/// Receives the full state JSON from SQF, validates it lightly, caches and broadcasts it.
pub fn state(json: String) -> Result<&'static str, String> {
    let parsed: Json = serde_json::from_str(&json).map_err(|e| format!("invalid JSON: {e}"))?;
    if parsed.get("type").and_then(Json::as_str) != Some("state")
        || parsed.get("v").and_then(Json::as_u64) != Some(PROTOCOL_VERSION)
    {
        file_log(&format!("state rejected: {:.200}", json));
        return Err("not a v1 state message".into());
    }
    *lock(&shared().last_state) = json.clone();
    let delivered = broadcast(&json);
    file_log(&format!("state ({} bytes) queued for {delivered} client(s)", json.len()));
    Ok("ok")
}

/// Queues `msg` for every client; drops clients whose writer has gone away. Returns the count.
fn broadcast(msg: &str) -> usize {
    let mut clients = lock(&shared().clients);
    clients.retain(|c| c.tx.send(Some(msg.to_string())).is_ok());
    clients.len()
}

fn accept_loop(listener: TcpListener, stop: Arc<AtomicBool>, ctx: Arc<Context>) {
    static NEXT_ID: AtomicU64 = AtomicU64::new(1);
    while !stop.load(Ordering::SeqCst) {
        match listener.accept() {
            Ok((stream, addr)) => {
                let id = NEXT_ID.fetch_add(1, Ordering::SeqCst);
                log(&ctx, format!("client {id} connected from {addr}"));
                let thread_ctx = ctx.clone();
                let spawned = thread::Builder::new().name(format!("tfar_sd-client-{id}")).spawn(move || {
                    let result = serve_client(id, stream, &thread_ctx);
                    lock(&shared().clients).retain(|c| c.id != id);
                    match result {
                        Ok(()) => log(&thread_ctx, format!("client {id} disconnected")),
                        Err(e) => log(&thread_ctx, format!("client {id} closed: {e}")),
                    }
                });
                if let Err(e) = spawned {
                    log(&ctx, format!("cannot spawn client thread: {e}"));
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => thread::sleep(POLL_INTERVAL),
            Err(e) => {
                log(&ctx, format!("accept failed: {e}"));
                thread::sleep(POLL_INTERVAL);
            }
        }
    }
}

/// Handshake, then one blocking reader (this thread) and one blocking writer thread per client.
/// No read timeouts or polling: the writer blocks on its queue, the reader blocks on the socket.
fn serve_client(id: u64, stream: TcpStream, ctx: &Context) -> Result<(), String> {
    // Accepted sockets inherit non-blocking mode from the listener on Windows.
    stream.set_nonblocking(false).map_err(|e| e.to_string())?;
    stream.set_nodelay(true).map_err(|e| e.to_string())?;
    let reader = tungstenite::accept(stream).map_err(|e| format!("handshake failed: {e}"))?;
    let write_socket = reader.get_ref().try_clone().map_err(|e| e.to_string())?;
    let stop_socket = reader.get_ref().try_clone().map_err(|e| e.to_string())?;

    let (tx, rx) = mpsc::channel::<Outbound>();
    {
        // Queue the current state and register under the clients lock, so a concurrent `state`
        // call is either included in this snapshot or broadcast to us afterwards.
        let mut clients = lock(&shared().clients);
        let _ = tx.send(Some(lock(&shared().last_state).clone()));
        clients.push(Client { id, tx: tx.clone(), socket: stop_socket });
    }

    let writer = WebSocket::from_raw_socket(write_socket, Role::Server, None);
    let writer_handle = thread::Builder::new()
        .name(format!("tfar_sd-writer-{id}"))
        .spawn(move || writer_loop(id, writer, rx))
        .map_err(|e| e.to_string())?;

    let result = reader_loop(reader, &tx, ctx);
    let _ = tx.send(None);
    let _ = writer_handle.join();
    result
}

fn writer_loop(id: u64, mut ws: WebSocket<TcpStream>, rx: Receiver<Outbound>) {
    while let Ok(Some(msg)) = rx.recv() {
        let len = msg.len();
        if let Err(e) = ws.send(Message::text(msg)) {
            file_log(&format!("client {id} write failed: {e}"));
            let _ = ws.get_ref().shutdown(Shutdown::Both); // makes the reader exit too
            return;
        }
        file_log(&format!("client {id} sent {len} bytes"));
    }
}

fn reader_loop(mut ws: WebSocket<TcpStream>, tx: &Sender<Outbound>, ctx: &Context) -> Result<(), String> {
    // tungstenite answers pings from this (reader) side; the plugin never sends pings.
    loop {
        match ws.read() {
            Ok(Message::Text(text)) => handle_client_message(text.as_str(), tx, ctx),
            Ok(Message::Close(_)) => return Ok(()),
            Ok(_) => {} // binary / ping / pong ignored
            Err(tungstenite::Error::ConnectionClosed | tungstenite::Error::AlreadyClosed) => return Ok(()),
            Err(e) => return Err(e.to_string()),
        }
    }
}

/// What a single client message asks the game side to do.
#[derive(Debug, PartialEq)]
pub enum Command {
    SendState,
    SetChannel { radio: String, channel: i64 },
    Ignore(String),
}

/// Validates a plugin → game message (protocol v1). Never panics.
pub fn parse_client_message(text: &str) -> Command {
    let msg: Json = match serde_json::from_str(text) {
        Ok(m) => m,
        Err(_) => return Command::Ignore("malformed JSON".into()),
    };
    if msg.get("v").and_then(Json::as_u64) != Some(PROTOCOL_VERSION) {
        return Command::Ignore("missing or unsupported v".into());
    }
    match msg.get("type").and_then(Json::as_str) {
        Some("hello") | Some("requestState") => Command::SendState,
        Some("setChannel") => {
            let radio = msg.get("radio").and_then(Json::as_str).unwrap_or_default();
            let channel = msg.get("channel").and_then(Json::as_i64);
            let (min, max) = match radio {
                "sw" => (1, 8),
                "intercom" => (0, 2),
                r if RADIO_KINDS.contains(&r) => (1, 9),
                _ => return Command::Ignore(format!("unknown radio kind {radio:?}")),
            };
            match channel {
                Some(c) if (min..=max).contains(&c) => Command::SetChannel { radio: radio.to_string(), channel: c },
                _ => Command::Ignore(format!("channel out of range for {radio}")),
            }
        }
        other => Command::Ignore(format!("unknown type {other:?}")),
    }
}

fn handle_client_message(text: &str, tx: &Sender<Outbound>, ctx: &Context) {
    match parse_client_message(text) {
        Command::SendState => {
            let _ = tx.send(Some(lock(&shared().last_state).clone()));
            let _ = ctx.callback_null(CALLBACK_NAME, "requestState");
        }
        Command::SetChannel { radio, channel } => {
            file_log(&format!("setChannel {radio} {channel}"));
            let data = vec![Value::String(radio), Value::Number(channel as f64)];
            let _ = ctx.callback_data(CALLBACK_NAME, "setChannel", data);
        }
        Command::Ignore(reason) => log(ctx, format!("ignored message ({reason}): {:.200}", text)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_client_messages() {
        assert_eq!(parse_client_message(r#"{"type":"hello","v":1,"client":"streamdeck"}"#), Command::SendState);
        assert_eq!(parse_client_message(r#"{"type":"requestState","v":1}"#), Command::SendState);
        assert_eq!(
            parse_client_message(r#"{"type":"setChannel","v":1,"radio":"sw","channel":3}"#),
            Command::SetChannel { radio: "sw".into(), channel: 3 }
        );
        assert_eq!(
            parse_client_message(r#"{"type":"setChannel","v":1,"radio":"lrVehicle","channel":9}"#),
            Command::SetChannel { radio: "lrVehicle".into(), channel: 9 }
        );
        assert_eq!(
            parse_client_message(r#"{"type":"setChannel","v":1,"radio":"intercom","channel":0}"#),
            Command::SetChannel { radio: "intercom".into(), channel: 0 }
        );
    }

    #[test]
    fn rejects_bad_client_messages() {
        for bad in [
            "garbage",
            r#"{"type":"hello"}"#,
            r#"{"type":"hello","v":2}"#,
            r#"{"type":"nope","v":1}"#,
            r#"{"type":"setChannel","v":1,"radio":"sw","channel":9}"#,
            r#"{"type":"setChannel","v":1,"radio":"sw","channel":0}"#,
            r#"{"type":"setChannel","v":1,"radio":"lr","channel":10}"#,
            r#"{"type":"setChannel","v":1,"radio":"intercom","channel":3}"#,
            r#"{"type":"setChannel","v":1,"radio":"xx","channel":1}"#,
            r#"{"type":"setChannel","v":1,"radio":"sw","channel":"3"}"#,
        ] {
            assert!(matches!(parse_client_message(bad), Command::Ignore(_)), "{bad}");
        }
    }

    /// Real server + real WS client + Arma callback channel, through the arma-rs test harness.
    #[test]
    fn end_to_end() {
        use arma_rs::Result as CbResult;
        let ext = super::init().testing();
        let port = "9899";
        let (out, code) = ext.call("start", Some(vec![port.into()]));
        assert_eq!(code, 0, "{out}");

        let (mut client, _) = tungstenite::connect(format!("ws://127.0.0.1:{port}")).expect("connect");
        let first = client.read().unwrap().into_text().unwrap();
        assert_eq!(first.as_str(), OFFLINE_STATE);

        // SQF pushes a state: string args arrive SQF-quoted.
        let json = r#"{"type":"state","v":1,"inGame":true,"sw":{"present":true,"radio":"TFAR_anprc152_1","channel":3,"additionalChannel":null,"frequencies":["1","2","3","4","5","6","7","8"]}}"#;
        let quoted = format!("\"{}\"", json.replace('"', "\"\""));
        let (out, code) = ext.call("state", Some(vec![quoted]));
        assert_eq!((out.as_str(), code), ("ok", 0));
        let pushed = client.read().unwrap().into_text().unwrap();
        assert_eq!(pushed.as_str(), json);

        // Invalid state is rejected.
        let (_, code) = ext.call("state", Some(vec!["\"nope\"".into()]));
        assert_ne!(code, 0);

        // Plugin command becomes an ExtensionCallback.
        client
            .send(Message::text(r#"{"type":"setChannel","v":1,"radio":"sw","channel":5}"#))
            .unwrap();
        let got = ext.callback_handler(
            |name, func, data| {
                if name == CALLBACK_NAME && func == "setChannel" {
                    CbResult::<Option<String>, ()>::Ok(data.map(|d| d.to_string()))
                } else {
                    CbResult::Continue
                }
            },
            Duration::from_secs(2),
        );
        match got {
            CbResult::Ok(Some(d)) => assert_eq!(d, r#"["sw",5]"#),
            _ => panic!("no setChannel callback"),
        }

        assert!(ext.call("status", None).0.starts_with("running:9899:"));
        assert_eq!(ext.call("stop", None).0, "stopped");
        assert_eq!(ext.call("status", None).0, "stopped");
    }
}
