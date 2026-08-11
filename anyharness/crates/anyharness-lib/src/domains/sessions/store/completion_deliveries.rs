use rusqlite::{params, OptionalExtension};

use crate::domains::sessions::extensions::SessionTurnOutcome;
use crate::domains::sessions::model::SessionEventRecord;
use crate::domains::sessions::prompt::SUBAGENT_COMPLETION_PROMPT_ID_PREFIX;
use crate::domains::sessions::store::events::insert_event_row;
use crate::persistence::Db;

pub(crate) mod admission;
pub(crate) mod canonical;
pub(crate) mod enqueue;
pub(crate) mod queue;

#[derive(Debug, Clone)]
pub(crate) struct DurableTerminalTurn {
    pub terminal_id: String,
    pub session_id: String,
    pub turn_id: String,
    pub outcome: SessionTurnOutcome,
    pub assistant_text: Option<String>,
    pub events: Vec<SessionEventRecord>,
    pub completed_at: String,
}

#[derive(Debug, Clone)]
pub(crate) struct DurableSubagentWakeTurn {
    pub session_id: String,
    pub queue_seq: i64,
    pub events: Vec<SessionEventRecord>,
    pub admitted_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum DurableSubagentWakeTurnOutcome {
    Admitted,
    AlreadyVisible { parent_turn_id: String },
    Discarded,
    Stale,
}

#[derive(Debug, thiserror::Error)]
#[error("invalid completion delivery value: {0}")]
struct CompletionDeliveryParseError(String);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompletionDeliveryState {
    Pending,
    Enqueued,
    Delivered,
}

impl CompletionDeliveryState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Enqueued => "enqueued",
            Self::Delivered => "delivered",
        }
    }

    fn parse(value: &str) -> rusqlite::Result<Self> {
        match value {
            "pending" => Ok(Self::Pending),
            "enqueued" => Ok(Self::Enqueued),
            "delivered" => Ok(Self::Delivered),
            other => Err(rusqlite::Error::FromSqlConversionFailure(
                0,
                rusqlite::types::Type::Text,
                Box::new(CompletionDeliveryParseError(format!(
                    "unknown state {other}"
                ))),
            )),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompletionDeliveryRecord {
    pub delivery_id: String,
    pub completion_id: String,
    pub session_link_id: String,
    pub parent_session_id: String,
    pub child_session_id: String,
    pub subagent_public_id: Option<String>,
    pub label: Option<String>,
    pub child_turn_id: String,
    pub child_last_event_seq: i64,
    pub outcome: SessionTurnOutcome,
    pub assistant_text: Option<String>,
    pub notification_text: String,
    pub state: CompletionDeliveryState,
    pub parent_prompt_seq: Option<i64>,
    pub parent_turn_id: Option<String>,
    pub attempt_count: i64,
    pub next_attempt_at: String,
    pub lease_token: Option<String>,
    pub lease_expires_at: Option<String>,
    pub last_error_code: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub enqueued_at: Option<String>,
    pub delivered_at: Option<String>,
}

impl CompletionDeliveryRecord {
    pub fn prompt_id(&self) -> String {
        format!("{SUBAGENT_COMPLETION_PROMPT_ID_PREFIX}{}", self.delivery_id)
    }
}

#[derive(Clone)]
pub struct CompletionDeliveryStore {
    db: Db,
}

impl CompletionDeliveryStore {
    pub fn new(db: Db) -> Self {
        Self { db }
    }

    pub fn find(&self, delivery_id: &str) -> anyhow::Result<Option<CompletionDeliveryRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM session_link_completion_deliveries WHERE delivery_id = ?1",
                [delivery_id],
                map_delivery,
            )
            .optional()
        })
    }

    /// Materialize the legacy relationship completion ledger from the
    /// independent delivery intent before delivery begins. Promotion may have
    /// removed the relationship after terminal capture; in that ordering the
    /// outbox remains authoritative and no projection is recreated.
    pub fn ensure_completion_projection(
        &self,
        delivery: &CompletionDeliveryRecord,
    ) -> anyhow::Result<bool> {
        self.db
            .with_tx(|tx| ensure_completion_projection_in_tx(tx, delivery))
    }
}

pub(super) fn ensure_completion_projection_in_tx(
    tx: &rusqlite::Connection,
    delivery: &CompletionDeliveryRecord,
) -> rusqlite::Result<bool> {
    let link_exists: bool = tx.query_row(
        "SELECT EXISTS(
            SELECT 1 FROM session_links
            WHERE id = ?1 AND relation = 'subagent'
              AND child_session_id = ?2 AND closed_at IS NULL
         )",
        params![delivery.session_link_id, delivery.child_session_id],
        |row| row.get(0),
    )?;
    if !link_exists {
        return Ok(false);
    }
    if let Some(existing) =
        find_completion_projection(tx, &delivery.session_link_id, &delivery.child_turn_id)?
    {
        adopt_valid_completion_projection(tx, delivery, &existing)?;
        return Ok(true);
    }
    tx.execute(
        "INSERT OR IGNORE INTO session_link_completions (
            completion_id, session_link_id, child_turn_id, child_last_event_seq, outcome,
            parent_event_seq, parent_prompt_seq, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL, ?6, ?6)",
        params![
            delivery.completion_id,
            delivery.session_link_id,
            delivery.child_turn_id,
            delivery.child_last_event_seq,
            delivery.outcome.as_str(),
            delivery.created_at,
        ],
    )?;
    let projected =
        find_completion_projection(tx, &delivery.session_link_id, &delivery.child_turn_id)?
            .ok_or_else(|| {
                rusqlite::Error::ToSqlConversionFailure(Box::new(CompletionDeliveryParseError(
                    "completion projection insert was suppressed by a conflicting identity"
                        .to_string(),
                )))
            })?;
    adopt_valid_completion_projection(tx, delivery, &projected)?;
    Ok(true)
}

type CompletionProjection = (String, i64, String);

fn find_completion_projection(
    conn: &rusqlite::Connection,
    session_link_id: &str,
    child_turn_id: &str,
) -> rusqlite::Result<Option<CompletionProjection>> {
    conn.query_row(
        "SELECT completion_id, child_last_event_seq, outcome
         FROM session_link_completions
         WHERE session_link_id = ?1 AND child_turn_id = ?2",
        params![session_link_id, child_turn_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )
    .optional()
}

fn adopt_valid_completion_projection(
    tx: &rusqlite::Connection,
    delivery: &CompletionDeliveryRecord,
    projection: &CompletionProjection,
) -> rusqlite::Result<()> {
    let (completion_id, last_seq, outcome) = projection;
    if *last_seq != delivery.child_last_event_seq || outcome != delivery.outcome.as_str() {
        return Err(rusqlite::Error::ToSqlConversionFailure(Box::new(
            CompletionDeliveryParseError(
                "completion projection conflicts with captured delivery".to_string(),
            ),
        )));
    }
    if completion_id != &delivery.completion_id {
        tx.execute(
            "UPDATE session_link_completion_deliveries
             SET completion_id = ?2
             WHERE delivery_id = ?1",
            params![delivery.delivery_id, completion_id],
        )?;
    }
    Ok(())
}

pub(crate) fn persist_terminal_turn_in_tx(
    tx: &rusqlite::Connection,
    input: &DurableTerminalTurn,
) -> rusqlite::Result<()> {
    // Idempotent retry after a committed terminal tx must resolve the durable
    // intent before consulting current relationship state. Promotion may have
    // removed the link after the first commit.
    let existing_delivery = find_by_child_turn(tx, &input.session_id, &input.turn_id)?;
    let last_event_seq = validate_terminal_batch(tx, input, existing_delivery.is_some())?;
    if let Some(existing) = existing_delivery.as_ref() {
        validate_terminal_retry(existing, input, last_event_seq)?;
    }
    let link = if existing_delivery.is_none() {
        tx.query_row(
            "SELECT id, parent_session_id, child_session_id, public_id, label
             FROM session_links
             WHERE relation = 'subagent' AND child_session_id = ?1
               AND closed_at IS NULL",
            [input.session_id.as_str()],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                ))
            },
        )
        .optional()?
    } else {
        None
    };

    for event in &input.events {
        let existing = tx
            .query_row(
                "SELECT event_type, turn_id, item_id, payload_json
                 FROM session_events WHERE session_id = ?1 AND seq = ?2",
                params![event.session_id, event.seq],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                },
            )
            .optional()?;
        if let Some(existing) = existing {
            let expected = (
                event.event_type.clone(),
                event.turn_id.clone(),
                event.item_id.clone(),
                event.payload_json.clone(),
            );
            if existing != expected {
                return Err(rusqlite::Error::ToSqlConversionFailure(Box::new(
                    CompletionDeliveryParseError(format!(
                        "terminal retry conflicts at {}:{}",
                        event.session_id, event.seq
                    )),
                )));
            }
            continue;
        }
        if existing_delivery.is_some() {
            return Err(completion_delivery_error(
                "captured terminal retry is missing a durable event",
            ));
        }
        insert_event_row(tx, event)?;
    }

    if existing_delivery.is_some() {
        return Ok(());
    }
    let Some((link_id, parent_id, child_id, public_id, label)) = link else {
        return Ok(());
    };
    let outcome = input.outcome;
    let notification_text = notification_text(
        label.as_deref(),
        public_id.as_deref(),
        outcome,
        input.assistant_text.as_deref(),
    );
    let existing_projection = tx
        .query_row(
            "SELECT completion_id, child_last_event_seq, outcome
             FROM session_link_completions
             WHERE session_link_id = ?1 AND child_turn_id = ?2",
            params![link_id, input.turn_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()?;
    let completion_id = match existing_projection {
        Some((completion_id, projected_last_seq, projected_outcome)) => {
            if projected_last_seq != last_event_seq || projected_outcome != outcome.as_str() {
                return Err(rusqlite::Error::ToSqlConversionFailure(Box::new(
                    CompletionDeliveryParseError(
                        "existing completion projection conflicts with terminal turn".to_string(),
                    ),
                )));
            }
            completion_id
        }
        None => input.terminal_id.clone(),
    };
    tx.execute(
        "INSERT INTO session_link_completion_deliveries (
            delivery_id, completion_id, session_link_id, parent_session_id,
            child_session_id, subagent_public_id, label, child_turn_id,
            child_last_event_seq, outcome, assistant_text, notification_text,
            state, next_attempt_at, created_at, updated_at
         ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
            'pending', ?13, ?13, ?13
         )",
        params![
            input.terminal_id,
            completion_id,
            link_id,
            parent_id,
            child_id,
            public_id,
            label,
            input.turn_id,
            last_event_seq,
            outcome.as_str(),
            input.assistant_text,
            notification_text,
            input.completed_at,
        ],
    )?;
    Ok(())
}

fn validate_terminal_batch(
    tx: &rusqlite::Connection,
    input: &DurableTerminalTurn,
    is_captured_retry: bool,
) -> rusqlite::Result<i64> {
    let Some(first) = input.events.first() else {
        return Err(rusqlite::Error::InvalidParameterName(
            "empty terminal batch".into(),
        ));
    };
    if input.terminal_id.is_empty() || input.session_id.is_empty() || input.turn_id.is_empty() {
        return Err(completion_delivery_error(
            "terminal identity fields must not be empty",
        ));
    }
    for (index, event) in input.events.iter().enumerate() {
        let expected_seq = first
            .seq
            .checked_add(index as i64)
            .ok_or_else(|| completion_delivery_error("terminal sequence overflow"))?;
        if event.seq != expected_seq
            || event.session_id != input.session_id
            || event.turn_id.as_deref() != Some(input.turn_id.as_str())
        {
            return Err(completion_delivery_error(
                "terminal events must be contiguous and belong to the frozen session turn",
            ));
        }
    }
    if !is_captured_retry {
        let next_durable_seq: i64 = tx.query_row(
            "SELECT COALESCE(MAX(seq), 0) + 1
             FROM session_events WHERE session_id = ?1",
            [input.session_id.as_str()],
            |row| row.get(0),
        )?;
        if first.seq != next_durable_seq {
            return Err(completion_delivery_error(
                "terminal batch does not begin at the next durable sequence",
            ));
        }
    }
    let last = input
        .events
        .last()
        .expect("nonempty terminal batch was checked");
    let terminal_shape_matches = match input.outcome {
        SessionTurnOutcome::Completed => {
            last.event_type == "turn_ended"
                && persisted_stop_reason(last).as_deref() != Some("cancelled")
        }
        SessionTurnOutcome::Cancelled => last.event_type == "turn_ended",
        SessionTurnOutcome::Failed => matches!(last.event_type.as_str(), "turn_ended" | "error"),
    };
    if !terminal_shape_matches {
        return Err(completion_delivery_error(
            "terminal event shape conflicts with terminal outcome",
        ));
    }
    Ok(last.seq)
}

fn completion_delivery_error(message: &str) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(Box::new(CompletionDeliveryParseError(
        message.to_string(),
    )))
}

fn validate_terminal_retry(
    delivery: &CompletionDeliveryRecord,
    input: &DurableTerminalTurn,
    last_event_seq: i64,
) -> rusqlite::Result<()> {
    let outcome = input.outcome;
    let expected_notification = notification_text(
        delivery.label.as_deref(),
        delivery.subagent_public_id.as_deref(),
        outcome,
        input.assistant_text.as_deref(),
    );
    let matches = delivery.delivery_id == input.terminal_id
        && delivery.child_session_id == input.session_id
        && delivery.child_turn_id == input.turn_id
        && delivery.child_last_event_seq == last_event_seq
        && delivery.outcome == outcome
        && delivery.assistant_text == input.assistant_text
        && delivery.notification_text == expected_notification
        && delivery.created_at == input.completed_at;
    if !matches {
        return Err(completion_delivery_error(
            "terminal retry conflicts with captured delivery",
        ));
    }
    Ok(())
}

fn persisted_stop_reason(event: &SessionEventRecord) -> Option<String> {
    let value = serde_json::from_str::<serde_json::Value>(&event.payload_json).ok()?;
    value.get("stopReason")?.as_str().map(str::to_string)
}

fn find_by_child_turn(
    conn: &rusqlite::Connection,
    child_session_id: &str,
    child_turn_id: &str,
) -> rusqlite::Result<Option<CompletionDeliveryRecord>> {
    conn.query_row(
        "SELECT * FROM session_link_completion_deliveries
         WHERE child_session_id = ?1 AND child_turn_id = ?2",
        params![child_session_id, child_turn_id],
        map_delivery,
    )
    .optional()
}

fn map_delivery(row: &rusqlite::Row<'_>) -> rusqlite::Result<CompletionDeliveryRecord> {
    let outcome: String = row.get("outcome")?;
    let state: String = row.get("state")?;
    Ok(CompletionDeliveryRecord {
        delivery_id: row.get("delivery_id")?,
        completion_id: row.get("completion_id")?,
        session_link_id: row.get("session_link_id")?,
        parent_session_id: row.get("parent_session_id")?,
        child_session_id: row.get("child_session_id")?,
        subagent_public_id: row.get("subagent_public_id")?,
        label: row.get("label")?,
        child_turn_id: row.get("child_turn_id")?,
        child_last_event_seq: row.get("child_last_event_seq")?,
        outcome: parse_outcome(&outcome)?,
        assistant_text: row.get("assistant_text")?,
        notification_text: row.get("notification_text")?,
        state: CompletionDeliveryState::parse(&state)?,
        parent_prompt_seq: row.get("parent_prompt_seq")?,
        parent_turn_id: row.get("parent_turn_id")?,
        attempt_count: row.get("attempt_count")?,
        next_attempt_at: row.get("next_attempt_at")?,
        lease_token: row.get("lease_token")?,
        lease_expires_at: row.get("lease_expires_at")?,
        last_error_code: row.get("last_error_code")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        enqueued_at: row.get("enqueued_at")?,
        delivered_at: row.get("delivered_at")?,
    })
}

fn parse_outcome(value: &str) -> rusqlite::Result<SessionTurnOutcome> {
    match value {
        "completed" => Ok(SessionTurnOutcome::Completed),
        "failed" => Ok(SessionTurnOutcome::Failed),
        "cancelled" => Ok(SessionTurnOutcome::Cancelled),
        other => Err(rusqlite::Error::FromSqlConversionFailure(
            0,
            rusqlite::types::Type::Text,
            Box::new(CompletionDeliveryParseError(format!(
                "unknown outcome {other}"
            ))),
        )),
    }
}

fn notification_text(
    label: Option<&str>,
    public_id: Option<&str>,
    outcome: SessionTurnOutcome,
    assistant_text: Option<&str>,
) -> String {
    let output_label = if matches!(outcome, SessionTurnOutcome::Completed) {
        "Final output"
    } else {
        "Partial output"
    };
    let output = assistant_text.unwrap_or("No assistant output was recorded.");
    format!(
        "Subagent update\nAgent: {} ({})\nOutcome: {}\n\n{output_label}:\n{output}",
        label.unwrap_or("subagent"),
        public_id.unwrap_or("unknown"),
        outcome.as_str()
    )
}

#[cfg(test)]
#[path = "completion_deliveries/tests.rs"]
mod tests;
