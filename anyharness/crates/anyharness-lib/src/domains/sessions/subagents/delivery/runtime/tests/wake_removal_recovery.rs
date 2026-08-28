use anyharness_contract::v1::{PendingPromptAddedPayload, SessionEvent};

use super::*;

#[tokio::test(flavor = "current_thread")]
async fn mixed_message_suppression_retries_retired_wake_removal_after_restart() {
    let _lock = test_support::lock_env().await;
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let state = subagent_with_captured_completion().await;
    let first_worker = worker(&state);
    first_worker.process_available().await;

    let delivery_store = CompletionDeliveryStore::new(state.db.clone());
    let first = delivery_store
        .list_all_for_test()
        .expect("deliveries")
        .into_iter()
        .next()
        .expect("first delivery");
    let first_pending = SessionStore::new(state.db.clone())
        .find_pending_prompt(PARENT_ID, first.parent_prompt_seq.expect("first wake seq"))
        .expect("load first wake")
        .expect("first wake remains queued");
    SessionStore::new(state.db.clone())
        .append_event_with_next_seq(
            PARENT_ID,
            SessionEvent::PendingPromptAdded(PendingPromptAddedPayload {
                seq: first_pending.seq,
                prompt_id: first_pending.prompt_id.clone(),
                text: first_pending.text.clone(),
                content_parts: first_pending.prompt_payload().content_parts(),
                queued_at: first_pending.queued_at.clone(),
                prompt_provenance: first_pending.prompt_payload().public_provenance(),
            }),
            false,
        )
        .expect("make first wake visible to queue replay");

    let store = SessionStore::new(state.db.clone());
    store
        .append_event(&SessionEventRecord {
            id: 0,
            session_id: CHILD_ID.into(),
            seq: 3,
            timestamp: "2026-08-11T00:03:00Z".into(),
            event_type: "turn_started".into(),
            turn_id: Some("turn-follow-up".into()),
            item_id: None,
            payload_json: r#"{"type":"turn_started"}"#.into(),
        })
        .expect("start follow-up turn");
    store
        .persist_terminal_turn_record(&DurableTerminalTurn {
            terminal_id: "terminal-follow-up".into(),
            session_id: CHILD_ID.into(),
            turn_id: "turn-follow-up".into(),
            outcome: SessionTurnOutcome::Completed,
            assistant_text: Some("newest final output".into()),
            events: vec![SessionEventRecord {
                id: 0,
                session_id: CHILD_ID.into(),
                seq: 4,
                timestamp: "2026-08-11T00:04:00Z".into(),
                turn_id: Some("turn-follow-up".into()),
                item_id: None,
                event_type: "turn_ended".into(),
                payload_json: r#"{"type":"turn_ended","stopReason":"end_turn"}"#.into(),
            }],
            completed_at: "2026-08-11T00:04:00Z".into(),
        })
        .expect("capture follow-up completion");
    let message = store
        .insert_pending_prompt_payload(
            PARENT_ID,
            &PromptPayload::text("newest final output".into()).with_provenance(
                PromptProvenance::AgentSession {
                    source_session_id: CHILD_ID.into(),
                    session_link_id: None,
                    label: Some("worker".into()),
                },
            ),
            None,
        )
        .expect("queue follow-up child message");
    state
        .db
        .with_conn(|conn| {
            conn.execute_batch(
                "CREATE TRIGGER reject_retired_wake_removal
                 BEFORE INSERT ON session_events
                 WHEN NEW.session_id = 'parent-closed-repair'
                   AND NEW.event_type = 'pending_prompt_removed'
                 BEGIN SELECT RAISE(ABORT, 'removal event unavailable'); END;",
            )
        })
        .expect("install removal event failure");

    first_worker.process_available().await;

    let queue = store
        .list_pending_prompts(PARENT_ID)
        .expect("remaining parent queue");
    assert_eq!(
        queue.iter().map(|row| row.seq).collect::<Vec<_>>(),
        vec![message.seq]
    );
    assert!(store
        .list_events(PARENT_ID)
        .expect("parent events")
        .into_iter()
        .filter(|event| event.event_type == "pending_prompt_removed")
        .all(|event| {
            serde_json::from_str::<serde_json::Value>(&event.payload_json)
                .is_ok_and(|payload| payload["seq"] != first_pending.seq)
        }));
    let pending_removals = delivery_store
        .list_pending_wake_removals(10)
        .expect("durable removal intent");
    assert_eq!(pending_removals.len(), 1);
    assert_eq!(pending_removals[0].delivery_id, first.delivery_id);
    assert_eq!(pending_removals[0].parent_prompt_seq, first_pending.seq);
    assert_eq!(pending_removals[0].prompt_id, first_pending.prompt_id);
    drop(first_worker);

    state
        .db
        .with_conn(|conn| {
            conn.execute_batch(
                "DROP TRIGGER reject_retired_wake_removal;
                 UPDATE session_link_completion_deliveries
                 SET next_attempt_at = '1970-01-01T00:00:00Z'
                 WHERE removal_event_persisted_at IS NULL;",
            )
        })
        .expect("restore removal event persistence");
    let restarted_worker = worker(&state);
    assert_eq!(
        restarted_worker
            .repair_pending_wake_removals()
            .await
            .expect("repair removal after restart"),
        1
    );
    let removal_event_count = store
        .list_events(PARENT_ID)
        .expect("parent events after repair")
        .into_iter()
        .filter(|event| event.event_type == "pending_prompt_removed")
        .count();
    state
        .db
        .with_conn(|conn| {
            conn.execute(
                "UPDATE session_link_completion_deliveries
                 SET removal_event_persisted_at = NULL
                 WHERE delivery_id = ?1",
                [first.delivery_id.as_str()],
            )
        })
        .expect("simulate crash before removal acknowledgement");
    drop(restarted_worker);
    let replay_worker = worker(&state);
    assert_eq!(
        replay_worker
            .repair_pending_wake_removals()
            .await
            .expect("acknowledge already-persisted removal after restart"),
        1
    );
    assert_eq!(
        store
            .list_events(PARENT_ID)
            .expect("parent events after idempotent replay")
            .into_iter()
            .filter(|event| event.event_type == "pending_prompt_removed")
            .count(),
        removal_event_count,
        "repair must not duplicate an already-persisted removal event"
    );
    assert_eq!(
        replay_worker
            .repair_pending_wake_removals()
            .await
            .expect("acknowledged removal is idempotent"),
        0
    );
    assert!(delivery_store
        .list_pending_wake_removals(10)
        .expect("acknowledged removal intents")
        .is_empty());
    let removed = store
        .list_events(PARENT_ID)
        .expect("parent events after repair")
        .into_iter()
        .filter(|event| event.event_type == "pending_prompt_removed")
        .find(|event| {
            serde_json::from_str::<serde_json::Value>(&event.payload_json)
                .is_ok_and(|payload| payload["seq"] == first_pending.seq)
        })
        .expect("persisted pending prompt removal");
    let payload: serde_json::Value =
        serde_json::from_str(&removed.payload_json).expect("removal payload");
    assert_eq!(payload["seq"], first_pending.seq);
    assert_eq!(payload["promptId"], first_pending.prompt_id.unwrap());
    assert_eq!(payload["reason"], "deleted");
    let deliveries = delivery_store.list_all_for_test().expect("deliveries");
    assert_eq!(deliveries.len(), 2);
    assert_eq!(
        deliveries
            .iter()
            .filter(|delivery| delivery.state == CompletionDeliveryState::Delivered)
            .count(),
        2
    );
    assert_eq!(parent_completion_events(&state).len(), 2);
}
