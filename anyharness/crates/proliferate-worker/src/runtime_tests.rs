//! The real heartbeat → decoded verdict → snapshot-gate choreography (REL-10).
//!
//! These tests drive the actual private `runtime::heartbeat_and_converge` call
//! path — not `model_snapshot_sync::maybe_sync` directly — so the join under
//! proof is the one production runs: a genuine `POST /v1/cloud/worker/heartbeat`
//! against an instrumented cloud listener, a genuine Serde decode of the body,
//! the genuine acknowledgement event, and the genuine admission gate.
//!
//! Three independent cases, each with a fresh trace collector, fresh sync state,
//! fresh store, and fresh listeners:
//!
//! - `modelSnapshotUploadAllowed: false` — normal tick, zero snapshot work;
//! - the field omitted (an old server) — identical outcome, by default-false; and
//! - `true` — the acknowledgement precedes list/status/upload and the watermark
//!   advances.
//!
//! Snapshot events are classified by tracing TARGET, never by matching one
//! current message, so renaming or adding an "expected skip" warning cannot slip
//! past the silence assertions.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tracing::field::{Field, Visit};
use tracing::Level;
use tracing_subscriber::layer::{Context, Layer};
use tracing_subscriber::prelude::*;

use super::{heartbeat_and_converge, TickControl};
use crate::{
    cloud_client::CloudClient,
    config::WorkerConfig,
    identity::credentials::WorkerIdentity,
    model_snapshot_sync::{ModelSnapshotSyncState, SNAPSHOT_SYNC_TARGET},
    observability::HEARTBEAT_ACK_TARGET,
    store::WorkerStore,
};

// ── Trace capture, typed ───────────────────────────────────────────────────

/// Field values are kept TYPED: an acknowledgement that logged the verdict as
/// the string `"false"`, or as a hard-coded constant of the wrong type, must not
/// satisfy an assertion written for a real boolean.
#[derive(Debug, Clone, PartialEq)]
#[allow(dead_code)]
enum FieldValue {
    Bool(bool),
    I64(i64),
    U64(u64),
    Str(String),
    Debug(String),
}

impl FieldValue {
    fn text(&self) -> String {
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
#[allow(dead_code)]
struct CapturedEvent {
    level: Level,
    target: String,
    fields: Vec<(String, FieldValue)>,
}

#[allow(dead_code)]
impl CapturedEvent {
    fn message(&self) -> String {
        self.field("message")
            .map(FieldValue::text)
            .unwrap_or_default()
    }

    fn field(&self, name: &str) -> Option<&FieldValue> {
        self.fields
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value)
    }
}

/// One ordered timeline shared by the collector and both listeners. Ordering
/// claims are read off this single sequence rather than reconstructed by
/// comparing separate request tallies against separate log dumps.
#[derive(Debug, Clone)]
#[allow(dead_code)]
enum Step {
    Event(CapturedEvent),
    Request { server: &'static str, line: String },
}

type Timeline = Arc<Mutex<Vec<Step>>>;

fn timeline() -> Timeline {
    Arc::new(Mutex::new(Vec::new()))
}

fn steps(timeline: &Timeline) -> Vec<Step> {
    timeline.lock().unwrap().clone()
}

fn events(timeline: &Timeline) -> Vec<CapturedEvent> {
    steps(timeline)
        .into_iter()
        .filter_map(|step| match step {
            Step::Event(event) => Some(event),
            Step::Request { .. } => None,
        })
        .collect()
}

/// The index in the shared timeline of the first step matching a predicate.
fn position(timeline: &Timeline, mut matches: impl FnMut(&Step) -> bool) -> Option<usize> {
    steps(timeline).iter().position(|step| matches(step))
}

fn is_request_containing(needle: &str) -> impl Fn(&Step) -> bool + '_ {
    move |step| matches!(step, Step::Request { line, .. } if line.contains(needle))
}

struct FieldCollector(Vec<(String, FieldValue)>);

impl Visit for FieldCollector {
    fn record_bool(&mut self, field: &Field, value: bool) {
        self.0
            .push((field.name().to_string(), FieldValue::Bool(value)));
    }
    fn record_i64(&mut self, field: &Field, value: i64) {
        self.0.push((field.name().to_string(), FieldValue::I64(value)));
    }
    fn record_u64(&mut self, field: &Field, value: u64) {
        self.0.push((field.name().to_string(), FieldValue::U64(value)));
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

struct CollectingLayer(Timeline);

impl<S: tracing::Subscriber> Layer<S> for CollectingLayer {
    fn on_event(&self, event: &tracing::Event<'_>, _context: Context<'_, S>) {
        let mut collector = FieldCollector(Vec::new());
        event.record(&mut collector);
        let metadata = event.metadata();
        self.0.lock().unwrap().push(Step::Event(CapturedEvent {
            level: *metadata.level(),
            target: metadata.target().to_string(),
            fields: collector.0,
        }));
    }
}

fn capture(timeline: &Timeline) -> tracing::subscriber::DefaultGuard {
    tracing::subscriber::set_default(
        tracing_subscriber::registry().with(CollectingLayer(timeline.clone())),
    )
}

// ── An instrumented listener that proves an ABSENT request ─────────────────

/// `(method, exact path, status, body)`.
type Route = (&'static str, String, u16, String);

/// A fake HTTP server that answers a routing table for as long as the test wants
/// and records every request. It never pre-commits to a request count, which is
/// exactly what makes "zero snapshot requests arrived" an assertion rather than
/// a hang.
#[allow(dead_code)]
struct InstrumentedServer {
    address: SocketAddr,
    hits: Arc<Mutex<Vec<String>>>,
    stop: Arc<AtomicBool>,
    handle: Option<std::thread::JoinHandle<()>>,
}

#[allow(dead_code)]
impl InstrumentedServer {
    fn spawn(label: &'static str, routes: Vec<Route>, timeline: Timeline) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind instrumented server");
        listener
            .set_nonblocking(true)
            .expect("non-blocking instrumented listener");
        let address = listener.local_addr().expect("instrumented server address");
        let hits: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let thread_hits = Arc::clone(&hits);
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
                timeline
                    .lock()
                    .unwrap()
                    .push(Step::Request { server: label, line });
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
            stop,
            handle: Some(handle),
        }
    }

    /// Stop the accept loop and drain the thread, so a test's request tally is
    /// final rather than racing a late connection.
    fn shutdown(mut self) -> Vec<String> {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(handle) = self.handle.take() {
            handle.join().expect("instrumented server thread");
        }
        self.hits.lock().unwrap().clone()
    }
}

fn request_line(raw: &str) -> (String, String) {
    let mut parts = raw.lines().next().unwrap_or_default().split(' ');
    (
        parts.next().unwrap_or_default().to_string(),
        parts.next().unwrap_or_default().to_string(),
    )
}

// ── Fixtures ───────────────────────────────────────────────────────────────

static COUNTER: AtomicU64 = AtomicU64::new(0);

struct TempDir(std::path::PathBuf);

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn temp_dir() -> TempDir {
    let dir = std::env::temp_dir().join(format!(
        "proliferate-worker-runtime-{}-{}",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("create temp dir");
    TempDir(dir)
}

const PROBED_AT: &str = "2026-07-27T00:00:00Z";
const WORKER_BEARER: &str = "worker-secret-token";

/// A Worker config with every self-managed convergence behavior off, so the tick
/// exercises exactly the heartbeat + snapshot-gate join and nothing else. This
/// mirrors a supervisor-free legacy target with updates disabled.
fn test_config(dir: &TempDir, runtime: SocketAddr, cloud: SocketAddr) -> WorkerConfig {
    WorkerConfig {
        cloud_base_url: format!("http://{cloud}"),
        enrollment_token: None,
        worker_db_path: dir.0.join("worker.sqlite3"),
        integration_gateway_home: None,
        heartbeat_interval_seconds: 30,
        self_update_enabled: false,
        anyharness_update_enabled: false,
        anyharness_binary_path: None,
        anyharness_launcher_path: None,
        anyharness_workdir: None,
        runtime_base_url: format!("http://{runtime}"),
        runtime_bearer_token: None,
        supervisor_update_request_dir: None,
        supervisor_binary_path: None,
        supervisor_config_path: None,
        supervisor_config_toml: None,
        supervisor_bridge_marker_dir: None,
        config_path: None,
    }
}

fn heartbeat_body(capability: Option<bool>) -> String {
    let mut body = serde_json::json!({
        "workerId": "worker-1",
        "serverTime": "2026-08-18T00:00:00Z",
        "heartbeatIntervalSeconds": 30,
        "desiredVersions": {"worker": null, "anyharness": null},
        "desiredTopology": null,
        "supervisorBridge": null
    });
    if let Some(allowed) = capability {
        body["modelSnapshotUploadAllowed"] = serde_json::json!(allowed);
    }
    body.to_string()
}

/// The ordinary non-snapshot work every tick does: the catalog-version poll and
/// the heartbeat itself. Present in all three cases so "zero snapshot work" is
/// distinguishable from "zero work".
fn runtime_routes() -> Vec<Route> {
    vec![
        (
            "GET",
            "/v1/catalogs/agents/version".to_string(),
            200,
            serde_json::json!({"catalogVersion": "2026.08.18-1"}).to_string(),
        ),
        // Deliberately answerable: if the gate leaked, these WOULD succeed, so a
        // zero-hit assertion is about the gate rather than about a broken fake.
        (
            "GET",
            "/v1/agents".to_string(),
            200,
            serde_json::json!([{"kind": "opencode"}]).to_string(),
        ),
        (
            "GET",
            "/v1/agents/opencode/model-snapshot".to_string(),
            200,
            serde_json::json!({
                "agent": "opencode",
                "schemaVersion": 2,
                "probedAt": PROBED_AT,
                "stateRevision": 7,
                "models": [{"id": "m1"}],
                "modes": [{"id": "default"}],
                "warnings": [],
                "lastAttempt": {"at": PROBED_AT, "outcome": "ok"}
            })
            .to_string(),
        ),
    ]
}

fn cloud_routes(capability: Option<bool>) -> Vec<Route> {
    vec![
        (
            "POST",
            "/v1/cloud/worker/heartbeat".to_string(),
            200,
            heartbeat_body(capability),
        ),
        (
            "POST",
            "/v1/cloud/agent-models/opencode/refresh".to_string(),
            200,
            "{}".to_string(),
        ),
    ]
}

const SNAPSHOT_REQUEST_MARKERS: [&str; 3] = [
    "/v1/agents",
    "/v1/agents/opencode/model-snapshot",
    "/v1/cloud/agent-models",
];

fn snapshot_requests(hits: &[String]) -> Vec<String> {
    hits.iter()
        .filter(|line| {
            SNAPSHOT_REQUEST_MARKERS
                .iter()
                .any(|marker| line.contains(marker))
        })
        .cloned()
        .collect()
}

/// One real `heartbeat_and_converge` tick against fresh everything.
struct TickOutcome {
    control: TickControl,
    runtime_hits: Vec<String>,
    cloud_hits: Vec<String>,
    watermark_before: std::collections::HashMap<String, String>,
    watermark_after: std::collections::HashMap<String, String>,
    fuse_after: bool,
}

async fn run_one_tick(capability: Option<bool>, trace: &Timeline) -> TickOutcome {
    let dir = temp_dir();
    let runtime = InstrumentedServer::spawn("runtime", runtime_routes(), trace.clone());
    let cloud_server = InstrumentedServer::spawn("cloud", cloud_routes(capability), trace.clone());
    let config = test_config(&dir, runtime.address, cloud_server.address);
    let store = WorkerStore::open(config.worker_db_path.clone()).expect("open worker store");
    let cloud = CloudClient::new(&config).expect("build cloud client");
    let identity = WorkerIdentity {
        worker_id: "worker-1".to_string(),
        worker_token: WORKER_BEARER.to_string(),
    };
    let state = ModelSnapshotSyncState::new();
    let watermark_before = state.pushed_watermarks();

    let control = heartbeat_and_converge(
        &config, &cloud, &store, &identity, None, &state, false,
    )
    .await;

    TickOutcome {
        control,
        runtime_hits: runtime.shutdown(),
        cloud_hits: cloud_server.shutdown(),
        watermark_before,
        watermark_after: state.pushed_watermarks(),
        fuse_after: state.is_disabled_after_forbidden(),
    }
}

/// The single ordinary acknowledgement, asserted to be the only one.
fn sole_acknowledgement(trace: &Timeline) -> CapturedEvent {
    let acknowledgements: Vec<_> = events(trace)
        .into_iter()
        .filter(|event| {
            event.target == HEARTBEAT_ACK_TARGET
                && event.message() == "cloud heartbeat acknowledged"
        })
        .collect();
    assert_eq!(
        acknowledgements.len(),
        1,
        "exactly one heartbeat acknowledgement per tick: {acknowledgements:?}"
    );
    acknowledgements.into_iter().next().unwrap()
}

/// Every event emitted by the model-snapshot sync owner, found by TARGET so a
/// renamed message cannot hide.
fn snapshot_owner_events(trace: &Timeline) -> Vec<CapturedEvent> {
    events(trace)
        .into_iter()
        .filter(|event| event.target == SNAPSHOT_SYNC_TARGET)
        .collect()
}

/// The shared assertions for the two ineligible cases: normal non-snapshot work,
/// one truthful acknowledgement carrying typed `false`, no second
/// eligibility/skip event anywhere, no snapshot-owner WARN/ERROR at all, zero
/// snapshot requests, and zero snapshot state change.
fn assert_denied_tick(outcome: &TickOutcome, trace: &Timeline) {
    assert_eq!(
        outcome.control,
        TickControl::Continue,
        "an ineligible tick is an ordinary tick, not an exit"
    );
    // Ordinary work still happened.
    assert!(
        outcome
            .runtime_hits
            .iter()
            .any(|line| line == "GET /v1/catalogs/agents/version"),
        "the catalog-version poll still runs: {:?}",
        outcome.runtime_hits
    );
    assert_eq!(
        outcome
            .cloud_hits
            .iter()
            .filter(|line| *line == "POST /v1/cloud/worker/heartbeat")
            .count(),
        1,
        "exactly one heartbeat was sent: {:?}",
        outcome.cloud_hits
    );

    // Zero model-snapshot work.
    assert!(
        snapshot_requests(&outcome.runtime_hits).is_empty(),
        "no local model-snapshot read may happen: {:?}",
        outcome.runtime_hits
    );
    assert!(
        snapshot_requests(&outcome.cloud_hits).is_empty(),
        "no cloud ingest request may happen: {:?}",
        outcome.cloud_hits
    );

    // Zero model-snapshot state change.
    assert_eq!(
        outcome.watermark_after, outcome.watermark_before,
        "the watermark map must be byte-identical before and after"
    );
    assert!(!outcome.fuse_after, "the process fuse stays clear");

    // Exactly one truthful acknowledgement, carrying a real boolean `false`.
    let acknowledgement = sole_acknowledgement(trace);
    assert_eq!(
        acknowledgement.field("model_snapshot_upload_allowed"),
        Some(&FieldValue::Bool(false)),
        "the acknowledgement must carry the typed verdict: {acknowledgement:?}"
    );

    // No second eligibility/skip event at ANY level, and no snapshot-owner
    // WARN/ERROR regardless of message text.
    let owner_events = snapshot_owner_events(trace);
    assert!(
        owner_events.is_empty(),
        "the snapshot owner must be completely silent on an expected denial: {owner_events:?}"
    );
    let eligibility_chatter: Vec<_> = events(trace)
        .into_iter()
        .filter(|event| {
            event.field("model_snapshot_upload_allowed").is_some()
                || event.message().to_lowercase().contains("snapshot")
        })
        .collect();
    assert_eq!(
        eligibility_chatter.len(),
        1,
        "the acknowledgement is the ONLY event that mentions eligibility: {eligibility_chatter:?}"
    );
}

// ── Case 1: an explicit false verdict ──────────────────────────────────────

#[tokio::test]
async fn a_false_verdict_performs_normal_work_and_zero_snapshot_work() {
    let trace = timeline();
    let _guard = capture(&trace);
    let outcome = run_one_tick(Some(false), &trace).await;
    assert_denied_tick(&outcome, &trace);
}

// ── Case 2: a legacy server that omits the field ───────────────────────────

#[tokio::test]
async fn an_omitted_verdict_is_indistinguishable_from_an_explicit_false() {
    // Old server + new Worker. The Serde default is what makes this fail closed,
    // and this is the proof that the default reaches the gate through the real
    // decode rather than only through a unit test of the type.
    let trace = timeline();
    let _guard = capture(&trace);
    let outcome = run_one_tick(None, &trace).await;
    assert_denied_tick(&outcome, &trace);
}

// ── Case 3: a true verdict ─────────────────────────────────────────────────

#[tokio::test]
async fn a_true_verdict_acknowledges_before_listing_reading_and_uploading() {
    let trace = timeline();
    let _guard = capture(&trace);
    let outcome = run_one_tick(Some(true), &trace).await;

    assert_eq!(outcome.control, TickControl::Continue);

    // The full eligible choreography really ran.
    assert!(
        outcome.runtime_hits.contains(&"GET /v1/agents".to_string()),
        "the eligible tick lists local harnesses: {:?}",
        outcome.runtime_hits
    );
    assert!(
        outcome
            .runtime_hits
            .contains(&"GET /v1/agents/opencode/model-snapshot".to_string()),
        "the eligible tick reads the harness status: {:?}",
        outcome.runtime_hits
    );
    assert!(
        outcome
            .cloud_hits
            .contains(&"POST /v1/cloud/agent-models/opencode/refresh".to_string()),
        "the eligible tick uploads the changed document: {:?}",
        outcome.cloud_hits
    );

    // Exactly one acknowledgement, carrying a real boolean `true`.
    let acknowledgement = sole_acknowledgement(&trace);
    assert_eq!(
        acknowledgement.field("model_snapshot_upload_allowed"),
        Some(&FieldValue::Bool(true)),
        "the acknowledgement must carry the typed TRUE verdict, not a constant"
    );

    // Ordering read off the ONE captured sequence: the acknowledgement exists
    // before the first snapshot request, so the gate really consumed this tick's
    // verdict rather than a stale or defaulted one.
    let ack_index = position(&trace, |step| {
        matches!(step, Step::Event(event)
            if event.target == HEARTBEAT_ACK_TARGET
                && event.message() == "cloud heartbeat acknowledged")
    })
    .expect("acknowledgement is in the timeline");
    let list_index =
        position(&trace, is_request_containing("GET /v1/agents")).expect("list is in the timeline");
    let status_index = position(&trace, is_request_containing("model-snapshot"))
        .expect("status read is in the timeline");
    let upload_index = position(&trace, is_request_containing("/v1/cloud/agent-models"))
        .expect("upload is in the timeline");
    assert!(
        ack_index < list_index,
        "the verdict must be acknowledged before the local list: {ack_index} !< {list_index}"
    );
    assert!(list_index < status_index && status_index < upload_index);

    // The successful upload advanced the watermark; the fuse stayed clear.
    assert_eq!(
        outcome.watermark_after.get("opencode"),
        Some(&PROBED_AT.to_string()),
        "a successful eligible upload advances the expected watermark"
    );
    assert!(outcome.watermark_before.is_empty());
    assert!(!outcome.fuse_after, "a success never trips the fuse");

    // No anomaly on the happy path.
    let owner_warnings: Vec<_> = snapshot_owner_events(&trace)
        .into_iter()
        .filter(|event| event.level == Level::WARN || event.level == Level::ERROR)
        .collect();
    assert!(
        owner_warnings.is_empty(),
        "an eligible success emits no snapshot warning or error: {owner_warnings:?}"
    );
}
