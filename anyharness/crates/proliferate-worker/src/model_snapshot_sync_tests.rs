use super::*;
use std::io::{Read, Write};
use std::net::TcpListener;

fn status(probed_at: Option<&str>) -> RuntimeModelSnapshotStatus {
    RuntimeModelSnapshotStatus {
        agent: Some("opencode".to_string()),
        schema_version: Some(2),
        probed_at: probed_at.map(str::to_string),
        attestation: None,
        install_identity: Some(serde_json::json!({"role": "agent_process", "source": "pinned_archive"})),
        state_revision: Some(7),
        models: vec![serde_json::json!({"id": "m1"})],
        modes: vec![serde_json::json!({"id": "default", "name": "Default"})],
        warnings: Vec::new(),
        last_attempt: Some(serde_json::json!({"at": "2026-07-27T00:00:00Z", "outcome": "ok"})),
    }
}

// ── plan_push: pure decision tests ────────────────────────────────

#[test]
fn plan_push_uploads_when_probed_at_advances() {
    let mut last_pushed = HashMap::new();
    last_pushed.insert("opencode".to_string(), "2026-07-26T00:00:00Z".to_string());
    let push = plan_push(
        "opencode",
        &status(Some("2026-07-27T00:00:00Z")),
        &last_pushed,
    )
    .expect("a changed probedAt must push");
    assert_eq!(push.harness_kind, "opencode");
    assert_eq!(push.probed_at, "2026-07-27T00:00:00Z");
    // The uploaded payload is the machine document's wire shape: one composed
    // observation with its provenance fields, no entries map and no context.
    let document: serde_json::Value =
        serde_json::from_str(&push.snapshot_json).expect("valid json");
    assert_eq!(document["schemaVersion"], serde_json::json!(2));
    assert_eq!(document["agent"], serde_json::json!("opencode"));
    assert_eq!(document["stateRevision"], serde_json::json!(7));
    assert_eq!(document["models"][0]["id"], serde_json::json!("m1"));
    assert!(document.get("entries").is_none());
    assert!(!push.snapshot_json.contains("authContextId"));
    assert!(!push.snapshot_json.contains("authFingerprint"));
}

#[test]
fn plan_push_does_not_repush_unchanged_probed_at() {
    let mut last_pushed = HashMap::new();
    last_pushed.insert("opencode".to_string(), "2026-07-27T00:00:00Z".to_string());
    assert!(
        plan_push(
            "opencode",
            &status(Some("2026-07-27T00:00:00Z")),
            &last_pushed
        )
        .is_none(),
        "unchanged probedAt must not re-push"
    );
}

#[test]
fn plan_push_skips_a_harness_with_no_observation_yet() {
    assert!(
        plan_push("opencode", &status(None), &HashMap::new()).is_none(),
        "no probedAt means no observation to upload"
    );
}

#[test]
fn plan_push_treats_each_harness_independently() {
    let mut last_pushed = HashMap::new();
    // Same probedAt, but recorded under a DIFFERENT harness — must not
    // suppress this harness's push.
    last_pushed.insert("grok".to_string(), "2026-07-27T00:00:00Z".to_string());
    assert!(plan_push(
        "opencode",
        &status(Some("2026-07-27T00:00:00Z")),
        &last_pushed
    )
    .is_some());
}

// ── resolve_runtime_bearer_token ─────────────────────────────────────

fn minimal_config() -> WorkerConfig {
    WorkerConfig {
        cloud_base_url: "https://cloud.test".to_string(),
        enrollment_token: None,
        worker_db_path: "/tmp/worker.sqlite3".into(),
        integration_gateway_home: None,
        heartbeat_interval_seconds: 30,
        self_update_enabled: false,
        anyharness_update_enabled: false,
        anyharness_binary_path: None,
        anyharness_launcher_path: None,
        anyharness_workdir: None,
        runtime_base_url: "http://127.0.0.1:8457".to_string(),
        runtime_bearer_token: None,
        supervisor_update_request_dir: None,
        supervisor_binary_path: None,
        supervisor_config_path: None,
        supervisor_config_toml: None,
        supervisor_bridge_marker_dir: None,
        config_path: None,
    }
}

#[test]
fn resolve_runtime_bearer_token_prefers_config_over_env() {
    let mut config = minimal_config();
    config.runtime_bearer_token = Some("from-config".to_string());
    assert_eq!(
        resolve_runtime_bearer_token(&config),
        Some("from-config".to_string())
    );
}

#[test]
fn resolve_runtime_bearer_token_falls_back_to_env() {
    let config = minimal_config();
    std::env::remove_var("ANYHARNESS_BEARER_TOKEN");
    assert_eq!(resolve_runtime_bearer_token(&config), None);
}

// ── Integration: fake HTTP servers for the runtime + the cloud ──────

struct CapturedRequest {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: String,
}

fn parse_request(raw: &str) -> CapturedRequest {
    let mut parts = raw.splitn(2, "\r\n\r\n");
    let head = parts.next().unwrap_or_default();
    let body = parts
        .next()
        .unwrap_or_default()
        .trim_end_matches('\0')
        .to_string();
    let mut lines = head.lines();
    let request_line = lines.next().unwrap_or_default();
    let mut request_parts = request_line.split(' ');
    let method = request_parts.next().unwrap_or_default().to_string();
    let path = request_parts.next().unwrap_or_default().to_string();
    let mut headers = HashMap::new();
    for line in lines {
        if let Some((key, value)) = line.split_once(':') {
            headers.insert(key.trim().to_lowercase(), value.trim().to_string());
        }
    }
    CapturedRequest {
        method,
        path,
        headers,
        body,
    }
}

/// Accept exactly `responses.len()` connections in order, one response
/// per connection, and return every captured request. Mirrors the
/// hand-rolled `TcpListener` pattern in
/// `anyharness-lib`'s `installer/downloads_tests.rs` — this crate has no
/// HTTP-mocking dependency.
fn spawn_fake_server(
    responses: Vec<(u16, &'static str, String)>,
) -> (
    std::net::SocketAddr,
    std::thread::JoinHandle<Vec<CapturedRequest>>,
) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind fake server");
    let address = listener.local_addr().expect("fake server address");
    let handle = std::thread::spawn(move || {
        let mut captured = Vec::new();
        for (status, reason, body) in responses {
            let (mut stream, _) = listener.accept().expect("accept request");
            let mut buffer = vec![0u8; 65536];
            let read = stream.read(&mut buffer).expect("read request");
            let raw = String::from_utf8_lossy(&buffer[..read]).to_string();
            captured.push(parse_request(&raw));
            write!(
                stream,
                "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .expect("write response");
        }
        captured
    });
    (address, handle)
}

fn runtime_responses(
    harness_kind: &str,
    status_json: String,
) -> Vec<(u16, &'static str, String)> {
    vec![
        (
            200,
            "OK",
            serde_json::json!([{ "kind": harness_kind }]).to_string(),
        ),
        (200, "OK", status_json),
    ]
}

fn observed_status_json() -> String {
    serde_json::json!({
        "agent": "opencode",
        "schemaVersion": 2,
        "probeEngine": "owner",
        "state": "idle",
        "probedAt": "2026-07-27T00:00:00Z",
        "stateRevision": 7,
        "models": [{"id": "m1"}],
        "modes": [{"id": "default", "name": "Default"}],
        "warnings": [],
        "lastAttempt": {"at": "2026-07-27T00:00:00Z", "outcome": "ok"}
    })
    .to_string()
}

fn cloud_config_for(
    runtime_addr: std::net::SocketAddr,
    cloud_addr: std::net::SocketAddr,
) -> WorkerConfig {
    let mut config = minimal_config();
    config.cloud_base_url = format!("http://{cloud_addr}");
    config.runtime_base_url = format!("http://{runtime_addr}");
    config
}

#[tokio::test]
async fn maybe_sync_uploads_a_changed_document_with_the_workers_bearer() {
    let (runtime_addr, runtime_handle) =
        spawn_fake_server(runtime_responses("opencode", observed_status_json()));
    let (cloud_addr, cloud_handle) = spawn_fake_server(vec![(
        200,
        "OK",
        serde_json::json!({"ok": true}).to_string(),
    )]);

    let config = cloud_config_for(runtime_addr, cloud_addr);
    let cloud = CloudClient::new(&config).expect("build cloud client");
    let state = ModelSnapshotSyncState::new();

    maybe_sync(true, &config, &cloud, "worker-secret-token", &state).await;

    let runtime_requests = runtime_handle.join().expect("runtime server thread");
    assert_eq!(runtime_requests[0].path, "/v1/agents");
    assert_eq!(
        runtime_requests[1].path,
        "/v1/agents/opencode/model-snapshot"
    );

    let cloud_requests = cloud_handle.join().expect("cloud server thread");
    assert_eq!(cloud_requests.len(), 1, "exactly one document changed");
    let push = &cloud_requests[0];
    assert_eq!(push.method, "POST");
    assert_eq!(push.path, "/v1/cloud/agent-models/opencode/refresh");
    assert_eq!(
        push.headers.get("authorization").map(String::as_str),
        Some("Bearer worker-secret-token"),
        "the worker's own bearer must authenticate the cloud upload"
    );
    assert!(push.body.contains("\"probedAt\":\"2026-07-27T00:00:00Z\""));
    assert!(
        !push.body.contains("authContextId"),
        "the composed upload carries no context key"
    );

    // Success is recorded, so an identical status next tick would not
    // re-push (verified against the pure decision fn directly).
    let recorded = state.snapshot();
    assert_eq!(
        recorded.get("opencode"),
        Some(&"2026-07-27T00:00:00Z".to_string())
    );
}

#[tokio::test]
async fn maybe_sync_does_not_wedge_on_a_cloud_error_and_leaves_the_push_pending() {
    let (runtime_addr, runtime_handle) =
        spawn_fake_server(runtime_responses("opencode", observed_status_json()));
    let (cloud_addr, cloud_handle) = spawn_fake_server(vec![(
        500,
        "Internal Server Error",
        serde_json::json!({"error": "boom"}).to_string(),
    )]);

    let config = cloud_config_for(runtime_addr, cloud_addr);
    let cloud = CloudClient::new(&config).expect("build cloud client");
    let state = ModelSnapshotSyncState::new();

    // Must return normally — never panic, never propagate an error.
    maybe_sync(true, &config, &cloud, "worker-secret-token", &state).await;

    runtime_handle.join().expect("runtime server thread");
    let cloud_requests = cloud_handle.join().expect("cloud server thread");
    assert_eq!(cloud_requests.len(), 1, "the push was attempted");

    // Not recorded on failure, so the next tick's plan_push sees the
    // same document as still needing an upload.
    let recorded = state.snapshot();
    assert!(
        recorded.is_empty(),
        "a failed push must not be recorded as pushed"
    );
    let retry = plan_push("opencode", &status(Some("2026-07-27T00:00:00Z")), &recorded);
    assert!(retry.is_some(), "the next tick must retry the failed push");
}

// ═══════════════════════════════════════════════════════════════════════════
// REL-10: server-decided eligibility, the process-lifetime 403 fuse, and the
// bounded one-WARN privacy contract.
//
// Everything below observes REQUESTS and CAPTURED EVENTS rather than inferring
// behavior from `maybe_sync`'s `()` return or from a latch transition. Each case
// owns a fresh sync state and a fresh trace collector, so no proof can borrow
// another's fuse or events.
// ═══════════════════════════════════════════════════════════════════════════

use std::net::SocketAddr;
use std::sync::Arc;
use tracing::field::{Field, Visit};
use tracing::Level;
use tracing_subscriber::layer::{Context, Layer};
use tracing_subscriber::prelude::*;

// ── Trace capture ──────────────────────────────────────────────────────────

/// A captured field value, kept TYPED so a boolean logged as the string
/// `"false"`, or a constant, cannot satisfy an assertion meant for a real
/// boolean.
#[derive(Debug, Clone, PartialEq)]
#[allow(dead_code)]
enum FieldValue {
    Bool(bool),
    I64(i64),
    U64(u64),
    Str(String),
    /// `?value` / `%value` / the event message all arrive as Debug renderings.
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
        self.field("message").map(FieldValue::text).unwrap_or_default()
    }

    fn field(&self, name: &str) -> Option<&FieldValue> {
        self.fields
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value)
    }

    fn has_field(&self, name: &str) -> bool {
        self.field(name).is_some()
    }

    /// Every byte this event could put in front of an operator: target, level,
    /// field names, and rendered field values. The privacy proof scans this.
    fn rendered(&self) -> String {
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

/// One ordered timeline shared by the trace collector and the fake servers, so
/// "the acknowledgement happened BEFORE the first request" is a single captured
/// sequence rather than two unordered tallies compared after the fact.
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

fn events(timeline: &Timeline) -> Vec<CapturedEvent> {
    timeline
        .lock()
        .unwrap()
        .iter()
        .filter_map(|step| match step {
            Step::Event(event) => Some(event.clone()),
            Step::Request { .. } => None,
        })
        .collect()
}

struct FieldCollector(Vec<(String, FieldValue)>);

impl Visit for FieldCollector {
    fn record_bool(&mut self, field: &Field, value: bool) {
        self.0.push((field.name().to_string(), FieldValue::Bool(value)));
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

/// Install the collector for THIS test thread only. `#[tokio::test]` uses a
/// current-thread runtime, so every future polled inside the guard's lifetime
/// emits into this timeline and no other test's.
fn capture(timeline: &Timeline) -> tracing::subscriber::DefaultGuard {
    tracing::subscriber::set_default(
        tracing_subscriber::registry().with(CollectingLayer(timeline.clone())),
    )
}

// ── An instrumented server that never blocks on an absent request ──────────

/// `(method, exact path, status, body)`.
type Route = (&'static str, String, u16, String);

/// A fake HTTP server that answers a routing table and records every request it
/// received, for as long as the test wants. Unlike `spawn_fake_server`, it does
/// NOT pre-commit to a request count — which is what makes "zero requests
/// arrived" provable instead of a hang.
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
                        std::thread::sleep(std::time::Duration::from_millis(2));
                        continue;
                    }
                    Err(_) => break,
                };
                stream
                    .set_nonblocking(false)
                    .expect("blocking accepted stream");
                stream
                    .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                    .expect("accepted stream read timeout");
                let mut buffer = vec![0u8; 262_144];
                let read = match stream.read(&mut buffer) {
                    Ok(0) => continue,
                    Ok(read) => read,
                    Err(_) => continue,
                };
                let raw = String::from_utf8_lossy(&buffer[..read]).to_string();
                let request = parse_request(&raw);
                let line = format!("{} {}", request.method, request.path);
                thread_hits.lock().unwrap().push(line.clone());
                timeline
                    .lock()
                    .unwrap()
                    .push(Step::Request { server: label, line });
                let (status, body) = routes
                    .iter()
                    .find(|(method, path, _, _)| *method == request.method && *path == request.path)
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

    fn hits(&self) -> Vec<String> {
        self.hits.lock().unwrap().clone()
    }

    fn count(&self, needle: &str) -> usize {
        self.hits()
            .iter()
            .filter(|line| line.contains(needle))
            .count()
    }

    /// Stop the accept loop and drain the thread, so a test's request tally is
    /// final rather than racing a late connection.
    fn shutdown(mut self) -> Vec<String> {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(handle) = self.handle.take() {
            handle.join().expect("instrumented server thread");
        }
        self.hits()
    }
}

fn agents_list(kinds: &[&str]) -> String {
    serde_json::Value::Array(
        kinds
            .iter()
            .map(|kind| serde_json::json!({ "kind": kind }))
            .collect(),
    )
    .to_string()
}

fn status_json_for(agent: &str, probed_at: &str) -> String {
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

// ── The admission gate ─────────────────────────────────────────────────────

#[tokio::test]
async fn a_denied_tick_performs_zero_local_and_cloud_work() {
    // The whole point of REL-10: with the server's verdict false, NOTHING
    // happens — not the local `/v1/agents` list, not a status read, not an
    // upload. Proven by instrumented listeners that would have answered.
    let trace = timeline();
    let _guard = capture(&trace);
    let runtime = InstrumentedServer::spawn(
        "runtime",
        vec![
            ("GET", "/v1/agents".to_string(), 200, agents_list(&["opencode"])),
            (
                "GET",
                "/v1/agents/opencode/model-snapshot".to_string(),
                200,
                status_json_for("opencode", "2026-07-27T00:00:00Z"),
            ),
        ],
        trace.clone(),
    );
    let cloud_server = InstrumentedServer::spawn(
        "cloud",
        vec![(
            "POST",
            "/v1/cloud/agent-models/opencode/refresh".to_string(),
            200,
            "{}".to_string(),
        )],
        trace.clone(),
    );

    let config = cloud_config_for(runtime.address, cloud_server.address);
    let cloud = CloudClient::new(&config).expect("build cloud client");
    let state = ModelSnapshotSyncState::new();
    let before = state.snapshot();

    maybe_sync(false, &config, &cloud, "worker-secret-token", &state).await;

    assert!(
        runtime.shutdown().is_empty(),
        "a denied tick must not touch the local runtime at all"
    );
    assert!(
        cloud_server.shutdown().is_empty(),
        "a denied tick must not reach the cloud"
    );
    assert_eq!(state.snapshot(), before, "the watermark map is untouched");
    assert!(
        !state.is_disabled_after_forbidden(),
        "an expected denial is not a contradiction and must not trip the fuse"
    );
    // Silence: expected ineligibility is not an anomaly, and the heartbeat
    // acknowledgement already carries the verdict.
    let snapshot_events: Vec<_> = events(&trace)
        .into_iter()
        .filter(|event| event.target == SNAPSHOT_SYNC_TARGET)
        .collect();
    assert!(
        snapshot_events.is_empty(),
        "a denied tick must emit no snapshot event at any level: {snapshot_events:?}"
    );
}

#[tokio::test]
async fn an_allowed_tick_still_lists_reads_uploads_and_advances_the_watermark() {
    // The eligible path is unchanged by REL-10 — the invariant that keeps cloud
    // sync working, asserted through the same instrumented listeners.
    let trace = timeline();
    let _guard = capture(&trace);
    let runtime = InstrumentedServer::spawn(
        "runtime",
        vec![
            ("GET", "/v1/agents".to_string(), 200, agents_list(&["opencode"])),
            (
                "GET",
                "/v1/agents/opencode/model-snapshot".to_string(),
                200,
                status_json_for("opencode", "2026-07-27T00:00:00Z"),
            ),
        ],
        trace.clone(),
    );
    let cloud_server = InstrumentedServer::spawn(
        "cloud",
        vec![(
            "POST",
            "/v1/cloud/agent-models/opencode/refresh".to_string(),
            200,
            "{}".to_string(),
        )],
        trace.clone(),
    );
    let config = cloud_config_for(runtime.address, cloud_server.address);
    let cloud = CloudClient::new(&config).expect("build cloud client");
    let state = ModelSnapshotSyncState::new();

    maybe_sync(true, &config, &cloud, "worker-secret-token", &state).await;

    assert_eq!(
        runtime.shutdown(),
        vec![
            "GET /v1/agents".to_string(),
            "GET /v1/agents/opencode/model-snapshot".to_string(),
        ],
        "list then status, in that order"
    );
    assert_eq!(
        cloud_server.shutdown(),
        vec!["POST /v1/cloud/agent-models/opencode/refresh".to_string()],
        "exactly one authenticated upload"
    );
    assert_eq!(
        state.snapshot().get("opencode"),
        Some(&"2026-07-27T00:00:00Z".to_string()),
        "a successful upload advances the watermark"
    );
    assert!(!state.is_disabled_after_forbidden());
}

#[tokio::test]
async fn a_tripped_fuse_denies_a_later_allowed_tick() {
    // Capability `true` on a later heartbeat cannot revive a fused process: only
    // a restart can, and that is deliberate.
    let trace = timeline();
    let _guard = capture(&trace);
    let runtime = InstrumentedServer::spawn(
        "runtime",
        vec![("GET", "/v1/agents".to_string(), 200, agents_list(&["opencode"]))],
        trace.clone(),
    );
    let cloud_server = InstrumentedServer::spawn("cloud", vec![], trace.clone());
    let config = cloud_config_for(runtime.address, cloud_server.address);
    let cloud = CloudClient::new(&config).expect("build cloud client");
    let state = ModelSnapshotSyncState::new();
    assert!(state.trip_disabled_after_forbidden(), "first trip wins");

    maybe_sync(true, &config, &cloud, "worker-secret-token", &state).await;

    assert!(runtime.shutdown().is_empty());
    assert!(cloud_server.shutdown().is_empty());
}

#[test]
fn the_fuse_trips_exactly_once() {
    // The single-warning guarantee rests on this: only the caller that flipped
    // the latch may log, so two racing harnesses cannot both emit.
    let state = ModelSnapshotSyncState::new();
    assert!(!state.is_disabled_after_forbidden());
    assert!(state.trip_disabled_after_forbidden());
    assert!(!state.trip_disabled_after_forbidden());
    assert!(state.is_disabled_after_forbidden());
}

// ── The eligible-then-403 contradiction: one request, one bounded warning ──

/// Sentinels seeded into every place a careless log could leak something.
const SENTINEL_BODY: &str = "SENTINEL-RESPONSE-BODY-9f13a";
const SENTINEL_BEARER: &str = "SENTINEL-WORKER-BEARER-4c8e2";
const SENTINEL_MODEL: &str = "SENTINEL-SNAPSHOT-DOCUMENT-7b21d";
const SENTINEL_RUNTIME_PATH: &str = "SENTINEL-LOCAL-PATH-1d90c";

#[tokio::test]
async fn an_eligible_403_stops_the_tick_after_one_upload_and_warns_once_safely() {
    let trace = timeline();
    let _guard = capture(&trace);
    // Two harnesses: the first 403s, so the second must never be touched.
    let first_status = serde_json::json!({
        "agent": "claude",
        "schemaVersion": 2,
        "probedAt": "2026-07-27T00:00:00Z",
        "stateRevision": 7,
        // The document itself carries a sentinel: snapshot content must never
        // appear in the anomaly event.
        "models": [{"id": SENTINEL_MODEL}],
        "modes": [{"id": "default"}],
        "warnings": [SENTINEL_RUNTIME_PATH],
        "lastAttempt": {"at": "2026-07-27T00:00:00Z", "outcome": "ok"}
    })
    .to_string();
    let runtime = InstrumentedServer::spawn(
        "runtime",
        vec![
            (
                "GET",
                "/v1/agents".to_string(),
                200,
                agents_list(&["claude", "opencode"]),
            ),
            (
                "GET",
                "/v1/agents/claude/model-snapshot".to_string(),
                200,
                first_status,
            ),
            (
                "GET",
                "/v1/agents/opencode/model-snapshot".to_string(),
                200,
                status_json_for("opencode", "2026-07-27T00:00:00Z"),
            ),
        ],
        trace.clone(),
    );
    let cloud_server = InstrumentedServer::spawn(
        "cloud",
        vec![
            (
                "POST",
                "/v1/cloud/agent-models/claude/refresh".to_string(),
                403,
                serde_json::json!({
                    "detail": {
                        "code": "agent_model_snapshot_upload_forbidden",
                        "message": SENTINEL_BODY
                    }
                })
                .to_string(),
            ),
            (
                "POST",
                "/v1/cloud/agent-models/opencode/refresh".to_string(),
                200,
                "{}".to_string(),
            ),
        ],
        trace.clone(),
    );
    let config = cloud_config_for(runtime.address, cloud_server.address);
    let cloud = CloudClient::new(&config).expect("build cloud client");
    let state = ModelSnapshotSyncState::new();

    // Tick 1: eligible, hits the 403.
    maybe_sync(true, &config, &cloud, SENTINEL_BEARER, &state).await;
    assert!(
        state.is_disabled_after_forbidden(),
        "the first eligible 403 trips the process fuse"
    );
    // Tick 2: the server still says `true`; the fused process still does nothing.
    maybe_sync(true, &config, &cloud, SENTINEL_BEARER, &state).await;

    let runtime_hits = runtime.shutdown();
    let cloud_hits = cloud_server.shutdown();
    assert_eq!(
        runtime_hits.iter().filter(|line| line.contains("model-snapshot")).count(),
        1,
        "exactly one harness status read across both ticks: {runtime_hits:?}"
    );
    assert!(
        !runtime_hits
            .iter()
            .any(|line| line.contains("opencode/model-snapshot")),
        "the second harness in the tick must never be read: {runtime_hits:?}"
    );
    assert_eq!(
        cloud_hits,
        vec!["POST /v1/cloud/agent-models/claude/refresh".to_string()],
        "at most one upload reaches the server for the whole process"
    );
    assert!(
        state.snapshot().is_empty(),
        "a 403 must not advance last_pushed: a restart may retry this document"
    );

    // ── Exactly one bounded WARN, with nothing sensitive in it ──
    let snapshot_events: Vec<_> = events(&trace)
        .into_iter()
        .filter(|event| event.target == SNAPSHOT_SYNC_TARGET)
        .collect();
    assert_eq!(
        snapshot_events.len(),
        1,
        "one snapshot event for the whole process: {snapshot_events:?}"
    );
    let warning = &snapshot_events[0];
    assert_eq!(warning.level, Level::WARN, "not an ERROR, not page-worthy");
    assert_eq!(warning.message(), FORBIDDEN_AFTER_ALLOWED_MESSAGE);
    assert_eq!(
        warning.field("reason"),
        Some(&FieldValue::Str("unexpected_forbidden".to_string())),
        "the classified reason is a bounded literal"
    );
    assert_eq!(
        warning.field("http_status"),
        Some(&FieldValue::I64(403)),
        "http_status is numeric, not a rendered string"
    );
    assert_eq!(
        warning.field("harness_kind").map(FieldValue::text),
        Some("claude".to_string()),
        "the bounded harness kind identifies which upload contradicted"
    );
    assert!(
        !warning.has_field("error"),
        "no `?error` Debug object on this branch: it would carry the response body"
    );
    let rendered = warning.rendered();
    for secret in [
        SENTINEL_BODY,
        SENTINEL_BEARER,
        SENTINEL_MODEL,
        SENTINEL_RUNTIME_PATH,
        "agent_model_snapshot_upload_forbidden",
        "Bearer",
        "/v1/cloud/agent-models",
        "127.0.0.1",
        "http://",
    ] {
        assert!(
            !rendered.contains(secret),
            "the anomaly event leaked {secret:?}: {rendered}"
        );
    }
    // Exactly the four fields the contract allows, nothing else.
    let mut names: Vec<&str> = warning
        .fields
        .iter()
        .map(|(key, _)| key.as_str())
        .collect();
    names.sort_unstable();
    assert_eq!(
        names,
        vec!["harness_kind", "http_status", "message", "reason"],
        "only bounded branch fields belong on this event"
    );
}

// ── Non-403 failures keep retrying and never trip the fuse ────────────────

#[tokio::test]
async fn a_500_upload_is_still_retryable_and_does_not_trip_the_fuse() {
    // Independent state and capture: this proof must not borrow the 403 case's
    // fuse or its warning.
    let trace = timeline();
    let _guard = capture(&trace);
    let runtime = InstrumentedServer::spawn(
        "runtime",
        vec![
            ("GET", "/v1/agents".to_string(), 200, agents_list(&["opencode"])),
            (
                "GET",
                "/v1/agents/opencode/model-snapshot".to_string(),
                200,
                status_json_for("opencode", "2026-07-27T00:00:00Z"),
            ),
        ],
        trace.clone(),
    );
    let cloud_server = InstrumentedServer::spawn(
        "cloud",
        vec![(
            "POST",
            "/v1/cloud/agent-models/opencode/refresh".to_string(),
            500,
            serde_json::json!({"error": "boom"}).to_string(),
        )],
        trace.clone(),
    );
    let config = cloud_config_for(runtime.address, cloud_server.address);
    let cloud = CloudClient::new(&config).expect("build cloud client");
    let state = ModelSnapshotSyncState::new();

    maybe_sync(true, &config, &cloud, "worker-secret-token", &state).await;
    assert!(
        !state.is_disabled_after_forbidden(),
        "a 5xx is transient: suppression is reserved for the contract contradiction"
    );
    // The next eligible tick really does try again.
    maybe_sync(true, &config, &cloud, "worker-secret-token", &state).await;

    let cloud_hits = cloud_server.shutdown();
    runtime.shutdown();
    assert_eq!(
        cloud_hits.len(),
        2,
        "both eligible ticks attempted the upload: {cloud_hits:?}"
    );
    assert!(state.snapshot().is_empty(), "a failed push stays pending");
    let warnings: Vec<_> = events(&trace)
        .into_iter()
        .filter(|event| {
            event.target == SNAPSHOT_SYNC_TARGET
                && event.message() == FORBIDDEN_AFTER_ALLOWED_MESSAGE
        })
        .collect();
    assert!(
        warnings.is_empty(),
        "the 403 anomaly message must not be emitted for a 5xx"
    );
}

#[tokio::test]
async fn a_network_failure_is_still_retryable_and_does_not_trip_the_fuse() {
    let trace = timeline();
    let _guard = capture(&trace);
    let runtime = InstrumentedServer::spawn(
        "runtime",
        vec![
            ("GET", "/v1/agents".to_string(), 200, agents_list(&["opencode"])),
            (
                "GET",
                "/v1/agents/opencode/model-snapshot".to_string(),
                200,
                status_json_for("opencode", "2026-07-27T00:00:00Z"),
            ),
        ],
        trace.clone(),
    );
    // A closed port: the upload fails at the transport layer, with no status.
    let dead = TcpListener::bind("127.0.0.1:0").expect("bind then drop");
    let dead_address = dead.local_addr().expect("dead address");
    drop(dead);

    let config = cloud_config_for(runtime.address, dead_address);
    let cloud = CloudClient::new(&config).expect("build cloud client");
    let state = ModelSnapshotSyncState::new();

    maybe_sync(true, &config, &cloud, "worker-secret-token", &state).await;

    runtime.shutdown();
    assert!(
        !state.is_disabled_after_forbidden(),
        "a transport failure carries no server verdict and must never fuse"
    );
    assert!(state.snapshot().is_empty(), "a failed push stays pending");
    let anomalies: Vec<_> = events(&trace)
        .into_iter()
        .filter(|event| event.message() == FORBIDDEN_AFTER_ALLOWED_MESSAGE)
        .collect();
    assert!(anomalies.is_empty());
}
