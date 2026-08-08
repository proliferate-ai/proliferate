//! Behavioral proofs for the human wake route
//! (`POST /v1/sessions/{session_id}/wakes/{target_session_id}`): the success
//! shape, the refusal matrix, and the scope the TARGET has to clear.
//!
//! The refusal cases run over the real router; the scope case calls the handler
//! with a direct-attach user claim, which is the only way to exercise a scoped
//! token without minting one through the auth manager.

use std::sync::Mutex;

use anyharness_contract::v1::ScheduleAgentWakeRequest;
use axum::{
    body::{to_bytes, Body},
    extract::{Path, State},
    http::{header, Request, StatusCode},
    Extension, Json,
};
use serde_json::Value;
use tower::util::ServiceExt;

use super::auth::{AuthContext, ClaimPermissions, UserClaimAuth};
use super::http::sessions_wakes::schedule_agent_wake;
use super::router::build_router;
use super::workflow_runs_tests::test_state;
use crate::app::{test_support, AppState};
use crate::domains::sessions::model::{SessionMcpBindingPolicy, SessionRecord};

const WS: &str = "20000000-0000-4000-8000-000000000002";
const OTHER_WS: &str = "20000000-0000-4000-8000-000000000003";

fn insert_agent_session(state: &AppState, workspace_id: &str, id: &str, title: &str) -> String {
    let now = chrono::Utc::now().to_rfc3339();
    let record = SessionRecord {
        id: id.to_string(),
        workspace_id: workspace_id.to_string(),
        agent_kind: "claude".to_string(),
        native_session_id: None,
        agent_auth_contexts: None,
        requested_model_id: None,
        current_model_id: None,
        requested_mode_id: None,
        current_mode_id: None,
        title: Some(title.to_string()),
        thinking_level_id: None,
        thinking_budget_tokens: None,
        status: "idle".to_string(),
        created_at: now.clone(),
        updated_at: now,
        last_prompt_at: None,
        closed_at: None,
        dismissed_at: None,
        mcp_bindings_ciphertext: None,
        mcp_binding_summaries_json: None,
        // An ordinary agent, not runtime plumbing: `internal_only` sessions are
        // refused as a wake target on purpose.
        mcp_binding_policy: SessionMcpBindingPolicy::InheritWorkspace,
        system_prompt_append: None,
        subagents_enabled: true,
        action_capabilities_json: None,
        origin: None,
    };
    state
        .session_service
        .store()
        .insert(&record)
        .expect("insert session");
    id.to_string()
}

fn close_session(state: &AppState, session_id: &str) {
    let now = chrono::Utc::now().to_rfc3339();
    let store = state.session_service.store();
    store
        .update_status(session_id, "closed", &now)
        .expect("status closed");
    store
        .mark_closed(session_id, &now)
        .expect("stamp closed_at");
}

async fn arm(state: &AppState, watcher: &str, target: &str) -> (StatusCode, Value) {
    let request = Request::builder()
        .method("POST")
        .uri(format!("/v1/sessions/{watcher}/wakes/{target}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .expect("request");
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

fn workspace_scoped_claim(workspace_id: &str) -> AuthContext {
    AuthContext::UserClaim(UserClaimAuth {
        user_id: "user-1".to_string(),
        organization_id: "org-1".to_string(),
        target_id: "target-1".to_string(),
        cloud_workspace_id: "cloud-workspace-1".to_string(),
        anyharness_workspace_id: workspace_id.to_string(),
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
    })
}

fn wake_fixture() -> (AppState, String, String) {
    let state = test_state();
    test_support::seed_workspace_with_repo_root(&state.db, WS, "local", "/tmp/wake-ws");
    let watcher = insert_agent_session(&state, WS, "ses_wake_watcher", "Deploy Checker");
    let target = insert_agent_session(&state, WS, "ses_wake_target", "Schema audit");
    (state, watcher, target)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_route_arms_one_schedule_and_reports_a_repeat_as_already_scheduled() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let _guard = test_support::set_bearer_token_env(None);
    let (state, watcher, target) = wake_fixture();

    let (status, body) = arm(&state, &watcher, &target).await;

    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["watcherSessionId"], watcher);
    assert_eq!(body["targetSessionId"], target);
    assert_eq!(body["wakeScheduled"], true);
    assert_eq!(body["alreadyScheduled"], false);
    assert_eq!(
        state
            .session_service
            .store()
            .list_agent_wakes_for_target(&target)
            .expect("list schedules")
            .len(),
        1
    );

    // The pair is the primary key, so a repeat is one row and one wake.
    let (status, body) = arm(&state, &watcher, &target).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["alreadyScheduled"], true);
    assert_eq!(
        state
            .session_service
            .store()
            .list_agent_wakes_for_target(&target)
            .expect("list schedules")
            .len(),
        1
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_route_refuses_a_self_wake_an_unknown_target_and_a_closed_one() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let _guard = test_support::set_bearer_token_env(None);
    let (state, watcher, target) = wake_fixture();

    let (status, body) = arm(&state, &watcher, &watcher).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert_eq!(body["code"], "INVALID_TARGET");

    let (status, body) = arm(&state, &watcher, "ses_wake_ghost").await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");
    assert_eq!(body["code"], "SESSION_NOT_FOUND");

    close_session(&state, &target);
    let (status, body) = arm(&state, &watcher, &target).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["code"], "SESSION_CLOSED");

    assert!(state
        .session_service
        .store()
        .list_agent_wakes_for_watcher(&watcher)
        .expect("list schedules")
        .is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_scoped_token_cannot_arm_on_a_target_outside_its_scope() {
    // M1. Reach is runtime-wide for AGENTS (`authorize`); a human token reaches
    // only what its scope already shows, or a workspace-scoped token could arm
    // across workspaces and then read the target's title back out of the
    // pointer the wake fires.
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let _guard = test_support::set_bearer_token_env(None);
    let (state, watcher, target) = wake_fixture();
    test_support::seed_workspace_with_repo_root(&state.db, OTHER_WS, "local", "/tmp/wake-ws-other");
    let foreign = insert_agent_session(&state, OTHER_WS, "ses_wake_foreign", "Other workspace");

    let error = schedule_agent_wake(
        State(state.clone()),
        Extension(workspace_scoped_claim(WS)),
        Path((watcher.clone(), foreign.clone())),
        Json(ScheduleAgentWakeRequest {}),
    )
    .await
    .err()
    .expect("a foreign target is refused");
    // The SAME refusal a session that does not exist gets: the status spread
    // must not answer "does this id exist elsewhere?".
    assert_eq!(error.status(), StatusCode::NOT_FOUND);
    assert_eq!(error.code(), Some("SESSION_NOT_FOUND"));
    let ghost = schedule_agent_wake(
        State(state.clone()),
        Extension(workspace_scoped_claim(WS)),
        Path((watcher.clone(), "ses_wake_ghost".to_string())),
        Json(ScheduleAgentWakeRequest {}),
    )
    .await
    .err()
    .expect("an unknown target is refused");
    assert_eq!(ghost.status(), error.status());
    assert_eq!(ghost.code(), error.code());
    assert!(state
        .session_service
        .store()
        .list_agent_wakes_for_watcher(&watcher)
        .expect("list schedules")
        .is_empty());

    // Negative control: the same claim, the same route, an in-scope target —
    // the refusal above is the scope check and not a blanket block.
    let armed = schedule_agent_wake(
        State(state.clone()),
        Extension(workspace_scoped_claim(WS)),
        Path((watcher.clone(), target.clone())),
        Json(ScheduleAgentWakeRequest {}),
    )
    .await;
    let Ok(Json(armed)) = armed else {
        panic!("an in-scope target must be armed");
    };
    assert_eq!(armed.target_session_id, target);
    assert!(armed.wake_scheduled);
    assert_eq!(
        state
            .session_service
            .store()
            .list_agent_wakes_for_target(&target)
            .expect("list schedules")
            .len(),
        1
    );
}
