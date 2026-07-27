use super::*;
use std::io::{Read, Write};
use std::net::TcpListener;

fn context(auth_context_id: &str, probed_at: Option<&str>) -> RuntimeContextStatus {
    RuntimeContextStatus {
        auth_context_id: auth_context_id.to_string(),
        probed_at: probed_at.map(str::to_string),
        models: vec![serde_json::json!({"id": "m1"})],
        modes: vec![serde_json::json!({"id": "default", "name": "Default"})],
        attestation: None,
        warnings: Vec::new(),
    }
}

// ── plan_pushes: pure decision tests ────────────────────────────────

#[test]
fn plan_pushes_uploads_when_probed_at_advances() {
    let contexts = vec![context("gateway", Some("2026-07-27T00:00:00Z"))];
    let mut last_pushed = HashMap::new();
    last_pushed.insert(
        ("opencode".to_string(), "gateway".to_string()),
        "2026-07-26T00:00:00Z".to_string(),
    );
    let pushes = plan_pushes("opencode", &contexts, &last_pushed);
    assert_eq!(pushes.len(), 1);
    assert_eq!(pushes[0].auth_context_id, "gateway");
    assert_eq!(pushes[0].probed_at, "2026-07-27T00:00:00Z");
    assert!(pushes[0].snapshot_json.contains("\"m1\""));
}

#[test]
fn plan_pushes_does_not_repush_unchanged_probed_at() {
    let contexts = vec![context("gateway", Some("2026-07-27T00:00:00Z"))];
    let mut last_pushed = HashMap::new();
    last_pushed.insert(
        ("opencode".to_string(), "gateway".to_string()),
        "2026-07-27T00:00:00Z".to_string(),
    );
    let pushes = plan_pushes("opencode", &contexts, &last_pushed);
    assert!(pushes.is_empty(), "unchanged probedAt must not re-push");
}

#[test]
fn plan_pushes_skips_a_context_with_no_snapshot_yet() {
    let contexts = vec![context("gateway", None)];
    let pushes = plan_pushes("opencode", &contexts, &HashMap::new());
    assert!(pushes.is_empty(), "no probedAt means no entry to upload");
}

#[test]
fn plan_pushes_treats_each_harness_independently() {
    let contexts = vec![context("gateway", Some("2026-07-27T00:00:00Z"))];
    let mut last_pushed = HashMap::new();
    // Same probedAt, but recorded under a DIFFERENT harness — must not
    // suppress this harness's push.
    last_pushed.insert(
        ("grok".to_string(), "gateway".to_string()),
        "2026-07-27T00:00:00Z".to_string(),
    );
    let pushes = plan_pushes("opencode", &contexts, &last_pushed);
    assert_eq!(pushes.len(), 1);
}

#[test]
fn plan_pushes_handles_no_contexts_at_all() {
    let pushes = plan_pushes("opencode", &[], &HashMap::new());
    assert!(pushes.is_empty());
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
    contexts_json: &str,
) -> Vec<(u16, &'static str, String)> {
    vec![
        (
            200,
            "OK",
            serde_json::json!([{ "kind": harness_kind }]).to_string(),
        ),
        (200, "OK", format!("{{\"contexts\":{contexts_json}}}")),
    ]
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
async fn maybe_sync_uploads_a_changed_context_with_the_workers_bearer() {
    let contexts_json = serde_json::json!([
        {
            "authContextId": "gateway",
            "probedAt": "2026-07-27T00:00:00Z",
            "models": [{"id": "m1"}],
            "modes": [{"id": "default", "name": "Default"}],
            "warnings": []
        }
    ])
    .to_string();
    let (runtime_addr, runtime_handle) =
        spawn_fake_server(runtime_responses("opencode", &contexts_json));
    let (cloud_addr, cloud_handle) = spawn_fake_server(vec![(
        200,
        "OK",
        serde_json::json!({"ok": true}).to_string(),
    )]);

    let config = cloud_config_for(runtime_addr, cloud_addr);
    let cloud = CloudClient::new(&config).expect("build cloud client");
    let state = ModelSnapshotSyncState::new();

    maybe_sync(&config, &cloud, "worker-secret-token", &state).await;

    let runtime_requests = runtime_handle.join().expect("runtime server thread");
    assert_eq!(runtime_requests[0].path, "/v1/agents");
    assert_eq!(
        runtime_requests[1].path,
        "/v1/agents/opencode/model-snapshot"
    );

    let cloud_requests = cloud_handle.join().expect("cloud server thread");
    assert_eq!(cloud_requests.len(), 1, "exactly one context changed");
    let push = &cloud_requests[0];
    assert_eq!(push.method, "POST");
    assert_eq!(push.path, "/v1/cloud/agent-models/opencode/refresh");
    assert_eq!(
        push.headers.get("authorization").map(String::as_str),
        Some("Bearer worker-secret-token"),
        "the worker's own bearer must authenticate the cloud upload"
    );
    assert!(push.body.contains("\"authContextId\":\"gateway\""));
    assert!(push.body.contains("\"probedAt\":\"2026-07-27T00:00:00Z\""));

    // Success is recorded, so an identical status next tick would not
    // re-push (verified against the pure decision fn directly).
    let recorded = state.snapshot();
    assert_eq!(
        recorded.get(&("opencode".to_string(), "gateway".to_string())),
        Some(&"2026-07-27T00:00:00Z".to_string())
    );
}

#[tokio::test]
async fn maybe_sync_does_not_wedge_on_a_cloud_error_and_leaves_the_push_pending() {
    let contexts_json = serde_json::json!([
        {
            "authContextId": "gateway",
            "probedAt": "2026-07-27T00:00:00Z",
            "models": [{"id": "m1"}],
            "modes": [],
            "warnings": []
        }
    ])
    .to_string();
    let (runtime_addr, runtime_handle) =
        spawn_fake_server(runtime_responses("opencode", &contexts_json));
    let (cloud_addr, cloud_handle) = spawn_fake_server(vec![(
        500,
        "Internal Server Error",
        serde_json::json!({"error": "boom"}).to_string(),
    )]);

    let config = cloud_config_for(runtime_addr, cloud_addr);
    let cloud = CloudClient::new(&config).expect("build cloud client");
    let state = ModelSnapshotSyncState::new();

    // Must return normally — never panic, never propagate an error.
    maybe_sync(&config, &cloud, "worker-secret-token", &state).await;

    runtime_handle.join().expect("runtime server thread");
    let cloud_requests = cloud_handle.join().expect("cloud server thread");
    assert_eq!(cloud_requests.len(), 1, "the push was attempted");

    // Not recorded on failure, so the next tick's plan_pushes sees the
    // same context as still needing an upload.
    let recorded = state.snapshot();
    assert!(
        recorded.is_empty(),
        "a failed push must not be recorded as pushed"
    );
    let contexts = vec![context("gateway", Some("2026-07-27T00:00:00Z"))];
    let retry = plan_pushes("opencode", &contexts, &recorded);
    assert_eq!(retry.len(), 1, "the next tick must retry the failed push");
}
