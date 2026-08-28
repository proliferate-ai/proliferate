//! D-LIVE acceptance proof for the protected fork connection's *prompt*
//! terminal: a ready process-local fork child is driven through a real
//! `session/prompt` over the real protected connection, and the provider's
//! sentinels must not survive onto any durable or admitted surface.
//!
//! The two shapes exercised here are the two the protected preflight
//! (`live/sessions/driver/connection.rs::validate_protected_incoming_line`)
//! and the raw-key-presence classifier
//! (`live/sessions/driver/frame_observer.rs::RawResponseFields::classify`)
//! distinguish for a response envelope: an explicit JSON-RPC error, which is
//! projected to the fixed `protected ACP request failed` message with its id
//! and code preserved and its `data` dropped, and a malformed envelope
//! (`result` and `error` both present), which fails closed without ever
//! reaching the ACP decoder.
//!
//! Tracing note: `anyharness.turn.failed` is emitted from the session actor's
//! own spawned task, which does not inherit a test-scoped
//! `tracing::subscriber` default, so these tests cannot capture that record
//! the way `checkpoint_queue_settlement_tests::capture_logs` captures
//! same-task output. They instead pin the exact value that record interpolates:
//! `finish.rs` builds `error_message` once, logs it as the `error` field of
//! `anyharness.turn.failed`, and then moves that same `String` into
//! `PromptTerminalEvent::Error { message, .. }`. Asserting sentinel absence on
//! the persisted `error` event therefore constrains the admitted log line by
//! identity, and every other reachable durable surface is swept too.

use std::time::Duration;

use anyharness_contract::v1::PromptInputBlock;

use super::fork_scenario_fixtures_tests::{
    assert_process_local_fork_wire_contract, before_user_message, build_fork_runtime_state,
    close_all, seed_parent, seed_three_turn_transcript, write_fork_agent,
};
use super::prompt_message_actor_tests::{
    install_scripted_agent_env, read_requests, temp_runtime_home,
};
use crate::app::{test_support, AppState};
use crate::persistence::Db;

/// Every provider-owned string the scripted agent puts on the protected wire
/// for a child `session/prompt`. None of these may reach a durable row, a
/// stored notification, or the turn-failure record.
const PROMPT_PROVIDER_SENTINELS: &[&str] = &[
    "provider-secret-prompt-message",
    "provider-secret-prompt-data",
    "provider-secret-malformed-message",
    "provider-secret-malformed-data",
];

/// The one message a protected explicit provider error is allowed to carry.
const FIXED_PROTECTED_ERROR_MESSAGE: &str = "protected ACP request failed";

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn explicit_child_prompt_provider_error_persists_a_fixed_terminal_without_sentinels() {
    let _env_lock = test_support::lock_env().await;
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let runtime_home = temp_runtime_home("fork-child-prompt-explicit-error");
    let script = write_fork_agent(&runtime_home, "strict");
    let _guards = install_scripted_agent_env(&script);
    let state = build_fork_runtime_state(
        &runtime_home,
        Db::open_in_memory().expect("in-memory db"),
        true,
    );
    let parent_id = seed_parent(&state, Some(r#"{"fork":true,"targetedFork":true}"#));
    seed_three_turn_transcript(&state, &parent_id);

    let child = state
        .session_runtime
        .fork_session(
            &parent_id,
            Some(before_user_message("turn-1", "item-1")),
            Some("prompt-explicit-error-child".to_string()),
            None,
        )
        .await
        .expect("targeted fork produces a ready process-local child");
    let child_id = child.session.id.clone();
    assert_process_local_fork_wire_contract(&script.request_log);

    // Armed only after the child is ready, so the fork itself is untouched and
    // exactly one prompt can observe the fault.
    std::fs::write(script.control_dir.join("child-prompt-explicit-error"), b"")
        .expect("arm explicit child prompt error");
    state
        .session_runtime
        .send_prompt(
            &child_id,
            vec![PromptInputBlock::Text {
                text: "drive the protected child prompt".to_string(),
            }],
            Some("prompt-explicit-error".to_string()),
        )
        .await
        .expect("the protected child prompt dispatches");

    let payload = wait_for_child_error_event(&state, &child_id).await;
    assert!(
        payload.contains(FIXED_PROTECTED_ERROR_MESSAGE),
        "the durable terminal must carry the fixed protected message: {payload}"
    );
    assert_no_prompt_sentinels(&state, &parent_id, &child_id);
    assert_failed_turn_left_child_resumable(&state, &child_id).await;
    assert_eq!(
        child_prompt_wire_count(&script.request_log),
        1,
        "a failed protected prompt must not be redispatched"
    );

    close_all(&state, &[parent_id.as_str(), child_id.as_str()]).await;
    drop(state);
    std::fs::remove_dir_all(&runtime_home).expect("remove runtime home");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn malformed_child_prompt_envelope_fails_closed_without_sentinels_or_provider_projection() {
    let _env_lock = test_support::lock_env().await;
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let runtime_home = temp_runtime_home("fork-child-prompt-malformed");
    let script = write_fork_agent(&runtime_home, "strict");
    let _guards = install_scripted_agent_env(&script);
    let state = build_fork_runtime_state(
        &runtime_home,
        Db::open_in_memory().expect("in-memory db"),
        true,
    );
    let parent_id = seed_parent(&state, Some(r#"{"fork":true,"targetedFork":true}"#));
    seed_three_turn_transcript(&state, &parent_id);

    let child = state
        .session_runtime
        .fork_session(
            &parent_id,
            Some(before_user_message("turn-1", "item-1")),
            Some("prompt-malformed-child".to_string()),
            None,
        )
        .await
        .expect("targeted fork produces a ready process-local child");
    let child_id = child.session.id.clone();
    assert_process_local_fork_wire_contract(&script.request_log);

    // `{"result":null,"error":{...}}`: serde would collapse the explicit null
    // into a plain error, so only the raw-key-presence classifier keeps this a
    // both-fields malformed envelope.
    std::fs::write(
        script.control_dir.join("child-prompt-malformed-result"),
        b"",
    )
    .expect("arm malformed child prompt envelope");
    state
        .session_runtime
        .send_prompt(
            &child_id,
            vec![PromptInputBlock::Text {
                text: "drive the malformed protected child prompt".to_string(),
            }],
            Some("prompt-malformed".to_string()),
        )
        .await
        .expect("the protected child prompt dispatches");

    let payload = wait_for_child_error_event(&state, &child_id).await;
    assert!(
        !payload.contains(FIXED_PROTECTED_ERROR_MESSAGE),
        "a malformed envelope must not be projected as an explicit provider error: {payload}"
    );
    assert_no_prompt_sentinels(&state, &parent_id, &child_id);
    assert_failed_turn_left_child_resumable(&state, &child_id).await;
    assert_eq!(
        child_prompt_wire_count(&script.request_log),
        1,
        "a fail-closed protected prompt must not be redispatched"
    );

    close_all(&state, &[parent_id.as_str(), child_id.as_str()]).await;
    drop(state);
    std::fs::remove_dir_all(&runtime_home).expect("remove runtime home");
}

// --- Shared assertions -----------------------------------------------------

fn child_prompt_wire_count(path: &std::path::Path) -> usize {
    read_requests(path)
        .iter()
        .filter(|request| request["method"] == "session/prompt")
        .count()
}

/// The persisted `PromptTerminalEvent::Error` payload for the child's failed
/// turn. Bounded: the terminal commit is asynchronous to the caller's
/// `send_prompt` return.
async fn wait_for_child_error_event(state: &AppState, child_id: &str) -> String {
    for _ in 0..500 {
        let events = state
            .session_service
            .list_session_event_records(child_id, None, None, None, None, false)
            .expect("list child events")
            .expect("child session exists");
        if let Some(event) = events.iter().find(|event| event.event_type == "error") {
            return event.payload_json.clone();
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("timed out waiting for a durable error terminal on {child_id}");
}

/// A failed protected turn tears the live actor down (the malformed envelope
/// fails closed on the transport; the explicit error ends the turn) and unloads
/// it, which by the actor's exit contract leaves the durable child row a plain
/// resumable `idle` — the failure lives on the turn's error terminal, not on the
/// session row. Bounded: teardown is asynchronous to the terminal commit.
async fn assert_failed_turn_left_child_resumable(state: &AppState, child_id: &str) {
    for _ in 0..500 {
        if state.acp_manager.get_handle(child_id).await.is_none() {
            let status = state
                .session_service
                .get_session(child_id)
                .expect("get child session")
                .expect("child session exists")
                .status;
            assert_eq!(
                status, "idle",
                "an unloaded child must stay resumable after a failed protected turn"
            );
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("timed out waiting for the protected child actor teardown on {child_id}");
}

/// Sweep every durable surface a protected child prompt can reach: the child's
/// events (the terminal error row included), the child's stored raw
/// notifications, the child session row, the child's fork operation row, and
/// the parent's own events.
fn assert_no_prompt_sentinels(state: &AppState, parent_id: &str, child_id: &str) {
    let store = state.session_service.store();
    let mut surfaces: Vec<(String, String)> = Vec::new();
    for session_id in [parent_id, child_id] {
        for event in state
            .session_service
            .list_session_event_records(session_id, None, None, None, None, false)
            .expect("list session events")
            .expect("session exists")
        {
            surfaces.push((
                format!("{session_id} event {}", event.event_type),
                event.payload_json,
            ));
        }
        for notification in store
            .list_raw_notifications(session_id)
            .expect("list raw notifications")
        {
            surfaces.push((
                format!("{session_id} raw notification"),
                notification.payload_json,
            ));
        }
        let record = state
            .session_service
            .get_session(session_id)
            .expect("get session")
            .expect("session exists");
        surfaces.push((format!("{session_id} session row"), format!("{record:?}")));
    }
    if let Some(operation) = store
        .find_fork_operation_by_child(child_id)
        .expect("query fork operation")
    {
        surfaces.push((
            format!("{child_id} fork operation"),
            format!("{operation:?}"),
        ));
    }

    for (surface, text) in surfaces {
        for sentinel in PROMPT_PROVIDER_SENTINELS {
            assert!(
                !text.contains(sentinel),
                "provider sentinel {sentinel} leaked onto {surface}: {text}"
            );
        }
    }
}
