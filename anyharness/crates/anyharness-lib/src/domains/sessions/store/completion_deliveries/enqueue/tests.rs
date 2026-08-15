use anyharness_contract::v1::{
    ContentPart, ItemCompletedEvent, ItemStartedEvent, PromptProvenance as PublicPromptProvenance,
    SessionEvent, TranscriptItemKind, TranscriptItemPayload, TranscriptItemStatus,
    TurnStartedEvent,
};

use super::super::canonical::pending_prompt_matches_delivery;
use super::super::tests::{persist_delivery, seed_link};
use super::super::{CompletionDeliveryRecord, CompletionDeliveryState, CompletionDeliveryStore};
use super::ClaimedDeliveryEnqueueOutcome;
use crate::domains::sessions::model::SessionEventRecord;
use crate::domains::sessions::prompt::{provenance::PromptProvenance, PromptPayload};
use crate::domains::sessions::store::pending_prompts::PendingPromptWriteError;
use crate::domains::sessions::store::SessionStore;
use crate::persistence::Db;

pub(super) const CLAIMED_AT: &str = "2026-08-11T00:02:00Z";
pub(super) const RETRY_AT: &str = "2026-08-11T00:02:02Z";

pub(super) fn claim(store: &CompletionDeliveryStore, lease_token: &str) -> CompletionDeliveryRecord {
    store
        .claim_next_due(CLAIMED_AT, "2026-08-11T00:02:30Z", lease_token)
        .expect("claim")
        .expect("delivery claimed")
}

fn canonical_payload(delivery: &CompletionDeliveryRecord) -> PromptPayload {
    PromptPayload::text(delivery.notification_text.clone()).with_provenance(
        PromptProvenance::SubagentWake {
            session_link_id: delivery.session_link_id.clone(),
            completion_id: delivery.delivery_id.clone(),
            label: delivery.label.clone(),
        },
    )
}

pub(super) fn append_parent_prompt_triplet(
    db: &Db,
    delivery: &CompletionDeliveryRecord,
    provenance: Option<PublicPromptProvenance>,
    text: &str,
) {
    let turn_id = "parent-turn-1";
    let item_id = "parent-item-1";
    let item = TranscriptItemPayload {
        kind: TranscriptItemKind::UserMessage,
        status: TranscriptItemStatus::Completed,
        source_agent_kind: "claude".into(),
        is_transient: false,
        message_id: None,
        prompt_id: Some(delivery.prompt_id()),
        title: None,
        tool_call_id: None,
        native_tool_name: None,
        parent_tool_call_id: None,
        raw_input: None,
        raw_output: None,
        content_parts: vec![ContentPart::Text { text: text.into() }],
        prompt_provenance: provenance,
    };
    let store = SessionStore::new(db.clone());
    for (seq, event, turn, item_id) in [
        (
            1,
            SessionEvent::TurnStarted(TurnStartedEvent::default()),
            Some(turn_id),
            None,
        ),
        (
            2,
            SessionEvent::ItemStarted(ItemStartedEvent { item: item.clone() }),
            Some(turn_id),
            Some(item_id),
        ),
        (
            3,
            SessionEvent::ItemCompleted(ItemCompletedEvent { item }),
            Some(turn_id),
            Some(item_id),
        ),
    ] {
        store
            .append_event(&SessionEventRecord {
                id: 0,
                session_id: delivery.parent_session_id.clone(),
                seq,
                timestamp: format!("2026-08-11T00:03:0{seq}Z"),
                event_type: event.event_type().into(),
                turn_id: turn.map(str::to_string),
                item_id: item_id.map(str::to_string),
                payload_json: serde_json::to_string(&event).expect("event json"),
            })
            .expect("append parent transcript event");
    }
}
#[test]
fn atomic_enqueue_preserves_ordinary_collision_and_adds_one_canonical_row() {
    let db = Db::open_in_memory().expect("open db");
    seed_link(&db, false);
    let delivery = persist_delivery(&db, "turn-1");
    let session_store = SessionStore::new(db.clone());
    let ordinary = session_store
        .insert_pending_prompt(
            &delivery.parent_session_id,
            "ordinary same-id prompt",
            Some(&delivery.prompt_id()),
        )
        .expect("ordinary collision");
    let store = CompletionDeliveryStore::new(db.clone());
    claim(&store, "worker-1");

    let outcome = store
        .enqueue_claimed_canonical(&delivery.delivery_id, "worker-1", CLAIMED_AT, RETRY_AT)
        .expect("atomic enqueue");
    let ClaimedDeliveryEnqueueOutcome::Enqueued {
        delivery: enqueued,
        pending,
        inserted,
        ..
    } = outcome
    else {
        panic!("expected enqueue");
    };
    assert!(inserted);
    assert_ne!(pending.seq, ordinary.seq);
    assert!(pending_prompt_matches_delivery(&pending, &enqueued));
    let rows = session_store
        .list_pending_prompts(&delivery.parent_session_id)
        .expect("queue");
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0], ordinary);
    assert_eq!(enqueued.parent_prompt_seq, Some(pending.seq));
    assert_eq!(enqueued.state, CompletionDeliveryState::Enqueued);
    assert_eq!(enqueued.next_attempt_at, RETRY_AT);
    assert!(enqueued.lease_token.is_none());
}

#[test]
fn atomic_enqueue_persists_backoff_and_reclaims_only_when_due() {
    let db = Db::open_in_memory().expect("open db");
    seed_link(&db, false);
    let delivery = persist_delivery(&db, "turn-1");
    let store = CompletionDeliveryStore::new(db);
    claim(&store, "worker-1");

    assert!(matches!(
        store
            .enqueue_claimed_canonical(&delivery.delivery_id, "worker-1", CLAIMED_AT, RETRY_AT)
            .expect("enqueue canonical"),
        ClaimedDeliveryEnqueueOutcome::Enqueued { .. }
    ));
    assert!(store
        .claim_next_due("2026-08-11T00:02:01Z", "2026-08-11T00:02:31Z", "worker-2",)
        .expect("early claim")
        .is_none());
    let reclaimed = store
        .claim_next_due(RETRY_AT, "2026-08-11T00:02:32Z", "worker-2")
        .expect("due claim")
        .expect("delivery reclaimed");
    assert_eq!(reclaimed.delivery_id, delivery.delivery_id);
    assert_eq!(reclaimed.state, CompletionDeliveryState::Enqueued);
    assert_eq!(reclaimed.attempt_count, 2);
}

#[test]
fn atomic_enqueue_recreates_deleted_internal_row_with_the_stable_prompt_id() {
    let db = Db::open_in_memory().expect("open db");
    seed_link(&db, false);
    let delivery = persist_delivery(&db, "turn-1");
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

    store
        .claim_next_due(RETRY_AT, "2026-08-11T00:03:00Z", "worker-2")
        .expect("reclaim")
        .expect("due delivery");
    let recreated = match store
        .enqueue_claimed_canonical(
            &delivery.delivery_id,
            "worker-2",
            RETRY_AT,
            "2026-08-11T00:02:06Z",
        )
        .expect("recreate")
    {
        ClaimedDeliveryEnqueueOutcome::Enqueued {
            pending, inserted, ..
        } => {
            assert!(inserted);
            pending
        }
        _ => panic!("expected recreated enqueue"),
    };
    let stable_prompt_id = delivery.prompt_id();
    assert!(recreated.seq > first.seq);
    assert_eq!(
        recreated.prompt_id.as_deref(),
        Some(stable_prompt_id.as_str())
    );
}

#[test]
fn atomic_enqueue_culls_only_duplicate_canonical_rows() {
    let db = Db::open_in_memory().expect("open db");
    seed_link(&db, false);
    let delivery = persist_delivery(&db, "turn-1");
    let session_store = SessionStore::new(db.clone());
    let ordinary = session_store
        .insert_pending_prompt(
            &delivery.parent_session_id,
            "ordinary collision",
            Some(&delivery.prompt_id()),
        )
        .expect("ordinary row");
    let first = session_store
        .insert_pending_prompt_payload(
            &delivery.parent_session_id,
            &canonical_payload(&delivery),
            Some(&delivery.prompt_id()),
        )
        .expect("first canonical");
    let second = session_store
        .insert_pending_prompt_payload(
            &delivery.parent_session_id,
            &canonical_payload(&delivery),
            Some(&delivery.prompt_id()),
        )
        .expect("second canonical");
    let store = CompletionDeliveryStore::new(db.clone());
    claim(&store, "worker-1");
    let outcome = store
        .enqueue_claimed_canonical(&delivery.delivery_id, "worker-1", CLAIMED_AT, RETRY_AT)
        .expect("dedupe");
    let ClaimedDeliveryEnqueueOutcome::Enqueued {
        pending, inserted, ..
    } = outcome
    else {
        panic!("expected enqueue");
    };
    assert!(!inserted);
    assert_eq!(pending.seq, first.seq);
    let rows = session_store
        .list_pending_prompts(&delivery.parent_session_id)
        .expect("queue");
    assert!(rows.iter().any(|row| row.seq == ordinary.seq));
    assert!(rows.iter().any(|row| row.seq == first.seq));
    assert!(!rows.iter().any(|row| row.seq == second.seq));
    assert_eq!(rows.len(), 2);
}

#[test]
fn exact_transcript_reconciles_and_cleans_only_stale_canonical_rows() {
    let db = Db::open_in_memory().expect("open db");
    seed_link(&db, false);
    let delivery = persist_delivery(&db, "turn-1");
    let session_store = SessionStore::new(db.clone());
    let ordinary = session_store
        .insert_pending_prompt(
            &delivery.parent_session_id,
            "ordinary collision",
            Some(&delivery.prompt_id()),
        )
        .expect("ordinary row");
    let canonical = session_store
        .insert_pending_prompt_payload(
            &delivery.parent_session_id,
            &canonical_payload(&delivery),
            Some(&delivery.prompt_id()),
        )
        .expect("stale canonical row");
    db.with_conn(|conn| {
        conn.execute(
            "UPDATE session_link_completion_deliveries
             SET parent_prompt_seq = ?2 WHERE delivery_id = ?1",
            rusqlite::params![delivery.delivery_id, ordinary.seq],
        )?;
        Ok(())
    })
    .expect("seed conflicting raw-id projection");
    append_parent_prompt_triplet(
        &db,
        &delivery,
        Some(PublicPromptProvenance::SubagentWake {
            session_link_id: delivery.session_link_id.clone(),
            completion_id: delivery.delivery_id.clone(),
            label: delivery.label.clone(),
        }),
        &delivery.notification_text,
    );
    let store = CompletionDeliveryStore::new(db.clone());
    claim(&store, "worker-1");
    let outcome = store
        .enqueue_claimed_canonical(&delivery.delivery_id, "worker-1", CLAIMED_AT, RETRY_AT)
        .expect("reconcile transcript");
    let ClaimedDeliveryEnqueueOutcome::AlreadyVisible {
        delivery: delivered,
        parent_turn_id,
    } = outcome
    else {
        panic!("expected visible reconciliation");
    };
    assert_eq!(parent_turn_id, "parent-turn-1");
    assert_eq!(delivered.state, CompletionDeliveryState::Delivered);
    assert_eq!(delivered.parent_turn_id.as_deref(), Some("parent-turn-1"));
    assert_eq!(delivered.parent_prompt_seq, Some(canonical.seq));
    db.with_conn(|conn| {
        let projection: (Option<i64>, Option<i64>) = conn.query_row(
            "SELECT parent_prompt_seq, parent_event_seq
             FROM session_link_completions WHERE completion_id = ?1",
            [delivery.completion_id.as_str()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        assert_eq!(projection, (Some(canonical.seq), Some(3)));
        Ok(())
    })
    .expect("exact projection");
    let rows = session_store
        .list_pending_prompts(&delivery.parent_session_id)
        .expect("queue");
    assert_eq!(rows, vec![ordinary]);
}

#[test]
fn ordinary_same_id_transcript_never_acknowledges_delivery() {
    let db = Db::open_in_memory().expect("open db");
    seed_link(&db, false);
    let delivery = persist_delivery(&db, "turn-1");
    append_parent_prompt_triplet(&db, &delivery, None, &delivery.notification_text);
    let store = CompletionDeliveryStore::new(db.clone());
    claim(&store, "worker-1");
    let outcome = store
        .enqueue_claimed_canonical(&delivery.delivery_id, "worker-1", CLAIMED_AT, RETRY_AT)
        .expect("enqueue after spoof transcript");
    assert!(matches!(
        outcome,
        ClaimedDeliveryEnqueueOutcome::Enqueued { inserted: true, .. }
    ));
    assert_eq!(
        store
            .find(&delivery.delivery_id)
            .expect("delivery")
            .expect("row")
            .state,
        CompletionDeliveryState::Enqueued
    );
}

#[test]
fn failed_outbox_transition_rolls_back_queue_and_projection_then_retries() {
    let db = Db::open_in_memory().expect("open db");
    seed_link(&db, false);
    let delivery = persist_delivery(&db, "turn-1");
    let store = CompletionDeliveryStore::new(db.clone());
    claim(&store, "worker-1");
    db.with_conn(|conn| {
        conn.execute_batch(
            "CREATE TRIGGER fail_enqueue_state
             BEFORE UPDATE OF state ON session_link_completion_deliveries
             WHEN NEW.state = 'enqueued'
             BEGIN SELECT RAISE(ABORT, 'enqueue failpoint'); END;",
        )
    })
    .expect("install enqueue failpoint");
    assert!(store
        .enqueue_claimed_canonical(&delivery.delivery_id, "worker-1", CLAIMED_AT, RETRY_AT,)
        .is_err());
    db.with_conn(|conn| {
        let queue_count: i64 =
            conn.query_row("SELECT COUNT(*) FROM session_pending_prompts", [], |row| {
                row.get(0)
            })?;
        let projection_count: i64 =
            conn.query_row("SELECT COUNT(*) FROM session_link_completions", [], |row| {
                row.get(0)
            })?;
        assert_eq!((queue_count, projection_count), (0, 0));
        conn.execute_batch("DROP TRIGGER fail_enqueue_state")?;
        Ok(())
    })
    .expect("verify rollback");
    assert!(matches!(
        store
            .enqueue_claimed_canonical(&delivery.delivery_id, "worker-1", CLAIMED_AT, RETRY_AT,)
            .expect("retry same lease"),
        ClaimedDeliveryEnqueueOutcome::Enqueued { inserted: true, .. }
    ));
}

#[test]
fn canonical_row_is_protected_while_same_prefix_ordinary_row_and_order_remain_mutable() {
    let db = Db::open_in_memory().expect("open db");
    seed_link(&db, false);
    let delivery = persist_delivery(&db, "turn-1");
    let session_store = SessionStore::new(db.clone());
    let ordinary = session_store
        .insert_pending_prompt(
            &delivery.parent_session_id,
            "ordinary collision",
            Some(&delivery.prompt_id()),
        )
        .expect("ordinary row");
    let delivery_store = CompletionDeliveryStore::new(db);
    claim(&delivery_store, "worker-1");
    let (enqueued, canonical) = match delivery_store
        .enqueue_claimed_canonical(&delivery.delivery_id, "worker-1", CLAIMED_AT, RETRY_AT)
        .expect("enqueue canonical")
    {
        ClaimedDeliveryEnqueueOutcome::Enqueued {
            delivery, pending, ..
        } => (delivery, pending),
        _ => panic!("expected enqueue"),
    };

    let edit_error = session_store
        .update_pending_prompt_text(&delivery.parent_session_id, canonical.seq, "forged edit")
        .expect_err("canonical edit protected");
    assert!(edit_error
        .downcast_ref::<PendingPromptWriteError>()
        .is_some());
    let delete_error = session_store
        .delete_pending_prompt_record(&delivery.parent_session_id, canonical.seq)
        .expect_err("canonical delete protected");
    assert!(delete_error
        .downcast_ref::<PendingPromptWriteError>()
        .is_some());
    assert_eq!(
        session_store
            .find_pending_prompt(&delivery.parent_session_id, canonical.seq)
            .expect("canonical")
            .expect("row"),
        canonical
    );
    assert_eq!(
        delivery_store
            .find(&delivery.delivery_id)
            .expect("delivery")
            .expect("row"),
        enqueued
    );

    assert!(session_store
        .update_pending_prompt_text(&delivery.parent_session_id, ordinary.seq, "edited ordinary")
        .expect("ordinary edit"));
    let reordered = session_store
        .reorder_pending_prompts(
            &delivery.parent_session_id,
            &[ordinary.seq, canonical.seq],
            &[canonical.seq, ordinary.seq],
        )
        .expect("reorder with canonical row");
    assert!(matches!(
        reordered,
        crate::domains::sessions::model::PendingPromptReorderOutcome::Reordered(_)
    ));
    assert!(session_store
        .delete_pending_prompt(&delivery.parent_session_id, ordinary.seq)
        .expect("ordinary delete"));
    assert!(session_store
        .find_pending_prompt(&delivery.parent_session_id, canonical.seq)
        .expect("canonical")
        .is_some());
}

// PR review finding 1: a completion captured while its parent is still open,
// then the parent is closed before the worker enqueues, must finalize the
// delivery rather than insert a wake into the closed parent's queue and loop
// forever. Negative control: without the closed-parent guard the row would
// reach 'enqueued', a wake prompt would appear in the queue, and claim_next_due
// would keep re-claiming it — every assertion below would fail.
#[test]
fn closed_parent_finalizes_delivery_without_enqueueing_or_reclaiming() {
    let db = Db::open_in_memory().expect("open db");
    seed_link(&db, false);
    let delivery = persist_delivery(&db, "turn-1");
    db.with_conn(|conn| {
        conn.execute(
            "UPDATE sessions SET status = 'closed', closed_at = ?2 WHERE id = ?1",
            rusqlite::params![delivery.parent_session_id, CLAIMED_AT],
        )?;
        Ok(())
    })
    .expect("close parent before enqueue");
    let store = CompletionDeliveryStore::new(db.clone());
    claim(&store, "worker-1");

    let outcome = store
        .enqueue_claimed_canonical(&delivery.delivery_id, "worker-1", CLAIMED_AT, RETRY_AT)
        .expect("closed-parent enqueue");
    assert!(matches!(outcome, ClaimedDeliveryEnqueueOutcome::Stale));

    let finalized = store
        .find(&delivery.delivery_id)
        .expect("delivery")
        .expect("row");
    assert_eq!(finalized.state, CompletionDeliveryState::Abandoned);
    assert_eq!(finalized.last_error_code.as_deref(), Some("parent_closed"));
    assert!(finalized.lease_token.is_none());

    let queue = SessionStore::new(db.clone())
        .list_pending_prompts(&delivery.parent_session_id)
        .expect("queue");
    assert!(queue.is_empty(), "no wake is inserted into a closed parent");

    // The abandoned row is terminal: the worker never re-claims it, even far in
    // the future.
    assert!(store
        .claim_next_due("2999-01-01T00:00:00Z", "2999-01-01T00:00:30Z", "worker-2")
        .expect("post-finalize claim")
        .is_none());
}

// PR review finding 2: a permanently failing delivery must be dead-lettered to
// a terminal 'failed' state once it exhausts the attempt cap, instead of being
// retried forever. Negative control: while pending/enqueued the same row is
// claimable; after dead_letter the terminal state makes claim_next_due skip it.
#[test]
fn dead_letter_finalizes_failed_and_is_never_reclaimed() {
    let db = Db::open_in_memory().expect("open db");
    seed_link(&db, false);
    let delivery = persist_delivery(&db, "turn-1");
    let store = CompletionDeliveryStore::new(db);
    claim(&store, "worker-1");

    let finalized = store
        .dead_letter(
            &delivery.delivery_id,
            "worker-1",
            "delivery_attempt_failed",
            CLAIMED_AT,
        )
        .expect("dead-letter");
    assert!(finalized);

    let row = store
        .find(&delivery.delivery_id)
        .expect("delivery")
        .expect("row");
    assert_eq!(row.state, CompletionDeliveryState::Failed);
    assert_eq!(
        row.last_error_code.as_deref(),
        Some("delivery_attempt_failed")
    );
    assert!(row.lease_token.is_none());

    assert!(store
        .claim_next_due("2999-01-01T00:00:00Z", "2999-01-01T00:00:30Z", "worker-2")
        .expect("post-dead-letter claim")
        .is_none());
}
