//! The REL-10 admission gate, the process-lifetime fuse, and the bounded
//! eligible-then-403 anomaly.
//!
//! Split out of `model_snapshot_sync_tests.rs` to keep both files under the
//! repo-wide size cap. The shared trace collector and instrumented listener come
//! from `crate::test_support`; the tests themselves are unchanged.

use super::*;
use std::net::TcpListener;
use std::sync::Arc;

use tracing::Level;

use crate::test_support::{
    agents_list, capture, capture_with_latch_probe, cloud_config_for, events, status_json_for,
    timeline, FieldValue, InstrumentedServer,
};

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

    // Both tallies, because they can fail independently: a connection that is
    // accepted but never readable leaves no hit behind, so `hits` alone would
    // let a contact with the runtime or the cloud slip through unnoticed.
    runtime.drain();
    cloud_server.drain();
    assert_eq!(
        runtime.accepted_count(),
        0,
        "a denied tick must not even open a connection to the local runtime"
    );
    assert_eq!(
        cloud_server.accepted_count(),
        0,
        "a denied tick must not even open a connection to the cloud"
    );
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

    runtime.drain();
    cloud_server.drain();
    assert_eq!(
        runtime.accepted_count(),
        0,
        "a fused process opens no connection to the runtime"
    );
    assert_eq!(
        cloud_server.accepted_count(),
        0,
        "a fused process opens no connection to the cloud"
    );
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
    let state = Arc::new(ModelSnapshotSyncState::new());

    // The collector reads the fuse from inside the emit path, so "the latch was
    // already set when the WARN was written" is observed rather than inferred
    // from reading the source. An implementation that logged first and latched
    // afterwards would capture `Some(false)` here.
    let _guard = capture_with_latch_probe(&trace, {
        let probed = Arc::clone(&state);
        Arc::new(move || probed.is_disabled_after_forbidden())
    });

    // Tick 1: eligible, hits the 403.
    maybe_sync(true, &config, &cloud, SENTINEL_BEARER, &state).await;
    assert!(
        state.is_disabled_after_forbidden(),
        "the first eligible 403 trips the process fuse"
    );
    // Tick 2: the server still says `true`; the fused process still does nothing.
    maybe_sync(true, &config, &cloud, SENTINEL_BEARER, &state).await;

    runtime.drain();
    cloud_server.drain();
    // Tick 2 is fused, so the tallies below cover the whole process. Accounting
    // for every accepted connection keeps an unreadable contact from hiding in
    // the gap between "connections opened" and "requests recorded".
    assert_eq!(
        runtime.accepted_count() as usize,
        runtime.hits().len(),
        "every runtime connection is accounted for as a request"
    );
    assert_eq!(
        cloud_server.accepted_count() as usize,
        cloud_server.hits().len(),
        "every cloud connection is accounted for as a request"
    );
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
        warning.latch_at_capture,
        Some(true),
        "the fuse must already be latched at the instant the WARN is emitted, so a \
         concurrent tick can never slip past the gate between the log and the latch"
    );
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
