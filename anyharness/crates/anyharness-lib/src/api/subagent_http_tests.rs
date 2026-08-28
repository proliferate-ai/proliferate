use super::*;
use axum::http::Method;

use crate::api::auth::{user_route_allowed, AuthError, ClaimPermissions, UserClaimAuth};
use crate::domains::agent_operations::model::ListAgentsInput;
use crate::domains::sessions::extensions::SessionTurnOutcome;
use crate::domains::sessions::links::completions::LinkCompletionStore;
use crate::domains::sessions::links::model::{
    SessionLinkRecord, SessionLinkRelation, SessionLinkWorkspaceRelation,
};
use crate::domains::sessions::links::service::SessionLinkService;
use crate::domains::sessions::links::store::SessionLinkStore;
use crate::domains::sessions::store::SessionStore;
use crate::domains::sessions::subagents::model::SubagentCompletionRecord;
use crate::live::sessions::ScriptedSessionSpec;

const OTHER_WS: &str = "30000000-0000-4000-8000-000000000003";

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn workspace_and_parent_rosters_project_only_current_subagents() {
    let _lock = test_support::lock_env().await;
    let _guard = test_support::set_bearer_token_env(None);
    let state = test_state();
    test_support::seed_workspace_with_repo_root(&state.db, WS, "local", "/tmp/roster-ws");
    test_support::seed_workspace_with_repo_root(
        &state.db,
        OTHER_WS,
        "local",
        "/tmp/roster-other-ws",
    );

    let later_parent = insert_session_row(&state, WS);
    let earlier_parent = insert_session_row(&state, WS);
    let first_child = insert_session_row(&state, WS);
    let closed_child = insert_session_row(&state, WS);
    let later_child = insert_session_row(&state, WS);
    let generic_closed_child = insert_session_row(&state, WS);
    let review_child = insert_session_row(&state, WS);
    let other_workspace_parent = insert_session_row(&state, OTHER_WS);
    let other_workspace_child = insert_session_row(&state, OTHER_WS);
    set_created_at(&state, &later_parent, "2026-08-11T02:00:00Z");
    set_created_at(&state, &earlier_parent, "2026-08-11T01:00:00Z");

    let closed_link = link(
        "link-closed",
        SessionLinkRelation::Subagent,
        &earlier_parent,
        &closed_child,
        "2026-08-11T01:01:00Z",
    );
    let first_link = link(
        "link-first",
        SessionLinkRelation::Subagent,
        &earlier_parent,
        &first_child,
        "2026-08-11T01:00:00Z",
    );
    let mut generic_closed_link = link(
        "link-generic-closed",
        SessionLinkRelation::Subagent,
        &later_parent,
        &generic_closed_child,
        "2026-08-11T02:00:00Z",
    );
    generic_closed_link.closed_at = Some("2026-08-11T03:00:00Z".into());
    let review_link = link(
        "link-review",
        SessionLinkRelation::ReviewAgent,
        &later_parent,
        &review_child,
        "2026-08-11T02:01:00Z",
    );
    let later_link = link(
        "link-later",
        SessionLinkRelation::Subagent,
        &later_parent,
        &later_child,
        "2026-08-11T02:02:00Z",
    );
    let other_link = link(
        "link-other-workspace",
        SessionLinkRelation::Subagent,
        &other_workspace_parent,
        &other_workspace_child,
        "2026-08-11T02:03:00Z",
    );
    let link_service = SessionLinkService::new(
        SessionLinkStore::new(state.db.clone()),
        SessionStore::new(state.db.clone()),
    );
    for record in [
        &closed_link,
        &first_link,
        &generic_closed_link,
        &review_link,
        &later_link,
        &other_link,
    ] {
        link_service.import_link(record).expect("import link");
    }
    state
        .session_runtime
        .close_subagent(&earlier_parent, &closed_child)
        .await
        .expect("reversibly close child");
    LinkCompletionStore::new(state.db.clone())
        .import_completion(&SubagentCompletionRecord {
            completion_id: "completion-latest".into(),
            session_link_id: first_link.id.clone(),
            child_turn_id: "turn-1".into(),
            child_last_event_seq: 42,
            outcome: SessionTurnOutcome::Completed,
            parent_event_seq: Some(99),
            parent_prompt_seq: Some(100),
            created_at: "2026-08-11T04:00:00Z".into(),
            updated_at: "2026-08-11T04:00:00Z".into(),
        })
        .expect("import completion");

    let (status, payload) = call(
        &state,
        "GET",
        format!("/v1/workspaces/{WS}/subagents"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{payload}");
    assert_eq!(payload["workspaceId"], WS);
    let parents = payload["parents"].as_array().expect("parents");
    assert_eq!(parents.len(), 2);
    assert_eq!(
        parents[0]["parent"]["identity"]["sessionId"],
        earlier_parent
    );
    assert_eq!(
        parents[1]["parent"]["identity"]["sessionId"], later_parent,
        "parents are ordered by durable creation time then identity"
    );
    assert_eq!(
        parents[1]["children"][0]["relationship"]["sessionLinkId"], "link-later",
        "generic-closed and non-subagent links are excluded"
    );
    let children = parents[0]["children"].as_array().expect("children");
    assert_eq!(children.len(), 2);
    assert_eq!(children[0]["relationship"]["sessionLinkId"], "link-first");
    assert_eq!(
        children[0]["latestCompletion"]["completionId"],
        "completion-latest"
    );
    assert_eq!(children[0]["latestCompletion"]["outcome"], "completed");
    assert!(children[0]["latestCompletion"]
        .get("parentPromptSeq")
        .is_none());
    assert_eq!(children[1]["relationship"]["sessionLinkId"], "link-closed");
    assert_eq!(children[1]["agent"]["status"]["presentation"], "closed");
    assert_eq!(children[1]["agent"]["status"]["execution"], "closed");
    assert_eq!(children[1]["agent"]["status"]["hasLiveActor"], false);
    assert_eq!(children[1]["agent"]["parent"]["sessionId"], earlier_parent);

    let (status, parent_payload) = call(
        &state,
        "GET",
        format!("/v1/sessions/{earlier_parent}/subagents"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{parent_payload}");
    assert_eq!(
        parent_payload["parent"]["identity"]["sessionId"],
        earlier_parent
    );
    assert_eq!(
        parent_payload["children"],
        payload["parents"][0]["children"]
    );

    let (status, child_payload) = call(
        &state,
        "GET",
        format!("/v1/sessions/{first_child}/subagents"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{child_payload}");
    assert_eq!(
        child_payload["parent"]["identity"]["sessionId"],
        first_child
    );
    assert_eq!(
        child_payload["parent"]["parent"]["sessionId"],
        earlier_parent
    );
    assert_eq!(child_payload["children"], json!([]));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn lifecycle_routes_preserve_identity_are_idempotent_and_hide_non_targets() {
    let _lock = test_support::lock_env().await;
    let _guard = test_support::set_bearer_token_env(None);
    let state = test_state();
    test_support::seed_workspace_with_repo_root(&state.db, WS, "local", "/tmp/lifecycle-ws");
    let parent = insert_session_row(&state, WS);
    let wrong_parent = insert_session_row(&state, WS);
    let close_child = insert_session_row(&state, WS);
    let open_child = insert_session_row(&state, WS);
    let promote_child = insert_session_row(&state, WS);
    let closed_promote_child = insert_session_row(&state, WS);
    let controlled_child = insert_session_row(&state, WS);
    for child in [
        &close_child,
        &open_child,
        &promote_child,
        &closed_promote_child,
        &controlled_child,
    ] {
        state
            .subagent_service
            .link_child(&parent, child, None, None, None)
            .expect("link child");
    }

    for _ in 0..2 {
        let (status, payload) = call(
            &state,
            "POST",
            format!("/v1/sessions/{parent}/subagents/{close_child}/close"),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{payload}");
        assert_eq!(payload["agent"]["identity"]["sessionId"], close_child);
        assert_eq!(payload["agent"]["role"], "subagent");
        assert_eq!(payload["agent"]["parent"]["sessionId"], parent);
        assert_eq!(payload["agent"]["status"]["presentation"], "closed");
        assert_eq!(payload["relationship"]["childSessionId"], close_child);
        assert_eq!(payload["relationship"]["parentSessionId"], parent);
        assert!(payload["relationship"]["subagentClosedAt"].is_string());
    }

    state
        .session_runtime
        .close_subagent(&parent, &open_child)
        .await
        .expect("close Open target");
    let _open_actor = state
        .session_runtime
        .acp_manager_for_test()
        .insert_scripted_session_for_test(
            &open_child,
            ScriptedSessionSpec {
                prompt_turn_id: "turn-open-http".into(),
                hold_config_replies: false,
                hold_cancel_replies: false,
            },
        )
        .await;
    for _ in 0..2 {
        let (status, payload) = call(
            &state,
            "POST",
            format!("/v1/sessions/{parent}/subagents/{open_child}/open"),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{payload}");
        assert_eq!(payload["agent"]["identity"]["sessionId"], open_child);
        assert_eq!(payload["agent"]["role"], "subagent");
        assert_eq!(payload["agent"]["status"]["presentation"], "running");
        assert_eq!(payload["agent"]["status"]["hasLiveActor"], true);
        assert_eq!(payload["relationship"]["childSessionId"], open_child);
        assert!(payload["relationship"]["subagentClosedAt"].is_null());
    }

    state
        .session_runtime
        .close_subagent(&parent, &closed_promote_child)
        .await
        .expect("close promotion target");
    let (status, payload) = call(
        &state,
        "POST",
        format!("/v1/sessions/{parent}/subagents/{closed_promote_child}/promote"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{payload}");
    assert_eq!(payload["code"], "SUBAGENT_OPEN_REQUIRED");

    let (status, payload) = call(
        &state,
        "POST",
        format!("/v1/sessions/{parent}/subagents/{promote_child}/promote"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{payload}");
    assert_eq!(payload["agent"]["identity"]["sessionId"], promote_child);
    assert_eq!(payload["agent"]["role"], "ordinary");
    assert!(payload["agent"]["parent"].is_null());
    assert!(payload.get("relationship").is_some());
    assert!(payload["relationship"].is_null());
    let page = state
        .agent_operations
        .list_agents(
            &state.agent_operations.authenticated_caller(&parent),
            ListAgentsInput {
                workspace_id: Some(WS.into()),
                ..ListAgentsInput::default()
            },
        )
        .await
        .expect("ordinary roster");
    assert!(page
        .agents
        .iter()
        .any(|agent| agent.identity.session_id == promote_child));

    let (status, parent_roster) = call(
        &state,
        "GET",
        format!("/v1/sessions/{parent}/subagents"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{parent_roster}");
    assert!(parent_roster["children"]
        .as_array()
        .expect("parent children")
        .iter()
        .all(|entry| entry["agent"]["identity"]["sessionId"] != promote_child));
    let (status, workspace_roster) = call(
        &state,
        "GET",
        format!("/v1/workspaces/{WS}/subagents"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{workspace_roster}");
    assert!(workspace_roster["parents"]
        .as_array()
        .expect("workspace parents")
        .iter()
        .flat_map(|entry| entry["children"].as_array().into_iter().flatten())
        .all(|entry| entry["agent"]["identity"]["sessionId"] != promote_child));

    let (repeat_status, repeat_payload) = call(
        &state,
        "POST",
        format!("/v1/sessions/{parent}/subagents/{promote_child}/promote"),
        None,
    )
    .await;
    assert_eq!(repeat_status, StatusCode::NOT_FOUND, "{repeat_payload}");
    assert_eq!(repeat_payload["code"], "AGENT_NOT_FOUND");

    for action in ["close", "open", "promote"] {
        let hidden_targets = [
            (
                "wrong-parent open",
                wrong_parent.as_str(),
                close_child.as_str(),
            ),
            (
                "wrong-parent closed",
                wrong_parent.as_str(),
                closed_promote_child.as_str(),
            ),
            (
                "wrong-parent running",
                wrong_parent.as_str(),
                controlled_child.as_str(),
            ),
            ("promoted", parent.as_str(), promote_child.as_str()),
            ("missing", parent.as_str(), "missing-child"),
        ];
        let mut public_not_found = None;
        for (case, request_parent, child) in hidden_targets {
            let (status, payload) = call(
                &state,
                "POST",
                format!("/v1/sessions/{request_parent}/subagents/{child}/{action}"),
                None,
            )
            .await;
            assert_eq!(status, StatusCode::NOT_FOUND, "{action} {case}: {payload}");
            assert_eq!(
                payload["code"], "AGENT_NOT_FOUND",
                "{action} {case}: {payload}"
            );
            if let Some(expected) = &public_not_found {
                assert_eq!(
                    &payload, expected,
                    "{action} {case} must be indistinguishable from other hidden targets"
                );
            } else {
                public_not_found = Some(payload);
            }
        }
    }
}

#[test]
fn subagent_http_routes_require_read_or_parent_control_with_matching_scope() {
    let read = claim(ClaimPermissions {
        read: true,
        ..ClaimPermissions::default()
    });
    assert_eq!(
        user_route_allowed(
            &Method::GET,
            &format!("/v1/workspaces/{WS}/subagents"),
            &read,
        ),
        Ok(())
    );
    assert_eq!(
        user_route_allowed(&Method::GET, "/v1/sessions/parent/subagents", &read,),
        Ok(())
    );
    assert_eq!(
        user_route_allowed(
            &Method::POST,
            "/v1/sessions/parent/subagents/child/close",
            &read,
        ),
        Err(AuthError::InsufficientPermission)
    );

    let mut control = claim(ClaimPermissions {
        control: true,
        ..ClaimPermissions::default()
    });
    control.anyharness_session_id = Some("parent".into());
    for action in ["close", "open", "promote"] {
        assert_eq!(
            user_route_allowed(
                &Method::POST,
                &format!("/v1/sessions/parent/subagents/child/{action}"),
                &control,
            ),
            Ok(())
        );
    }
    control.anyharness_session_id = Some("child".into());
    assert_eq!(
        user_route_allowed(
            &Method::POST,
            "/v1/sessions/parent/subagents/child/close",
            &control,
        ),
        Err(AuthError::ScopeMismatch),
        "lifecycle authority is scoped to the parent path identity"
    );

    let mut wrong_workspace = read;
    wrong_workspace.anyharness_workspace_id = OTHER_WS.into();
    assert_eq!(
        user_route_allowed(
            &Method::GET,
            &format!("/v1/workspaces/{WS}/subagents"),
            &wrong_workspace,
        ),
        Err(AuthError::ScopeMismatch)
    );
}

/// Forks ADR rung 2 (scope f): the fork and steer routes are reachable by a
/// direct-attached user claim at Write authority on the scoped session, and a
/// claim scoped to a different session is refused rather than falling through
/// to `UnsupportedRoute`.
#[test]
fn fork_and_steer_routes_require_write_with_matching_session_scope() {
    let mut write = claim(ClaimPermissions {
        write: true,
        ..ClaimPermissions::default()
    });
    write.anyharness_session_id = Some("s1".into());

    assert_eq!(
        user_route_allowed(&Method::POST, "/v1/sessions/s1/fork", &write),
        Ok(())
    );
    assert_eq!(
        user_route_allowed(
            &Method::POST,
            "/v1/sessions/s1/pending-prompts/7/steer",
            &write,
        ),
        Ok(())
    );

    let read = claim(ClaimPermissions {
        read: true,
        ..ClaimPermissions::default()
    });
    assert_eq!(
        user_route_allowed(&Method::POST, "/v1/sessions/s1/fork", &read),
        Err(AuthError::InsufficientPermission)
    );

    let mut wrong_session = claim(ClaimPermissions {
        write: true,
        ..ClaimPermissions::default()
    });
    wrong_session.anyharness_session_id = Some("s2".into());
    assert_eq!(
        user_route_allowed(&Method::POST, "/v1/sessions/s1/fork", &wrong_session),
        Err(AuthError::ScopeMismatch)
    );
    assert_eq!(
        user_route_allowed(
            &Method::POST,
            "/v1/sessions/s1/pending-prompts/7/steer",
            &wrong_session,
        ),
        Err(AuthError::ScopeMismatch)
    );
}

fn link(
    id: &str,
    relation: SessionLinkRelation,
    parent_session_id: &str,
    child_session_id: &str,
    created_at: &str,
) -> SessionLinkRecord {
    SessionLinkRecord {
        id: id.into(),
        public_id: Some(format!("public-{id}")),
        relation,
        parent_session_id: parent_session_id.into(),
        child_session_id: child_session_id.into(),
        workspace_relation: SessionLinkWorkspaceRelation::SameWorkspace,
        label: Some(format!("label-{id}")),
        created_by_turn_id: None,
        created_by_tool_call_id: None,
        created_at: created_at.into(),
        subagent_closed_at: None,
        closed_at: None,
    }
}

fn set_created_at(state: &AppState, session_id: &str, created_at: &str) {
    state
        .db
        .with_conn(|conn| {
            conn.execute(
                "UPDATE sessions SET created_at = ?2, updated_at = ?2 WHERE id = ?1",
                rusqlite::params![session_id, created_at],
            )?;
            Ok(())
        })
        .expect("set deterministic timestamp");
}

fn claim(permissions: ClaimPermissions) -> UserClaimAuth {
    UserClaimAuth {
        user_id: "user-1".into(),
        organization_id: "org-1".into(),
        target_id: "runtime-1".into(),
        cloud_workspace_id: "cloud-workspace-1".into(),
        anyharness_workspace_id: WS.into(),
        cloud_session_id: None,
        anyharness_session_id: None,
        claim_id: "claim-1".into(),
        permissions,
        jti: "jti-1".into(),
        expires_at: i64::MAX,
    }
}
