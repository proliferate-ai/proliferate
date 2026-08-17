use anyharness_contract::v1::{
    ContentPart, ItemCompletedEvent, ItemStartedEvent, PendingPromptAddedPayload,
    PendingPromptRemovalReason, PendingPromptRemovedPayload,
    PromptProvenance as PublicPromptProvenance, SessionEvent, TranscriptItemKind,
    TranscriptItemPayload, TranscriptItemStatus, TurnStartedEvent,
};

use super::super::canonical::pending_prompt_matches_delivery;
use super::super::tests::seed_link;
use super::super::{
    CompletionDeliveryRecord, CompletionDeliveryState, CompletionDeliveryStore, DurableTerminalTurn,
};
use super::tests::{claim, CLAIMED_AT, RETRY_AT};
use super::{ClaimedDeliveryEnqueueOutcome, CompletionWakeSuppressionReason};
use crate::domains::sessions::extensions::SessionTurnOutcome;
use crate::domains::sessions::model::SessionEventRecord;
use crate::domains::sessions::prompt::{provenance::PromptProvenance, PromptPayload};
use crate::domains::sessions::store::SessionStore;
use crate::persistence::Db;

/// Seed the child's `turn_started` event so suppression can bound the turn
/// window, then persist the terminal turn immediately after it.
fn persist_delivery_for_started_turn(
    db: &Db,
    turn_id: &str,
    turn_started_seq: i64,
    started_at: &str,
    ended_at: &str,
    outcome: SessionTurnOutcome,
) -> CompletionDeliveryRecord {
    let session_store = SessionStore::new(db.clone());
    session_store
        .append_event(&SessionEventRecord {
            id: 0,
            session_id: "child-1".to_string(),
            seq: turn_started_seq,
            timestamp: started_at.to_string(),
            turn_id: Some(turn_id.to_string()),
            item_id: None,
            event_type: "turn_started".to_string(),
            payload_json: r#"{"type":"turn_started"}"#.to_string(),
        })
        .expect("seed child turn start");
    session_store
        .persist_terminal_turn_record(&DurableTerminalTurn {
            terminal_id: format!("terminal-{turn_id}"),
            session_id: "child-1".to_string(),
            turn_id: turn_id.to_string(),
            outcome,
            assistant_text: Some("Useful answer".to_string()),
            events: vec![SessionEventRecord {
                id: 0,
                session_id: "child-1".to_string(),
                seq: turn_started_seq + 1,
                timestamp: ended_at.to_string(),
                turn_id: Some(turn_id.to_string()),
                item_id: None,
                event_type: "turn_ended".to_string(),
                payload_json: r#"{"type":"turn_ended","stopReason":"end_turn"}"#.to_string(),
            }],
            completed_at: ended_at.to_string(),
        })
        .expect("persist terminal turn");
    CompletionDeliveryStore::new(db.clone())
        .find(&format!("terminal-{turn_id}"))
        .expect("find delivery")
        .expect("delivery captured")
}

/// Queue an ordinary child-to-parent message with trusted internal
/// `agent_session` provenance and a pinned queue timestamp.
fn queue_child_message(db: &Db, parent_session_id: &str, queued_at: &str) -> i64 {
    let payload = PromptPayload::text("Status update from the child".to_string()).with_provenance(
        PromptProvenance::AgentSession {
            source_session_id: "child-1".to_string(),
            session_link_id: Some("link-1".to_string()),
            label: Some("Researcher".to_string()),
        },
    );
    let record = SessionStore::new(db.clone())
        .insert_pending_prompt_payload(parent_session_id, &payload, None)
        .expect("queue child message");
    db.with_conn(|conn| {
        conn.execute(
            "UPDATE session_pending_prompts SET queued_at = ?3
             WHERE session_id = ?1 AND seq = ?2",
            rusqlite::params![parent_session_id, record.seq, queued_at],
        )?;
        Ok(())
    })
    .expect("pin queued_at");
    record.seq
}

fn append_executed_child_message(db: &Db, delivery: &CompletionDeliveryRecord, queued_at: &str) {
    let queue_seq = 41;
    let turn_id = "parent-message-turn";
    let item_id = "parent-message-item";
    let text = "Status update from the child";
    let provenance = PublicPromptProvenance::AgentSession {
        source_session_id: delivery.child_session_id.clone(),
        session_link_id: Some(delivery.session_link_id.clone()),
        label: Some("Researcher".to_string()),
    };
    let item = TranscriptItemPayload {
        kind: TranscriptItemKind::UserMessage,
        status: TranscriptItemStatus::Completed,
        source_agent_kind: "claude".into(),
        is_transient: false,
        message_id: None,
        prompt_id: None,
        title: None,
        tool_call_id: None,
        native_tool_name: None,
        parent_tool_call_id: None,
        raw_input: None,
        raw_output: None,
        content_parts: vec![ContentPart::Text { text: text.into() }],
        prompt_provenance: Some(provenance.clone()),
    };
    let events = [
        (
            SessionEvent::PendingPromptAdded(PendingPromptAddedPayload {
                seq: queue_seq,
                prompt_id: None,
                text: text.into(),
                content_parts: vec![ContentPart::Text { text: text.into() }],
                queued_at: queued_at.to_string(),
                prompt_provenance: Some(provenance),
            }),
            None,
            None,
        ),
        (
            SessionEvent::TurnStarted(TurnStartedEvent::default()),
            Some(turn_id),
            None,
        ),
        (
            SessionEvent::ItemStarted(ItemStartedEvent { item: item.clone() }),
            Some(turn_id),
            Some(item_id),
        ),
        (
            SessionEvent::ItemCompleted(ItemCompletedEvent { item }),
            Some(turn_id),
            Some(item_id),
        ),
        (
            SessionEvent::PendingPromptRemoved(PendingPromptRemovedPayload {
                seq: queue_seq,
                prompt_id: None,
                reason: PendingPromptRemovalReason::Executed,
            }),
            None,
            None,
        ),
    ];
    let store = SessionStore::new(db.clone());
    for (offset, (event, turn_id, item_id)) in events.into_iter().enumerate() {
        store
            .append_event(&SessionEventRecord {
                id: 0,
                session_id: delivery.parent_session_id.clone(),
                seq: offset as i64 + 1,
                timestamp: format!("2026-08-11T00:03:0{}Z", offset + 1),
                event_type: event.event_type().into(),
                turn_id: turn_id.map(str::to_string),
                item_id: item_id.map(str::to_string),
                payload_json: serde_json::to_string(&event).expect("event json"),
            })
            .expect("append executed child message event");
    }
}

#[test]
fn completed_wake_is_suppressed_while_child_message_is_queued() {
    let db = Db::open_in_memory().expect("open db");
    seed_link(&db, false);
    let delivery = persist_delivery_for_started_turn(
        &db,
        "turn-1",
        1,
        "2026-08-11T00:01:30Z",
        "2026-08-11T00:02:00Z",
        SessionTurnOutcome::Completed,
    );
    let message_seq = queue_child_message(&db, &delivery.parent_session_id, "2026-08-11T00:01:45Z");
    let store = CompletionDeliveryStore::new(db.clone());
    claim(&store, "worker-1");

    let outcome = store
        .enqueue_claimed_canonical(&delivery.delivery_id, "worker-1", CLAIMED_AT, RETRY_AT)
        .expect("suppression decision");
    let ClaimedDeliveryEnqueueOutcome::Suppressed {
        delivery: suppressed,
        ..
    } = outcome
    else {
        panic!("expected suppression");
    };
    assert_eq!(suppressed.state, CompletionDeliveryState::Delivered);
    assert!(suppressed.parent_prompt_seq.is_none());
    assert!(suppressed.parent_turn_id.is_none());
    assert!(suppressed.delivered_at.is_some());
    assert!(suppressed.lease_token.is_none());

    // The child's own message stays as the single queued parent wake; the
    // completion ledger row remains durable for delegated-work surfaces.
    let queue = SessionStore::new(db.clone())
        .list_pending_prompts(&delivery.parent_session_id)
        .expect("queue");
    assert_eq!(
        queue.iter().map(|row| row.seq).collect::<Vec<_>>(),
        vec![message_seq]
    );
    db.with_conn(|conn| {
        let completions: i64 =
            conn.query_row("SELECT COUNT(*) FROM session_link_completions", [], |row| {
                row.get(0)
            })?;
        assert_eq!(completions, 1);
        Ok(())
    })
    .expect("projection durable");
    assert!(store
        .claim_next_due("2999-01-01T00:00:00Z", "2999-01-01T00:00:30Z", "worker-2")
        .expect("post-suppression claim")
        .is_none());
}

#[test]
fn completed_wake_is_suppressed_after_parent_executed_child_message() {
    let db = Db::open_in_memory().expect("open db");
    seed_link(&db, false);
    let delivery = persist_delivery_for_started_turn(
        &db,
        "turn-1",
        1,
        "2026-08-11T00:01:30Z",
        "2026-08-11T00:02:00Z",
        SessionTurnOutcome::Completed,
    );
    // The parent already ran the child's message as a transcript item after
    // the child turn began (idle-parent ordering).
    append_executed_child_message(&db, &delivery, "2026-08-11T00:01:45Z");
    let store = CompletionDeliveryStore::new(db.clone());
    claim(&store, "worker-1");

    let outcome = store
        .enqueue_claimed_canonical(&delivery.delivery_id, "worker-1", CLAIMED_AT, RETRY_AT)
        .expect("suppression decision");
    assert!(matches!(
        outcome,
        ClaimedDeliveryEnqueueOutcome::Suppressed { .. }
    ));
    let queue = SessionStore::new(db)
        .list_pending_prompts(&delivery.parent_session_id)
        .expect("queue");
    assert!(queue.is_empty(), "no wake prompt is inserted");
}

#[test]
fn prior_turn_message_executed_after_current_turn_started_does_not_suppress() {
    let db = Db::open_in_memory().expect("open db");
    seed_link(&db, false);
    let delivery = persist_delivery_for_started_turn(
        &db,
        "turn-1",
        1,
        "2026-08-11T00:01:30Z",
        "2026-08-11T00:02:00Z",
        SessionTurnOutcome::Completed,
    );
    // Execution happens after the current child turn starts, but the durable
    // queue identity proves that this message was sent by an earlier turn.
    append_executed_child_message(&db, &delivery, "2026-08-11T00:01:00Z");
    let store = CompletionDeliveryStore::new(db.clone());
    claim(&store, "worker-1");

    assert!(matches!(
        store
            .enqueue_claimed_canonical(&delivery.delivery_id, "worker-1", CLAIMED_AT, RETRY_AT)
            .expect("enqueue current completion wake"),
        ClaimedDeliveryEnqueueOutcome::Enqueued { .. }
    ));
    let queue = SessionStore::new(db)
        .list_pending_prompts(&delivery.parent_session_id)
        .expect("queue");
    assert_eq!(queue.len(), 1, "the current completion wake remains queued");
}

#[test]
fn failed_wake_is_never_suppressed() {
    let db = Db::open_in_memory().expect("open db");
    seed_link(&db, false);
    let delivery = persist_delivery_for_started_turn(
        &db,
        "turn-1",
        1,
        "2026-08-11T00:01:30Z",
        "2026-08-11T00:02:00Z",
        SessionTurnOutcome::Failed,
    );
    queue_child_message(&db, &delivery.parent_session_id, "2026-08-11T00:01:45Z");
    let store = CompletionDeliveryStore::new(db.clone());
    claim(&store, "worker-1");

    assert!(matches!(
        store
            .enqueue_claimed_canonical(&delivery.delivery_id, "worker-1", CLAIMED_AT, RETRY_AT)
            .expect("enqueue failed-turn wake"),
        ClaimedDeliveryEnqueueOutcome::Enqueued { .. }
    ));
    let queue = SessionStore::new(db)
        .list_pending_prompts(&delivery.parent_session_id)
        .expect("queue");
    assert_eq!(queue.len(), 2, "message and failure wake both queued");
}

#[test]
fn message_queued_before_the_terminal_turn_does_not_suppress() {
    let db = Db::open_in_memory().expect("open db");
    seed_link(&db, false);
    let delivery = persist_delivery_for_started_turn(
        &db,
        "turn-1",
        1,
        "2026-08-11T00:01:30Z",
        "2026-08-11T00:02:00Z",
        SessionTurnOutcome::Completed,
    );
    queue_child_message(&db, &delivery.parent_session_id, "2026-08-11T00:01:00Z");
    let store = CompletionDeliveryStore::new(db.clone());
    claim(&store, "worker-1");

    assert!(matches!(
        store
            .enqueue_claimed_canonical(&delivery.delivery_id, "worker-1", CLAIMED_AT, RETRY_AT)
            .expect("enqueue with stale message"),
        ClaimedDeliveryEnqueueOutcome::Enqueued { .. }
    ));
}

#[test]
fn newer_wake_takes_over_the_queued_row_of_an_unconsumed_older_wake() {
    let db = Db::open_in_memory().expect("open db");
    seed_link(&db, false);
    let first = persist_delivery_for_started_turn(
        &db,
        "turn-1",
        1,
        "2026-08-11T00:01:10Z",
        "2026-08-11T00:02:00Z",
        SessionTurnOutcome::Completed,
    );
    let store = CompletionDeliveryStore::new(db.clone());
    claim(&store, "worker-1");
    let first_pending = match store
        .enqueue_claimed_canonical(
            &first.delivery_id,
            "worker-1",
            CLAIMED_AT,
            "2999-01-01T00:00:00Z",
        )
        .expect("enqueue first wake")
    {
        ClaimedDeliveryEnqueueOutcome::Enqueued { pending, .. } => pending,
        _ => panic!("expected first enqueue"),
    };
    let second = persist_delivery_for_started_turn(
        &db,
        "turn-2",
        3,
        "2026-08-11T00:02:05Z",
        "2026-08-11T00:02:10Z",
        SessionTurnOutcome::Completed,
    );

    let claimed = store
        .claim_next_due("2026-08-11T00:02:15Z", "2026-08-11T00:02:45Z", "worker-2")
        .expect("claim second")
        .expect("second delivery due");
    assert_eq!(claimed.delivery_id, second.delivery_id);
    let outcome = store
        .enqueue_claimed_canonical(
            &second.delivery_id,
            "worker-2",
            "2026-08-11T00:02:15Z",
            "2026-08-11T00:02:17Z",
        )
        .expect("coalesce second wake");
    let ClaimedDeliveryEnqueueOutcome::Enqueued {
        delivery: second_enqueued,
        pending,
        inserted,
        superseded_delivery_id,
    } = outcome
    else {
        panic!("expected coalesced enqueue");
    };
    assert!(!inserted);
    assert_eq!(
        superseded_delivery_id.as_deref(),
        Some(first.delivery_id.as_str())
    );

    // The older wake's queue row is rewritten in place: same seq and position,
    // now carrying the newest completion so the parent never drains stale
    // output.
    assert_eq!(pending.seq, first_pending.seq);
    assert_eq!(pending.text, second.notification_text);
    assert!(pending_prompt_matches_delivery(&pending, &second_enqueued));
    let queue = SessionStore::new(db)
        .list_pending_prompts(&first.parent_session_id)
        .expect("queue");
    assert_eq!(
        queue.iter().map(|row| row.seq).collect::<Vec<_>>(),
        vec![first_pending.seq]
    );

    let retired = store.find(&first.delivery_id).expect("first").expect("row");
    assert_eq!(retired.state, CompletionDeliveryState::Delivered);
    assert!(retired.parent_prompt_seq.is_none());
    assert!(retired.parent_turn_id.is_none());
    assert_eq!(second_enqueued.state, CompletionDeliveryState::Enqueued);
    assert_eq!(second_enqueued.parent_prompt_seq, Some(first_pending.seq));
}

#[test]
fn same_turn_message_retires_an_older_queued_completed_wake() {
    let db = Db::open_in_memory().expect("open db");
    seed_link(&db, false);
    let first = persist_delivery_for_started_turn(
        &db,
        "turn-1",
        1,
        "2026-08-11T00:01:10Z",
        "2026-08-11T00:02:00Z",
        SessionTurnOutcome::Completed,
    );
    let store = CompletionDeliveryStore::new(db.clone());
    claim(&store, "worker-1");
    let first_pending = match store
        .enqueue_claimed_canonical(
            &first.delivery_id,
            "worker-1",
            CLAIMED_AT,
            "2999-01-01T00:00:00Z",
        )
        .expect("enqueue first wake")
    {
        ClaimedDeliveryEnqueueOutcome::Enqueued { pending, .. } => pending,
        _ => panic!("expected first enqueue"),
    };
    let second = persist_delivery_for_started_turn(
        &db,
        "turn-2",
        3,
        "2026-08-11T00:02:05Z",
        "2026-08-11T00:02:10Z",
        SessionTurnOutcome::Completed,
    );
    let message_seq = queue_child_message(&db, &second.parent_session_id, "2026-08-11T00:02:07Z");
    let claimed = store
        .claim_next_due("2026-08-11T00:02:15Z", "2026-08-11T00:02:45Z", "worker-2")
        .expect("claim second")
        .expect("second delivery due");
    assert_eq!(claimed.delivery_id, second.delivery_id);

    let outcome = store
        .enqueue_claimed_canonical(
            &second.delivery_id,
            "worker-2",
            "2026-08-11T00:02:15Z",
            "2026-08-11T00:02:17Z",
        )
        .expect("suppress second wake");
    let ClaimedDeliveryEnqueueOutcome::Suppressed {
        reason,
        retired_wakes,
        ..
    } = outcome
    else {
        panic!("expected suppression");
    };
    assert_eq!(
        reason,
        CompletionWakeSuppressionReason::RedundantChildMessage
    );
    assert_eq!(retired_wakes.len(), 1);
    assert_eq!(retired_wakes[0].delivery_id, first.delivery_id);
    assert_eq!(retired_wakes[0].parent_prompt_seq, first_pending.seq);
    assert_eq!(retired_wakes[0].prompt_id, first_pending.prompt_id);

    let queue = SessionStore::new(db.clone())
        .list_pending_prompts(&second.parent_session_id)
        .expect("queue");
    assert_eq!(
        queue.iter().map(|row| row.seq).collect::<Vec<_>>(),
        vec![message_seq]
    );
    assert!(!queue.iter().any(|row| row.seq == first_pending.seq));
    let retired = store.find(&first.delivery_id).expect("first").expect("row");
    assert_eq!(retired.state, CompletionDeliveryState::Delivered);
    assert!(retired.parent_prompt_seq.is_none());
}

#[test]
fn older_retry_yields_to_every_newer_terminal_wake() {
    for newer_outcome in [
        SessionTurnOutcome::Completed,
        SessionTurnOutcome::Failed,
        SessionTurnOutcome::Cancelled,
    ] {
        let db = Db::open_in_memory().expect("open db");
        seed_link(&db, false);
        let first = persist_delivery_for_started_turn(
            &db,
            "turn-1",
            1,
            "2026-08-11T00:01:10Z",
            "2026-08-11T00:02:00Z",
            SessionTurnOutcome::Completed,
        );
        let second = persist_delivery_for_started_turn(
            &db,
            "turn-2",
            3,
            "2026-08-11T00:02:05Z",
            "2026-08-11T00:02:10Z",
            newer_outcome,
        );
        let store = CompletionDeliveryStore::new(db.clone());

        let first_claim = store
            .claim_next_due("2026-08-11T00:02:15Z", "2026-08-11T00:02:45Z", "worker-1")
            .expect("claim first")
            .expect("first delivery due");
        assert_eq!(first_claim.delivery_id, first.delivery_id);
        let second_claim = store
            .claim_next_due("2026-08-11T00:02:15Z", "2026-08-11T00:02:45Z", "worker-2")
            .expect("claim second")
            .expect("second delivery due while first is leased");
        assert_eq!(second_claim.delivery_id, second.delivery_id);
        let second_pending = match store
            .enqueue_claimed_canonical(
                &second.delivery_id,
                "worker-2",
                "2026-08-11T00:02:15Z",
                "2026-08-11T00:02:17Z",
            )
            .expect("enqueue newer wake")
        {
            ClaimedDeliveryEnqueueOutcome::Enqueued {
                delivery, pending, ..
            } => {
                assert_eq!(delivery.outcome, newer_outcome);
                pending
            }
            _ => panic!("expected newer enqueue"),
        };

        let reclaimed = store
            .claim_next_due("2026-08-11T00:02:46Z", "2026-08-11T00:03:16Z", "worker-3")
            .expect("reclaim first")
            .expect("older delivery due after lease expiry");
        assert_eq!(reclaimed.delivery_id, first.delivery_id);
        let outcome = store
            .enqueue_claimed_canonical(
                &first.delivery_id,
                "worker-3",
                "2026-08-11T00:02:46Z",
                "2026-08-11T00:02:48Z",
            )
            .expect("coalesce reverse-order retry");
        assert!(matches!(
            outcome,
            ClaimedDeliveryEnqueueOutcome::Suppressed {
                reason: CompletionWakeSuppressionReason::Coalesced,
                ..
            }
        ));

        let queue = SessionStore::new(db)
            .list_pending_prompts(&first.parent_session_id)
            .expect("queue");
        assert_eq!(queue.len(), 1);
        assert_eq!(queue[0].seq, second_pending.seq);
        let retired = store.find(&first.delivery_id).expect("first").expect("row");
        assert_eq!(retired.state, CompletionDeliveryState::Delivered);
        assert!(retired.parent_prompt_seq.is_none());
    }
}

#[test]
fn previously_enqueued_delivery_is_recreated_not_suppressed() {
    let db = Db::open_in_memory().expect("open db");
    seed_link(&db, false);
    let delivery = persist_delivery_for_started_turn(
        &db,
        "turn-1",
        1,
        "2026-08-11T00:01:30Z",
        "2026-08-11T00:02:00Z",
        SessionTurnOutcome::Completed,
    );
    let store = CompletionDeliveryStore::new(db.clone());
    claim(&store, "worker-1");
    let first = match store
        .enqueue_claimed_canonical(&delivery.delivery_id, "worker-1", CLAIMED_AT, RETRY_AT)
        .expect("first enqueue")
    {
        ClaimedDeliveryEnqueueOutcome::Enqueued { pending, .. } => pending,
        _ => panic!("expected enqueue"),
    };
    db.with_conn(|conn| {
        conn.execute(
            "DELETE FROM session_pending_prompts WHERE session_id = ?1 AND seq = ?2",
            rusqlite::params![delivery.parent_session_id, first.seq],
        )?;
        Ok(())
    })
    .expect("simulate missing internal row");
    queue_child_message(&db, &delivery.parent_session_id, "2026-08-11T00:01:45Z");

    store
        .claim_next_due(RETRY_AT, "2026-08-11T00:03:00Z", "worker-2")
        .expect("reclaim")
        .expect("due delivery");
    // Exactly-once reconciliation wins over suppression for a delivery that
    // already reached the parent queue once.
    assert!(matches!(
        store
            .enqueue_claimed_canonical(
                &delivery.delivery_id,
                "worker-2",
                RETRY_AT,
                "2026-08-11T00:02:06Z",
            )
            .expect("recreate"),
        ClaimedDeliveryEnqueueOutcome::Enqueued { inserted: true, .. }
    ));
}
