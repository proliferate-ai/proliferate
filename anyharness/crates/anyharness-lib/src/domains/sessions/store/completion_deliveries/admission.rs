use rusqlite::{params, OptionalExtension};

use super::canonical::{
    find_canonical_transcript_turn, pending_prompt_has_subagent_wake_provenance,
    pending_prompt_matches_delivery, staged_wake_matches_delivery,
};
use super::{
    map_delivery, CompletionDeliveryRecord, CompletionDeliveryState, DurableSubagentWakeTurn,
    DurableSubagentWakeTurnOutcome,
};
use crate::domains::sessions::model::PendingPromptRecord;
use crate::domains::sessions::prompt::SUBAGENT_COMPLETION_PROMPT_ID_PREFIX;
use crate::domains::sessions::store::events::insert_event_row;
use crate::domains::sessions::store::pending_prompts::map_pending_prompt;

pub(in crate::domains::sessions::store) fn persist_subagent_wake_turn_in_tx(
    tx: &rusqlite::Connection,
    input: &DurableSubagentWakeTurn,
) -> rusqlite::Result<DurableSubagentWakeTurnOutcome> {
    let Some(pending) = find_pending_in_tx(tx, &input.session_id, input.queue_seq)? else {
        return Ok(DurableSubagentWakeTurnOutcome::Stale);
    };
    // A same-prefix ordinary or corrupt/no-authority row is not internal and
    // must remain untouched. Only a row that still carries SubagentWake
    // provenance enters the internal discard/admission path.
    if !pending_prompt_has_subagent_wake_provenance(&pending) {
        return Ok(DurableSubagentWakeTurnOutcome::Stale);
    }

    let delivery = pending
        .prompt_id
        .as_deref()
        .and_then(|prompt_id| prompt_id.strip_prefix(SUBAGENT_COMPLETION_PROMPT_ID_PREFIX))
        .map(|delivery_id| find_delivery_in_tx(tx, delivery_id))
        .transpose()?
        .flatten();
    let Some(delivery) = delivery else {
        delete_internal_pending(tx, &pending)?;
        return Ok(DurableSubagentWakeTurnOutcome::Discarded);
    };
    if !pending_prompt_matches_delivery(&pending, &delivery) {
        delete_internal_pending(tx, &pending)?;
        return Ok(DurableSubagentWakeTurnOutcome::Discarded);
    }

    if delivery.lease_token.is_some() {
        return Ok(DurableSubagentWakeTurnOutcome::Stale);
    }
    if let Some(visible) = find_canonical_transcript_turn(tx, &delivery)? {
        if !matches!(
            delivery.state,
            CompletionDeliveryState::Enqueued | CompletionDeliveryState::Delivered
        ) {
            return Ok(DurableSubagentWakeTurnOutcome::Stale);
        }
        delete_internal_pending(tx, &pending)?;
        let parent_prompt_seq = visible_parent_prompt_seq(tx, &delivery, &pending)?;
        mark_delivery_visible(
            tx,
            &delivery,
            parent_prompt_seq,
            &visible.turn_id,
            &input.admitted_at,
        )?;
        update_completion_projection(
            tx,
            &delivery,
            parent_prompt_seq,
            visible.item_completed_seq,
            &input.admitted_at,
        )?;
        return Ok(DurableSubagentWakeTurnOutcome::AlreadyVisible {
            parent_turn_id: visible.turn_id,
        });
    }

    if delivery.state != CompletionDeliveryState::Enqueued
        || delivery.parent_prompt_seq != Some(input.queue_seq)
    {
        return Ok(DurableSubagentWakeTurnOutcome::Stale);
    }
    // A coalescing rewrite may replace the queue row's payload after the actor
    // copied it for staging (the row then resolves to the newer delivery). The
    // stale copy is not admissible; the enqueued delivery's retry redelivers
    // the rewritten wake.
    let Some(staged) = staged_wake_matches_delivery(&input.events, input.queue_seq, &delivery)
    else {
        return Ok(DurableSubagentWakeTurnOutcome::Stale);
    };
    let durable_next_seq: i64 = tx.query_row(
        "SELECT COALESCE(MAX(seq), 0) + 1 FROM session_events WHERE session_id = ?1",
        [input.session_id.as_str()],
        |row| row.get(0),
    )?;
    if input.events.first().map(|event| event.seq) != Some(durable_next_seq) {
        return Err(invalid_admission(
            "staged completion wake does not begin at the durable next sequence",
        ));
    }

    for event in &input.events {
        insert_event_row(tx, event)?;
    }
    delete_internal_pending(tx, &pending)?;
    let changed = tx.execute(
        "UPDATE session_link_completion_deliveries
         SET state = 'delivered', parent_turn_id = ?3,
             delivered_at = COALESCE(delivered_at, ?4), updated_at = ?4,
             lease_token = NULL, lease_expires_at = NULL, last_error_code = NULL
         WHERE delivery_id = ?1 AND parent_prompt_seq = ?2
           AND state = 'enqueued' AND lease_token IS NULL",
        params![
            delivery.delivery_id,
            input.queue_seq,
            staged.turn_id,
            input.admitted_at,
        ],
    )?;
    if changed != 1 {
        return Err(invalid_admission(
            "completion delivery changed during wake admission",
        ));
    }
    update_completion_projection(
        tx,
        &delivery,
        input.queue_seq,
        staged.item_completed_seq,
        &input.admitted_at,
    )?;
    Ok(DurableSubagentWakeTurnOutcome::Admitted)
}

fn visible_parent_prompt_seq(
    tx: &rusqlite::Connection,
    delivery: &CompletionDeliveryRecord,
    pending: &PendingPromptRecord,
) -> rusqlite::Result<i64> {
    let Some(stored_seq) = delivery.parent_prompt_seq else {
        return Ok(pending.seq);
    };
    if stored_seq == pending.seq {
        return Ok(stored_seq);
    }
    let stored_row = find_pending_in_tx(tx, &delivery.parent_session_id, stored_seq)?;
    if stored_row
        .as_ref()
        .is_some_and(|record| !pending_prompt_matches_delivery(record, delivery))
    {
        return Ok(pending.seq);
    }
    Ok(stored_seq)
}

fn find_pending_in_tx(
    tx: &rusqlite::Connection,
    session_id: &str,
    queue_seq: i64,
) -> rusqlite::Result<Option<PendingPromptRecord>> {
    tx.query_row(
        "SELECT * FROM session_pending_prompts WHERE session_id = ?1 AND seq = ?2",
        params![session_id, queue_seq],
        map_pending_prompt,
    )
    .optional()
}

fn find_delivery_in_tx(
    tx: &rusqlite::Connection,
    delivery_id: &str,
) -> rusqlite::Result<Option<CompletionDeliveryRecord>> {
    tx.query_row(
        "SELECT * FROM session_link_completion_deliveries WHERE delivery_id = ?1",
        [delivery_id],
        map_delivery,
    )
    .optional()
}

fn delete_internal_pending(
    tx: &rusqlite::Connection,
    pending: &PendingPromptRecord,
) -> rusqlite::Result<()> {
    let changed = tx.execute(
        "DELETE FROM session_pending_prompts WHERE session_id = ?1 AND seq = ?2",
        params![pending.session_id, pending.seq],
    )?;
    if changed != 1 {
        return Err(invalid_admission(
            "completion wake queue row changed during admission",
        ));
    }
    Ok(())
}

fn mark_delivery_visible(
    tx: &rusqlite::Connection,
    delivery: &CompletionDeliveryRecord,
    parent_prompt_seq: i64,
    parent_turn_id: &str,
    now: &str,
) -> rusqlite::Result<()> {
    let changed = tx.execute(
        "UPDATE session_link_completion_deliveries
         SET state = 'delivered', parent_prompt_seq = ?2, parent_turn_id = ?3,
             delivered_at = COALESCE(delivered_at, ?4), updated_at = ?4,
             lease_token = NULL, lease_expires_at = NULL, last_error_code = NULL
         WHERE delivery_id = ?1 AND state IN ('enqueued', 'delivered')
           AND lease_token IS NULL",
        params![delivery.delivery_id, parent_prompt_seq, parent_turn_id, now,],
    )?;
    if changed != 1 {
        return Err(invalid_admission(
            "completion delivery changed during visible reconciliation",
        ));
    }
    Ok(())
}

fn update_completion_projection(
    tx: &rusqlite::Connection,
    delivery: &CompletionDeliveryRecord,
    parent_prompt_seq: i64,
    parent_event_seq: i64,
    now: &str,
) -> rusqlite::Result<()> {
    tx.execute(
        "UPDATE session_link_completions
         SET parent_prompt_seq = ?2, parent_event_seq = ?3, updated_at = ?4
         WHERE completion_id = ?1",
        params![
            delivery.completion_id,
            parent_prompt_seq,
            parent_event_seq,
            now,
        ],
    )?;
    Ok(())
}

fn invalid_admission(detail: &str) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::new(
        std::io::ErrorKind::InvalidData,
        detail.to_string(),
    )))
}

#[cfg(test)]
#[path = "admission/tests.rs"]
mod tests;
