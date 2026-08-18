use std::collections::HashSet;

use rusqlite::{params, OptionalExtension};

use super::super::canonical::{
    pending_prompt_agent_session_source, pending_prompt_matches_delivery,
};
use super::super::{completion_delivery_error, map_delivery, CompletionDeliveryRecord};
use super::{
    canonical_wake_payload, sql_conversion_error, update_completion_projection,
    RetiredCompletionWake,
};
use crate::domains::sessions::extensions::SessionTurnOutcome;
use crate::domains::sessions::model::PendingPromptRecord;
use crate::domains::sessions::store::pending_prompts::map_pending_prompt;

/// Coalesce a fresh delivery with an older completed wake for the same child
/// that is still queued and unconsumed: rewrite that queue row in place (same
/// seq and queue position, so no queue-visibility event is needed) to carry
/// this delivery's canonical prompt, and retire the older delivery without its
/// own wake turn. Failed and cancelled siblings are never eligible because
/// each actionable outcome must retain its own wake.
pub(super) fn adopt_superseded_sibling_wake(
    tx: &rusqlite::Connection,
    delivery: &CompletionDeliveryRecord,
    now: &str,
) -> rusqlite::Result<Option<(PendingPromptRecord, String)>> {
    let siblings = older_queued_completed_siblings(tx, delivery)?;
    for sibling in siblings {
        let Some(pending) = canonical_pending_for_delivery(tx, &sibling)? else {
            continue;
        };

        let payload = canonical_wake_payload(delivery);
        let blocks_json = payload.blocks_json().map_err(sql_conversion_error)?;
        let provenance_json = payload.provenance_json().map_err(sql_conversion_error)?;
        let rewritten = tx.execute(
            "UPDATE session_pending_prompts
             SET prompt_id = ?3, text = ?4, blocks_json = ?5, provenance_json = ?6
             WHERE session_id = ?1 AND seq = ?2",
            params![
                delivery.parent_session_id,
                pending.seq,
                delivery.prompt_id(),
                payload.text_summary,
                blocks_json,
                provenance_json,
            ],
        )?;
        if rewritten != 1 {
            return Err(completion_delivery_error(
                "queued sibling wake changed during coalescing rewrite",
            ));
        }
        retire_enqueued_completed_delivery(tx, &sibling, now)?;
        let adopted = tx.query_row(
            "SELECT * FROM session_pending_prompts WHERE session_id = ?1 AND seq = ?2",
            params![delivery.parent_session_id, pending.seq],
            map_pending_prompt,
        )?;
        return Ok(Some((adopted, sibling.delivery_id)));
    }
    Ok(None)
}

/// Remove every older completed wake that a same-turn child message makes
/// redundant. Leases do not protect a sibling from this transaction: clearing
/// the lease makes an already-claimed retry observe `Stale`, while a staged
/// actor copy observes the deleted queue row and does the same.
pub(super) fn retire_older_completed_sibling_wakes(
    tx: &rusqlite::Connection,
    delivery: &CompletionDeliveryRecord,
    now: &str,
) -> rusqlite::Result<Vec<RetiredCompletionWake>> {
    let mut retired_wakes = Vec::new();
    for sibling in older_queued_completed_siblings(tx, delivery)? {
        let Some(pending) = canonical_pending_for_delivery(tx, &sibling)? else {
            continue;
        };
        let deleted = tx.execute(
            "DELETE FROM session_pending_prompts WHERE session_id = ?1 AND seq = ?2",
            params![pending.session_id, pending.seq],
        )?;
        if deleted != 1 {
            return Err(completion_delivery_error(
                "queued sibling wake changed during suppression",
            ));
        }
        retire_enqueued_completed_delivery(tx, &sibling, now)?;
        record_retired_wake_removal_intent(tx, &sibling, &pending)?;
        retired_wakes.push(RetiredCompletionWake {
            delivery_id: sibling.delivery_id,
            parent_session_id: pending.session_id,
            parent_prompt_seq: pending.seq,
            prompt_id: pending.prompt_id,
        });
    }
    Ok(retired_wakes)
}

/// A retry may run an older completion after a later terminal outcome was
/// already recorded. The durable child event sequence, not worker claim order
/// or wall-clock time, decides which result is newer. Failed and cancelled
/// successors remain actionable; only the stale older completed wake retires.
pub(super) fn newer_terminal_delivery_id(
    tx: &rusqlite::Connection,
    delivery: &CompletionDeliveryRecord,
) -> rusqlite::Result<Option<String>> {
    tx.query_row(
        "SELECT delivery_id FROM session_link_completion_deliveries
         WHERE parent_session_id = ?1 AND child_session_id = ?2
           AND delivery_id != ?3
           AND state IN ('pending', 'enqueued', 'delivered')
           AND child_last_event_seq > ?4
         ORDER BY child_last_event_seq DESC, created_at DESC, delivery_id DESC
         LIMIT 1",
        params![
            delivery.parent_session_id,
            delivery.child_session_id,
            delivery.delivery_id,
            delivery.child_last_event_seq,
        ],
        |row| row.get(0),
    )
    .optional()
}

fn older_queued_completed_siblings(
    tx: &rusqlite::Connection,
    delivery: &CompletionDeliveryRecord,
) -> rusqlite::Result<Vec<CompletionDeliveryRecord>> {
    let mut stmt = tx.prepare(
        "SELECT * FROM session_link_completion_deliveries
         WHERE parent_session_id = ?1 AND child_session_id = ?2
           AND delivery_id != ?3 AND state = 'enqueued'
           AND outcome = 'completed' AND parent_prompt_seq IS NOT NULL
           AND child_last_event_seq < ?4
         ORDER BY parent_prompt_seq ASC",
    )?;
    let rows = stmt.query_map(
        params![
            delivery.parent_session_id,
            delivery.child_session_id,
            delivery.delivery_id,
            delivery.child_last_event_seq,
        ],
        map_delivery,
    )?;
    rows.collect()
}

fn canonical_pending_for_delivery(
    tx: &rusqlite::Connection,
    delivery: &CompletionDeliveryRecord,
) -> rusqlite::Result<Option<PendingPromptRecord>> {
    let Some(seq) = delivery.parent_prompt_seq else {
        return Ok(None);
    };
    let pending = tx
        .query_row(
            "SELECT * FROM session_pending_prompts WHERE session_id = ?1 AND seq = ?2",
            params![delivery.parent_session_id, seq],
            map_pending_prompt,
        )
        .optional()?;
    Ok(pending.filter(|record| pending_prompt_matches_delivery(record, delivery)))
}

fn retire_enqueued_completed_delivery(
    tx: &rusqlite::Connection,
    delivery: &CompletionDeliveryRecord,
    now: &str,
) -> rusqlite::Result<()> {
    let retired = tx.execute(
        "UPDATE session_link_completion_deliveries
         SET state = 'delivered', parent_prompt_seq = NULL,
             delivered_at = COALESCE(delivered_at, ?2), updated_at = ?2,
             lease_token = NULL, lease_expires_at = NULL, last_error_code = NULL
         WHERE delivery_id = ?1 AND state = 'enqueued'",
        params![delivery.delivery_id, now],
    )?;
    if retired != 1 {
        return Err(completion_delivery_error(
            "superseded delivery changed during coalescing",
        ));
    }
    update_completion_projection(tx, &delivery.delivery_id, None, None, true, now)
}

fn record_retired_wake_removal_intent(
    tx: &rusqlite::Connection,
    delivery: &CompletionDeliveryRecord,
    pending: &PendingPromptRecord,
) -> rusqlite::Result<()> {
    let recorded = tx.execute(
        "UPDATE session_link_completion_deliveries
         SET retired_prompt_seq = ?2, retired_prompt_id = ?3,
             removal_event_persisted_at = NULL
         WHERE delivery_id = ?1 AND state = 'delivered'",
        params![delivery.delivery_id, pending.seq, pending.prompt_id],
    )?;
    if recorded != 1 {
        return Err(completion_delivery_error(
            "retired completion wake removal intent was not recorded",
        ));
    }
    Ok(())
}

/// Whether the child's own `send_message` for this terminal turn already
/// reached the parent, making a separate wake turn redundant. Only successful
/// completions are ever suppressed: failed and cancelled turns always
/// materialize a wake turn so the parent is forced to look.
pub(super) fn wake_is_redundant_with_child_message(
    tx: &rusqlite::Connection,
    delivery: &CompletionDeliveryRecord,
) -> rusqlite::Result<bool> {
    if delivery.outcome != SessionTurnOutcome::Completed {
        return Ok(false);
    }
    let Some(turn_started_at) = child_turn_started_at(tx, delivery)? else {
        return Ok(false);
    };
    Ok(
        child_message_is_queued_since(tx, delivery, turn_started_at)?
            || child_message_executed_since(tx, delivery, turn_started_at)?,
    )
}

fn child_turn_started_at(
    tx: &rusqlite::Connection,
    delivery: &CompletionDeliveryRecord,
) -> rusqlite::Result<Option<chrono::DateTime<chrono::FixedOffset>>> {
    let timestamp: Option<String> = tx
        .query_row(
            "SELECT timestamp FROM session_events
             WHERE session_id = ?1 AND turn_id = ?2 AND event_type = 'turn_started'
             ORDER BY seq ASC LIMIT 1",
            params![delivery.child_session_id, delivery.child_turn_id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(timestamp.as_deref().and_then(parse_event_timestamp))
}

/// A message the child sent during its terminal turn that the parent has not
/// consumed yet. It will wake the parent with fresher content than the
/// completion notification.
fn child_message_is_queued_since(
    tx: &rusqlite::Connection,
    delivery: &CompletionDeliveryRecord,
    since: chrono::DateTime<chrono::FixedOffset>,
) -> rusqlite::Result<bool> {
    let mut stmt = tx.prepare("SELECT * FROM session_pending_prompts WHERE session_id = ?1")?;
    let rows = stmt
        .query_map([delivery.parent_session_id.as_str()], map_pending_prompt)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows.iter().any(|record| {
        pending_prompt_agent_session_source(record)
            .is_some_and(|source| source == delivery.child_session_id)
            && parse_event_timestamp(&record.queued_at).is_some_and(|queued| queued >= since)
    }))
}

/// A message the child sent during its terminal turn that the parent already
/// executed as a transcript item. Correlate the executed removal to the
/// durable `pending_prompt_added` identity so a prior-turn message consumed
/// after this turn started cannot suppress this turn's wake.
fn child_message_executed_since(
    tx: &rusqlite::Connection,
    delivery: &CompletionDeliveryRecord,
    since: chrono::DateTime<chrono::FixedOffset>,
) -> rusqlite::Result<bool> {
    let mut stmt = tx.prepare(
        "SELECT event_type, payload_json FROM session_events
         WHERE session_id = ?1
           AND event_type IN ('pending_prompt_added', 'pending_prompt_removed')
         ORDER BY seq ASC",
    )?;
    let mut rows = stmt.query([delivery.parent_session_id.as_str()])?;
    let mut eligible_queue_seqs = HashSet::new();
    while let Some(row) = rows.next()? {
        let event_type: String = row.get(0)?;
        let payload: String = row.get(1)?;
        if event_type == "pending_prompt_added" {
            if let Some((seq, queued_at)) =
                child_message_pending_added(&payload, &delivery.child_session_id)
            {
                if queued_at >= since {
                    eligible_queue_seqs.insert(seq);
                }
            }
        } else if executed_pending_prompt_seq(&payload)
            .is_some_and(|seq| eligible_queue_seqs.contains(&seq))
        {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Probe persisted queue event payloads without importing wire contract types
/// below the mapper boundary (same untyped-JSON approach as
/// `persisted_stop_reason`).
fn child_message_pending_added(
    payload_json: &str,
    child_session_id: &str,
) -> Option<(i64, chrono::DateTime<chrono::FixedOffset>)> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(payload_json) else {
        return None;
    };
    let provenance = &value["promptProvenance"];
    if value["type"] != "pending_prompt_added"
        || provenance["type"] != "agentSession"
        || provenance["sourceSessionId"] != child_session_id
    {
        return None;
    }
    Some((
        value["seq"].as_i64()?,
        parse_event_timestamp(value["queuedAt"].as_str()?)?,
    ))
}

fn executed_pending_prompt_seq(payload_json: &str) -> Option<i64> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(payload_json) else {
        return None;
    };
    (value["type"] == "pending_prompt_removed" && value["reason"] == "executed")
        .then(|| value["seq"].as_i64())
        .flatten()
}

fn parse_event_timestamp(value: &str) -> Option<chrono::DateTime<chrono::FixedOffset>> {
    chrono::DateTime::parse_from_rfc3339(value).ok()
}
