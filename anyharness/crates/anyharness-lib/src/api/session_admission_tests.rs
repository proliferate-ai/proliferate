//! Spec 2b merge-gated proofs over the admission surface: source semantics
//! against the REAL controller policy and durable rows, the full fenced-route
//! conflict matrix (before any side effect), read/cosmetic availability, and
//! the fail-closed purge/mobility posture. The executor-ordering races live
//! with the workflow suite (`workflow_runs_tests`).

use std::sync::Mutex;

use axum::{
    body::{to_bytes, Body},
    http::{header, Request, StatusCode},
};
use serde_json::{json, Value};
use tower::util::ServiceExt;

use super::router::build_router;
use super::workflow_runs_tests::{get as get_run, test_state};
use crate::app::{test_support, AppState};
use crate::domains::sessions::admission::{
    SessionMutationConflict, SessionMutationKind, SessionMutationSource,
};
use crate::domains::workflows::service::WorkflowRunService;
use crate::domains::workflows::store::WorkflowRunStore;

const WS: &str = "20000000-0000-4000-8000-000000000002";

fn insert_session_row(state: &AppState, workspace_id: &str) -> String {
    let now = chrono::Utc::now().to_rfc3339();
    let record = crate::domains::sessions::model::SessionRecord {
        id: uuid::Uuid::new_v4().to_string(),
        workspace_id: workspace_id.to_string(),
        agent_kind: "claude".to_string(),
        native_session_id: None,
        agent_auth_contexts: None,
        requested_model_id: None,
        current_model_id: None,
        requested_mode_id: None,
        current_mode_id: None,
        title: None,
        thinking_level_id: None,
        thinking_budget_tokens: None,
        status: "starting".to_string(),
        created_at: now.clone(),
        updated_at: now,
        last_prompt_at: None,
        closed_at: None,
        dismissed_at: None,
        mcp_bindings_ciphertext: None,
        mcp_binding_summaries_json: None,
        mcp_binding_policy: crate::domains::sessions::model::SessionMcpBindingPolicy::InternalOnly,
        system_prompt_append: None,
        subagents_enabled: false,
        action_capabilities_json: None,
        origin: Some(crate::origin::OriginContext::system_local_runtime()),
    };
    state
        .session_service
        .store()
        .insert(&record)
        .expect("insert session row");
    record.id
}

fn controlled_fixture(state: &AppState) -> (String, String) {
    test_support::seed_workspace_with_repo_root(&state.db, WS, "local", "/tmp/admission-ws");
    let session_id = insert_session_row(state, WS);
    let service = WorkflowRunService::new(WorkflowRunStore::new(state.db.clone()));
    let run_id = uuid::Uuid::new_v4().to_string();
    service
        .accept(
            &run_id,
            super::workflow_runs_tests::domain_input_for_workspace(WS),
        )
        .expect("accept");
    assert!(service.begin_run(&run_id).expect("begin_run"));
    assert!(service
        .bind_session(&run_id, &session_id)
        .expect("bind_session"));
    (run_id, session_id)
}

async fn call(
    state: &AppState,
    method: &str,
    uri: String,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut builder = Request::builder().method(method).uri(uri);
    let request = match body {
        Some(value) => builder
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(serde_json::to_vec(&value).expect("body")))
            .expect("request"),
        None => builder.body(Body::empty()).expect("request"),
    };
    let response = build_router(state.clone())
        .oneshot(request)
        .await
        .expect("response");
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("bytes");
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn foreign_and_stale_workflow_sources_denied_owning_admitted() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let _guard = test_support::set_bearer_token_env(None);
    let state = test_state();
    let (run_id, session_id) = controlled_fixture(&state);

    // External denied.
    match state
        .session_admission
        .acquire(
            &session_id,
            SessionMutationKind::Prompt,
            &SessionMutationSource::external(),
        )
        .await
    {
        Err(SessionMutationConflict::ControlledByWorkflow { run_id: owner }) => {
            assert_eq!(owner, run_id);
        }
        Err(other) => panic!("external source must conflict cleanly: {other:?}"),
        Ok(_permit) => panic!("external source must conflict, not be admitted"),
    }

    // A STALE/foreign workflow source (a different run id) is denied exactly
    // like any external caller — no cross-run authority.
    let stale = SessionMutationSource::workflow_run("11111111-1111-4111-8111-111111111111");
    assert!(matches!(
        state
            .session_admission
            .acquire(&session_id, SessionMutationKind::Cancel, &stale)
            .await,
        Err(SessionMutationConflict::ControlledByWorkflow { .. })
    ));

    // The OWNING workflow source is admitted.
    let owning = SessionMutationSource::workflow_run(&run_id);
    assert!(state
        .session_admission
        .acquire(&session_id, SessionMutationKind::Cancel, &owning)
        .await
        .is_ok());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn every_fenced_route_conflicts_before_side_effects_and_reads_stay_available() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let _guard = test_support::set_bearer_token_env(None);
    let state = test_state();
    let (_run_id, sid) = controlled_fixture(&state);

    let prompt_body = json!({"blocks": [{"type": "text", "text": "foreign"}]});
    let cases: Vec<(&str, String, Option<Value>)> = vec![
        (
            "POST",
            format!("/v1/sessions/{sid}/prompt"),
            Some(prompt_body.clone()),
        ),
        (
            "PATCH",
            format!("/v1/sessions/{sid}/pending-prompts/1"),
            Some(prompt_body.clone()),
        ),
        (
            "DELETE",
            format!("/v1/sessions/{sid}/pending-prompts/1"),
            None,
        ),
        (
            "PUT",
            format!("/v1/sessions/{sid}/pending-prompts/order"),
            Some(json!({"expectedSeqs": [], "desiredSeqs": []})),
        ),
        (
            "POST",
            format!("/v1/sessions/{sid}/pending-prompts/1/steer"),
            None,
        ),
        (
            "POST",
            format!("/v1/sessions/{sid}/config-options"),
            Some(json!({"configId": "effort", "value": "low"})),
        ),
        ("POST", format!("/v1/sessions/{sid}/cancel"), None),
        ("POST", format!("/v1/sessions/{sid}/close"), None),
        ("POST", format!("/v1/sessions/{sid}/dismiss"), None),
        (
            "POST",
            format!("/v1/sessions/{sid}/resume"),
            Some(json!({})),
        ),
        ("POST", format!("/v1/sessions/{sid}/fork"), Some(json!({}))),
        (
            "POST",
            format!("/v1/sessions/{sid}/interactions/req-1/resolve"),
            Some(json!({"outcome": "dismissed"})),
        ),
        (
            "PUT",
            format!("/v1/sessions/{sid}/goal"),
            Some(json!({"text": "goal"})),
        ),
        ("DELETE", format!("/v1/sessions/{sid}/goal"), None),
        (
            "PUT",
            format!("/v1/sessions/{sid}/loops"),
            Some(json!({"prompt": "loop", "schedule": {"kind": "interval", "expr": "1h"}})),
        ),
        ("DELETE", format!("/v1/sessions/{sid}/loops"), None),
        (
            "POST",
            format!("/v1/sessions/{sid}/subagents/child-1/wake"),
            Some(json!({})),
        ),
    ];
    for (method, uri, body) in cases {
        let (status, payload) = call(&state, method, uri.clone(), body).await;
        assert_eq!(
            status,
            StatusCode::CONFLICT,
            "{method} {uri} must conflict while controlled (got {status}: {payload})"
        );
        assert_eq!(
            payload["code"], "SESSION_CONTROLLED_BY_WORKFLOW",
            "{method} {uri} stable code"
        );
    }

    // No side effects: the session row is untouched and unqueued.
    let (status, session) = call(&state, "GET", format!("/v1/sessions/{sid}"), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(session["status"], "starting");
    assert!(session["lastPromptAt"].is_null());
    assert!(session.get("closedAt").map(|v| v.is_null()).unwrap_or(true));
    assert!(session
        .get("dismissedAt")
        .map(|v| v.is_null())
        .unwrap_or(true));

    // Reads stay available while controlled.
    let (status, _) = call(&state, "GET", format!("/v1/sessions/{sid}/events"), None).await;
    assert_eq!(status, StatusCode::OK);

    // Cosmetic title rename stays allowed (ruling 2).
    let (status, titled) = call(
        &state,
        "PATCH",
        format!("/v1/sessions/{sid}/title"),
        Some(json!({"title": "still mine to name"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(titled["title"], "still mine to name");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn purge_and_mobility_fail_closed_while_controlled() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let _guard = test_support::set_bearer_token_env(None);
    let state = test_state();
    let (_run_id, _sid) = controlled_fixture(&state);

    let (status, payload) = call(&state, "DELETE", format!("/v1/workspaces/{WS}"), None).await;
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "purge must fail closed while a workflow controls a session (got {status}: {payload})"
    );
    assert_eq!(payload["code"], "SESSION_CONTROLLED_BY_WORKFLOW");

    let (status, payload) = call(
        &state,
        "POST",
        format!("/v1/workspaces/{WS}/mobility/export"),
        Some(json!({})),
    )
    .await;
    assert!(
        status == StatusCode::CONFLICT || status == StatusCode::NOT_FOUND,
        "mobility export must not proceed while controlled (got {status}: {payload})"
    );
    if status == StatusCode::CONFLICT {
        assert_eq!(payload["code"], "SESSION_CONTROLLED_BY_WORKFLOW");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn ordinary_sessions_keep_existing_behavior() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let _guard = test_support::set_bearer_token_env(None);
    let state = test_state();
    test_support::seed_workspace_with_repo_root(&state.db, WS, "local", "/tmp/admission-ord");
    let sid = insert_session_row(&state, WS);

    // Uncontrolled: admission admits External; the mutation proceeds to its
    // ordinary downstream outcome (dismiss succeeds end-to-end).
    let (status, dismissed) =
        call(&state, "POST", format!("/v1/sessions/{sid}/dismiss"), None).await;
    assert_eq!(status, StatusCode::OK, "{dismissed}");
}
