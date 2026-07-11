use std::path::PathBuf;
use std::sync::Mutex;

use axum::body::{to_bytes, Body};
use axum::extract::State;
use axum::http::{header, Request, StatusCode};
use axum::response::IntoResponse;
use axum::{Extension, Json};
use serde_json::{json, Value};
use tower::util::ServiceExt;
use uuid::Uuid;

use super::workflow_runs::create_workflow_run;
use crate::api::auth::{AuthContext, ClaimPermissions, UserClaimAuth};
use crate::api::router::build_router;
use crate::app::{test_support, AppState};
use crate::domains::agents::installer::seed::AgentSeedStore;
use crate::domains::workflows::delivery::content_hash_excluding;
use crate::persistence::Db;

fn state() -> AppState {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("environment lock");
    let _bearer_guard = test_support::set_bearer_token_env(Some("worker-secret"));
    let _data_key_guard = test_support::set_data_key_env(None);
    let db = Db::open_in_memory().expect("open db");
    test_support::seed_workspace_with_repo_root(&db, "workspace-1", "local", "/tmp/workspace-1");
    AppState::new(
        PathBuf::from(format!("/tmp/anyharness-wf-route-{}", Uuid::new_v4())),
        "http://127.0.0.1:8457".to_string(),
        db,
        false,
        AgentSeedStore::not_configured_dev(),
    )
    .expect("build app state")
}

fn effect_counts(state: &AppState) -> [i64; 5] {
    state
        .db
        .with_conn(|conn| {
            Ok([
                conn.query_row("SELECT COUNT(*) FROM workflow_runs", [], |row| row.get(0))?,
                conn.query_row("SELECT COUNT(*) FROM workflow_step_runs", [], |row| {
                    row.get(0)
                })?,
                conn.query_row("SELECT COUNT(*) FROM workflow_observations", [], |row| {
                    row.get(0)
                })?,
                conn.query_row("SELECT COUNT(*) FROM workflow_effects", [], |row| {
                    row.get(0)
                })?,
                conn.query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))?,
            ])
        })
        .expect("count route side effects")
}

fn request_payload() -> Value {
    const RUN_ID: &str = "11111111-1111-4111-8111-111111111111";
    const WORKFLOW_ID: &str = "22222222-2222-4222-8222-222222222222";
    const VERSION_ID: &str = "33333333-3333-4333-8333-333333333333";
    const COMMIT: &str = "1111111111111111111111111111111111111111";
    let mut plan = json!({
        "planVersion": 1,
        "planHash": "",
        "run_id": RUN_ID,
        "workflow_id": WORKFLOW_ID,
        "workflow_version_id": VERSION_ID,
        "version_n": 1,
        "trigger_kind": "manual",
        "target_mode": "local",
        "sourceIntent": {"kind": "local_commit", "resolvedCommit": COMMIT},
        "isolation": "workspace",
        "sessions": {},
        "inputs": {},
        "steps": []
    });
    let plan_hash = content_hash_excluding(&plan, "planHash").unwrap();
    plan["planHash"] = Value::String(plan_hash.clone());
    let mut binding = json!({
        "schemaVersion": 1,
        "target": "local",
        "sourceKind": "local_commit",
        "repositoryObjectFormat": "sha1",
        "baseCommitOid": "1111111111111111111111111111111111111111",
        "workspaceId": "workspace-1",
        "workspaceGeneration": 1,
        "materializationId": "materialization-1",
        "executorId": "executor-1",
        "executorGeneration": 1,
        "bindingHash": ""
    });
    let binding_hash = content_hash_excluding(&binding, "bindingHash").unwrap();
    binding["bindingHash"] = Value::String(binding_hash.clone());
    json!({
        "plan": plan,
        "workspaceId": "workspace-1",
        "deliveryIdentity": {
            "schemaVersion": 1,
        "runId": RUN_ID,
            "planHash": plan_hash,
            "bindingHash": binding_hash,
            "executionGeneration": 1
        },
        "binding": binding
    })
}

async fn body(response: axum::response::Response) -> Value {
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test(flavor = "current_thread")]
async fn delivery_route_auth_and_final_gate_have_zero_side_effects() {
    let state = state();
    let before = effect_counts(&state);
    let app = build_router(state.clone());
    for authorization in [None, Some("Bearer forged-worker-secret")] {
        let mut request = Request::builder()
            .method("POST")
            .uri("/v1/workflow-runs")
            .header(header::CONTENT_TYPE, "application/json");
        if let Some(value) = authorization {
            request = request.header(header::AUTHORIZATION, value);
        }
        let response = app
            .clone()
            .oneshot(request.body(Body::from("{}")).expect("request"))
            .await
            .expect("route response");
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(effect_counts(&state), before);
    }

    for auth in [
        AuthContext::Unauthenticated,
        AuthContext::UserClaim(UserClaimAuth {
            user_id: "user-1".to_string(),
            organization_id: "org-1".to_string(),
            target_id: "target-1".to_string(),
            cloud_workspace_id: "cloud-workspace-1".to_string(),
            anyharness_workspace_id: "workspace-1".to_string(),
            cloud_session_id: None,
            anyharness_session_id: None,
            claim_id: "claim-1".to_string(),
            permissions: ClaimPermissions {
                read: true,
                write: true,
                control: true,
            },
            jti: "jti-1".to_string(),
            expires_at: i64::MAX,
        }),
    ] {
        let response = create_workflow_run(State(state.clone()), Extension(auth), Json(json!({})))
            .await
            .expect_err("user contexts cannot deliver")
            .into_response();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            body(response).await["code"],
            "WORKFLOW_DELIVERY_WORKER_AUTH_REQUIRED"
        );
        assert_eq!(effect_counts(&state), before);
    }

    let payload = request_payload();
    let binding = payload["binding"].as_object().unwrap();
    assert!(!binding.contains_key("checkpointId"));
    assert!(!binding.contains_key("checkpointContentHash"));
    assert_eq!(
        content_hash_excluding(&payload["binding"], "bindingHash").unwrap(),
        payload["binding"]["bindingHash"]
    );

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/workflow-runs")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::AUTHORIZATION, "Bearer worker-secret")
                .body(Body::from(payload.to_string()))
                .unwrap(),
        )
        .await
        .expect("worker delivery response");
    assert_eq!(response.status(), StatusCode::CONFLICT);
    assert_eq!(body(response).await["code"], "FINAL_ENVELOPE_REQUIRED");
    assert_eq!(effect_counts(&state), before);
}

#[tokio::test(flavor = "current_thread")]
async fn delivery_route_rejects_null_checkpoint_members_before_preflight() {
    let state = state();
    let before = effect_counts(&state);
    let app = build_router(state.clone());

    for fields in [
        vec!["checkpointId"],
        vec!["checkpointContentHash"],
        vec!["checkpointId", "checkpointContentHash"],
    ] {
        let mut payload = request_payload();
        let binding = payload["binding"].as_object_mut().unwrap();
        for field in fields {
            binding.insert(field.to_string(), Value::Null);
        }

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/workflow-runs")
                    .header(header::CONTENT_TYPE, "application/json")
                    .header(header::AUTHORIZATION, "Bearer worker-secret")
                    .body(Body::from(payload.to_string()))
                    .unwrap(),
            )
            .await
            .expect("worker delivery response");
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            body(response).await["code"],
            "WORKFLOW_DELIVERY_REQUEST_INVALID"
        );
        assert_eq!(effect_counts(&state), before);
    }
}
