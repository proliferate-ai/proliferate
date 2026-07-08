use rusqlite::{params, OptionalExtension};

use super::SessionStore;
use crate::domains::sessions::model::PendingPromptRecord;
use crate::domains::sessions::prompt::PromptPayload;

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
            let next_seq: i64 = tx.query_row(
                "SELECT COALESCE(MAX(seq), 0) + 1 FROM session_pending_prompts WHERE session_id = ?1",
                [session_id],
                |row| row.get(0),
            )?;
            tx.execute(
                "INSERT INTO session_pending_prompts (
                    session_id, seq, prompt_id, text, blocks_json, provenance_json, queued_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    session_id,
                    next_seq,
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
                 ORDER BY seq ASC",
            )?;
            let rows = stmt.query_map([session_id], map_pending_prompt)?;
            rows.collect()
        })
    }

    /// Batched form of [`Self::list_pending_prompts`] for list endpoints:
    /// one query for the whole page, grouped by session, each group in the
    /// same `seq ASC` order as the single-session query.
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
                 ORDER BY session_id ASC, seq ASC"
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
                 ORDER BY seq ASC
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
        self.db.with_conn(|conn| {
            let rows = conn.execute(
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
        self.db.with_conn(|conn| {
            let record = conn
                .query_row(
                    "SELECT * FROM session_pending_prompts WHERE session_id = ?1 AND seq = ?2",
                    params![session_id, seq],
                    map_pending_prompt,
                )
                .optional()?;
            if record.is_none() {
                return Ok(None);
            }
            conn.execute(
                "DELETE FROM session_pending_prompts WHERE session_id = ?1 AND seq = ?2",
                params![session_id, seq],
            )?;
            Ok(record)
        })
    }

    /// Reorder existing pending prompts so their `seq` values match the given
    /// order. `ordered_seqs` must contain exactly the set of seq values that
    /// currently exist for this session (no duplicates, no extras, no missing).
    /// Returns the full list of records in the new order.
    pub fn reorder_pending_prompts(
        &self,
        session_id: &str,
        ordered_seqs: &[i64],
    ) -> anyhow::Result<Vec<PendingPromptRecord>> {
        self.db.with_tx_anyhow(|tx| {
            // Fetch all current seqs for validation.
            let mut stmt = tx.prepare(
                "SELECT seq FROM session_pending_prompts WHERE session_id = ?1 ORDER BY seq ASC",
            )?;
            let existing: Vec<i64> = stmt
                .query_map([session_id], |row| row.get(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;

            // Validate exact multiset equality: the request must be a
            // permutation of the existing seqs — no duplicates, no extras, no
            // missing. Do NOT dedup the request before comparing: deduping would
            // let e.g. [2, 2, 1] over existing {1, 2} pass and corrupt the seq
            // numbering. Reject on any count mismatch or any duplicate seq.
            if ordered_seqs.len() != existing.len() {
                anyhow::bail!(
                    "reorder seqs count mismatch: expected {} rows, got {}",
                    existing.len(),
                    ordered_seqs.len()
                );
            }
            let mut sorted_requested = ordered_seqs.to_vec();
            sorted_requested.sort_unstable();
            if sorted_requested.windows(2).any(|pair| pair[0] == pair[1]) {
                anyhow::bail!("reorder seqs contain duplicates: {:?}", ordered_seqs);
            }
            let mut sorted_existing = existing.clone();
            sorted_existing.sort_unstable();
            if sorted_requested != sorted_existing {
                anyhow::bail!(
                    "reorder seqs mismatch: expected {:?}, got {:?}",
                    sorted_existing,
                    sorted_requested
                );
            }

            // Renumber: assign fresh seq values starting from 1, in the order
            // specified by `ordered_seqs`. Use a temp negative offset to avoid
            // UNIQUE constraint violations during reassignment.
            for (idx, &old_seq) in ordered_seqs.iter().enumerate() {
                let temp_seq = -(idx as i64 + 1);
                tx.execute(
                    "UPDATE session_pending_prompts SET seq = ?3 WHERE session_id = ?1 AND seq = ?2",
                    params![session_id, old_seq, temp_seq],
                )?;
            }
            for idx in 0..ordered_seqs.len() {
                let temp_seq = -(idx as i64 + 1);
                let new_seq = idx as i64 + 1;
                tx.execute(
                    "UPDATE session_pending_prompts SET seq = ?3 WHERE session_id = ?1 AND seq = ?2",
                    params![session_id, temp_seq, new_seq],
                )?;
            }

            // Return the records in new order.
            let mut load_stmt = tx.prepare(
                "SELECT * FROM session_pending_prompts WHERE session_id = ?1 ORDER BY seq ASC",
            )?;
            let rows = load_stmt.query_map([session_id], map_pending_prompt)?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
                .map_err(Into::into)
        })
    }
}

fn map_pending_prompt(row: &rusqlite::Row) -> rusqlite::Result<PendingPromptRecord> {
    Ok(PendingPromptRecord {
        session_id: row.get("session_id")?,
        seq: row.get("seq")?,
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
            session_id, seq, prompt_id, text, blocks_json, queued_at, provenance_json
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            record.session_id,
            record.seq,
            record.prompt_id,
            record.text,
            record.blocks_json,
            record.queued_at,
            record.provenance_json,
        ],
    )?;
    Ok(())
}
