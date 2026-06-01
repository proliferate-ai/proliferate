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
