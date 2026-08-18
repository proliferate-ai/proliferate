use super::*;
use std::io::{Read, Write};
use std::net::TcpListener;
use crate::test_support::{cloud_config_for, minimal_config};

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
