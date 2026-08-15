use std::collections::HashMap;

use super::{map_delivery, CompletionDeliveryRecord};
use crate::domains::sessions::model::{PendingPromptRecord, SessionEventRecord};
use crate::domains::sessions::prompt::provenance::PromptProvenance;
use crate::domains::sessions::prompt::{StoredPromptBlock, SUBAGENT_COMPLETION_PROMPT_ID_PREFIX};
use crate::domains::sessions::subagents::transcript::{
    persisted_completion_wake_event, CompletionWakeEventExpectation, PersistedCompletionWakeEvent,
};
use rusqlite::OptionalExtension;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct CanonicalTranscriptTurn {
    pub turn_id: String,
    pub item_completed_seq: i64,
}

/// A completion wake is authoritative only as the complete outbox-backed
/// tuple. Prompt id and trusted provenance are both necessary, but neither is
/// sufficient without the exact parent, body, block shape, link, delivery,
/// and label.
pub(super) fn pending_prompt_matches_delivery(
    record: &PendingPromptRecord,
    delivery: &CompletionDeliveryRecord,
) -> bool {
    record.session_id == delivery.parent_session_id
        && record.prompt_id.as_deref() == Some(delivery.prompt_id().as_str())
        && pending_prompt_has_exact_text(record, &delivery.notification_text)
        && pending_prompt_provenance(record)
            == Some(PromptProvenance::SubagentWake {
                session_link_id: delivery.session_link_id.clone(),
                completion_id: delivery.delivery_id.clone(),
                label: delivery.label.clone(),
            })
}

pub(super) fn pending_prompt_has_subagent_wake_provenance(record: &PendingPromptRecord) -> bool {
    matches!(
        pending_prompt_provenance(record),
        Some(PromptProvenance::SubagentWake { .. })
    )
}

pub(in crate::domains::sessions::store) fn pending_prompt_is_canonical_delivery(
    conn: &rusqlite::Connection,
    record: &PendingPromptRecord,
) -> rusqlite::Result<bool> {
    let Some(delivery_id) = record
        .prompt_id
        .as_deref()
        .and_then(|prompt_id| prompt_id.strip_prefix(SUBAGENT_COMPLETION_PROMPT_ID_PREFIX))
    else {
        return Ok(false);
    };
    let delivery = conn
        .query_row(
            "SELECT * FROM session_link_completion_deliveries WHERE delivery_id = ?1",
            [delivery_id],
            map_delivery,
        )
        .optional()?;
    Ok(delivery
        .as_ref()
        .is_some_and(|delivery| pending_prompt_matches_delivery(record, delivery)))
}

pub(super) fn find_canonical_transcript_turn(
    conn: &rusqlite::Connection,
    delivery: &CompletionDeliveryRecord,
) -> rusqlite::Result<Option<CanonicalTranscriptTurn>> {
    let mut stmt = conn.prepare(
        "SELECT id, session_id, seq, timestamp, event_type, turn_id, item_id, payload_json
         FROM session_events
         WHERE session_id = ?1
           AND event_type IN ('turn_started', 'item_started', 'item_completed')
         ORDER BY seq ASC",
    )?;
    let rows = stmt
        .query_map([delivery.parent_session_id.as_str()], map_event)?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut turn_starts = HashMap::<String, i64>::new();
    let expected = event_expectation(delivery);
    let mut item_starts = HashMap::<(String, String), (i64, serde_json::Value)>::new();
    for record in rows {
        let Some(event) =
            persisted_completion_wake_event(&record.event_type, &record.payload_json, &expected)
        else {
            continue;
        };
        match event {
            PersistedCompletionWakeEvent::TurnStarted => {
                let Some(turn_id) = record.turn_id else {
                    continue;
                };
                if record.item_id.is_none() {
                    turn_starts.entry(turn_id).or_insert(record.seq);
                }
            }
            PersistedCompletionWakeEvent::ItemStarted { item_value } => {
                let (Some(turn_id), Some(item_id)) = (record.turn_id, record.item_id) else {
                    continue;
                };
                item_starts
                    .entry((turn_id, item_id))
                    .or_insert((record.seq, item_value));
            }
            PersistedCompletionWakeEvent::ItemCompleted { item_value } => {
                let (Some(turn_id), Some(item_id)) = (record.turn_id, record.item_id) else {
                    continue;
                };
                let Some(turn_started_seq) = turn_starts.get(&turn_id).copied() else {
                    continue;
                };
                let Some((item_started_seq, started_value)) =
                    item_starts.get(&(turn_id.clone(), item_id))
                else {
                    continue;
                };
                if turn_started_seq.checked_add(1) != Some(*item_started_seq)
                    || item_started_seq.checked_add(1) != Some(record.seq)
                    || *started_value != item_value
                {
                    continue;
                }
                return Ok(Some(CanonicalTranscriptTurn {
                    turn_id,
                    item_completed_seq: record.seq,
                }));
            }
            PersistedCompletionWakeEvent::PendingPromptRemoved { .. } => {}
        }
    }
    Ok(None)
}

pub(super) fn staged_wake_matches_delivery(
    events: &[SessionEventRecord],
    queue_seq: i64,
    delivery: &CompletionDeliveryRecord,
) -> Option<CanonicalTranscriptTurn> {
    let [turn_started, item_started, item_completed, prompt_removed] = events else {
        return None;
    };
    if events
        .iter()
        .any(|event| event.session_id != delivery.parent_session_id)
        || turn_started.seq.checked_add(1) != Some(item_started.seq)
        || item_started.seq.checked_add(1) != Some(item_completed.seq)
        || item_completed.seq.checked_add(1) != Some(prompt_removed.seq)
    {
        return None;
    }
    let (Some(turn_id), Some(started_turn_id), Some(completed_turn_id)) = (
        turn_started.turn_id.as_deref(),
        item_started.turn_id.as_deref(),
        item_completed.turn_id.as_deref(),
    ) else {
        return None;
    };
    let (Some(started_item_id), Some(completed_item_id)) = (
        item_started.item_id.as_deref(),
        item_completed.item_id.as_deref(),
    ) else {
        return None;
    };
    if turn_id != started_turn_id
        || turn_id != completed_turn_id
        || started_item_id != completed_item_id
        || turn_started.item_id.is_some()
        || prompt_removed.turn_id.is_some()
        || prompt_removed.item_id.is_some()
    {
        return None;
    }

    let expected = event_expectation(delivery);
    if !matches!(
        persisted_completion_wake_event(
            &turn_started.event_type,
            &turn_started.payload_json,
            &expected,
        )?,
        PersistedCompletionWakeEvent::TurnStarted
    ) {
        return None;
    }
    let PersistedCompletionWakeEvent::ItemStarted {
        item_value: started_value,
    } = persisted_completion_wake_event(
        &item_started.event_type,
        &item_started.payload_json,
        &expected,
    )?
    else {
        return None;
    };
    let PersistedCompletionWakeEvent::ItemCompleted {
        item_value: completed_value,
    } = persisted_completion_wake_event(
        &item_completed.event_type,
        &item_completed.payload_json,
        &expected,
    )?
    else {
        return None;
    };
    if started_value != completed_value {
        return None;
    }
    let PersistedCompletionWakeEvent::PendingPromptRemoved {
        seq,
        prompt_id,
        executed,
    } = persisted_completion_wake_event(
        &prompt_removed.event_type,
        &prompt_removed.payload_json,
        &expected,
    )?
    else {
        return None;
    };
    if seq != queue_seq || prompt_id.as_deref() != Some(delivery.prompt_id().as_str()) || !executed
    {
        return None;
    }

    Some(CanonicalTranscriptTurn {
        turn_id: turn_id.to_string(),
        item_completed_seq: item_completed.seq,
    })
}

fn pending_prompt_has_exact_text(record: &PendingPromptRecord, expected: &str) -> bool {
    if record.text != expected {
        return false;
    }
    let Some(blocks_json) = record.blocks_json.as_deref() else {
        // The pending-prompt store deliberately omits blocks_json when one
        // text block is losslessly represented by `text`.
        return true;
    };
    let Ok(blocks) = serde_json::from_str::<Vec<StoredPromptBlock>>(blocks_json) else {
        return false;
    };
    matches!(
        blocks.as_slice(),
        [StoredPromptBlock::Text { text }] if text == expected
    )
}

fn pending_prompt_provenance(record: &PendingPromptRecord) -> Option<PromptProvenance> {
    let value = record
        .provenance_json
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    serde_json::from_str(value).ok()
}

fn event_expectation(delivery: &CompletionDeliveryRecord) -> CompletionWakeEventExpectation<'_> {
    CompletionWakeEventExpectation {
        prompt_id: delivery.prompt_id(),
        notification_text: &delivery.notification_text,
        session_link_id: &delivery.session_link_id,
        delivery_id: &delivery.delivery_id,
        label: delivery.label.as_deref(),
    }
}

fn map_event(row: &rusqlite::Row<'_>) -> rusqlite::Result<SessionEventRecord> {
    Ok(SessionEventRecord {
        id: row.get("id")?,
        session_id: row.get("session_id")?,
        seq: row.get("seq")?,
        timestamp: row.get("timestamp")?,
        event_type: row.get("event_type")?,
        turn_id: row.get("turn_id")?,
        item_id: row.get("item_id")?,
        payload_json: row.get("payload_json")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::sessions::extensions::SessionTurnOutcome;
    use crate::domains::sessions::store::completion_deliveries::CompletionDeliveryState;

    fn delivery() -> CompletionDeliveryRecord {
        CompletionDeliveryRecord {
            delivery_id: "delivery-1".into(),
            completion_id: "completion-1".into(),
            session_link_id: "link-1".into(),
            parent_session_id: "parent-1".into(),
            child_session_id: "child-1".into(),
            subagent_public_id: Some("subagent-1".into()),
            label: Some("worker".into()),
            child_turn_id: "child-turn-1".into(),
            child_last_event_seq: 9,
            outcome: SessionTurnOutcome::Completed,
            assistant_text: Some("done".into()),
            notification_text: "canonical notification".into(),
            state: CompletionDeliveryState::Pending,
            parent_prompt_seq: None,
            parent_turn_id: None,
            attempt_count: 0,
            next_attempt_at: "2026-08-11T00:00:00Z".into(),
            lease_token: None,
            lease_expires_at: None,
            last_error_code: None,
            created_at: "2026-08-11T00:00:00Z".into(),
            updated_at: "2026-08-11T00:00:00Z".into(),
            enqueued_at: None,
            delivered_at: None,
        }
    }

    fn pending(provenance: Option<PromptProvenance>) -> PendingPromptRecord {
        let delivery = delivery();
        PendingPromptRecord {
            session_id: delivery.parent_session_id.clone(),
            seq: 1,
            queue_position: 1,
            prompt_id: Some(delivery.prompt_id()),
            text: delivery.notification_text.clone(),
            blocks_json: None,
            provenance_json: provenance.map(|value| serde_json::to_string(&value).unwrap()),
            queued_at: "2026-08-11T00:01:00Z".into(),
        }
    }

    #[test]
    fn pending_match_requires_the_entire_outbox_tuple() {
        let expected = delivery();
        let canonical = pending(Some(PromptProvenance::SubagentWake {
            session_link_id: expected.session_link_id.clone(),
            completion_id: expected.delivery_id.clone(),
            label: expected.label.clone(),
        }));
        assert!(pending_prompt_matches_delivery(&canonical, &expected));

        let mut cases = Vec::new();
        let mut no_provenance = canonical.clone();
        no_provenance.provenance_json = None;
        cases.push(no_provenance);
        let mut wrong_parent = canonical.clone();
        wrong_parent.session_id = "other-parent".into();
        cases.push(wrong_parent);
        let mut wrong_prompt_id = canonical.clone();
        wrong_prompt_id.prompt_id = Some("subagent_completion:other-delivery".into());
        cases.push(wrong_prompt_id);
        let mut wrong_link = canonical.clone();
        wrong_link.provenance_json = Some(
            serde_json::to_string(&PromptProvenance::SubagentWake {
                session_link_id: "other-link".into(),
                completion_id: expected.delivery_id.clone(),
                label: expected.label.clone(),
            })
            .unwrap(),
        );
        cases.push(wrong_link);
        let mut wrong_delivery = canonical.clone();
        wrong_delivery.provenance_json = Some(
            serde_json::to_string(&PromptProvenance::SubagentWake {
                session_link_id: expected.session_link_id.clone(),
                completion_id: "other-delivery".into(),
                label: expected.label.clone(),
            })
            .unwrap(),
        );
        cases.push(wrong_delivery);
        let mut wrong_label = canonical.clone();
        wrong_label.provenance_json = Some(
            serde_json::to_string(&PromptProvenance::SubagentWake {
                session_link_id: expected.session_link_id.clone(),
                completion_id: expected.delivery_id.clone(),
                label: Some("other-label".into()),
            })
            .unwrap(),
        );
        cases.push(wrong_label);
        let mut altered_text = canonical.clone();
        altered_text.text = "altered".into();
        cases.push(altered_text);
        let mut extra_block = canonical.clone();
        extra_block.blocks_json = Some(
            serde_json::to_string(&vec![
                StoredPromptBlock::Text {
                    text: expected.notification_text.clone(),
                },
                StoredPromptBlock::Text {
                    text: "extra".into(),
                },
            ])
            .unwrap(),
        );
        cases.push(extra_block);

        for case in cases {
            assert!(!pending_prompt_matches_delivery(&case, &expected));
        }
    }
}
