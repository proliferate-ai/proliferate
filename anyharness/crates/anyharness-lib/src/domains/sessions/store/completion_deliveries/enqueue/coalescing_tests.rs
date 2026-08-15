use anyharness_contract::v1::PromptProvenance as PublicPromptProvenance;

use super::super::canonical::pending_prompt_matches_delivery;
use super::super::tests::seed_link;
use super::super::{
    CompletionDeliveryRecord, CompletionDeliveryState, CompletionDeliveryStore,
    DurableTerminalTurn,
};
use super::tests::{append_parent_prompt_triplet, claim, CLAIMED_AT, RETRY_AT};
use super::ClaimedDeliveryEnqueueOutcome;
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
    let payload = PromptPayload::text("Status update from the child".to_string())
        .with_provenance(PromptProvenance::AgentSession {
            source_session_id: "child-1".to_string(),
            session_link_id: Some("link-1".to_string()),
            label: Some("Researcher".to_string()),
        });
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
    append_parent_prompt_triplet(
        &db,
        &delivery,
        Some(PublicPromptProvenance::AgentSession {
            source_session_id: "child-1".to_string(),
            session_link_id: Some("link-1".to_string()),
            label: Some("Researcher".to_string()),
        }),
        "Status update from the child",
    );
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
    let second = persist_delivery_for_started_turn(
        &db,
        "turn-2",
        3,
        "2026-08-11T00:02:05Z",
        "2026-08-11T00:02:10Z",
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

