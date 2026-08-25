//! The real heartbeat → decoded verdict → snapshot-gate choreography (REL-10).
//!
//! These tests drive the actual private `runtime::heartbeat_and_converge` call
//! path — not `launch_options_sync::maybe_sync` directly — so the join under
//! proof is the one production runs: a genuine `POST /v1/cloud/worker/heartbeat`
//! against an instrumented cloud listener, a genuine Serde decode of the body,
//! the genuine acknowledgement event, and the genuine admission gate.
//!
//! Three independent cases, each with a fresh trace collector, fresh sync state,
//! fresh store, and fresh listeners:
//!
//! - `launchOptionsUploadAllowed: false` — normal tick, zero launch-option work;
//! - the field omitted (an old server) — identical outcome, by default-false; and
//! - `true` — the acknowledgement precedes list/status/upload and the watermark
//!   advances.
//!
//! Launch-option events are classified by tracing TARGET, never by matching one
//! current message, so renaming or adding an "expected skip" warning cannot slip
//! past the silence assertions.

use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};

use tracing::Level;

use super::heartbeat_and_converge;
use crate::test_support::{
    capture, events, is_request_containing, position, timeline, CapturedEvent, FieldValue,
    InstrumentedServer, Route, Step, Timeline,
};
use crate::{
    cloud_client::CloudClient,
    config::WorkerConfig,
    identity::credentials::WorkerIdentity,
    launch_options_sync::{LaunchOptionsSyncState, LAUNCH_OPTIONS_SYNC_TARGET},
    observability::HEARTBEAT_ACK_TARGET,
    store::WorkerStore,
};

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

/// A Worker config with no mailbox dir, so the tick exercises exactly the
/// heartbeat + launch-options gate join and nothing else. This mirrors a
/// non-supervisor-owned target (desktop shape), which converges nothing.
fn test_config(dir: &TempDir, runtime: SocketAddr, cloud: SocketAddr) -> WorkerConfig {
    WorkerConfig {
        cloud_base_url: format!("http://{cloud}"),
        enrollment_token: None,
        worker_db_path: dir.0.join("worker.sqlite3"),
        integration_gateway_home: None,
        heartbeat_interval_seconds: 30,
        runtime_base_url: format!("http://{runtime}"),
        runtime_bearer_token: None,
        supervisor_update_request_dir: None,
        config_path: None,
    }
}

fn heartbeat_body(capability: Option<bool>) -> String {
    // `desiredTopology`/`supervisorBridge` stay in the fake ack deliberately:
    // deployed servers that predate the D5-bridge deletion still emit them,
    // and the Worker must tolerate them as unknown fields.
    let mut body = serde_json::json!({
        "workerId": "worker-1",
        "serverTime": "2026-08-18T00:00:00Z",
        "heartbeatIntervalSeconds": 30,
        "desiredVersions": {"worker": null, "anyharness": null},
        "desiredTopology": null,
        "supervisorBridge": null
    });
    if let Some(allowed) = capability {
        body["launchOptionsUploadAllowed"] = serde_json::json!(allowed);
    }
    body.to_string()
}

/// The ordinary non-copy work every tick does: the catalog-version poll and
/// the heartbeat itself. Present in all three cases so "zero launch-option work" is
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
            "/v1/agents/opencode/launch-options".to_string(),
            200,
            serde_json::json!({
                "harnessKind": "opencode",
                "basisRevision": "basis-1",
                "revision": 7,
                "state": "observed",
                "options": {
                    "models": [{"id": "m1", "observedName": null, "observedDescription": null}],
                    "controls": [],
                    "defaults": {"modelId": null, "controlValues": {}}
                },
                "observedAt": PROBED_AT,
                "probeAttemptedAt": PROBED_AT,
                "probeFailureCode": null,
                "readiness": "ready"
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
            "/v1/cloud/harness-launch-options/opencode".to_string(),
            200,
            "{}".to_string(),
        ),
    ]
}

const LAUNCH_OPTIONS_REQUEST_MARKERS: [&str; 3] = [
    "/v1/agents",
    "/v1/agents/opencode/launch-options",
    "/v1/cloud/harness-launch-options",
];

fn snapshot_requests(hits: &[String]) -> Vec<String> {
    hits.iter()
        .filter(|line| {
            LAUNCH_OPTIONS_REQUEST_MARKERS
                .iter()
                .any(|marker| line.contains(marker))
        })
        .cloned()
        .collect()
}

/// One real `heartbeat_and_converge` tick against fresh everything.
struct TickOutcome {
    runtime_hits: Vec<String>,
    cloud_hits: Vec<String>,
    watermark_before: std::collections::HashMap<String, i64>,
    watermark_after: std::collections::HashMap<String, i64>,
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
    let state = LaunchOptionsSyncState::new();
    let watermark_before = state.pushed_revisions();

    heartbeat_and_converge(
        &config, &cloud, &store, &identity, None, &state, false,
    )
    .await;

    // Every accepted connection must have produced a recorded request. Without
    // this, a connection that was accepted but never readable would leave no hit
    // behind, and the per-case "zero snapshot requests" assertions below —
    // which read only hits — could pass while contact had in fact happened.
    runtime.drain();
    cloud_server.drain();
    assert_eq!(
        runtime.accepted_count() as usize,
        runtime.hits().len(),
        "every connection the runtime accepted is accounted for as a request"
    );
    assert_eq!(
        cloud_server.accepted_count() as usize,
        cloud_server.hits().len(),
        "every connection the cloud accepted is accounted for as a request"
    );

    TickOutcome {
        runtime_hits: runtime.shutdown(),
        cloud_hits: cloud_server.shutdown(),
        watermark_before,
        watermark_after: state.pushed_revisions(),
        fuse_after: false,
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

/// Every event emitted by the launch-options sync owner, found by TARGET so a
/// renamed message cannot hide.
fn snapshot_owner_events(trace: &Timeline) -> Vec<CapturedEvent> {
    events(trace)
        .into_iter()
        .filter(|event| event.target == LAUNCH_OPTIONS_SYNC_TARGET)
        .collect()
}

/// The shared assertions for the two ineligible cases: normal non-snapshot work,
/// one truthful acknowledgement carrying typed `false`, no second
/// eligibility/skip event anywhere, no snapshot-owner WARN/ERROR at all, zero
/// snapshot requests, and zero snapshot state change.
fn assert_denied_tick(outcome: &TickOutcome, trace: &Timeline) {
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

    // Zero launch-options work.
    assert!(
        snapshot_requests(&outcome.runtime_hits).is_empty(),
        "no local launch-options read may happen: {:?}",
        outcome.runtime_hits
    );
    assert!(
        snapshot_requests(&outcome.cloud_hits).is_empty(),
        "no cloud ingest request may happen: {:?}",
        outcome.cloud_hits
    );

    // Zero launch-options state change.
    assert_eq!(
        outcome.watermark_after, outcome.watermark_before,
        "the watermark map must be byte-identical before and after"
    );
    assert!(!outcome.fuse_after, "the process fuse stays clear");

    // Exactly one truthful acknowledgement, carrying a real boolean `false`.
    let acknowledgement = sole_acknowledgement(trace);
    assert_eq!(
        acknowledgement.field("launch_options_upload_allowed"),
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
            event.field("launch_options_upload_allowed").is_some()
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

    // The full eligible choreography really ran.
    assert!(
        outcome.runtime_hits.contains(&"GET /v1/agents".to_string()),
        "the eligible tick lists local harnesses: {:?}",
        outcome.runtime_hits
    );
    assert!(
        outcome
            .runtime_hits
            .contains(&"GET /v1/agents/opencode/launch-options".to_string()),
        "the eligible tick reads the harness status: {:?}",
        outcome.runtime_hits
    );
    assert!(
        outcome
            .cloud_hits
            .contains(&"POST /v1/cloud/harness-launch-options/opencode".to_string()),
        "the eligible tick uploads the changed document: {:?}",
        outcome.cloud_hits
    );

    // Exactly one acknowledgement, carrying a real boolean `true`.
    let acknowledgement = sole_acknowledgement(&trace);
    assert_eq!(
        acknowledgement.field("launch_options_upload_allowed"),
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
    let status_index = position(&trace, is_request_containing("launch-options"))
        .expect("status read is in the timeline");
    let upload_index = position(&trace, is_request_containing("/v1/cloud/harness-launch-options"))
        .expect("upload is in the timeline");
    assert!(
        ack_index < list_index,
        "the verdict must be acknowledged before the local list: {ack_index} !< {list_index}"
    );
    assert!(list_index < status_index && status_index < upload_index);

    // The successful upload advanced the watermark; the fuse stayed clear.
    assert_eq!(
        outcome.watermark_after.get("opencode"),
        Some(&7),
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
