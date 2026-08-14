use super::super::tests::{persist_delivery, seed_link};
use super::super::{CompletionDeliveryState, CompletionDeliveryStore};
use super::tests::append_parent_prompt_triplet;
use super::ClaimedDeliveryEnqueueOutcome;
use crate::domains::sessions::store::SessionStore;
use crate::persistence::Db;
use anyharness_contract::v1::PromptProvenance;

#[test]
fn visible_reconciliation_clears_present_noncanonical_parent_seq_without_canonical_row() {
    let db = Db::open_in_memory().expect("open db");
    seed_link(&db, false);
    let delivery = persist_delivery(&db, "turn-1");
    let session_store = SessionStore::new(db.clone());
    let store = CompletionDeliveryStore::new(db.clone());
    store
        .ensure_completion_projection(&delivery)
        .expect("seed completion projection");
    let ordinary = session_store
        .insert_pending_prompt(
            &delivery.parent_session_id,
            "ordinary raw-id collision",
            Some(&delivery.prompt_id()),
        )
        .expect("ordinary collision");
    append_parent_prompt_triplet(
        &db,
        &delivery,
        Some(PromptProvenance::SubagentWake {
            session_link_id: delivery.session_link_id.clone(),
            completion_id: delivery.delivery_id.clone(),
            label: delivery.label.clone(),
        }),
        &delivery.notification_text,
    );
    db.with_conn(|conn| {
        let outbox_updates = conn.execute(
            "UPDATE session_link_completion_deliveries
             SET parent_prompt_seq = ?2 WHERE delivery_id = ?1",
            rusqlite::params![delivery.delivery_id, ordinary.seq],
        )?;
        let projection_updates = conn.execute(
            "UPDATE session_link_completions
             SET parent_prompt_seq = ?2 WHERE completion_id = ?1",
            rusqlite::params![delivery.completion_id, ordinary.seq],
        )?;
        assert_eq!(outbox_updates, 1);
        assert_eq!(projection_updates, 1);
        Ok(())
    })
    .expect("seed conflicting raw-id projection");

    store
        .claim_next_due("2026-08-11T00:02:00Z", "2026-08-11T00:02:30Z", "worker-1")
        .expect("claim")
        .expect("delivery claimed");
    let outcome = store
        .enqueue_claimed_canonical(
            &delivery.delivery_id,
            "worker-1",
            "2026-08-11T00:02:00Z",
            "2026-08-11T00:02:02Z",
        )
        .expect("visible reconciliation");
    let ClaimedDeliveryEnqueueOutcome::AlreadyVisible {
        delivery: delivered,
        ..
    } = outcome
    else {
        panic!("expected already visible");
    };
    assert_eq!(delivered.state, CompletionDeliveryState::Delivered);
    assert_eq!(delivered.parent_prompt_seq, None);
    assert_eq!(
        session_store
            .list_pending_prompts(&delivery.parent_session_id)
            .expect("queue"),
        vec![ordinary]
    );
    db.with_conn(|conn| {
        let projection: (Option<i64>, Option<i64>) = conn.query_row(
            "SELECT parent_prompt_seq, parent_event_seq
             FROM session_link_completions WHERE completion_id = ?1",
            [delivery.completion_id.as_str()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        assert_eq!(projection, (None, Some(3)));
        Ok(())
    })
    .expect("cleared projection");
}
