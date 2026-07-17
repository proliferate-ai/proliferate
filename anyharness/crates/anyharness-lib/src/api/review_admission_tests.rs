use std::sync::Mutex;

use axum::{
    body::{to_bytes, Body},
    http::{header, Request, StatusCode},
};
use serde_json::{json, Value};
use tower::util::ServiceExt;

use super::router::build_router;
use super::workflow_runs_tests::test_state;
use crate::app::test_support;
use crate::domains::plans::model::NewPlan;
use crate::domains::plans::service::PlanEventContext;

const WORKSPACE_ID: &str = "20000000-0000-4000-8000-000000000002";
const SESSION_ID: &str = "30000000-0000-4000-8000-000000000003";

#[tokio::test]
async fn plan_lookup_error_fails_closed_before_review_side_effects() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let _guard = test_support::set_bearer_token_env(None);
    let state = test_state();
    test_support::seed_workspace_with_repo_root(
        &state.db,
        WORKSPACE_ID,
        "local",
        "/tmp/review-admission-workspace",
    );
    state
        .db
        .with_conn(|conn| {
            conn.execute(
                "INSERT INTO sessions (
                    id, workspace_id, agent_kind, status, created_at, updated_at
                 ) VALUES (?1, ?2, 'claude', 'idle', 'now', 'now')",
                [SESSION_ID, WORKSPACE_ID],
            )?;
            Ok(())
        })
        .expect("seed parent session");
    let plan = state
        .plan_service
        .create_completed_plan(
            NewPlan {
                workspace_id: WORKSPACE_ID.to_string(),
                session_id: SESSION_ID.to_string(),
                title: "Review target".to_string(),
                body_markdown: "Verify the implementation.".to_string(),
                source_agent_kind: "claude".to_string(),
                source_kind: "claude_exit_plan_mode".to_string(),
                source_turn_id: Some("turn-1".to_string()),
                source_item_id: Some("item-1".to_string()),
                source_tool_call_id: Some("tool-1".to_string()),
            },
            PlanEventContext {
                session_id: SESSION_ID.to_string(),
                source_agent_kind: "claude".to_string(),
                turn_id: Some("turn-1".to_string()),
                next_seq: 1,
            },
        )
        .expect("create plan")
        .plan;
    let sessions_before = state
        .session_service
        .store()
        .list_all()
        .expect("list sessions before");

    state.plan_service.store().fail_next_find_by_id_for_test();
    let response = build_router(state.clone())
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!(
                    "/v1/workspaces/{WORKSPACE_ID}/plans/{}/review",
                    plan.id
                ))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "parentSessionId": SESSION_ID,
                        "maxRounds": 1,
                        "autoIterate": false,
                        "reviewers": [{
                            "personaId": "reviewer-1",
                            "label": "Reviewer",
                            "prompt": "Review carefully.",
                            "agentKind": "claude"
                        }]
                    })
                    .to_string(),
                ))
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    let body: Value = serde_json::from_slice(
        &to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("response body"),
    )
    .expect("problem details");
    assert_eq!(body["detail"], "Failed to load review plan");
    assert!(!body.to_string().contains("private-test-marker"));

    assert!(state
        .plan_service
        .get(&plan.id)
        .expect("fail-once lookup is consumed")
        .is_some());
    assert!(state
        .review_service
        .store()
        .list_runs_for_parent(SESSION_ID)
        .expect("list review runs")
        .is_empty());
    assert_eq!(
        state
            .session_service
            .store()
            .list_all()
            .expect("list sessions after")
            .len(),
        sessions_before.len(),
        "a failed admission lookup must not create reviewer sessions or actors"
    );
}
