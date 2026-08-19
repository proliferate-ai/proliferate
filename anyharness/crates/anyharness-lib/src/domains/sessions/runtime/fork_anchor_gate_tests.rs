//! Forks ADR rung 3: targeted-fork anchor-derivation gate tests, split out of
//! `tests.rs` (PROD-SIZE-1 ratchet) alongside its existing rung 2 sibling
//! block. This file also hosts the shared fork fixtures
//! (`build_forkable_fork_state`, `build_forkable_fork_state_for_agent`,
//! `before_user_message_target`), which `tests.rs` imports back via
//! `pub(super)`.

use super::tests::session_record;
use crate::app::test_support;
use crate::domains::sessions::links::service::SessionLinkService;
use crate::domains::sessions::links::store::SessionLinkStore;
use crate::domains::sessions::model::SessionEventRecord;
use crate::domains::sessions::runtime::ForkSessionError;
use crate::persistence::Db;

/// Build an `AppState` with a seeded, on-disk local workspace and a single
/// forkable parent session. Returns `(state, parent_id, runtime_home)`.
pub(super) fn build_forkable_fork_state(
    caps_json: &str,
) -> (crate::app::AppState, String, std::path::PathBuf) {
    build_forkable_fork_state_for_agent(caps_json, "claude")
}

/// Like [`build_forkable_fork_state`], parameterized on agent kind.
pub(super) fn build_forkable_fork_state_for_agent(
    caps_json: &str,
    agent_kind: &str,
) -> (crate::app::AppState, String, std::path::PathBuf) {
    use crate::domains::agents::installer::seed::AgentSeedStore;

    let runtime_home =
        std::env::temp_dir().join(format!("anyharness-fork-rung2-{}", uuid::Uuid::new_v4()));
    let workspace_path = runtime_home.join("workspace");
    std::fs::create_dir_all(&workspace_path).expect("create workspace directory");

    let state = crate::app::AppState::new(
        runtime_home.clone(),
        "http://127.0.0.1:8457".to_string(),
        Db::open_in_memory().expect("in-memory db"),
        false,
        AgentSeedStore::not_configured_dev(),
    )
    .expect("app state");

    test_support::seed_workspace_with_repo_root(
        &state.db,
        "workspace-fork-rung2",
        "local",
        &workspace_path.to_string_lossy(),
    );

    let mut record = session_record(agent_kind);
    record.workspace_id = "workspace-fork-rung2".to_string();
    record.last_prompt_at = Some("2026-03-25T00:05:00Z".to_string());
    record.action_capabilities_json = Some(caps_json.to_string());
    state
        .session_service
        .store()
        .insert(&record)
        .expect("insert parent session");

    (state, record.id, runtime_home)
}

pub(super) fn before_user_message_target(
    item_id: Option<&str>,
) -> anyharness_contract::v1::ForkSessionTarget {
    anyharness_contract::v1::ForkSessionTarget {
        target_type: anyharness_contract::v1::ForkSessionTargetType::BeforeUserMessage,
        turn_id: "turn-1".to_string(),
        item_id: item_id.map(str::to_string),
    }
}

fn fork_gate_event(
    seq: i64,
    event_type: &str,
    turn: &str,
    item: &str,
    payload: serde_json::Value,
) -> SessionEventRecord {
    SessionEventRecord {
        id: seq,
        session_id: "unused".to_string(),
        seq,
        timestamp: "2026-08-17T00:00:00Z".to_string(),
        event_type: event_type.to_string(),
        turn_id: Some(turn.to_string()),
        item_id: (!item.is_empty()).then(|| item.to_string()),
        payload_json: payload.to_string(),
    }
}

pub(super) fn fork_gate_user_message(seq: i64, turn: &str, item: &str) -> SessionEventRecord {
    fork_gate_event(
        seq,
        "item_completed",
        turn,
        item,
        serde_json::json!({
            "type": "item_completed",
            "item": {
                "id": item,
                "kind": "user_message",
                "status": "completed",
                "sourceAgentKind": "claude",
                "contentParts": [{"type": "text", "text": "hi"}],
            }
        }),
    )
}

pub(super) fn fork_gate_assistant_message(
    seq: i64,
    turn: &str,
    item: &str,
    message_id: &str,
) -> SessionEventRecord {
    fork_gate_event(
        seq,
        "item_completed",
        turn,
        item,
        serde_json::json!({
            "type": "item_completed",
            "item": {
                "id": item,
                "kind": "assistant_message",
                "status": "completed",
                "sourceAgentKind": "claude",
                "messageId": message_id,
                "contentParts": [{"type": "text", "text": "reply"}],
            }
        }),
    )
}

pub(super) fn fork_gate_turn_ended(seq: i64, turn: &str) -> SessionEventRecord {
    fork_gate_event(
        seq,
        "turn_ended",
        turn,
        "",
        serde_json::json!({"type": "turn_ended", "turnId": turn, "stopReason": "end_turn"}),
    )
}

#[tokio::test(flavor = "current_thread")]
async fn targeted_fork_with_capability_passes_the_gate_and_derives_the_anchor() {
    // With `targetedFork` advertised and a resolvable anchor, the request
    // proceeds past the old rung-3 hard stop (gate opened, anchor derived)
    // and only then fails at the live-session start seam (no real agent in
    // Tier 1). Full dispatch assertion lands in the tier-2/3 follow-up.
    let (state, parent_id, runtime_home) =
        build_forkable_fork_state(r#"{"fork":true,"targetedFork":true}"#);
    let store = state.session_service.store();
    for event in [
        fork_gate_user_message(1, "t0", "u0"),
        fork_gate_assistant_message(2, "t0", "a0", "msg-0"),
        fork_gate_turn_ended(3, "t0"),
        fork_gate_user_message(4, "turn-1", "item-1"),
        fork_gate_turn_ended(5, "turn-1"),
    ] {
        store
            .append_event(&SessionEventRecord {
                session_id: parent_id.clone(),
                ..event
            })
            .expect("append parent event");
    }

    let error = state
        .session_runtime
        .fork_session(
            &parent_id,
            Some(before_user_message_target(Some("item-1"))),
            None,
            None,
        )
        .await
        .expect_err("no live agent in Tier 1 — the fork cannot fully dispatch");

    assert!(
        !matches!(
            error,
            ForkSessionError::Unsupported(_) | ForkSessionError::TargetNotFound
        ),
        "expected the gate to open and the anchor to derive, got {error:?}"
    );
    let _ = std::fs::remove_dir_all(&runtime_home);
}

#[tokio::test(flavor = "current_thread")]
async fn targeted_fork_with_underivable_anchor_is_target_not_found() {
    // The last kept message before the boundary is a USER message (no
    // assistant reply in the earlier turn) — no provider-visible anchor id
    // exists, so the fork must fail closed with TARGET_NOT_FOUND, not
    // silently dispatch anchor-less or fall back to a tip fork.
    let (state, parent_id, runtime_home) =
        build_forkable_fork_state(r#"{"fork":true,"targetedFork":true}"#);
    let store = state.session_service.store();
    for event in [
        fork_gate_user_message(1, "t0", "u0"),
        fork_gate_turn_ended(2, "t0"),
        fork_gate_user_message(3, "turn-1", "item-1"),
        fork_gate_turn_ended(4, "turn-1"),
    ] {
        store
            .append_event(&SessionEventRecord {
                session_id: parent_id.clone(),
                ..event
            })
            .expect("append parent event");
    }

    let error = state
        .session_runtime
        .fork_session(
            &parent_id,
            Some(before_user_message_target(Some("item-1"))),
            None,
            None,
        )
        .await
        .expect_err("no assistant anchor in the kept prefix");

    assert!(matches!(error, ForkSessionError::TargetNotFound));
    let link_service = SessionLinkService::new(
        SessionLinkStore::new(state.db.clone()),
        state.session_service.store().clone(),
    );
    let children = link_service.list_by_parent(&parent_id).expect("list links");
    assert!(
        children.is_empty(),
        "no fork child may be created when the anchor cannot be derived"
    );
    // The anchor derivation runs before the fork operation is inserted (see
    // fork.rs), so no `fork_operations` row exists either — only the
    // no-children assertion above is directly checkable through the public
    // store surface, but the ordering itself is enforced by the code path.
    let _ = std::fs::remove_dir_all(&runtime_home);
}

#[tokio::test(flavor = "current_thread")]
async fn targeted_fork_on_codex_parent_fails_closed_with_no_translator() {
    // Codex has no anchor translator yet (Q-R2 fail, 2026-08-18): even with
    // the capability advertised and a resolvable boundary, the targeted fork
    // must fail closed rather than dispatch anchor-less.
    let (state, parent_id, runtime_home) =
        build_forkable_fork_state_for_agent(r#"{"fork":true,"targetedFork":true}"#, "codex");
    let store = state.session_service.store();
    for event in [
        fork_gate_user_message(1, "t0", "u0"),
        fork_gate_assistant_message(2, "t0", "a0", "msg-0"),
        fork_gate_turn_ended(3, "t0"),
        fork_gate_user_message(4, "turn-1", "item-1"),
        fork_gate_turn_ended(5, "turn-1"),
    ] {
        store
            .append_event(&SessionEventRecord {
                session_id: parent_id.clone(),
                ..event
            })
            .expect("append parent event");
    }

    let error = state
        .session_runtime
        .fork_session(
            &parent_id,
            Some(before_user_message_target(Some("item-1"))),
            None,
            None,
        )
        .await
        .expect_err("codex has no anchor translator yet");

    assert!(matches!(error, ForkSessionError::TargetNotFound));
    let link_service = SessionLinkService::new(
        SessionLinkStore::new(state.db.clone()),
        state.session_service.store().clone(),
    );
    let children = link_service.list_by_parent(&parent_id).expect("list links");
    assert!(children.is_empty());
    let _ = std::fs::remove_dir_all(&runtime_home);
}
