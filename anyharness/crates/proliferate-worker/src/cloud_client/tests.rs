//! Wire-contract tests for the cloud client.
//!
//! Split out of `mod.rs` to keep both files under the repo-wide size cap; the
//! tests are unchanged.

use super::{EnrollResponse, HeartbeatResponse};

#[test]
fn enroll_response_parses_integration_gateway() {
    let payload = br#"{
        "workerId": "worker",
        "workerToken": "token",
        "heartbeatIntervalSeconds": 30,
        "integrationGateway": {
            "url": "http://127.0.0.1:8300",
            "authorization": "Bearer gw-secret"
        }
    }"#;
    let response = serde_json::from_slice::<EnrollResponse>(payload)
        .expect("enroll response with integrationGateway");
    assert_eq!(response.worker_id, "worker");
    assert_eq!(response.worker_token, "token");
    assert_eq!(response.heartbeat_interval_seconds, 30);
    assert_eq!(response.integration_gateway.url, "http://127.0.0.1:8300");
    assert_eq!(
        response.integration_gateway.authorization,
        "Bearer gw-secret"
    );
}

#[test]
fn heartbeat_response_parses_minimal_ack() {
    // Mirrors an older server's body: workerId + serverTime + interval,
    // no status and no desiredVersions.
    let payload = br#"{
        "workerId": "worker",
        "serverTime": "2026-07-01T00:00:00Z",
        "heartbeatIntervalSeconds": 30
    }"#;
    let response =
        serde_json::from_slice::<HeartbeatResponse>(payload).expect("minimal heartbeat ack");
    assert_eq!(response.worker_id, "worker");
    assert_eq!(response.status, None);
    assert_eq!(
        response.server_time.as_deref(),
        Some("2026-07-01T00:00:00Z")
    );
    assert!(response.desired_versions.is_none());
}

#[test]
fn heartbeat_response_parses_desired_versions() {
    let payload = br#"{
        "workerId": "worker",
        "serverTime": "2026-07-01T00:00:00Z",
        "heartbeatIntervalSeconds": 30,
        "desiredVersions": {"worker": "0.2.16", "anyharness": "0.2.16"}
    }"#;
    let response = serde_json::from_slice::<HeartbeatResponse>(payload)
        .expect("heartbeat ack with desiredVersions");
    let desired = response.desired_versions.expect("desiredVersions present");
    assert_eq!(desired.worker.as_deref(), Some("0.2.16"));
    assert_eq!(desired.anyharness.as_deref(), Some("0.2.16"));
}

#[test]
fn heartbeat_response_tolerates_partial_desired_versions() {
    // Future shape changes must never break heartbeating.
    let payload = br#"{
        "workerId": "worker",
        "desiredVersions": {"worker": "0.2.16"}
    }"#;
    let response = serde_json::from_slice::<HeartbeatResponse>(payload)
        .expect("heartbeat ack with partial desiredVersions");
    let desired = response.desired_versions.expect("desiredVersions present");
    assert_eq!(desired.worker.as_deref(), Some("0.2.16"));
    assert_eq!(desired.anyharness, None);
}

#[test]
fn heartbeat_response_ignores_a_legacy_servers_catalog_version() {
    // The catalog is binary-only (agent-distribution.md "Convergence"), so
    // the worker no longer models a served catalog version. A server that
    // still advertises one — a not-yet-deployed or rolled-back server
    // during the window this deletion rides out — must be acked normally
    // with the field simply ignored, never a deserialization failure.
    let payload = br#"{
        "workerId": "worker",
        "desiredVersions": {
            "worker": "0.2.16",
            "anyharness": "0.2.16",
            "catalogVersion": "2026-07-06.1"
        }
    }"#;
    let response = serde_json::from_slice::<HeartbeatResponse>(payload)
        .expect("heartbeat ack from a server still advertising catalogVersion");
    let desired = response.desired_versions.expect("desiredVersions present");
    assert_eq!(desired.worker.as_deref(), Some("0.2.16"));
    assert_eq!(desired.anyharness.as_deref(), Some("0.2.16"));
}

#[test]
fn heartbeat_response_tolerates_deleted_bridge_fields_from_deployed_servers() {
    // Deployed servers that predate the D5-bridge deletion still emit
    // `desiredTopology` (and, for provisioned targets, `supervisorBridge`).
    // The Worker no longer models either; both must decode as tolerated
    // unknown fields, never a parse failure.
    let payload = br#"{
        "workerId": "worker",
        "desiredVersions": {"worker": "0.2.16", "anyharness": "0.2.16"},
        "desiredTopology": "supervisor_owned",
        "supervisorBridge": {
            "supervisorBinaryPath": "/home/user/.proliferate/bin/proliferate-supervisor",
            "supervisorConfigPath": "/home/user/.proliferate/supervisor/config.toml",
            "supervisorConfigToml": "x = 1\n",
            "workerConfigPath": "/home/user/.proliferate/worker/config.toml",
            "workerConfigToml": "y = 2\n",
            "markerDir": "/home/user/.proliferate/worker/bridge"
        }
    }"#;
    let response = serde_json::from_slice::<HeartbeatResponse>(payload)
        .expect("heartbeat ack carrying the deleted bridge fields");
    let desired = response.desired_versions.expect("desiredVersions present");
    assert_eq!(desired.worker.as_deref(), Some("0.2.16"));
}

// ── REL-10: the shared Python-producer / Rust-consumer heartbeat contract ──
//
// These parse the SAME committed fixtures the server's
// `tests/unit/test_worker_heartbeat_contract.py` proves the real Pydantic
// model serializes to. A handwritten copy of either payload here would let
// the two languages drift silently, so the bytes come off disk.

/// `fixtures/contracts/worker-heartbeat/v1.json` — a complete new-server body.
const V1_FIXTURE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../fixtures/contracts/worker-heartbeat/v1.json"
));
/// `fixtures/contracts/worker-heartbeat/v0-legacy.json` — the supported
/// pre-field body, identical to v1 except that the capability is omitted.
const V0_LEGACY_FIXTURE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../fixtures/contracts/worker-heartbeat/v0-legacy.json"
));

#[test]
fn heartbeat_response_parses_the_shared_v1_fixture_as_allowed() {
    let response = serde_json::from_str::<HeartbeatResponse>(V1_FIXTURE)
        .expect("the committed v1 heartbeat fixture must parse");
    assert!(
        response.launch_options_upload_allowed,
        "the shared v1 fixture advertises eligibility"
    );
    // The rest of the golden body still decodes, so this fixture really is
    // the whole contract rather than a capability-only stub.
    assert_eq!(response.worker_id, "2f5b3c14-8d1e-4a7b-9c60-1f2e3d4a5b6c");
    let desired = response.desired_versions.expect("desiredVersions present");
    assert_eq!(desired.worker.as_deref(), Some("0.4.13"));
    assert_eq!(desired.anyharness.as_deref(), Some("0.66.0"));
}

#[test]
fn heartbeat_response_parses_the_shared_legacy_fixture_as_denied() {
    // Old server + new Worker: the omission is decoded as `false`, which
    // pauses snapshot sync before any local read or upload.
    let response = serde_json::from_str::<HeartbeatResponse>(V0_LEGACY_FIXTURE)
        .expect("the committed legacy heartbeat fixture must parse");
    assert!(
        !response.launch_options_upload_allowed,
        "an omitted capability must fail closed to false"
    );
    // Everything the legacy server DOES send is still honoured, so failing
    // closed on snapshots never disables version convergence.
    let desired = response.desired_versions.expect("desiredVersions present");
    assert_eq!(desired.worker.as_deref(), Some("0.4.13"));
}

#[test]
fn the_legacy_fixture_really_omits_the_capability_member() {
    // Guards the proof above from a fixture edit that quietly adds
    // `"launchOptionsUploadAllowed": false`, which would make the
    // default-false assertion pass for the wrong reason.
    let value: serde_json::Value =
        serde_json::from_str(V0_LEGACY_FIXTURE).expect("legacy fixture is json");
    assert!(
        value.get("launchOptionsUploadAllowed").is_none(),
        "the legacy fixture must OMIT the member, not send false"
    );
    let v1: serde_json::Value = serde_json::from_str(V1_FIXTURE).expect("v1 fixture is json");
    assert_eq!(v1["launchOptionsUploadAllowed"], serde_json::json!(true));
}

#[test]
fn heartbeat_response_parses_an_explicit_false_capability() {
    let payload = br#"{
        "workerId": "worker",
        "serverTime": "2026-08-18T00:00:00Z",
        "heartbeatIntervalSeconds": 30,
        "launchOptionsUploadAllowed": false
    }"#;
    let response = serde_json::from_slice::<HeartbeatResponse>(payload)
        .expect("heartbeat ack with an explicit false capability");
    assert!(!response.launch_options_upload_allowed);
}

#[test]
fn heartbeat_request_serializes_versions_camel_case() {
    let request = super::HeartbeatRequest {
        status: Some("online".to_string()),
        worker_version: Some("0.1.0".to_string()),
        anyharness_version: None,
        catalog_version: None,
    };
    let value = serde_json::to_value(&request).expect("serialize heartbeat request");
    assert_eq!(value["status"], "online");
    assert_eq!(value["workerVersion"], "0.1.0");
    // Absent versions are omitted entirely, not sent as null.
    assert!(value.get("anyharnessVersion").is_none());
    assert!(value.get("catalogVersion").is_none());
}

#[test]
fn heartbeat_request_serializes_catalog_version_when_present() {
    let request = super::HeartbeatRequest {
        status: Some("online".to_string()),
        worker_version: Some("0.1.0".to_string()),
        anyharness_version: None,
        catalog_version: Some("2026.08.15-1".to_string()),
    };
    let value = serde_json::to_value(&request).expect("serialize heartbeat request");
    assert_eq!(value["catalogVersion"], "2026.08.15-1");
}
