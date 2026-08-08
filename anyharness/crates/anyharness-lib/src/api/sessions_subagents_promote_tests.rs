//! Behavioral proofs for the HUMAN promote route
//! (`POST /v1/sessions/{session_id}/subagents/{child_session_id}/promote`).
//!
//! ADR §4 puts Promote in the agent detail header and ruling 7 lets either the
//! parent agent or the human do it, so this route and
//! `agent_ops::calls::promote_subagent` must mean the same thing: one
//! idempotent stamp on the caller's own link, and a refusal otherwise. These
//! run over the real router, the same way the wake-route proofs do.

use std::sync::Mutex;

use axum::{
    body::{to_bytes, Body},
    http::{header, Request, StatusCode},
};
use serde_json::Value;
use tower::util::ServiceExt;

use super::router::build_router;
use super::workflow_runs_tests::test_state;
use crate::app::{test_support, AppState};
use crate::domains::sessions::model::{SessionMcpBindingPolicy, SessionRecord};

const WS: &str = "20000000-0000-4000-8000-000000000012";

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

async fn promote(state: &AppState, parent: &str, child: &str) -> (StatusCode, Value) {
    let request = Request::builder()
        .method("POST")
        .uri(format!("/v1/sessions/{parent}/subagents/{child}/promote"))
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

/// A parent, its linked subagent, and one unrelated session in the same
/// workspace — the third one is what "you do not own that" is proved against.
fn promote_fixture() -> (AppState, String, String, String) {
    let state = test_state();
    test_support::seed_workspace_with_repo_root(&state.db, WS, "local", "/tmp/promote-ws");
    let parent = insert_agent_session(&state, WS, "ses_promote_parent", "Refactor billing");
    let child = insert_agent_session(&state, WS, "ses_promote_child", "Audit retry schema");
    let stranger = insert_agent_session(&state, WS, "ses_promote_stranger", "Docs pass");
    state
        .subagent_service
        .link_child(
            &parent,
            &child,
            Some("Audit retry schema".to_string()),
            None,
            None,
        )
        .expect("link subagent");
    (state, parent, child, stranger)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_route_promotes_once_and_reports_a_repeat_as_already_promoted() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let _guard = test_support::set_bearer_token_env(None);
    let (state, parent, child, _stranger) = promote_fixture();

    let (status, body) = promote(&state, &parent, &child).await;

    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["parentSessionId"], parent);
    assert_eq!(body["childSessionId"], child);
    assert_eq!(body["promoted"], true);
    assert_eq!(body["alreadyPromoted"], false);
    let promoted_at = body["promotedAt"]
        .as_str()
        .expect("promotedAt is stamped")
        .to_string();

    // ADR §3.2: promotion is a STAMP, not a new row. The link keeps
    // `relation = 'subagent'` so the former parent stays an owner.
    let link = state
        .subagent_service
        .link_service()
        .find_owned_link_including_closed(&parent, &child)
        .expect("read link")
        .expect("link still exists");
    assert!(link.promoted_at.is_some(), "promotion must stamp the link");

    // Idempotent: the second call reports the FIRST call's timestamp and writes
    // nothing, so a retried request cannot move the stamp.
    let (status, body) = promote(&state, &parent, &child).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["alreadyPromoted"], true);
    assert_eq!(body["promotedAt"], promoted_at);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_route_refuses_an_unowned_agent_an_unknown_one_and_itself() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let _guard = test_support::set_bearer_token_env(None);
    let (state, parent, child, stranger) = promote_fixture();

    // A real session the caller does not own. Ownership is not reachability, so
    // this is a 409 rather than a 404 that would deny the session exists.
    let (status, body) = promote(&state, &parent, &stranger).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["code"], "SUBAGENT_NOT_OWNED");

    // An unknown child has no link either, so it lands in the same refusal —
    // the route never distinguishes "no such agent" from "not yours", which is
    // what keeps it from being an existence oracle.
    let (status, body) = promote(&state, &parent, "ses_promote_ghost").await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["code"], "SUBAGENT_NOT_OWNED");

    // An unknown PARENT is a 404: the route reads it before anything else, and
    // the caller named its own session.
    let (status, body) = promote(&state, "ses_promote_ghost_parent", &child).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");
    assert_eq!(body["code"], "SESSION_NOT_FOUND");

    // Self-promotion is a 400 in this file's own `SUBAGENT_*` family, not the
    // wake route's `INVALID_TARGET`.
    let (status, body) = promote(&state, &parent, &parent).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert_eq!(body["code"], "SUBAGENT_SELF_TARGET");

    // None of the refusals wrote anything.
    let link = state
        .subagent_service
        .link_service()
        .find_owned_link_including_closed(&parent, &child)
        .expect("read link")
        .expect("link still exists");
    assert!(
        link.promoted_at.is_none(),
        "a refused promotion must not stamp the link"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn promotion_stamps_the_child_summary_without_moving_it_to_owned_agents() {
    // ADR §3.2 spells the promoted state as `relation = 'subagent'` PLUS
    // `promoted_at`, because the row also records how the agent came to be. So
    // the summaries must report the stamp on the child the pane already knows —
    // moving it into `ownedAgents` would erase the fact that it was spawned as
    // a subagent, and `ownedAgents` is `spawn_agent`'s list.
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let _guard = test_support::set_bearer_token_env(None);
    let (state, parent, child, _stranger) = promote_fixture();

    let before = state
        .subagent_service
        .subagent_context(&parent)
        .expect("context before");
    assert_eq!(before.children.len(), 1);
    assert!(before.children[0].promoted_at.is_none());
    assert!(before.owned_agents.is_empty());

    let (status, body) = promote(&state, &parent, &child).await;
    assert_eq!(status, StatusCode::OK, "{body}");

    let after = state
        .subagent_service
        .subagent_context(&parent)
        .expect("context after");
    assert_eq!(after.children.len(), 1);
    assert!(
        after.children[0].promoted_at.is_some(),
        "the child summary must carry the promotion stamp — it is what the pane's Promoted \
         badge and the disabled Promote action both read"
    );
    assert!(
        after.owned_agents.is_empty(),
        "promotion must not write an owned_agent row: `spawn_agent` is that relation's only \
         producer, and a promoted agent would then appear twice"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn owned_peers_populate_their_own_list_and_never_the_fanout() {
    // `ownedAgents` is the peer list `spawn_agent` writes. Every consumer of
    // `children` reads it as a fanout — a cap count, a depth rule, a close
    // cascade — so a peer arriving in there would be counted and cascaded as
    // something it is not.
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let _guard = test_support::set_bearer_token_env(None);
    let (state, parent, child, peer) = promote_fixture();

    state
        .agent_ownership_service
        .link_owned_agent(&parent, WS, &peer, WS, Some("Docs pass".to_string()))
        .expect("link owned agent");

    let context = state
        .subagent_service
        .subagent_context(&parent)
        .expect("context");

    assert_eq!(context.owned_agents.len(), 1);
    assert_eq!(context.owned_agents[0].agent_session_id, peer);
    assert_eq!(context.owned_agents[0].label.as_deref(), Some("Docs pass"));
    assert_eq!(
        context
            .children
            .iter()
            .map(|entry| entry.child_session_id.as_str())
            .collect::<Vec<_>>(),
        vec![child.as_str()],
        "an owned peer must never arrive inside the subagent fanout"
    );
}
