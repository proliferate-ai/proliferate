use rusqlite::{params, OptionalExtension};

use super::SessionStore;
use crate::domains::sessions::model::{
    PendingPromptRecord, PendingPromptReorderOutcome, MAX_PENDING_PROMPT_SEQ,
};
use crate::domains::sessions::prompt::PromptPayload;

#[derive(Debug, thiserror::Error)]
pub(crate) enum PendingPromptWriteError {
    #[error("canonical completion wake pending prompt is protected")]
    Protected,
}

#[derive(Debug, thiserror::Error)]
#[error("pending-prompt sequence space exhausted for session {session_id}")]
struct PendingPromptSequenceExhausted {
    session_id: String,
}

impl SessionStore {
    pub fn insert_pending_prompt(
        &self,
        session_id: &str,
        text: &str,
        prompt_id: Option<&str>,
    ) -> anyhow::Result<PendingPromptRecord> {
        self.insert_pending_prompt_payload(
            session_id,
            &PromptPayload::text(text.to_string()),
            prompt_id,
        )
    }

    pub fn insert_pending_prompt_payload(
        &self,
        session_id: &str,
        payload: &PromptPayload,
        prompt_id: Option<&str>,
    ) -> anyhow::Result<PendingPromptRecord> {
        let queued_at = chrono::Utc::now().to_rfc3339();
        let blocks_json = payload.blocks_json()?;
        let provenance_json = payload.provenance_json()?;
        self.db.with_tx(|tx| {
            let next_seq = allocate_pending_prompt_seq(tx, session_id)?;
            let next_position: i64 = tx.query_row(
                "SELECT COALESCE(MAX(queue_position), 0) + 1
                 FROM session_pending_prompts WHERE session_id = ?1",
                [session_id],
                |row| row.get(0),
            )?;
            tx.execute(
                "INSERT INTO session_pending_prompts (
                    session_id, seq, queue_position, prompt_id, text,
                    blocks_json, provenance_json, queued_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    session_id,
                    next_seq,
                    next_position,
                    prompt_id,
                    payload.text_summary,
                    blocks_json,
                    provenance_json,
                    queued_at
                ],
            )?;
            Ok(PendingPromptRecord {
                session_id: session_id.to_string(),
                seq: next_seq,
                queue_position: next_position,
                prompt_id: prompt_id.map(|s| s.to_string()),
                text: payload.text_summary.clone(),
                blocks_json,
                provenance_json,
                queued_at: queued_at.clone(),
            })
        })
    }

    pub fn list_pending_prompts(
        &self,
        session_id: &str,
    ) -> anyhow::Result<Vec<PendingPromptRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT * FROM session_pending_prompts
                 WHERE session_id = ?1
                 ORDER BY queue_position ASC, seq ASC",
            )?;
            let rows = stmt.query_map([session_id], map_pending_prompt)?;
            rows.collect()
        })
    }

    /// Batched form of [`Self::list_pending_prompts`] for list endpoints:
    /// one query for the whole page, grouped by session, each group in the
    /// same durable queue order as the single-session query.
    pub fn list_pending_prompts_for_sessions(
        &self,
        session_ids: &[String],
    ) -> anyhow::Result<std::collections::HashMap<String, Vec<PendingPromptRecord>>> {
        if session_ids.is_empty() {
            return Ok(std::collections::HashMap::new());
        }
        self.db.with_conn(|conn| {
            let placeholders = vec!["?"; session_ids.len()].join(", ");
            let mut stmt = conn.prepare(&format!(
                "SELECT * FROM session_pending_prompts
                 WHERE session_id IN ({placeholders})
                 ORDER BY session_id ASC, queue_position ASC, seq ASC"
            ))?;
            let rows = stmt.query_map(
                rusqlite::params_from_iter(session_ids.iter()),
                map_pending_prompt,
            )?;
            let mut grouped = std::collections::HashMap::<String, Vec<PendingPromptRecord>>::new();
            for row in rows {
                let record = row?;
                grouped
                    .entry(record.session_id.clone())
                    .or_default()
                    .push(record);
            }
            Ok(grouped)
        })
    }

    pub fn peek_head_pending_prompt(
        &self,
        session_id: &str,
    ) -> anyhow::Result<Option<PendingPromptRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM session_pending_prompts
                 WHERE session_id = ?1
                 ORDER BY queue_position ASC, seq ASC
                 LIMIT 1",
                [session_id],
                map_pending_prompt,
            )
            .optional()
        })
    }

    pub fn find_pending_prompt(
        &self,
        session_id: &str,
        seq: i64,
    ) -> anyhow::Result<Option<PendingPromptRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM session_pending_prompts
                 WHERE session_id = ?1 AND seq = ?2",
                params![session_id, seq],
                map_pending_prompt,
            )
            .optional()
        })
    }

    pub fn update_pending_prompt_text(
        &self,
        session_id: &str,
        seq: i64,
        text: &str,
    ) -> anyhow::Result<bool> {
        self.update_pending_prompt_payload(session_id, seq, &PromptPayload::text(text.to_string()))
    }

    pub fn update_pending_prompt_payload(
        &self,
        session_id: &str,
        seq: i64,
        payload: &PromptPayload,
    ) -> anyhow::Result<bool> {
        let blocks_json = payload.blocks_json()?;
        self.db.with_tx_anyhow(|tx| {
            let record = tx
                .query_row(
                    "SELECT * FROM session_pending_prompts
                     WHERE session_id = ?1 AND seq = ?2",
                    params![session_id, seq],
                    map_pending_prompt,
                )
                .optional()?;
            let Some(record) = record else {
                return Ok(false);
            };
            if super::completion_deliveries::canonical::pending_prompt_is_canonical_delivery(
                tx, &record,
            )? {
                return Err(anyhow::Error::new(PendingPromptWriteError::Protected));
            }
            let rows = tx.execute(
                "UPDATE session_pending_prompts
                 SET text = ?3, blocks_json = ?4
                 WHERE session_id = ?1 AND seq = ?2",
                params![session_id, seq, payload.text_summary, blocks_json],
            )?;
            Ok(rows > 0)
        })
    }

    pub fn delete_pending_prompt(&self, session_id: &str, seq: i64) -> anyhow::Result<bool> {
        Ok(self
            .delete_pending_prompt_record(session_id, seq)?
            .is_some())
    }

    pub fn delete_pending_prompt_record(
        &self,
        session_id: &str,
        seq: i64,
    ) -> anyhow::Result<Option<PendingPromptRecord>> {
        self.db.with_tx_anyhow(|tx| {
            let record = tx
                .query_row(
                    "SELECT * FROM session_pending_prompts WHERE session_id = ?1 AND seq = ?2",
                    params![session_id, seq],
                    map_pending_prompt,
                )
                .optional()?;
            if record.is_none() {
                return Ok(None);
            }
            let record = record.expect("guarded pending prompt exists");
            if super::completion_deliveries::canonical::pending_prompt_is_canonical_delivery(
                tx, &record,
            )? {
                return Err(anyhow::Error::new(PendingPromptWriteError::Protected));
            }
            tx.execute(
                "DELETE FROM session_pending_prompts WHERE session_id = ?1 AND seq = ?2",
                params![session_id, seq],
            )?;
            Ok(Some(record))
        })
    }

    /// Compare-and-swap the queue order without changing stable entry ids.
    ///
    /// `expected_seqs` must match the current ordered ids exactly. Only then
    /// may `desired_seqs` be applied, and it must be an exact permutation of
    /// that current set. Expected conflicts are returned as typed outcomes;
    /// database failures remain errors.
    pub fn reorder_pending_prompts(
        &self,
        session_id: &str,
        expected_seqs: &[i64],
        desired_seqs: &[i64],
    ) -> anyhow::Result<PendingPromptReorderOutcome> {
        self.db.with_tx_anyhow(|tx| {
            let existing = {
                let mut seq_stmt = tx.prepare(
                    "SELECT seq FROM session_pending_prompts
                 WHERE session_id = ?1
                 ORDER BY queue_position ASC, seq ASC",
                )?;
                let seqs = seq_stmt
                    .query_map([session_id], |row| row.get(0))?
                    .collect::<rusqlite::Result<Vec<i64>>>()?;
                seqs
            };

            if existing != expected_seqs {
                return Ok(PendingPromptReorderOutcome::Stale {
                    current_seqs: existing,
                });
            }
            if let Err(reason) = validate_pending_prompt_order(&existing, desired_seqs) {
                return Ok(PendingPromptReorderOutcome::Invalid { reason });
            }

            for (index, seq) in desired_seqs.iter().copied().enumerate() {
                let temporary_position = -(index as i64 + 1);
                let changed = tx.execute(
                    "UPDATE session_pending_prompts
                     SET queue_position = ?3
                     WHERE session_id = ?1 AND seq = ?2",
                    params![session_id, seq, temporary_position],
                )?;
                debug_assert_eq!(changed, 1);
            }
            for index in 0..desired_seqs.len() {
                let temporary_position = -(index as i64 + 1);
                let new_position = index as i64 + 1;
                tx.execute(
                    "UPDATE session_pending_prompts
                     SET queue_position = ?3
                     WHERE session_id = ?1 AND queue_position = ?2",
                    params![session_id, temporary_position, new_position],
                )?;
            }

            let mut load_stmt = tx.prepare(
                "SELECT * FROM session_pending_prompts
                 WHERE session_id = ?1
                 ORDER BY queue_position ASC, seq ASC",
            )?;
            let records = load_stmt
                .query_map([session_id], map_pending_prompt)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(PendingPromptReorderOutcome::Reordered(records))
        })
    }
}

pub(super) fn allocate_pending_prompt_seq(
    conn: &rusqlite::Connection,
    session_id: &str,
) -> rusqlite::Result<i64> {
    let next_seq = conn
        .query_row(
            "UPDATE sessions
             SET pending_prompt_seq_cursor = pending_prompt_seq_cursor + 1
             WHERE id = ?1 AND pending_prompt_seq_cursor < ?2
             RETURNING pending_prompt_seq_cursor",
            params![session_id, MAX_PENDING_PROMPT_SEQ],
            |row| row.get(0),
        )
        .optional()?;
    if let Some(next_seq) = next_seq {
        return Ok(next_seq);
    }

    let session_exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sessions WHERE id = ?1)",
        [session_id],
        |row| row.get(0),
    )?;
    if !session_exists {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }
    Err(rusqlite::Error::ToSqlConversionFailure(Box::new(
        PendingPromptSequenceExhausted {
            session_id: session_id.to_string(),
        },
    )))
}

fn validate_pending_prompt_order(existing: &[i64], requested: &[i64]) -> Result<(), String> {
    if requested.len() != existing.len() {
        return Err(format!(
            "reorder seq count mismatch: expected {}, got {}",
            existing.len(),
            requested.len(),
        ));
    }

    let mut sorted_requested = requested.to_vec();
    sorted_requested.sort_unstable();
    if sorted_requested.windows(2).any(|pair| pair[0] == pair[1]) {
        return Err(format!("reorder seqs contain duplicates: {requested:?}"));
    }

    let mut sorted_existing = existing.to_vec();
    sorted_existing.sort_unstable();
    if sorted_requested != sorted_existing {
        return Err(format!(
            "reorder seqs mismatch: expected {sorted_existing:?}, got {sorted_requested:?}",
        ));
    }
    Ok(())
}

pub(super) fn map_pending_prompt(row: &rusqlite::Row) -> rusqlite::Result<PendingPromptRecord> {
    Ok(PendingPromptRecord {
        session_id: row.get("session_id")?,
        seq: row.get("seq")?,
        queue_position: row.get("queue_position")?,
        prompt_id: row.get("prompt_id")?,
        text: row.get("text")?,
        blocks_json: row.get("blocks_json")?,
        provenance_json: row.get("provenance_json")?,
        queued_at: row.get("queued_at")?,
    })
}

pub(super) fn insert_pending_prompt_row(
    conn: &rusqlite::Connection,
    record: &PendingPromptRecord,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO session_pending_prompts (
            session_id, seq, queue_position, prompt_id, text, blocks_json,
            queued_at, provenance_json
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            record.session_id,
            record.seq,
            record.queue_position,
            record.prompt_id,
            record.text,
            record.blocks_json,
            record.queued_at,
            record.provenance_json,
        ],
    )?;
    conn.execute(
        "UPDATE sessions
         SET pending_prompt_seq_cursor = MAX(pending_prompt_seq_cursor, ?2)
         WHERE id = ?1",
        params![record.session_id, record.seq],
    )?;
    Ok(())
}
