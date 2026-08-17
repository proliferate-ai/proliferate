use rusqlite::{params, OptionalExtension};

use super::super::canonical::{
    pending_prompt_agent_session_source, pending_prompt_matches_delivery,
};
use super::super::{completion_delivery_error, map_delivery, CompletionDeliveryRecord};
use super::{canonical_wake_payload, sql_conversion_error, update_completion_projection};
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
    let mut stmt = tx.prepare(
        "SELECT * FROM session_link_completion_deliveries
         WHERE parent_session_id = ?1 AND child_session_id = ?2
           AND delivery_id != ?3 AND state = 'enqueued'
           AND outcome = 'completed'
           AND lease_token IS NULL AND parent_prompt_seq IS NOT NULL
           AND created_at <= ?4
         ORDER BY parent_prompt_seq ASC",
    )?;
    let siblings = stmt
        .query_map(
            params![
                delivery.parent_session_id,
                delivery.child_session_id,
                delivery.delivery_id,
                delivery.created_at,
            ],
            map_delivery,
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for sibling in siblings {
        let Some(seq) = sibling.parent_prompt_seq else {
            continue;
        };
        let pending = tx
            .query_row(
                "SELECT * FROM session_pending_prompts WHERE session_id = ?1 AND seq = ?2",
                params![sibling.parent_session_id, seq],
                map_pending_prompt,
            )
            .optional()?;
        let Some(pending) =
            pending.filter(|record| pending_prompt_matches_delivery(record, &sibling))
        else {
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
        let retired = tx.execute(
            "UPDATE session_link_completion_deliveries
             SET state = 'delivered', parent_prompt_seq = NULL,
                 delivered_at = COALESCE(delivered_at, ?2), updated_at = ?2,
                 lease_token = NULL, lease_expires_at = NULL, last_error_code = NULL
             WHERE delivery_id = ?1 AND state = 'enqueued' AND lease_token IS NULL",
            params![sibling.delivery_id, now],
        )?;
        if retired != 1 {
            return Err(completion_delivery_error(
                "superseded delivery changed during coalescing rewrite",
            ));
        }
        update_completion_projection(tx, &sibling.delivery_id, None, None, true, now)?;
        let adopted = tx.query_row(
            "SELECT * FROM session_pending_prompts WHERE session_id = ?1 AND seq = ?2",
            params![delivery.parent_session_id, pending.seq],
            map_pending_prompt,
        )?;
        return Ok(Some((adopted, sibling.delivery_id)));
    }
    Ok(None)
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
    Ok(child_message_is_queued_since(tx, delivery, turn_started_at)?
        || child_message_executed_since(tx, delivery, turn_started_at)?)
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
    let mut stmt =
        tx.prepare("SELECT * FROM session_pending_prompts WHERE session_id = ?1")?;
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
/// executed as a transcript item (the idle-parent ordering: the message turn
/// starts before the completion wake is claimed). Scans newest-first and stops
/// at the first event older than the child turn start.
fn child_message_executed_since(
    tx: &rusqlite::Connection,
    delivery: &CompletionDeliveryRecord,
    since: chrono::DateTime<chrono::FixedOffset>,
) -> rusqlite::Result<bool> {
    let mut stmt = tx.prepare(
        "SELECT timestamp, payload_json FROM session_events
         WHERE session_id = ?1 AND event_type = 'item_completed'
         ORDER BY seq DESC",
    )?;
    let mut rows = stmt.query([delivery.parent_session_id.as_str()])?;
    while let Some(row) = rows.next()? {
        let timestamp: String = row.get(0)?;
        let Some(at) = parse_event_timestamp(&timestamp) else {
            continue;
        };
        if at < since {
            return Ok(false);
        }
        let payload: String = row.get(1)?;
        if item_completed_from_agent_session(&payload, &delivery.child_session_id) {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Probe the persisted item payload for `agentSession` provenance from the
/// child without importing wire contract types below the mapper boundary
/// (same untyped-JSON approach as `persisted_stop_reason`).
fn item_completed_from_agent_session(payload_json: &str, child_session_id: &str) -> bool {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(payload_json) else {
        return false;
    };
    let provenance = &value["item"]["promptProvenance"];
    provenance["type"] == "agentSession" && provenance["sourceSessionId"] == child_session_id
}

fn parse_event_timestamp(value: &str) -> Option<chrono::DateTime<chrono::FixedOffset>> {
    chrono::DateTime::parse_from_rfc3339(value).ok()
}
