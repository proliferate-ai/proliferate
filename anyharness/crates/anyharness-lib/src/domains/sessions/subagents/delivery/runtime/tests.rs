use std::sync::Arc;

use super::*;
use crate::app::{test_support, AppState};
use crate::domains::agents::installer::seed::AgentSeedStore;
use crate::domains::sessions::extensions::SessionTurnOutcome;
use crate::domains::sessions::links::model::{
    SessionLinkRecord, SessionLinkRelation, SessionLinkWorkspaceRelation,
};
use crate::domains::sessions::links::store::SessionLinkStore;
use crate::domains::sessions::model::{SessionEventRecord, SessionMcpBindingPolicy, SessionRecord};
use crate::domains::sessions::prompt::{provenance::PromptProvenance, PromptPayload};
use crate::domains::sessions::store::completion_deliveries::DurableTerminalTurn;
use crate::domains::sessions::store::SessionStore;
use crate::domains::sessions::subagents::delivery::CompletionDeliveryState;
use crate::persistence::Db;

const WORKSPACE_ID: &str = "workspace-closed-repair";
const PARENT_ID: &str = "parent-closed-repair";
const CHILD_ID: &str = "child-closed-repair";

#[path = "tests/pagination.rs"]
mod pagination;
#[path = "tests/restart_recovery.rs"]
mod restart_recovery;
#[path = "tests/wake_removal_recovery.rs"]
mod wake_removal_recovery;

#[test]
fn enqueued_backoff_increases_and_caps_at_sixty_seconds() {
    assert_eq!(
        (1..=8).map(retry_delay_seconds).collect::<Vec<_>>(),
        vec![2, 4, 8, 16, 32, 60, 60, 60]
    );
}

// PR review finding 2: the worker retires a delivery only once its attempt
// count reaches the dead-letter cap, and keeps retrying below it.
#[test]
fn dead_letter_threshold_trips_only_at_the_attempt_cap() {
    assert!(!dead_letter_threshold_reached(0));
    assert!(!dead_letter_threshold_reached(MAX_DELIVERY_ATTEMPTS - 1));
    assert!(dead_letter_threshold_reached(MAX_DELIVERY_ATTEMPTS));
    assert!(dead_letter_threshold_reached(MAX_DELIVERY_ATTEMPTS + 5));
}

#[test]
fn delivery_timing_uses_enqueue_time_for_queue_age() {
    let delivery = CompletionDeliveryRecord {
        delivery_id: "delivery".into(),
        completion_id: "completion".into(),
        session_link_id: "link".into(),
        parent_session_id: PARENT_ID.into(),
        child_session_id: CHILD_ID.into(),
        subagent_public_id: None,
        label: None,
        child_turn_id: "turn".into(),
        child_last_event_seq: 1,
        outcome: SessionTurnOutcome::Completed,
        assistant_text: None,
        notification_text: "done".into(),
        state: CompletionDeliveryState::Enqueued,
        parent_prompt_seq: Some(1),
        parent_turn_id: None,
        retired_prompt_seq: None,
        retired_prompt_id: None,
        attempt_count: 0,
        next_attempt_at: "2026-08-13T00:00:00Z".into(),
        lease_token: None,
        lease_expires_at: None,
        last_error_code: None,
        created_at: "2026-08-13T00:00:00Z".into(),
        updated_at: "2026-08-13T00:00:05Z".into(),
        enqueued_at: Some("2026-08-13T00:00:05Z".into()),
        delivered_at: None,
    };

    assert_eq!(
        delivery_timing_ms(&delivery, "2026-08-13T00:00:10Z"),
        (5_000, 10_000)
    );
}

#[tokio::test(flavor = "current_thread")]
async fn restarted_worker_repairs_retired_closed_turn_once_after_store_recovers() {
    let _lock = test_support::lock_env().await;
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let state = subagent_with_open_turn("worker-restart", true, false, true).await;

    let first_worker = worker(&state);
    assert!(first_worker.repair_retired_subagent_turns().await.is_err());
    assert_open_turn_without_delivery(&state);
    drop(first_worker);

    state
        .db
        .with_conn(|conn| conn.execute_batch("DROP TRIGGER reject_closed_repair_delivery;"))
        .expect("remove repair failure");
    let restarted_worker = worker(&state);
    assert_eq!(
        restarted_worker
            .repair_retired_subagent_turns()
            .await
            .expect("restart repair"),
        1
    );
    assert_eq!(
        restarted_worker
            .repair_retired_subagent_turns()
            .await
            .expect("idempotent restart repair"),
        0
    );
    assert_one_cancelled_terminal_and_delivery(&state);
}

#[tokio::test(flavor = "current_thread")]
async fn worker_skips_live_closed_child_until_exact_handle_is_retired() {
    let _lock = test_support::lock_env().await;
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let state = subagent_with_open_turn("worker-live-gate", false, true, true).await;
    let worker = worker(&state);

    assert_eq!(
        worker
            .repair_retired_subagent_turns()
            .await
            .expect("live child skipped"),
        0
    );
    assert_open_turn_without_delivery(&state);

    state.acp_manager.remove_session(CHILD_ID).await;
    assert_eq!(
        worker
            .repair_retired_subagent_turns()
            .await
            .expect("retired child repaired"),
        1
    );
    assert_one_cancelled_terminal_and_delivery(&state);
}

#[tokio::test(flavor = "current_thread")]
async fn worker_repairs_open_current_link_but_not_promoted_session() {
    let _lock = test_support::lock_env().await;
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let open_state = subagent_with_open_turn("worker-open", false, true, false).await;
    open_state.acp_manager.remove_session(CHILD_ID).await;
    assert_eq!(
        worker(&open_state)
            .repair_retired_subagent_turns()
            .await
            .expect("open current subagent repair"),
        1
    );
    assert_one_cancelled_terminal_and_delivery(&open_state);

    let promoted_state = subagent_with_open_turn("worker-promoted", false, true, false).await;
    promoted_state
        .db
        .with_conn(|conn| {
            conn.execute(
                "DELETE FROM session_links WHERE child_session_id = ?1",
                [CHILD_ID],
            )?;
            Ok(())
        })
        .expect("promote by deleting relationship");
    promoted_state.acp_manager.remove_session(CHILD_ID).await;
    assert_eq!(
        worker(&promoted_state)
            .repair_retired_subagent_turns()
            .await
            .expect("promoted session skipped"),
        0
    );
    assert_open_turn_without_delivery(&promoted_state);
}

#[tokio::test(flavor = "current_thread")]
async fn delivered_completion_injects_one_completion_event_into_the_parent_transcript() {
    let _lock = test_support::lock_env().await;
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let state = subagent_with_captured_completion().await;
    let worker = worker(&state);

    worker.process_available().await;
    let injected = parent_completion_events(&state);
    assert_eq!(injected.len(), 1, "one injected completion event");
    let payload = &injected[0];
    assert_eq!(payload["parentSessionId"], PARENT_ID);
    assert_eq!(payload["childSessionId"], CHILD_ID);
    assert_eq!(payload["childTurnId"], "turn-complete");
    assert_eq!(payload["childLastEventSeq"], 2);
    assert_eq!(payload["outcome"], "completed");
    assert_eq!(payload["label"], "worker");

    let deliveries = CompletionDeliveryStore::new(state.db.clone())
        .list_all_for_test()
        .expect("deliveries");
    assert_eq!(deliveries.len(), 1);
    assert_eq!(deliveries[0].state, CompletionDeliveryState::Enqueued);
    assert_eq!(payload["completionId"], deliveries[0].completion_id);
    assert_eq!(payload["sessionLinkId"], deliveries[0].session_link_id);

    force_delivery_due(&state, &deliveries[0].delivery_id);
    worker.process_available().await;
    assert_eq!(
        parent_completion_events(&state).len(),
        1,
        "a recovered delivery must not inject a second completion event"
    );
}

#[tokio::test(flavor = "current_thread")]
async fn suppressed_completion_injects_metadata_without_a_wake_prompt() {
    let _lock = test_support::lock_env().await;
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let state = subagent_with_captured_completion().await;
    // The child's own report for the terminal turn is already queued for the
    // parent, so the completion wake is redundant.
    let message = SessionStore::new(state.db.clone())
        .insert_pending_prompt_payload(
            PARENT_ID,
            &PromptPayload::text("final output".into()).with_provenance(
                PromptProvenance::AgentSession {
                    source_session_id: CHILD_ID.into(),
                    session_link_id: None,
                    label: Some("worker".into()),
                },
            ),
            None,
        )
        .expect("queue child message");
    let worker = worker(&state);

    worker.process_available().await;
    assert_eq!(
        parent_completion_events(&state).len(),
        1,
        "suppression still injects the completion metadata event"
    );
    let deliveries = CompletionDeliveryStore::new(state.db.clone())
        .list_all_for_test()
        .expect("deliveries");
    assert_eq!(deliveries.len(), 1);
    assert_eq!(deliveries[0].state, CompletionDeliveryState::Delivered);
    assert!(deliveries[0].parent_prompt_seq.is_none());
    assert!(deliveries[0].parent_turn_id.is_none());
    let queue = SessionStore::new(state.db.clone())
        .list_pending_prompts(PARENT_ID)
        .expect("queue");
    assert_eq!(
        queue.iter().map(|row| row.seq).collect::<Vec<_>>(),
        vec![message.seq],
        "only the child's own message remains queued"
    );

    // Recovery replay: the terminal delivered row is never re-claimed, so no
    // second completion event or late wake prompt appears.
    force_delivery_due(&state, &deliveries[0].delivery_id);
    worker.process_available().await;
    assert_eq!(parent_completion_events(&state).len(), 1);
    assert_eq!(
        SessionStore::new(state.db.clone())
            .list_pending_prompts(PARENT_ID)
            .expect("queue")
            .len(),
        1
    );
}

fn worker(state: &AppState) -> CompletionDeliveryWorker {
    CompletionDeliveryWorker {
        delivery_store: CompletionDeliveryStore::new(state.db.clone()),
        session_runtime: Arc::downgrade(&state.session_runtime),
    }
}

async fn subagent_with_captured_completion() -> AppState {
    let runtime_home = std::env::temp_dir().join(format!(
        "completion-delivery-injection-{}",
        uuid::Uuid::new_v4()
    ));
    let workspace_path = runtime_home.join("workspace");
    std::fs::create_dir_all(&workspace_path).expect("create workspace");
    let state = AppState::new(
        runtime_home,
        "http://127.0.0.1:8457".into(),
        Db::open_in_memory().expect("db"),
        false,
        AgentSeedStore::not_configured_dev(),
    )
    .expect("app state");
    test_support::seed_workspace_with_repo_root(
        &state.db,
        WORKSPACE_ID,
        "local",
        &workspace_path.to_string_lossy(),
    );
    let store = SessionStore::new(state.db.clone());
    // A parent whose agent cannot start leaves the wake prompt queued, so the
    // recovery pass re-claims the same enqueued delivery.
    let mut parent = session(PARENT_ID);
    parent.agent_kind = "missing-agent".to_string();
    store.insert(&parent).expect("parent");
    store.insert(&session(CHILD_ID)).expect("child");
    state
        .subagent_service
        .link_child(PARENT_ID, CHILD_ID, Some("worker".into()), None, None)
        .expect("link");
    store
        .append_event(&SessionEventRecord {
            id: 0,
            session_id: CHILD_ID.into(),
            seq: 1,
            timestamp: "2026-08-11T00:01:00Z".into(),
            event_type: "turn_started".into(),
            turn_id: Some("turn-complete".into()),
            item_id: None,
            payload_json: r#"{"type":"turn_started"}"#.into(),
        })
        .expect("open turn");
    store
        .persist_terminal_turn_record(&DurableTerminalTurn {
            terminal_id: "terminal-complete".into(),
            session_id: CHILD_ID.into(),
            turn_id: "turn-complete".into(),
            outcome: SessionTurnOutcome::Completed,
            assistant_text: Some("final output".into()),
            events: vec![SessionEventRecord {
                id: 0,
                session_id: CHILD_ID.into(),
                seq: 2,
                timestamp: "2026-08-11T00:02:00Z".into(),
                turn_id: Some("turn-complete".into()),
                item_id: None,
                event_type: "turn_ended".into(),
                payload_json: r#"{"type":"turn_ended","stopReason":"end_turn"}"#.into(),
            }],
            completed_at: "2026-08-11T00:02:00Z".into(),
        })
        .expect("atomic terminal capture");
    state
}

fn parent_completion_events(state: &AppState) -> Vec<serde_json::Value> {
    state
        .session_service
        .store()
        .list_events(PARENT_ID)
        .expect("parent events")
        .into_iter()
        .filter(|event| event.event_type == "subagent_turn_completed")
        .map(|event| {
            serde_json::from_str::<serde_json::Value>(&event.payload_json)
                .expect("completion event payload")
        })
        .collect()
}

fn force_delivery_due(state: &AppState, delivery_id: &str) {
    state
        .db
        .with_conn(|conn| {
            let changed = conn.execute(
                "UPDATE session_link_completion_deliveries
                 SET next_attempt_at = '1970-01-01T00:00:00Z',
                     lease_token = NULL, lease_expires_at = NULL
                 WHERE delivery_id = ?1",
                [delivery_id],
            )?;
            assert_eq!(changed, 1);
            Ok(())
        })
        .expect("force delivery due");
}

async fn subagent_with_open_turn(
    label: &str,
    reject_repair: bool,
    install_live_handle: bool,
    close_relationship: bool,
) -> AppState {
    let runtime_home = std::env::temp_dir().join(format!(
        "completion-delivery-{label}-{}",
        uuid::Uuid::new_v4()
    ));
    let workspace_path = runtime_home.join("workspace");
    std::fs::create_dir_all(&workspace_path).expect("create workspace");
    let state = AppState::new(
        runtime_home,
        "http://127.0.0.1:8457".into(),
        Db::open_in_memory().expect("db"),
        false,
        AgentSeedStore::not_configured_dev(),
    )
    .expect("app state");
    test_support::seed_workspace_with_repo_root(
        &state.db,
        WORKSPACE_ID,
        "local",
        &workspace_path.to_string_lossy(),
    );
    seed_subagent_open_turn(
        &state,
        reject_repair,
        install_live_handle,
        close_relationship,
    )
    .await;
    state
}

async fn seed_subagent_open_turn(
    state: &AppState,
    reject_repair: bool,
    install_live_handle: bool,
    close_relationship: bool,
) {
    let store = SessionStore::new(state.db.clone());
    store.insert(&session(PARENT_ID)).expect("parent");
    store.insert(&session(CHILD_ID)).expect("child");
    let link = state
        .subagent_service
        .link_child(PARENT_ID, CHILD_ID, Some("worker".into()), None, None)
        .expect("link");
    if reject_repair {
        state
            .db
            .with_conn(|conn| {
                conn.execute_batch(
                    "CREATE TRIGGER reject_closed_repair_delivery
                     BEFORE INSERT ON session_link_completion_deliveries
                     BEGIN SELECT RAISE(ABORT, 'injected repair failure'); END;",
                )
            })
            .expect("install repair failure");
    }
    if install_live_handle {
        state
            .acp_manager
            .insert_unavailable_session_for_test(CHILD_ID)
            .await;
    }
    if close_relationship {
        SessionLinkStore::new(state.db.clone())
            .close_subagent_operability(&link.id, "2026-08-11T00:01:00Z")
            .expect("close relationship");
    }
    store
        .append_event(&SessionEventRecord {
            id: 0,
            session_id: CHILD_ID.into(),
            seq: 1,
            timestamp: "2026-08-11T00:02:00Z".into(),
            event_type: "turn_started".into(),
            turn_id: Some("turn-open".into()),
            item_id: None,
            payload_json: r#"{"type":"turn_started"}"#.into(),
        })
        .expect("open turn");
}

fn session(id: &str) -> SessionRecord {
    SessionRecord {
        id: id.into(),
        workspace_id: WORKSPACE_ID.into(),
        agent_kind: "claude".into(),
        native_session_id: Some(format!("native-{id}")),
        agent_auth_contexts: None,
        requested_model_id: None,
        current_model_id: None,
        requested_mode_id: None,
        current_mode_id: None,
        title: Some(id.into()),
        thinking_level_id: None,
        thinking_budget_tokens: None,
        status: "idle".into(),
        created_at: "2026-08-11T00:00:00Z".into(),
        updated_at: "2026-08-11T00:00:00Z".into(),
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
    }
}

fn assert_open_turn_without_delivery(state: &AppState) {
    let events = state
        .session_service
        .store()
        .list_events(CHILD_ID)
        .expect("events");
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].event_type, "turn_started");
    assert!(CompletionDeliveryStore::new(state.db.clone())
        .list_all_for_test()
        .expect("deliveries")
        .is_empty());
}

fn assert_one_cancelled_terminal_and_delivery(state: &AppState) {
    let events = state
        .session_service
        .store()
        .list_events(CHILD_ID)
        .expect("events");
    assert_eq!(
        events
            .iter()
            .filter(|event| event.event_type == "turn_ended")
            .count(),
        1
    );
    let deliveries = CompletionDeliveryStore::new(state.db.clone())
        .list_all_for_test()
        .expect("deliveries");
    assert_eq!(deliveries.len(), 1);
    assert_eq!(deliveries[0].outcome.as_str(), "cancelled");
    assert_eq!(deliveries[0].child_turn_id, "turn-open");
}
