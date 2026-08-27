//! Shared test scaffolding for the Worker's behavioural tests.
//!
//! Two kinds of proof need the same two instruments, so they live here once
//! instead of being duplicated per test module:
//!
//! - a `tracing` collector that keeps field values TYPED, so a boolean logged as
//!   the string `"false"` or as a constant of the wrong type cannot satisfy an
//!   assertion written for a real boolean; and
//! - an instrumented HTTP listener that answers a routing table for as long as a
//!   test wants, recording every request and every accepted connection, and that
//!   stops on a flag rather than on a request. Stopping without needing one more
//!   connection is what makes "zero requests arrived" an assertion instead of a
//!   hang.
//!
//! Both feed ONE ordered timeline, so a claim like "the acknowledgement happened
//! before the first request" is read off a single captured sequence rather than
//! reconstructed by comparing separate tallies after the fact.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::config::WorkerConfig;
use tracing::field::{Field, Visit};
use tracing::Level;
use tracing_subscriber::layer::{Context, Layer};
use tracing_subscriber::prelude::*;

// ── Trace capture, typed ───────────────────────────────────────────────────

/// A captured field value, kept TYPED so a boolean logged as the string
/// `"false"`, or a constant of the wrong type, cannot satisfy an assertion meant
/// for a real boolean.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum FieldValue {
    Bool(bool),
    I64(i64),
    U64(u64),
    Str(String),
    /// `?value` / `%value` / the event message all arrive as Debug renderings.
    Debug(String),
}

impl FieldValue {
    pub(crate) fn text(&self) -> String {
        match self {
            FieldValue::Bool(value) => value.to_string(),
            FieldValue::I64(value) => value.to_string(),
            FieldValue::U64(value) => value.to_string(),
            FieldValue::Str(value) => value.clone(),
            FieldValue::Debug(value) => value.clone(),
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct CapturedEvent {
    pub(crate) level: Level,
    pub(crate) target: String,
    pub(crate) fields: Vec<(String, FieldValue)>,
    /// What the installed latch probe read at the instant this event was
    /// captured, when a probe was installed. This is how "the state was already
    /// set BEFORE the log line" becomes behavioural rather than source-inspected.
    pub(crate) latch_at_capture: Option<bool>,
}

impl CapturedEvent {
    pub(crate) fn message(&self) -> String {
        self.field("message")
            .map(FieldValue::text)
            .unwrap_or_default()
    }

    pub(crate) fn field(&self, name: &str) -> Option<&FieldValue> {
        self.fields
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value)
    }

    pub(crate) fn has_field(&self, name: &str) -> bool {
        self.field(name).is_some()
    }

    /// Every byte this event could put in front of an operator: target, level,
    /// field names, and rendered field values. The privacy proof scans this.
    pub(crate) fn rendered(&self) -> String {
        let mut rendered = format!("{} {:?}", self.target, self.level);
        for (key, value) in &self.fields {
            rendered.push(' ');
            rendered.push_str(key);
            rendered.push('=');
            rendered.push_str(&value.text());
        }
        rendered
    }
}

/// One ordered timeline shared by the trace collector and the fake listeners.
#[derive(Debug, Clone)]
pub(crate) enum Step {
    Event(CapturedEvent),
    Request {
        /// Which listener answered. Read through the derived `Debug` when an
        /// assertion prints the timeline, which the dead-code lint cannot see.
        #[allow(dead_code)]
        server: &'static str,
        line: String,
    },
}

pub(crate) type Timeline = Arc<Mutex<Vec<Step>>>;

/// Read some piece of process state at the moment an event is captured.
pub(crate) type LatchProbe = Arc<dyn Fn() -> bool + Send + Sync>;

pub(crate) fn timeline() -> Timeline {
    Arc::new(Mutex::new(Vec::new()))
}

pub(crate) fn steps(timeline: &Timeline) -> Vec<Step> {
    timeline.lock().unwrap().clone()
}

pub(crate) fn events(timeline: &Timeline) -> Vec<CapturedEvent> {
    steps(timeline)
        .into_iter()
        .filter_map(|step| match step {
            Step::Event(event) => Some(event),
            Step::Request { .. } => None,
        })
        .collect()
}

/// The index in the shared timeline of the first step matching a predicate.
pub(crate) fn position(
    timeline: &Timeline,
    mut matches: impl FnMut(&Step) -> bool,
) -> Option<usize> {
    steps(timeline).iter().position(matches)
}

pub(crate) fn is_request_containing(needle: &str) -> impl Fn(&Step) -> bool + '_ {
    move |step| matches!(step, Step::Request { line, .. } if line.contains(needle))
}

struct FieldCollector(Vec<(String, FieldValue)>);

impl Visit for FieldCollector {
    fn record_bool(&mut self, field: &Field, value: bool) {
        self.0
            .push((field.name().to_string(), FieldValue::Bool(value)));
    }
    fn record_i64(&mut self, field: &Field, value: i64) {
        self.0
            .push((field.name().to_string(), FieldValue::I64(value)));
    }
    fn record_u64(&mut self, field: &Field, value: u64) {
        self.0
            .push((field.name().to_string(), FieldValue::U64(value)));
    }
    fn record_str(&mut self, field: &Field, value: &str) {
        self.0
            .push((field.name().to_string(), FieldValue::Str(value.to_string())));
    }
    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        self.0.push((
            field.name().to_string(),
            FieldValue::Debug(format!("{value:?}")),
        ));
    }
}

struct CollectingLayer {
    timeline: Timeline,
    probe: Option<LatchProbe>,
}

impl<S: tracing::Subscriber> Layer<S> for CollectingLayer {
    fn on_event(&self, event: &tracing::Event<'_>, _context: Context<'_, S>) {
        let mut collector = FieldCollector(Vec::new());
        event.record(&mut collector);
        let metadata = event.metadata();
        // Read the probed state HERE, inside the emit path, so ordering between
        // the state change and the log line is observed rather than assumed.
        let latch_at_capture = self.probe.as_ref().map(|probe| probe());
        self.timeline
            .lock()
            .unwrap()
            .push(Step::Event(CapturedEvent {
                level: *metadata.level(),
                target: metadata.target().to_string(),
                fields: collector.0,
                latch_at_capture,
            }));
    }
}

/// Install the collector for THIS test thread only. `#[tokio::test]` uses a
/// current-thread runtime, so every future polled inside the guard's lifetime
/// emits into this timeline and no other test's.
pub(crate) fn capture(timeline: &Timeline) -> tracing::subscriber::DefaultGuard {
    install(timeline, None)
}

/// Like [`capture`], but each captured event also records what `probe` read at
/// the instant of capture.
pub(crate) fn capture_with_latch_probe(
    timeline: &Timeline,
    probe: LatchProbe,
) -> tracing::subscriber::DefaultGuard {
    install(timeline, Some(probe))
}

fn install(timeline: &Timeline, probe: Option<LatchProbe>) -> tracing::subscriber::DefaultGuard {
    tracing::subscriber::set_default(tracing_subscriber::registry().with(CollectingLayer {
        timeline: timeline.clone(),
        probe,
    }))
}

// ── An instrumented listener that proves an ABSENT request ─────────────────

/// `(method, exact path, status, body)`.
pub(crate) type Route = (&'static str, String, u16, String);

/// A fake HTTP server that answers a routing table for as long as the test wants
/// and records every request. It never pre-commits to a request count, which is
/// what makes "zero requests arrived" an assertion rather than a hang.
pub(crate) struct InstrumentedServer {
    pub(crate) address: SocketAddr,
    hits: Arc<Mutex<Vec<String>>>,
    accepted: Arc<AtomicU64>,
    stop: Arc<AtomicBool>,
    handle: Mutex<Option<std::thread::JoinHandle<()>>>,
}

impl InstrumentedServer {
    pub(crate) fn spawn(label: &'static str, routes: Vec<Route>, timeline: Timeline) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind instrumented server");
        listener
            .set_nonblocking(true)
            .expect("non-blocking instrumented listener");
        let address = listener.local_addr().expect("instrumented server address");
        let hits: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let thread_hits = Arc::clone(&hits);
        let accepted = Arc::new(AtomicU64::new(0));
        let thread_accepted = Arc::clone(&accepted);
        let stop = Arc::new(AtomicBool::new(false));
        let thread_stop = Arc::clone(&stop);
        let handle = std::thread::spawn(move || {
            // A polled accept loop, never a blocking one: the only way a test
            // can prove "no request arrived" is if stopping the server never
            // depends on a request arriving.
            loop {
                if thread_stop.load(Ordering::SeqCst) {
                    break;
                }
                let mut stream = match listener.accept() {
                    Ok((stream, _)) => stream,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(2));
                        continue;
                    }
                    Err(_) => break,
                };
                // Counted before the read, so a connection that is accepted but
                // never readable still shows up and cannot let a
                // zero-request assertion pass by accident.
                thread_accepted.fetch_add(1, Ordering::SeqCst);
                stream
                    .set_nonblocking(false)
                    .expect("blocking accepted stream");
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .expect("accepted stream read timeout");
                let mut buffer = vec![0u8; 262_144];
                let read = match stream.read(&mut buffer) {
                    Ok(0) => continue,
                    Ok(read) => read,
                    Err(_) => continue,
                };
                let raw = String::from_utf8_lossy(&buffer[..read]).to_string();
                let (method, path) = request_line(&raw);
                let line = format!("{method} {path}");
                thread_hits.lock().unwrap().push(line.clone());
                timeline.lock().unwrap().push(Step::Request {
                    server: label,
                    line,
                });
                let (status, body) = routes
                    .iter()
                    .find(|(route_method, route_path, _, _)| {
                        *route_method == method && *route_path == path
                    })
                    .map(|(_, _, status, body)| (*status, body.clone()))
                    .unwrap_or((404, "{}".to_string()));
                let _ = write!(
                    stream,
                    "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
            }
        });
        Self {
            address,
            hits,
            accepted,
            stop,
            handle: Mutex::new(Some(handle)),
        }
    }

    pub(crate) fn hits(&self) -> Vec<String> {
        self.hits.lock().unwrap().clone()
    }

    /// Connections accepted, whether or not a request could be read off them.
    /// Read this after [`Self::drain`] so the tally is final. A zero-request
    /// claim should assert on BOTH this and [`Self::hits`]: a connection that is
    /// accepted but never readable produces no hit, so hits alone would let such
    /// a contact pass unnoticed.
    pub(crate) fn accepted_count(&self) -> u64 {
        self.accepted.load(Ordering::SeqCst)
    }

    /// Stop the accept loop and join the thread, leaving both tallies final and
    /// still readable. Idempotent.
    pub(crate) fn drain(&self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(handle) = self.handle.lock().unwrap().take() {
            handle.join().expect("instrumented server thread");
        }
    }

    /// Stop the accept loop and drain the thread, so a test's request tally is
    /// final rather than racing a late connection.
    pub(crate) fn shutdown(self) -> Vec<String> {
        self.drain();
        self.hits()
    }
}

pub(crate) fn request_line(raw: &str) -> (String, String) {
    let mut parts = raw.lines().next().unwrap_or_default().split(' ');
    (
        parts.next().unwrap_or_default().to_string(),
        parts.next().unwrap_or_default().to_string(),
    )
}

// ── Shared JSON fixtures ───────────────────────────────────────────────────

pub(crate) fn agents_list(kinds: &[&str]) -> String {
    serde_json::Value::Array(
        kinds
            .iter()
            .map(|kind| serde_json::json!({ "kind": kind }))
            .collect(),
    )
    .to_string()
}

pub(crate) fn status_json_for(agent: &str, probed_at: &str) -> String {
    serde_json::json!({
        "agent": agent,
        "schemaVersion": 2,
        "probedAt": probed_at,
        "stateRevision": 7,
        "models": [{"id": "m1"}],
        "modes": [{"id": "default"}],
        "warnings": [],
        "lastAttempt": {"at": probed_at, "outcome": "ok"}
    })
    .to_string()
}

// ── Shared Worker config fixtures ──────────────────────────────────────────

/// A Worker config with no mailbox dir: heartbeat + sync only, no convergence.
pub(crate) fn minimal_config() -> WorkerConfig {
    WorkerConfig {
        cloud_base_url: "https://cloud.test".to_string(),
        enrollment_token: None,
        worker_db_path: "/tmp/worker.sqlite3".into(),
        integration_gateway_home: None,
        heartbeat_interval_seconds: 30,
        runtime_base_url: "http://127.0.0.1:8457".to_string(),
        runtime_bearer_token: None,
        supervisor_update_request_dir: None,
        config_path: None,
    }
}

pub(crate) fn cloud_config_for(
    runtime_addr: std::net::SocketAddr,
    cloud_addr: std::net::SocketAddr,
) -> WorkerConfig {
    let mut config = minimal_config();
    config.cloud_base_url = format!("http://{cloud_addr}");
    config.runtime_base_url = format!("http://{runtime_addr}");
    config
}
