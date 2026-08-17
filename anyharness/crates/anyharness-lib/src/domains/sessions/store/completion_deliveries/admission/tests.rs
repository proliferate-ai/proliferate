use anyharness_contract::v1::{
    ItemCompletedEvent, ItemStartedEvent, PendingPromptRemovalReason, PendingPromptRemovedPayload,
    SessionEvent, TranscriptItemKind, TranscriptItemPayload, TranscriptItemStatus,
    TurnStartedEvent,
};
use rusqlite::params;

use super::super::enqueue::ClaimedDeliveryEnqueueOutcome;
use super::super::tests::{persist_delivery, seed_link};
use super::super::{
    CompletionDeliveryRecord, CompletionDeliveryState, CompletionDeliveryStore,
    DurableSubagentWakeTurn, DurableSubagentWakeTurnOutcome, DurableTerminalTurn,
};
use crate::domains::sessions::extensions::SessionTurnOutcome;
use crate::domains::sessions::model::{PendingPromptRecord, SessionEventRecord};
use crate::domains::sessions::prompt::provenance::PromptProvenance;
use crate::domains::sessions::store::SessionStore;
use crate::persistence::Db;

const NOW: &str = "2026-08-11T00:04:00Z";

fn enqueued_fixture() -> (
    Db,
    SessionStore,
    CompletionDeliveryStore,
    CompletionDeliveryRecord,
    PendingPromptRecord,
) {
    let db = Db::open_in_memory().expect("open db");
    seed_link(&db, false);
    let delivery = persist_delivery(&db, "turn-1");
    let delivery_store = CompletionDeliveryStore::new(db.clone());
    delivery_store
        .claim_next_due("2026-08-11T00:02:00Z", "2026-08-11T00:02:30Z", "worker-1")
        .expect("claim")
        .expect("claimed");
    let (delivery, pending) = match delivery_store
        .enqueue_claimed_canonical(
            &delivery.delivery_id,
            "worker-1",
            "2026-08-11T00:02:00Z",
            "2026-08-11T00:02:02Z",
        )
        .expect("enqueue")
    {
        ClaimedDeliveryEnqueueOutcome::Enqueued {
            delivery, pending, ..
        } => (delivery, pending),
        _ => panic!("expected enqueued delivery"),
    };
    (
        db.clone(),
        SessionStore::new(db),
        delivery_store,
        delivery,
        pending,
    )
}

fn staged_input(
    delivery: &CompletionDeliveryRecord,
    pending: &PendingPromptRecord,
    first_seq: i64,
) -> DurableSubagentWakeTurn {
    let turn_id = "parent-turn-admitted";
    let item_id = "parent-item-admitted";
    let payload = pending.prompt_payload();
    let item = TranscriptItemPayload {
        kind: TranscriptItemKind::UserMessage,
        status: TranscriptItemStatus::Completed,
        source_agent_kind: "claude".into(),
        is_transient: false,
        message_id: None,
        prompt_id: pending.prompt_id.clone(),
        title: None,
        tool_call_id: None,
        native_tool_name: None,
        parent_tool_call_id: None,
        raw_input: None,
        raw_output: None,
        content_parts: payload.content_parts(),
        prompt_provenance: payload.public_provenance(),
    };
    let events = [
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
                seq: pending.seq,
                prompt_id: Some(delivery.prompt_id()),
                reason: PendingPromptRemovalReason::Executed,
            }),
            None,
            None,
        ),
    ]
    .into_iter()
    .enumerate()
    .map(|(offset, (event, turn_id, item_id))| SessionEventRecord {
        id: 0,
        session_id: delivery.parent_session_id.clone(),
        seq: first_seq + offset as i64,
        timestamp: format!("2026-08-11T00:04:0{offset}Z"),
        event_type: event.event_type().into(),
        turn_id: turn_id.map(str::to_string),
        item_id: item_id.map(str::to_string),
        payload_json: serde_json::to_string(&event).expect("event json"),
    })
    .collect();
    DurableSubagentWakeTurn {
        session_id: delivery.parent_session_id.clone(),
        queue_seq: pending.seq,
        events,
        admitted_at: NOW.into(),
    }
}

fn persist_delivery_with_outcome(
    db: &Db,
    turn_id: &str,
    event_seq: i64,
    completed_at: &str,
    outcome: SessionTurnOutcome,
) -> CompletionDeliveryRecord {
    SessionStore::new(db.clone())
        .persist_terminal_turn_record(&DurableTerminalTurn {
            terminal_id: format!("terminal-{turn_id}"),
            session_id: "child-1".into(),
            turn_id: turn_id.into(),
            outcome,
            assistant_text: Some(format!("{turn_id} output")),
            events: vec![SessionEventRecord {
                id: 0,
                session_id: "child-1".into(),
                seq: event_seq,
                timestamp: completed_at.into(),
                turn_id: Some(turn_id.into()),
                item_id: None,
                event_type: "turn_ended".into(),
                payload_json: format!(
                    r#"{{"type":"turn_ended","stopReason":"{}"}}"#,
                    if outcome == SessionTurnOutcome::Cancelled {
                        "cancelled"
                    } else {
                        "end_turn"
                    }
                ),
            }],
            completed_at: completed_at.into(),
        })
        .expect("persist terminal turn through production capture");
    CompletionDeliveryStore::new(db.clone())
        .find(&format!("terminal-{turn_id}"))
        .expect("find captured delivery")
        .expect("delivery captured")
}

#[test]
fn admission_commits_four_events_queue_delete_delivery_and_projection_together() {
    let (db, session_store, delivery_store, delivery, pending) = enqueued_fixture();
    let outcome = session_store
        .persist_subagent_wake_turn_record(&staged_input(&delivery, &pending, 1))
        .expect("admit wake");
    assert_eq!(outcome, DurableSubagentWakeTurnOutcome::Admitted);
    let events = session_store
        .list_events(&delivery.parent_session_id)
        .expect("events");
    assert_eq!(events.len(), 4);
    assert_eq!(
        events
            .iter()
            .map(|event| event.event_type.as_str())
            .collect::<Vec<_>>(),
        vec![
            "turn_started",
            "item_started",
            "item_completed",
            "pending_prompt_removed",
        ]
    );
    assert!(session_store
        .find_pending_prompt(&delivery.parent_session_id, pending.seq)
        .expect("pending")
        .is_none());
    let delivered = delivery_store
        .find(&delivery.delivery_id)
        .expect("delivery")
        .expect("row");
    assert_eq!(delivered.state, CompletionDeliveryState::Delivered);
    assert_eq!(
        delivered.parent_turn_id.as_deref(),
        Some("parent-turn-admitted")
    );
    db.with_conn(|conn| {
        let projection: (Option<i64>, Option<i64>) = conn.query_row(
            "SELECT parent_prompt_seq, parent_event_seq
             FROM session_link_completions WHERE completion_id = ?1",
            [delivery.completion_id.as_str()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        assert_eq!(projection, (Some(pending.seq), Some(3)));
        Ok(())
    })
    .expect("projection");
}

#[test]
fn stale_worker_after_committed_admission_cannot_reenqueue() {
    let (_db, session_store, delivery_store, delivery, pending) = enqueued_fixture();
    assert_eq!(
        session_store
            .persist_subagent_wake_turn_record(&staged_input(&delivery, &pending, 1))
            .expect("admit wake"),
        DurableSubagentWakeTurnOutcome::Admitted
    );

    assert_eq!(
        delivery_store
            .enqueue_claimed_canonical(
                &delivery.delivery_id,
                "worker-1",
                "2026-08-11T00:04:01Z",
                "2026-08-11T00:04:03Z",
            )
            .expect("stale worker"),
        ClaimedDeliveryEnqueueOutcome::Stale
    );
    assert!(session_store
        .list_pending_prompts(&delivery.parent_session_id)
        .expect("queue")
        .is_empty());
    assert_eq!(
        session_store
            .list_events(&delivery.parent_session_id)
            .expect("events")
            .len(),
        4
    );
}

#[test]
fn admission_failpoints_roll_back_every_write_and_retry_once() {
    for (trigger_name, trigger_sql) in [
        (
            "fail_wake_queue_delete",
            "CREATE TRIGGER fail_wake_queue_delete
             BEFORE DELETE ON session_pending_prompts
             BEGIN SELECT RAISE(ABORT, 'queue delete failpoint'); END;",
        ),
        (
            "fail_wake_outbox_update",
            "CREATE TRIGGER fail_wake_outbox_update
             BEFORE UPDATE OF state ON session_link_completion_deliveries
             WHEN NEW.state = 'delivered'
             BEGIN SELECT RAISE(ABORT, 'outbox update failpoint'); END;",
        ),
    ] {
        let (db, session_store, delivery_store, delivery, pending) = enqueued_fixture();
        db.with_conn(|conn| conn.execute_batch(trigger_sql))
            .expect("install failpoint");
        let input = staged_input(&delivery, &pending, 1);
        assert!(session_store
            .persist_subagent_wake_turn_record(&input)
            .is_err());
        assert!(session_store
            .list_events(&delivery.parent_session_id)
            .expect("events")
            .is_empty());
        assert!(session_store
            .find_pending_prompt(&delivery.parent_session_id, pending.seq)
            .expect("pending")
            .is_some());
        assert_eq!(
            delivery_store
                .find(&delivery.delivery_id)
                .expect("delivery")
                .expect("row")
                .state,
            CompletionDeliveryState::Enqueued
        );
        db.with_conn(|conn| conn.execute_batch(&format!("DROP TRIGGER {trigger_name}")))
            .expect("drop failpoint");
        assert_eq!(
            session_store
                .persist_subagent_wake_turn_record(&input)
                .expect("retry"),
            DurableSubagentWakeTurnOutcome::Admitted
        );
        assert_eq!(
            session_store
                .list_events(&delivery.parent_session_id)
                .expect("events")
                .len(),
            4
        );
    }
}

#[test]
fn exact_visible_turn_repeatedly_cleans_stale_canonical_rows_without_new_events() {
    let (db, session_store, delivery_store, delivery, pending) = enqueued_fixture();
    let input = staged_input(&delivery, &pending, 1);
    assert_eq!(
        session_store
            .persist_subagent_wake_turn_record(&input)
            .expect("first admission"),
        DurableSubagentWakeTurnOutcome::Admitted
    );
    let ordinary = session_store
        .insert_pending_prompt(
            &delivery.parent_session_id,
            "ordinary raw-id collision",
            Some(&delivery.prompt_id()),
        )
        .expect("ordinary collision");
    db.with_conn(|conn| {
        conn.execute(
            "UPDATE session_link_completion_deliveries
             SET parent_prompt_seq = ?2 WHERE delivery_id = ?1",
            params![delivery.delivery_id, ordinary.seq],
        )?;
        Ok(())
    })
    .expect("seed conflicting raw-id projection");

    let mut corrected_parent_prompt_seq = None;
    for _ in 0..2 {
        let stale = session_store
            .insert_pending_prompt_payload(
                &delivery.parent_session_id,
                &pending.prompt_payload(),
                Some(&delivery.prompt_id()),
            )
            .expect("stale canonical row");
        let outcome = session_store
            .persist_subagent_wake_turn_record(&staged_input(&delivery, &stale, 5))
            .expect("visible reconciliation");
        assert_eq!(
            outcome,
            DurableSubagentWakeTurnOutcome::AlreadyVisible {
                parent_turn_id: "parent-turn-admitted".into()
            }
        );
        assert!(session_store
            .find_pending_prompt(&delivery.parent_session_id, stale.seq)
            .expect("pending")
            .is_none());
        assert_eq!(
            session_store
                .list_events(&delivery.parent_session_id)
                .expect("events")
                .len(),
            4
        );
        corrected_parent_prompt_seq.get_or_insert(stale.seq);
        assert_eq!(
            delivery_store
                .find(&delivery.delivery_id)
                .expect("delivery")
                .expect("row")
                .parent_prompt_seq,
            corrected_parent_prompt_seq
        );
    }
}

// A coalescing rewrite can replace the queue row's payload after the parent
// actor copied it for staging. The stale copy must not execute as a turn, and
// the rewritten wake must remain admissible afterwards.
#[test]
fn stale_actor_copy_of_a_rewritten_wake_is_skipped_then_redelivered() {
    let (db, session_store, delivery_store, first, first_pending) = enqueued_fixture();
    let stale_copy = staged_input(&first, &first_pending, 1);

    db.with_conn(|conn| {
        conn.execute(
            "UPDATE session_link_completion_deliveries
             SET next_attempt_at = '2999-01-01T00:00:00Z' WHERE delivery_id = ?1",
            [first.delivery_id.as_str()],
        )?;
        Ok(())
    })
    .expect("park first delivery retry");
    session_store
        .persist_terminal_turn_record(&DurableTerminalTurn {
            terminal_id: "terminal-turn-2".into(),
            session_id: "child-1".into(),
            turn_id: "turn-2".into(),
            outcome: SessionTurnOutcome::Completed,
            assistant_text: Some("Newest answer".into()),
            events: vec![SessionEventRecord {
                id: 0,
                session_id: "child-1".into(),
                seq: 2,
                timestamp: "2026-08-11T00:03:00Z".into(),
                turn_id: Some("turn-2".into()),
                item_id: None,
                event_type: "turn_ended".into(),
                payload_json: r#"{"type":"turn_ended","stopReason":"end_turn"}"#.into(),
            }],
            completed_at: "2026-08-11T00:03:00Z".into(),
        })
        .expect("persist second terminal turn");
    delivery_store
        .claim_next_due("2026-08-11T00:03:05Z", "2026-08-11T00:03:35Z", "worker-2")
        .expect("claim second")
        .expect("second claimed");
    let (second, rewritten) = match delivery_store
        .enqueue_claimed_canonical(
            "terminal-turn-2",
            "worker-2",
            "2026-08-11T00:03:05Z",
            "2026-08-11T00:03:07Z",
        )
        .expect("coalesce second wake")
    {
        ClaimedDeliveryEnqueueOutcome::Enqueued {
            delivery,
            pending,
            superseded_delivery_id,
            ..
        } => {
            assert_eq!(
                superseded_delivery_id.as_deref(),
                Some(first.delivery_id.as_str())
            );
            (delivery, pending)
        }
        _ => panic!("expected coalesced enqueue"),
    };
    assert_eq!(rewritten.seq, first_pending.seq);

    assert_eq!(
        session_store
            .persist_subagent_wake_turn_record(&stale_copy)
            .expect("stale copy skipped"),
        DurableSubagentWakeTurnOutcome::Stale
    );
    assert!(session_store
        .list_events(&second.parent_session_id)
        .expect("events")
        .is_empty());
    assert_eq!(
        session_store
            .find_pending_prompt(&second.parent_session_id, rewritten.seq)
            .expect("pending")
            .expect("row"),
        rewritten
    );

    assert_eq!(
        session_store
            .persist_subagent_wake_turn_record(&staged_input(&second, &rewritten, 1))
            .expect("redeliver rewritten wake"),
        DurableSubagentWakeTurnOutcome::Admitted
    );
    assert_eq!(
        delivery_store
            .find(&second.delivery_id)
            .expect("second")
            .expect("row")
            .state,
        CompletionDeliveryState::Delivered
    );
}

#[test]
fn older_actionable_wakes_remain_drainable_when_a_later_completion_is_enqueued() {
    for actionable_outcome in [SessionTurnOutcome::Failed, SessionTurnOutcome::Cancelled] {
        let db = Db::open_in_memory().expect("open db");
        seed_link(&db, false);
        let delivery_store = CompletionDeliveryStore::new(db.clone());
        let session_store = SessionStore::new(db.clone());
        let actionable = persist_delivery_with_outcome(
            &db,
            "turn-actionable",
            1,
            "2026-08-11T00:02:00Z",
            actionable_outcome,
        );
        delivery_store
            .claim_next_due(
                "2026-08-11T00:02:00Z",
                "2026-08-11T00:02:30Z",
                "worker-actionable",
            )
            .expect("claim actionable delivery")
            .expect("actionable delivery due");
        let actionable_pending = match delivery_store
            .enqueue_claimed_canonical(
                &actionable.delivery_id,
                "worker-actionable",
                "2026-08-11T00:02:00Z",
                "2999-01-01T00:00:00Z",
            )
            .expect("enqueue actionable wake")
        {
            ClaimedDeliveryEnqueueOutcome::Enqueued {
                pending,
                superseded_delivery_id,
                ..
            } => {
                assert!(superseded_delivery_id.is_none());
                pending
            }
            _ => panic!("expected actionable wake enqueue"),
        };

        let completed = persist_delivery_with_outcome(
            &db,
            "turn-completed",
            2,
            "2026-08-11T00:03:00Z",
            SessionTurnOutcome::Completed,
        );
        let claimed = delivery_store
            .claim_next_due(
                "2026-08-11T00:03:05Z",
                "2026-08-11T00:03:35Z",
                "worker-completed",
            )
            .expect("claim later completion")
            .expect("later completion due");
        assert_eq!(claimed.delivery_id, completed.delivery_id);
        let completed_pending = match delivery_store
            .enqueue_claimed_canonical(
                &completed.delivery_id,
                "worker-completed",
                "2026-08-11T00:03:05Z",
                "2026-08-11T00:03:07Z",
            )
            .expect("enqueue later completed wake")
        {
            ClaimedDeliveryEnqueueOutcome::Enqueued {
                pending,
                inserted,
                superseded_delivery_id,
                ..
            } => {
                assert!(inserted);
                assert!(superseded_delivery_id.is_none());
                pending
            }
            _ => panic!("expected independent completed wake enqueue"),
        };

        // These are real SQLite queue rows produced by terminal capture,
        // outbox claim, and canonical enqueue. Admitting the actionable row
        // proves a later completion did not merely leave an orphaned prompt.
        assert_ne!(actionable_pending.seq, completed_pending.seq);
        assert_eq!(
            session_store
                .list_pending_prompts(&actionable.parent_session_id)
                .expect("durable queue"),
            vec![actionable_pending.clone(), completed_pending.clone()]
        );
        assert_eq!(
            session_store
                .persist_subagent_wake_turn_record(&staged_input(
                    &actionable,
                    &actionable_pending,
                    1,
                ))
                .expect("admit actionable wake"),
            DurableSubagentWakeTurnOutcome::Admitted
        );
        let delivered = delivery_store
            .find(&actionable.delivery_id)
            .expect("find actionable delivery")
            .expect("actionable delivery remains");
        assert_eq!(delivered.outcome, actionable_outcome);
        assert_eq!(delivered.parent_prompt_seq, Some(actionable_pending.seq));
        assert_eq!(
            delivered.parent_turn_id.as_deref(),
            Some("parent-turn-admitted")
        );
        assert_eq!(
            session_store
                .list_pending_prompts(&completed.parent_session_id)
                .expect("remaining queue"),
            vec![completed_pending]
        );
    }
}

#[test]
fn later_actionable_wakes_adopt_only_an_eligible_completed_sibling() {
    for actionable_outcome in [SessionTurnOutcome::Failed, SessionTurnOutcome::Cancelled] {
        let db = Db::open_in_memory().expect("open db");
        seed_link(&db, false);
        let delivery_store = CompletionDeliveryStore::new(db.clone());
        let session_store = SessionStore::new(db.clone());
        let completed = persist_delivery_with_outcome(
            &db,
            "turn-completed",
            1,
            "2026-08-11T00:02:00Z",
            SessionTurnOutcome::Completed,
        );
        delivery_store
            .claim_next_due(
                "2026-08-11T00:02:00Z",
                "2026-08-11T00:02:30Z",
                "worker-completed",
            )
            .expect("claim completed delivery")
            .expect("completed delivery due");
        let completed_pending = match delivery_store
            .enqueue_claimed_canonical(
                &completed.delivery_id,
                "worker-completed",
                "2026-08-11T00:02:00Z",
                "2999-01-01T00:00:00Z",
            )
            .expect("enqueue completed wake")
        {
            ClaimedDeliveryEnqueueOutcome::Enqueued { pending, .. } => pending,
            _ => panic!("expected completed wake enqueue"),
        };

        let actionable = persist_delivery_with_outcome(
            &db,
            "turn-actionable",
            2,
            "2026-08-11T00:03:00Z",
            actionable_outcome,
        );
        delivery_store
            .claim_next_due(
                "2026-08-11T00:03:05Z",
                "2026-08-11T00:03:35Z",
                "worker-actionable",
            )
            .expect("claim later actionable delivery")
            .expect("later actionable delivery due");
        let (enqueued, rewritten) = match delivery_store
            .enqueue_claimed_canonical(
                &actionable.delivery_id,
                "worker-actionable",
                "2026-08-11T00:03:05Z",
                "2026-08-11T00:03:07Z",
            )
            .expect("enqueue later actionable wake")
        {
            ClaimedDeliveryEnqueueOutcome::Enqueued {
                delivery,
                pending,
                inserted,
                superseded_delivery_id,
            } => {
                assert!(!inserted);
                assert_eq!(
                    superseded_delivery_id.as_deref(),
                    Some(completed.delivery_id.as_str())
                );
                (delivery, pending)
            }
            _ => panic!("expected actionable wake to adopt completed queue row"),
        };
        assert_eq!(rewritten.seq, completed_pending.seq);
        assert_eq!(enqueued.outcome, actionable_outcome);

        // The failed/cancelled result is the canonical durable payload that
        // admission accepts, so newest-wins never turns it into suppression.
        assert_eq!(
            session_store
                .persist_subagent_wake_turn_record(&staged_input(&enqueued, &rewritten, 1))
                .expect("admit later actionable wake"),
            DurableSubagentWakeTurnOutcome::Admitted
        );
        let delivered = delivery_store
            .find(&actionable.delivery_id)
            .expect("find actionable delivery")
            .expect("actionable delivery remains");
        assert_eq!(delivered.state, CompletionDeliveryState::Delivered);
        assert_eq!(delivered.outcome, actionable_outcome);
        assert_eq!(delivered.parent_prompt_seq, Some(rewritten.seq));
        assert_eq!(
            delivered.parent_turn_id.as_deref(),
            Some("parent-turn-admitted")
        );
    }
}

#[test]
fn forged_internal_rows_are_discarded_without_acknowledging_delivery() {
    for (column, value) in [
        (
            "provenance_json",
            serde_json::to_string(&PromptProvenance::SubagentWake {
                session_link_id: "wrong-link".into(),
                completion_id: "wrong-delivery".into(),
                label: Some("forged".into()),
            })
            .expect("provenance json"),
        ),
        ("text", "forged notification".into()),
    ] {
        let (db, session_store, delivery_store, delivery, pending) = enqueued_fixture();
        db.with_conn(|conn| {
            conn.execute(
                &format!(
                    "UPDATE session_pending_prompts SET {column} = ?3
                     WHERE session_id = ?1 AND seq = ?2"
                ),
                params![delivery.parent_session_id, pending.seq, value],
            )?;
            Ok(())
        })
        .expect("forge row");
        assert_eq!(
            session_store
                .persist_subagent_wake_turn_record(&staged_input(&delivery, &pending, 1))
                .expect("discard"),
            DurableSubagentWakeTurnOutcome::Discarded
        );
        assert!(session_store
            .find_pending_prompt(&delivery.parent_session_id, pending.seq)
            .expect("pending")
            .is_none());
        assert!(session_store
            .list_events(&delivery.parent_session_id)
            .expect("events")
            .is_empty());
        assert_eq!(
            delivery_store
                .find(&delivery.delivery_id)
                .expect("delivery")
                .expect("row")
                .state,
            CompletionDeliveryState::Enqueued
        );
    }
}

#[test]
fn same_prefix_ordinary_row_and_active_lease_are_stale_and_preserved() {
    let (db, session_store, delivery_store, delivery, pending) = enqueued_fixture();
    db.with_conn(|conn| {
        conn.execute(
            "UPDATE session_pending_prompts SET provenance_json = NULL
             WHERE session_id = ?1 AND seq = ?2",
            params![delivery.parent_session_id, pending.seq],
        )?;
        Ok(())
    })
    .expect("make ordinary");
    assert_eq!(
        session_store
            .persist_subagent_wake_turn_record(&staged_input(&delivery, &pending, 1))
            .expect("ordinary stale"),
        DurableSubagentWakeTurnOutcome::Stale
    );
    assert!(session_store
        .find_pending_prompt(&delivery.parent_session_id, pending.seq)
        .expect("pending")
        .is_some());

    db.with_conn(|conn| {
        conn.execute(
            "UPDATE session_pending_prompts SET provenance_json = ?3
             WHERE session_id = ?1 AND seq = ?2",
            params![
                delivery.parent_session_id,
                pending.seq,
                pending.provenance_json,
            ],
        )?;
        conn.execute(
            "UPDATE session_link_completion_deliveries
             SET lease_token = 'other-worker', lease_expires_at = '2099-01-01T00:00:00Z'
             WHERE delivery_id = ?1",
            [delivery.delivery_id.as_str()],
        )?;
        Ok(())
    })
    .expect("restore canonical with active lease");
    assert_eq!(
        session_store
            .persist_subagent_wake_turn_record(&staged_input(&delivery, &pending, 1))
            .expect("leased stale"),
        DurableSubagentWakeTurnOutcome::Stale
    );
    assert_eq!(
        delivery_store
            .find(&delivery.delivery_id)
            .expect("delivery")
            .expect("row")
            .state,
        CompletionDeliveryState::Enqueued
    );
}
