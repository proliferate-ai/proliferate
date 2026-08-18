use rusqlite::{params, OptionalExtension};

use super::canonical::{find_canonical_transcript_turn, pending_prompt_matches_delivery};
use super::{
    completion_delivery_error, ensure_completion_projection_in_tx, map_delivery,
    CompletionDeliveryRecord, CompletionDeliveryState, CompletionDeliveryStore,
};
use crate::domains::sessions::model::PendingPromptRecord;
use crate::domains::sessions::prompt::{provenance::PromptProvenance, PromptPayload};
use crate::domains::sessions::store::pending_prompts::{
    insert_pending_prompt_row, map_pending_prompt,
};

mod coalescing;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CompletionWakeSuppressionReason {
    Coalesced,
    RedundantChildMessage,
}

impl CompletionWakeSuppressionReason {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Coalesced => "coalesced",
            Self::RedundantChildMessage => "redundant_child_message",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RetiredCompletionWake {
    pub(crate) delivery_id: String,
    pub(crate) parent_session_id: String,
    pub(crate) parent_prompt_seq: i64,
    pub(crate) prompt_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ClaimedDeliveryEnqueueOutcome {
    Enqueued {
        delivery: CompletionDeliveryRecord,
        pending: PendingPromptRecord,
        inserted: bool,
        /// An older eligible completed wake for the same child whose queue row
        /// was rewritten in place to carry this delivery; that delivery is
        /// retired without its own wake turn.
        superseded_delivery_id: Option<String>,
    },
    AlreadyVisible {
        delivery: CompletionDeliveryRecord,
        parent_turn_id: String,
    },
    /// Terminal without a parent prompt: the child's own message for this turn
    /// already reached the parent. The completion stays durable and the worker
    /// still injects the completion metadata event, but no wake turn is
    /// created in the parent transcript.
    Suppressed {
        delivery: CompletionDeliveryRecord,
        reason: CompletionWakeSuppressionReason,
        retired_wakes: Vec<RetiredCompletionWake>,
    },
    Stale,
}

impl CompletionDeliveryStore {
    /// Reconcile or create the one canonical durable parent prompt while the
    /// claimed outbox row, queue rows, legacy projection, retry schedule, and
    /// lease are protected by the same SQLite transaction.
    pub(crate) fn enqueue_claimed_canonical(
        &self,
        delivery_id: &str,
        lease_token: &str,
        now: &str,
        next_attempt_at: &str,
    ) -> anyhow::Result<ClaimedDeliveryEnqueueOutcome> {
        self.db.with_tx(|tx| {
            let Some(mut delivery) = find_delivery_in_tx(tx, delivery_id)? else {
                return Ok(ClaimedDeliveryEnqueueOutcome::Stale);
            };
            if delivery.state == CompletionDeliveryState::Delivered
                || delivery.lease_token.as_deref() != Some(lease_token)
            {
                return Ok(ClaimedDeliveryEnqueueOutcome::Stale);
            }

            // A terminally closed (or deleted) parent will never consume the
            // wake. Finalizing the delivery here — instead of inserting a prompt
            // into the closed parent's queue — keeps claim_next_due from
            // re-claiming a row that can never reach 'delivered'.
            if parent_is_terminally_closed(tx, &delivery.parent_session_id)? {
                finalize_abandoned_in_tx(tx, &delivery.delivery_id, lease_token, now)?;
                return Ok(ClaimedDeliveryEnqueueOutcome::Stale);
            }

            ensure_completion_projection_in_tx(tx, &delivery)?;
            // Projection adoption may update the outbox completion_id. Re-read
            // the row before every canonical comparison and state transition.
            delivery = find_delivery_in_tx(tx, delivery_id)?.ok_or_else(|| {
                completion_delivery_error("claimed delivery disappeared during enqueue")
            })?;
            if delivery.state == CompletionDeliveryState::Delivered
                || delivery.lease_token.as_deref() != Some(lease_token)
            {
                return Ok(ClaimedDeliveryEnqueueOutcome::Stale);
            }

            let prompt_id = delivery.prompt_id();
            let prompt_rows =
                load_prompt_id_rows(tx, &delivery.parent_session_id, prompt_id.as_str())?;
            if let Some(visible) = find_canonical_transcript_turn(tx, &delivery)? {
                let stored_parent_is_noncanonical_collision = delivery
                    .parent_prompt_seq
                    .and_then(|seq| prompt_rows.iter().find(|record| record.seq == seq))
                    .is_some_and(|record| !pending_prompt_matches_delivery(record, &delivery));
                let canonical_seqs = prompt_rows
                    .iter()
                    .filter(|record| pending_prompt_matches_delivery(record, &delivery))
                    .map(|record| record.seq)
                    .collect::<Vec<_>>();
                let parent_prompt_seq = if stored_parent_is_noncanonical_collision {
                    canonical_seqs.first().copied()
                } else {
                    delivery
                        .parent_prompt_seq
                        .or_else(|| canonical_seqs.first().copied())
                };
                delete_prompt_seqs(tx, &delivery.parent_session_id, &canonical_seqs)?;
                let changed = tx.execute(
                    "UPDATE session_link_completion_deliveries
                     SET state = 'delivered',
                         parent_prompt_seq = CASE
                             WHEN ?3 THEN ?4 ELSE COALESCE(?4, parent_prompt_seq)
                         END,
                         parent_turn_id = ?5, delivered_at = COALESCE(delivered_at, ?6),
                         updated_at = ?6, lease_token = NULL, lease_expires_at = NULL,
                         last_error_code = NULL
                     WHERE delivery_id = ?1 AND lease_token = ?2
                       AND state != 'delivered'",
                    params![
                        delivery.delivery_id,
                        lease_token,
                        stored_parent_is_noncanonical_collision,
                        parent_prompt_seq,
                        visible.turn_id,
                        now,
                    ],
                )?;
                if changed != 1 {
                    return Err(completion_delivery_error(
                        "claimed delivery lease changed during transcript reconciliation",
                    ));
                }
                update_completion_projection(
                    tx,
                    &delivery.delivery_id,
                    parent_prompt_seq,
                    Some(visible.item_completed_seq),
                    stored_parent_is_noncanonical_collision,
                    now,
                )?;
                let delivered = find_delivery_in_tx(tx, delivery_id)?
                    .ok_or_else(|| completion_delivery_error("delivered outbox row disappeared"))?;
                return Ok(ClaimedDeliveryEnqueueOutcome::AlreadyVisible {
                    delivery: delivered,
                    parent_turn_id: visible.turn_id,
                });
            }

            let mut canonical = prompt_rows
                .into_iter()
                .filter(|record| pending_prompt_matches_delivery(record, &delivery))
                .collect::<Vec<_>>();
            canonical.sort_by_key(|record| record.seq);
            // Coalescing and suppression apply only to a delivery that has
            // never reached the parent queue. A previously enqueued delivery
            // (recreate/retry paths) keeps the legacy exactly-once
            // reconciliation.
            let is_fresh = delivery.parent_prompt_seq.is_none() && canonical.is_empty();
            if is_fresh
                && delivery.outcome
                    == crate::domains::sessions::extensions::SessionTurnOutcome::Completed
                && coalescing::wake_is_redundant_with_child_message(tx, &delivery)?
            {
                let retired_wakes =
                    coalescing::retire_older_completed_sibling_wakes(tx, &delivery, now)?;
                let suppressed = finalize_claimed_without_prompt(
                    tx,
                    &delivery,
                    lease_token,
                    now,
                    "wake suppression",
                )?;
                return Ok(ClaimedDeliveryEnqueueOutcome::Suppressed {
                    delivery: suppressed,
                    reason: CompletionWakeSuppressionReason::RedundantChildMessage,
                    retired_wakes,
                });
            }
            if is_fresh
                && delivery.outcome
                    == crate::domains::sessions::extensions::SessionTurnOutcome::Completed
                && coalescing::newer_terminal_delivery_id(tx, &delivery)?.is_some()
            {
                let retired_wakes =
                    coalescing::retire_older_completed_sibling_wakes(tx, &delivery, now)?;
                let suppressed = finalize_claimed_without_prompt(
                    tx,
                    &delivery,
                    lease_token,
                    now,
                    "reverse-order coalescing",
                )?;
                return Ok(ClaimedDeliveryEnqueueOutcome::Suppressed {
                    delivery: suppressed,
                    reason: CompletionWakeSuppressionReason::Coalesced,
                    retired_wakes,
                });
            }
            let adopted = if is_fresh {
                coalescing::adopt_superseded_sibling_wake(tx, &delivery, now)?
            } else {
                None
            };
            let (pending, inserted, superseded_delivery_id) = match adopted {
                Some((record, superseded_delivery_id)) => {
                    (record, false, Some(superseded_delivery_id))
                }
                None => match delivery
                    .parent_prompt_seq
                    .and_then(|expected| canonical.iter().find(|record| record.seq == expected))
                    .cloned()
                    .or_else(|| canonical.first().cloned())
                {
                    Some(record) => (record, false, None),
                    None => (insert_canonical_prompt(tx, &delivery, now)?, true, None),
                },
            };
            let duplicate_seqs = canonical
                .iter()
                .filter(|record| record.seq != pending.seq)
                .map(|record| record.seq)
                .collect::<Vec<_>>();
            delete_prompt_seqs(tx, &delivery.parent_session_id, &duplicate_seqs)?;

            let changed = tx.execute(
                "UPDATE session_link_completion_deliveries
                 SET state = 'enqueued', parent_prompt_seq = ?3,
                     enqueued_at = COALESCE(enqueued_at, ?4), updated_at = ?4,
                     next_attempt_at = ?5, lease_token = NULL, lease_expires_at = NULL,
                     last_error_code = NULL
                 WHERE delivery_id = ?1 AND lease_token = ?2
                   AND state != 'delivered'",
                params![
                    delivery.delivery_id,
                    lease_token,
                    pending.seq,
                    now,
                    next_attempt_at,
                ],
            )?;
            if changed != 1 {
                return Err(completion_delivery_error(
                    "claimed delivery lease changed during canonical enqueue",
                ));
            }
            update_completion_projection(
                tx,
                &delivery.delivery_id,
                Some(pending.seq),
                None,
                false,
                now,
            )?;
            let enqueued = find_delivery_in_tx(tx, delivery_id)?
                .ok_or_else(|| completion_delivery_error("enqueued outbox row disappeared"))?;
            Ok(ClaimedDeliveryEnqueueOutcome::Enqueued {
                delivery: enqueued,
                pending,
                inserted,
                superseded_delivery_id,
            })
        })
    }
}

fn finalize_claimed_without_prompt(
    tx: &rusqlite::Connection,
    delivery: &CompletionDeliveryRecord,
    lease_token: &str,
    now: &str,
    transition: &str,
) -> rusqlite::Result<CompletionDeliveryRecord> {
    let changed = tx.execute(
        "UPDATE session_link_completion_deliveries
         SET state = 'delivered', parent_prompt_seq = NULL, parent_turn_id = NULL,
             delivered_at = COALESCE(delivered_at, ?3), updated_at = ?3,
             lease_token = NULL, lease_expires_at = NULL, last_error_code = NULL
         WHERE delivery_id = ?1 AND lease_token = ?2
           AND state IN ('pending', 'enqueued')",
        params![delivery.delivery_id, lease_token, now],
    )?;
    if changed != 1 {
        let message = format!("claimed delivery lease changed during {transition}");
        return Err(completion_delivery_error(&message));
    }
    update_completion_projection(tx, &delivery.delivery_id, None, None, true, now)?;
    find_delivery_in_tx(tx, &delivery.delivery_id)?
        .ok_or_else(|| completion_delivery_error("suppressed outbox row disappeared"))
}

/// A parent is terminal when its session row has been closed (`closed_at IS NOT
/// NULL`) or the row is gone entirely (deleted parent). Either way the wake can
/// never be delivered and the delivery must be finalized rather than retried.
fn parent_is_terminally_closed(
    conn: &rusqlite::Connection,
    parent_session_id: &str,
) -> rusqlite::Result<bool> {
    let closed_at: Option<Option<String>> = conn
        .query_row(
            "SELECT closed_at FROM sessions WHERE id = ?1",
            [parent_session_id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(match closed_at {
        Some(value) => value.is_some(),
        None => true,
    })
}

fn finalize_abandoned_in_tx(
    conn: &rusqlite::Connection,
    delivery_id: &str,
    lease_token: &str,
    now: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE session_link_completion_deliveries
         SET state = 'abandoned', last_error_code = 'parent_closed', updated_at = ?3,
             lease_token = NULL, lease_expires_at = NULL
         WHERE delivery_id = ?1 AND lease_token = ?2
           AND state NOT IN ('delivered', 'abandoned', 'failed')",
        params![delivery_id, lease_token, now],
    )?;
    Ok(())
}

fn find_delivery_in_tx(
    conn: &rusqlite::Connection,
    delivery_id: &str,
) -> rusqlite::Result<Option<CompletionDeliveryRecord>> {
    conn.query_row(
        "SELECT * FROM session_link_completion_deliveries WHERE delivery_id = ?1",
        [delivery_id],
        map_delivery,
    )
    .optional()
}

fn load_prompt_id_rows(
    conn: &rusqlite::Connection,
    parent_session_id: &str,
    prompt_id: &str,
) -> rusqlite::Result<Vec<PendingPromptRecord>> {
    let mut stmt = conn.prepare(
        "SELECT * FROM session_pending_prompts
         WHERE session_id = ?1 AND prompt_id = ?2
         ORDER BY seq ASC",
    )?;
    let rows = stmt
        .query_map(params![parent_session_id, prompt_id], map_pending_prompt)?
        .collect();
    rows
}

fn canonical_wake_payload(delivery: &CompletionDeliveryRecord) -> PromptPayload {
    PromptPayload::text(delivery.notification_text.clone()).with_provenance(
        PromptProvenance::SubagentWake {
            session_link_id: delivery.session_link_id.clone(),
            completion_id: delivery.delivery_id.clone(),
            label: delivery.label.clone(),
        },
    )
}

fn insert_canonical_prompt(
    conn: &rusqlite::Connection,
    delivery: &CompletionDeliveryRecord,
    queued_at: &str,
) -> rusqlite::Result<PendingPromptRecord> {
    let payload = canonical_wake_payload(delivery);
    let blocks_json = payload.blocks_json().map_err(sql_conversion_error)?;
    let provenance_json = payload.provenance_json().map_err(sql_conversion_error)?;
    let changed = conn.execute(
        "UPDATE sessions
         SET pending_prompt_seq_cursor = pending_prompt_seq_cursor + 1
         WHERE id = ?1",
        [delivery.parent_session_id.as_str()],
    )?;
    if changed != 1 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }
    let next_seq: i64 = conn.query_row(
        "SELECT pending_prompt_seq_cursor FROM sessions WHERE id = ?1",
        [delivery.parent_session_id.as_str()],
        |row| row.get(0),
    )?;
    let next_position: i64 = conn.query_row(
        "SELECT COALESCE(MAX(queue_position), 0) + 1
         FROM session_pending_prompts WHERE session_id = ?1",
        [delivery.parent_session_id.as_str()],
        |row| row.get(0),
    )?;
    let record = PendingPromptRecord {
        session_id: delivery.parent_session_id.clone(),
        seq: next_seq,
        queue_position: next_position,
        prompt_id: Some(delivery.prompt_id()),
        text: payload.text_summary,
        blocks_json,
        provenance_json,
        queued_at: queued_at.to_string(),
    };
    insert_pending_prompt_row(conn, &record)?;
    Ok(record)
}

fn sql_conversion_error(error: anyhow::Error) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::new(
        std::io::ErrorKind::InvalidData,
        error.to_string(),
    )))
}

fn delete_prompt_seqs(
    conn: &rusqlite::Connection,
    parent_session_id: &str,
    seqs: &[i64],
) -> rusqlite::Result<()> {
    for seq in seqs {
        conn.execute(
            "DELETE FROM session_pending_prompts WHERE session_id = ?1 AND seq = ?2",
            params![parent_session_id, seq],
        )?;
    }
    Ok(())
}

fn update_completion_projection(
    conn: &rusqlite::Connection,
    delivery_id: &str,
    parent_prompt_seq: Option<i64>,
    parent_event_seq: Option<i64>,
    replace_parent_prompt_seq: bool,
    now: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE session_link_completions
         SET parent_prompt_seq = CASE
                 WHEN ?4 THEN ?2 ELSE COALESCE(?2, parent_prompt_seq)
             END,
             parent_event_seq = COALESCE(?3, parent_event_seq),
             updated_at = ?5
         WHERE completion_id = (
            SELECT completion_id
            FROM session_link_completion_deliveries
            WHERE delivery_id = ?1
         )",
        params![
            delivery_id,
            parent_prompt_seq,
            parent_event_seq,
            replace_parent_prompt_seq,
            now
        ],
    )?;
    Ok(())
}

#[cfg(test)]
#[path = "enqueue/tests.rs"]
mod tests;

#[cfg(test)]
#[path = "enqueue/coalescing_tests.rs"]
mod coalescing_tests;

#[cfg(test)]
#[path = "enqueue/reconciliation_tests.rs"]
mod reconciliation_tests;
