use rusqlite::params;

use super::persisted_payloads::sanitize_session_event_for_sqlite;
use super::SessionStore;
use crate::domains::sessions::model::SessionEventRecord;

impl SessionStore {
    pub fn next_event_seq(&self, session_id: &str) -> anyhow::Result<i64> {
        self.db.with_conn(|conn| {
            let max: Option<i64> = conn.query_row(
                "SELECT MAX(seq) FROM session_events WHERE session_id = ?1",
                [session_id],
                |row| row.get(0),
            )?;
            Ok(max.unwrap_or(0) + 1)
        })
    }

    pub fn append_event(&self, event: &SessionEventRecord) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            insert_event_row(conn, event)?;
            Ok(())
        })
    }

    pub(crate) fn append_event_and_touch_session(
        &self,
        event: &SessionEventRecord,
    ) -> anyhow::Result<()> {
        self.db.with_tx(|conn| {
            insert_event_row(conn, event)?;
            conn.execute(
                "UPDATE sessions SET updated_at = ?1 WHERE id = ?2",
                params![event.timestamp, event.session_id],
            )?;
            Ok(())
        })
    }

    /// Atomically append an already-normalized runtime-owned event using the
    /// next durable sequence number.
    ///
    /// # Invariants
    ///
    /// Callers must hold the ACP start/inject critical section described in
    /// `docs/structures/anyharness/src/acp.md#startinject-sequence-invariant` and must
    /// have confirmed that no live actor owns event sequencing for this
    /// session. Live actors assign seq from memory, so calling this while an
    /// actor is live can race that actor's `SessionEventSink`.
    pub(crate) fn append_event_with_next_seq(
        &self,
        session_id: &str,
        event: anyharness_contract::v1::SessionEvent,
        touch_session_activity: bool,
    ) -> anyhow::Result<anyharness_contract::v1::SessionEventEnvelope> {
        self.db.with_tx(|conn| {
            let session_exists: bool = conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM sessions WHERE id = ?1)",
                [session_id],
                |row| row.get(0),
            )?;
            if !session_exists {
                return Err(rusqlite::Error::QueryReturnedNoRows);
            }

            let seq: i64 = conn.query_row(
                "SELECT COALESCE(MAX(seq), 0) + 1 FROM session_events WHERE session_id = ?1",
                [session_id],
                |row| row.get(0),
            )?;
            let timestamp = chrono::Utc::now().to_rfc3339();
            let event_type = event.event_type().to_string();
            let envelope = anyharness_contract::v1::SessionEventEnvelope {
                session_id: session_id.to_string(),
                seq,
                timestamp: timestamp.clone(),
                turn_id: None,
                item_id: None,
                event,
            };
            let persisted_event = sanitize_session_event_for_sqlite(&envelope.event);
            let payload_json = serde_json::to_string(&persisted_event)
                .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
            conn.execute(
                "INSERT INTO session_events (
                    session_id, seq, timestamp, event_type, turn_id, item_id, payload_json
                 ) VALUES (?1, ?2, ?3, ?4, NULL, NULL, ?5)",
                params![session_id, seq, timestamp, event_type, payload_json],
            )?;
            if touch_session_activity {
                conn.execute(
                    "UPDATE sessions SET updated_at = ?1 WHERE id = ?2",
                    params![timestamp, session_id],
                )?;
            }
            Ok(envelope)
        })
    }

    pub fn list_events(&self, session_id: &str) -> anyhow::Result<Vec<SessionEventRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn
                .prepare("SELECT * FROM session_events WHERE session_id = ?1 ORDER BY seq ASC")?;
            let rows = stmt.query_map([session_id], |row| map_event(row))?;
            rows.collect()
        })
    }

    pub fn list_events_limited(
        &self,
        session_id: &str,
        limit: i64,
    ) -> anyhow::Result<Vec<SessionEventRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "WITH tail AS (
                   SELECT seq, turn_id, item_id
                   FROM session_events
                   WHERE session_id = ?1
                   ORDER BY seq DESC
                   LIMIT ?2
                 ),
                 tail_turns AS (
                   SELECT DISTINCT turn_id
                   FROM tail
                   WHERE turn_id IS NOT NULL
                 ),
                 tail_items AS (
                   SELECT DISTINCT item_id
                   FROM tail
                   WHERE item_id IS NOT NULL
                 )
                 SELECT e.*
                 FROM session_events e
                 WHERE e.session_id = ?1
                   AND (
                     e.seq IN (SELECT seq FROM tail)
                     OR (
                       e.event_type = 'turn_started'
                       AND e.turn_id IN (SELECT turn_id FROM tail_turns)
                     )
                     OR (
                       e.event_type = 'item_started'
                       AND e.item_id IN (SELECT item_id FROM tail_items)
                     )
                   )
                 ORDER BY seq ASC",
            )?;
            let rows = stmt.query_map(params![session_id, limit], |row| map_event(row))?;
            rows.collect()
        })
    }

    pub fn list_events_for_latest_turns(
        &self,
        session_id: &str,
        turn_limit: i64,
        event_limit: i64,
    ) -> anyhow::Result<Vec<SessionEventRecord>> {
        self.db.with_conn(|conn| {
            let turn_limit = turn_limit.max(1);
            let event_limit = event_limit.max(1);
            let mut turn_stmt = conn.prepare(
                "SELECT turn_id, seq
                 FROM session_events
                 WHERE session_id = ?1
                   AND event_type = 'turn_started'
                   AND turn_id IS NOT NULL
                 ORDER BY seq DESC
                 LIMIT ?2",
            )?;
            let turn_rows = turn_stmt.query_map(params![session_id, turn_limit], |row| {
                Ok((row.get::<_, String>("turn_id")?, row.get::<_, i64>("seq")?))
            })?;
            let turn_starts = turn_rows.collect::<rusqlite::Result<Vec<_>>>()?;

            if turn_starts.is_empty() {
                let mut stmt = conn.prepare(
                    "SELECT *
                     FROM (
                       SELECT *
                       FROM session_events
                       WHERE session_id = ?1
                       ORDER BY seq DESC
                       LIMIT ?2
                     )
                     ORDER BY seq ASC",
                )?;
                let rows =
                    stmt.query_map(params![session_id, event_limit], |row| map_event(row))?;
                return rows.collect();
            }

            let mut selected_turn_count = turn_starts.len();
            let mut cutoff_seq = turn_starts[selected_turn_count - 1].1;
            loop {
                let event_count: i64 = conn.query_row(
                    "SELECT COUNT(*)
                     FROM session_events
                     WHERE session_id = ?1 AND seq >= ?2",
                    params![session_id, cutoff_seq],
                    |row| row.get(0),
                )?;
                if event_count <= event_limit || selected_turn_count <= 1 {
                    break;
                }
                selected_turn_count -= 1;
                cutoff_seq = turn_starts[selected_turn_count - 1].1;
            }

            let mut stmt = conn.prepare(
                "SELECT *
                 FROM session_events
                 WHERE session_id = ?1 AND seq >= ?2
                 ORDER BY seq ASC",
            )?;
            let rows = stmt.query_map(params![session_id, cutoff_seq], |row| map_event(row))?;
            rows.collect()
        })
    }

    pub fn list_events_before_limited(
        &self,
        session_id: &str,
        before_seq: i64,
        limit: i64,
    ) -> anyhow::Result<Vec<SessionEventRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT *
                 FROM (
                   SELECT *
                   FROM session_events
                   WHERE session_id = ?1 AND seq < ?2
                   ORDER BY seq DESC
                   LIMIT ?3
                 )
                 ORDER BY seq ASC",
            )?;
            let rows =
                stmt.query_map(params![session_id, before_seq, limit], |row| map_event(row))?;
            rows.collect()
        })
    }

    pub fn list_events_before_for_latest_turns(
        &self,
        session_id: &str,
        before_seq: i64,
        turn_limit: i64,
        event_limit: i64,
    ) -> anyhow::Result<Vec<SessionEventRecord>> {
        self.db.with_conn(|conn| {
            let turn_limit = turn_limit.max(1);
            let event_limit = event_limit.max(1);
            let mut turn_stmt = conn.prepare(
                "SELECT turn_id, seq
                 FROM session_events
                 WHERE session_id = ?1
                   AND seq < ?2
                   AND event_type = 'turn_started'
                   AND turn_id IS NOT NULL
                 ORDER BY seq DESC
                 LIMIT ?3",
            )?;
            let turn_rows = turn_stmt
                .query_map(params![session_id, before_seq, turn_limit], |row| {
                    Ok((row.get::<_, String>("turn_id")?, row.get::<_, i64>("seq")?))
                })?;
            let turn_starts = turn_rows.collect::<rusqlite::Result<Vec<_>>>()?;

            if turn_starts.is_empty() {
                let mut stmt = conn.prepare(
                    "SELECT *
                     FROM (
                       SELECT *
                       FROM session_events
                       WHERE session_id = ?1 AND seq < ?2
                       ORDER BY seq DESC
                       LIMIT ?3
                     )
                     ORDER BY seq ASC",
                )?;
                let rows = stmt.query_map(params![session_id, before_seq, event_limit], |row| {
                    map_event(row)
                })?;
                return rows.collect();
            }

            let mut selected_turn_count = turn_starts.len();
            let mut cutoff_seq = turn_starts[selected_turn_count - 1].1;
            loop {
                let event_count: i64 = conn.query_row(
                    "SELECT COUNT(*)
                     FROM session_events
                     WHERE session_id = ?1 AND seq >= ?2 AND seq < ?3",
                    params![session_id, cutoff_seq, before_seq],
                    |row| row.get(0),
                )?;
                if event_count <= event_limit || selected_turn_count <= 1 {
                    break;
                }
                selected_turn_count -= 1;
                cutoff_seq = turn_starts[selected_turn_count - 1].1;
            }

            let mut stmt = conn.prepare(
                "SELECT *
                 FROM session_events
                 WHERE session_id = ?1 AND seq >= ?2 AND seq < ?3
                 ORDER BY seq ASC",
            )?;
            let rows = stmt.query_map(params![session_id, cutoff_seq, before_seq], |row| {
                map_event(row)
            })?;
            rows.collect()
        })
    }

    pub fn list_events_after(
        &self,
        session_id: &str,
        after_seq: i64,
    ) -> anyhow::Result<Vec<SessionEventRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT * FROM session_events
                 WHERE session_id = ?1 AND seq > ?2
                 ORDER BY seq ASC",
            )?;
            let rows = stmt.query_map(params![session_id, after_seq], |row| map_event(row))?;
            rows.collect()
        })
    }

    pub fn list_events_after_limited(
        &self,
        session_id: &str,
        after_seq: i64,
        limit: i64,
    ) -> anyhow::Result<Vec<SessionEventRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT *
                 FROM (
                   SELECT *
                   FROM session_events
                   WHERE session_id = ?1 AND seq > ?2
                   ORDER BY seq DESC
                   LIMIT ?3
                 )
                 ORDER BY seq ASC",
            )?;
            let rows =
                stmt.query_map(params![session_id, after_seq, limit], |row| map_event(row))?;
            rows.collect()
        })
    }

    pub fn list_events_after_oldest_limited(
        &self,
        session_id: &str,
        after_seq: i64,
        limit: i64,
    ) -> anyhow::Result<Vec<SessionEventRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT *
                 FROM session_events
                 WHERE session_id = ?1 AND seq > ?2
                 ORDER BY seq ASC
                 LIMIT ?3",
            )?;
            let rows =
                stmt.query_map(params![session_id, after_seq, limit], |row| map_event(row))?;
            rows.collect()
        })
    }

    pub fn last_event_seq(&self, session_id: &str) -> anyhow::Result<i64> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT COALESCE(MAX(seq), 0) FROM session_events WHERE session_id = ?1",
                [session_id],
                |row| row.get(0),
            )
        })
    }

    pub fn has_turn_started_event(&self, session_id: &str) -> anyhow::Result<bool> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT EXISTS(
                     SELECT 1
                     FROM session_events
                     WHERE session_id = ?1 AND event_type = 'turn_started'
                     LIMIT 1
                 )",
                [session_id],
                |row| row.get(0),
            )
        })
    }

    pub fn count_turn_started_events(&self, session_id: &str) -> anyhow::Result<i64> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT COUNT(*)
                 FROM session_events
                 WHERE session_id = ?1 AND event_type = 'turn_started'",
                [session_id],
                |row| row.get(0),
            )
        })
    }

    pub fn has_terminal_turn_event(&self, session_id: &str) -> anyhow::Result<bool> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT EXISTS(
                     SELECT 1
                     FROM session_events
                     WHERE session_id = ?1
                       AND event_type IN ('turn_ended', 'error', 'session_ended')
                     LIMIT 1
                 )",
                [session_id],
                |row| row.get(0),
            )
        })
    }

    /// Find turns that have a `turn_started` but no corresponding `turn_ended`
    /// (or `error` / `session_ended`) and close them with a synthetic
    /// `turn_ended` event carrying `stop_reason: cancelled`. Returns the number
    /// of turns repaired.
    pub fn repair_unclosed_turns(&self, session_id: &str) -> anyhow::Result<u32> {
        self.db.with_tx(|conn| {
            // Find turn_ids that were started but never ended.
            let mut stmt = conn.prepare(
                "SELECT DISTINCT e.turn_id
                 FROM session_events e
                 WHERE e.session_id = ?1
                   AND e.event_type = 'turn_started'
                   AND e.turn_id IS NOT NULL
                   AND NOT EXISTS (
                     SELECT 1 FROM session_events e2
                     WHERE e2.session_id = e.session_id
                       AND e2.turn_id = e.turn_id
                       AND e2.event_type IN ('turn_ended', 'error', 'session_ended')
                   )",
            )?;
            let unclosed_turn_ids: Vec<String> = stmt
                .query_map([session_id], |row| row.get(0))?
                .collect::<Result<Vec<_>, _>>()?;

            if unclosed_turn_ids.is_empty() {
                return Ok(0);
            }

            let now = chrono::Utc::now().to_rfc3339();
            let payload_json = r#"{"type":"turn_ended","stopReason":"cancelled"}"#;
            let mut count = 0u32;

            for turn_id in &unclosed_turn_ids {
                let next_seq: i64 = conn.query_row(
                    "SELECT COALESCE(MAX(seq), 0) + 1 FROM session_events WHERE session_id = ?1",
                    [session_id],
                    |row| row.get(0),
                )?;

                conn.execute(
                    "INSERT INTO session_events (session_id, seq, timestamp, event_type, turn_id, item_id, payload_json)
                     VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6)",
                    params![session_id, next_seq, now, "turn_ended", turn_id, payload_json],
                )?;

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

fn map_event(row: &rusqlite::Row) -> rusqlite::Result<SessionEventRecord> {
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

pub(super) fn insert_event_row(
    conn: &rusqlite::Connection,
    record: &SessionEventRecord,
) -> rusqlite::Result<()> {
    let payload_json = sanitize_session_event_payload_json(&record.payload_json)?;
    conn.execute(
        "INSERT INTO session_events (session_id, seq, timestamp, event_type, turn_id, item_id, payload_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            record.session_id,
            record.seq,
            record.timestamp,
            record.event_type,
            record.turn_id,
            record.item_id,
            payload_json,
        ],
    )?;
    Ok(())
}

fn sanitize_session_event_payload_json(payload_json: &str) -> rusqlite::Result<String> {
    let Ok(event) = serde_json::from_str::<anyharness_contract::v1::SessionEvent>(payload_json)
    else {
        return Ok(payload_json.to_string());
    };
    let sanitized = sanitize_session_event_for_sqlite(&event);
    serde_json::to_string(&sanitized)
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))
}
