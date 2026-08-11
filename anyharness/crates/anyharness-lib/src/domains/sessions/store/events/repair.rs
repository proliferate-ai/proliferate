use rusqlite::params;

use super::super::SessionStore;
use crate::domains::sessions::extensions::SessionTurnOutcome;
use crate::domains::sessions::model::SessionEventRecord;
use crate::domains::sessions::store::completion_deliveries::DurableTerminalTurn;
use crate::domains::sessions::store::persisted_payloads::persisted_turn_repair_facts;

impl SessionStore {
    /// Find turns that have a `turn_started` but no corresponding `turn_ended`
    /// (or `error` / `session_ended`) and close them with a synthetic
    /// `turn_ended` event carrying `stop_reason: cancelled`. Returns the number
    /// of turns repaired.
    pub fn repair_unclosed_turns(&self, session_id: &str) -> anyhow::Result<u32> {
        self.db.with_tx(|conn| {
            // Find turn_ids that were started but never ended.
            let mut stmt = conn.prepare(
                "SELECT e.turn_id
                 FROM session_events e
                 WHERE e.session_id = ?1
                   AND e.event_type = 'turn_started'
                   AND e.turn_id IS NOT NULL
                   AND NOT EXISTS (
                     SELECT 1 FROM session_events e2
                     WHERE e2.session_id = e.session_id
                       AND e2.turn_id = e.turn_id
                       AND e2.event_type IN ('turn_ended', 'error', 'session_ended')
                   )
                 GROUP BY e.turn_id
                 ORDER BY MIN(e.seq) ASC",
            )?;
            let unclosed_turn_ids: Vec<String> = stmt
                .query_map([session_id], |row| row.get(0))?
                .collect::<Result<Vec<_>, _>>()?;

            if unclosed_turn_ids.is_empty() {
                return Ok(0);
            }

            let now = chrono::Utc::now().to_rfc3339();
            let mut count = 0u32;

            for turn_id in &unclosed_turn_ids {
                let next_seq: i64 = conn.query_row(
                    "SELECT COALESCE(MAX(seq), 0) + 1 FROM session_events WHERE session_id = ?1",
                    [session_id],
                    |row| row.get(0),
                )?;

                let mut stmt = conn.prepare(
                    "SELECT item_id, payload_json FROM session_events
                     WHERE session_id = ?1 AND turn_id = ?2 ORDER BY seq ASC",
                )?;
                let payloads = stmt
                    .query_map(params![session_id, turn_id], |row| {
                        Ok((row.get::<_, Option<String>>(0)?, row.get::<_, String>(1)?))
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                let facts = persisted_turn_repair_facts(&payloads)
                    .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
                let repair_outcome = if facts.prompt_begun {
                    SessionTurnOutcome::Cancelled
                } else {
                    facts
                        .engine_outcome
                        .unwrap_or(SessionTurnOutcome::Cancelled)
                };
                let stop_reason = if matches!(repair_outcome, SessionTurnOutcome::Cancelled) {
                    "cancelled"
                } else {
                    "end_turn"
                };
                let mut terminal_events =
                    Vec::with_capacity(facts.open_assistant_completions.len() + 1);
                for (offset, completion) in facts.open_assistant_completions.into_iter().enumerate()
                {
                    terminal_events.push(SessionEventRecord {
                        id: 0,
                        session_id: session_id.to_string(),
                        seq: next_seq.checked_add(offset as i64).ok_or_else(|| {
                            rusqlite::Error::InvalidParameterName(
                                "terminal sequence overflow".to_string(),
                            )
                        })?,
                        timestamp: now.clone(),
                        event_type: "item_completed".to_string(),
                        turn_id: Some(turn_id.clone()),
                        item_id: Some(completion.item_id),
                        payload_json: completion.payload_json,
                    });
                }
                let turn_ended_seq = next_seq
                    .checked_add(terminal_events.len() as i64)
                    .ok_or_else(|| {
                        rusqlite::Error::InvalidParameterName(
                            "terminal sequence overflow".to_string(),
                        )
                    })?;
                terminal_events.push(SessionEventRecord {
                    id: 0,
                    session_id: session_id.to_string(),
                    seq: turn_ended_seq,
                    timestamp: now.clone(),
                    event_type: "turn_ended".to_string(),
                    turn_id: Some(turn_id.clone()),
                    item_id: None,
                    payload_json: serde_json::json!({
                        "type": "turn_ended",
                        "stopReason": stop_reason,
                    })
                    .to_string(),
                });
                let input = DurableTerminalTurn {
                    terminal_id: uuid::Uuid::new_v4().to_string(),
                    session_id: session_id.to_string(),
                    turn_id: turn_id.clone(),
                    outcome: repair_outcome,
                    assistant_text: facts.assistant_text,
                    events: terminal_events,
                    completed_at: now.clone(),
                };
                super::super::completion_deliveries::persist_terminal_turn_in_tx(conn, &input)?;

                tracing::info!(
                    session_id = %session_id,
                    turn_id = %turn_id,
                    seq = next_seq,
                    "repaired unclosed turn with synthetic turn_ended"
                );
                count += 1;
            }

            Ok(count)
        })
    }
}
