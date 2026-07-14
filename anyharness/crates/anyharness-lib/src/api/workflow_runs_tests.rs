//! HTTP-level tests for the workflow-runs routes over an in-memory `AppState`
//! and the real router. Workspace existence is not required for acceptance, so
//! these exercise the durable PUT/replay/conflict/GET surface without booting a
//! live agent.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::{
    body::{to_bytes, Body},
    http::{header, Request, StatusCode},
};
use serde_json::{json, Value};
use tower::util::ServiceExt;

use super::router::build_router;
use crate::{
    app::{test_support, AppState},
    domains::agents::installer::seed::AgentSeedStore,
    persistence::Db,
};

const RUN_ID: &str = "11111111-1111-4111-8111-111111111111";

fn test_state() -> AppState {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("unix timestamp")
        .as_nanos();
    AppState::new(
        PathBuf::from(format!("/tmp/anyharness-workflow-router-{unique}")),
        "http://127.0.0.1:8457".to_string(),
        Db::open_in_memory().expect("in-memory db"),
        false,
        AgentSeedStore::not_configured_dev(),
    )
    .expect("app state")
}

fn valid_body() -> Value {
    json!({
        "schemaVersion": 1,
        "workspaceId": "20000000-0000-4000-8000-000000000002",
        "definition": {
            "inputs": [{ "name": "ticket", "type": "string", "required": true }],
            "stages": [{
                "harnessConfig": {
                    "agentKind": "claude",
                    "modelId": "claude-sonnet-4-5",
                    "modeId": "bypassPermissions"
                },
                "steps": [{ "kind": "agent.prompt", "prompt": "Investigate {{inputs.ticket}}" }]
            }]
        },
        "arguments": { "ticket": "PROL-123" }
    })
}

async fn put(state: &AppState, run_id: &str, body: Value) -> (StatusCode, Value) {
    let response = build_router(state.clone())
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(format!("/v1/workflow-runs/{run_id}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body.to_string()))
                .expect("request"),
        )
        .await
        .expect("response");
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("body");
    let payload = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or(Value::Null)
    };
    (status, payload)
}

async fn get(state: &AppState, run_id: &str) -> (StatusCode, Value) {
    let response = build_router(state.clone())
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/v1/workflow-runs/{run_id}"))
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("body");
    let payload = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or(Value::Null)
    };
    (status, payload)
}

#[tokio::test]
async fn put_replay_conflict_get_and_not_found() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("env mutex");
    let _guard = test_support::set_bearer_token_env(None);
    let state = test_state();

    // New acceptance -> 201.
    let (status, body) = put(&state, RUN_ID, valid_body()).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["run"]["id"], RUN_ID);
    assert_eq!(
        body["steps"][0]["promptId"],
        format!("workflow:{RUN_ID}:0:0")
    );
    assert_eq!(body["steps"][0]["stageIndex"], 0);
    assert_eq!(body["steps"][0]["stepIndex"], 0);

    // Identical replay -> 200.
    let (status, _body) = put(&state, RUN_ID, valid_body()).await;
    assert_eq!(status, StatusCode::OK);

    // Same ID, different invocation -> 409.
    let mut different = valid_body();
    different["arguments"]["ticket"] = json!("OTHER");
    let (status, body) = put(&state, RUN_ID, different).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["code"], "WORKFLOW_RUN_CONFLICT");

    // GET the run -> 200.
    let (status, body) = get(&state, RUN_ID).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["run"]["id"], RUN_ID);
    assert_eq!(body["steps"][0]["stepIndex"], 0);

    // GET a missing run -> 404.
    let (status, body) = get(&state, "22222222-2222-4222-8222-222222222222").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["code"], "WORKFLOW_RUN_NOT_FOUND");
}

#[test]
fn openapi_documents_model_and_mode_ids_as_required_nullable() {
    // Spec §3.1/§8.1: modelId/modeId are required keys that may be null, and
    // the generated OpenAPI (thus the generated SDK) must say so.
    let doc: Value =
        serde_json::from_str(&super::openapi::openapi_json()).expect("parse openapi document");
    let schema = &doc["components"]["schemas"]["WorkflowRunHarnessConfig"];
    let required: Vec<&str> = schema["required"]
        .as_array()
        .expect("required array")
        .iter()
        .map(|value| value.as_str().expect("required entry"))
        .collect();
    assert!(required.contains(&"agentKind"), "required: {required:?}");
    assert!(required.contains(&"modelId"), "required: {required:?}");
    assert!(required.contains(&"modeId"), "required: {required:?}");
    assert_eq!(
        schema["properties"]["modelId"]["type"],
        json!(["string", "null"])
    );
    assert_eq!(
        schema["properties"]["modeId"]["type"],
        json!(["string", "null"])
    );
}

#[tokio::test]
async fn strict_shape_and_invalid_definitions_return_coded_400() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("env mutex");
    let _guard = test_support::set_bearer_token_env(None);
    let state = test_state();

    // Unknown field -> our coded 400, not axum's 422.
    let mut unknown = valid_body();
    unknown["surprise"] = json!(true);
    let (status, body) = put(&state, RUN_ID, unknown).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["code"], "WORKFLOW_RUN_INVALID");

    // Structurally valid but semantically invalid (bad schema version) -> 400.
    let mut bad_version = valid_body();
    bad_version["schemaVersion"] = json!(2);
    let (status, body) = put(&state, RUN_ID, bad_version).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["code"], "WORKFLOW_RUN_INVALID");

    // Non-canonical run id in the path -> 400.
    let (status, body) = put(&state, "not-a-uuid", valid_body()).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["code"], "WORKFLOW_RUN_INVALID");
}
