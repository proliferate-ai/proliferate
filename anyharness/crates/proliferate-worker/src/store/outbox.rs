use rusqlite::{params, OptionalExtension};

use crate::error::Result;

use super::{now_rfc3339, Store};

#[derive(Debug, Clone)]
pub struct OutboxBatchRecord {
    pub batch_id: String,
    pub target_id: String,
    pub session_id: String,
    pub seq_start: i64,
    pub seq_end: i64,
    pub payload: String,
    pub attempt_count: i64,
    pub next_attempt_at: Option<String>,
}

impl Store {
    pub fn insert_outbox_batch(&self, record: &OutboxBatchRecord) -> Result<()> {
        let now = now_rfc3339();
        self.with_conn(|conn| {
            conn.execute(
                "INSERT OR IGNORE INTO event_outbox (
                    batch_id, target_id, session_id, seq_start, seq_end, payload,
                    attempt_count, next_attempt_at, created_at, updated_at
                 )
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
                params![
                    record.batch_id,
                    record.target_id,
                    record.session_id,
                    record.seq_start,
                    record.seq_end,
                    record.payload,
                    record.attempt_count,
                    record.next_attempt_at,
                    now,
                ],
            )?;
            Ok(())
        })
    }

    pub fn list_due_outbox_batches(&self, limit: usize) -> Result<Vec<OutboxBatchRecord>> {
        let now = now_rfc3339();
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT batch_id, target_id, session_id, seq_start, seq_end, payload,
                        attempt_count, next_attempt_at
                 FROM event_outbox
                 WHERE next_attempt_at IS NULL OR next_attempt_at <= ?1
                 ORDER BY created_at
                 LIMIT ?2",
            )?;
            let records = stmt
                .query_map(params![now, limit as i64], |row| {
                    Ok(OutboxBatchRecord {
                        batch_id: row.get(0)?,
                        target_id: row.get(1)?,
                        session_id: row.get(2)?,
                        seq_start: row.get(3)?,
                        seq_end: row.get(4)?,
                        payload: row.get(5)?,
                        attempt_count: row.get(6)?,
                        next_attempt_at: row.get(7)?,
                    })
                })?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            Ok(records)
        })
    }

    pub fn delete_outbox_batch(&self, batch_id: &str) -> Result<()> {
        self.with_conn(|conn| {
            conn.execute(
                "DELETE FROM event_outbox WHERE batch_id = ?1",
                params![batch_id],
            )?;
            Ok(())
        })
    }

    pub fn mark_outbox_attempt(
        &self,
        batch_id: &str,
        attempt_count: i64,
        next_attempt_at: Option<&str>,
    ) -> Result<()> {
        let now = now_rfc3339();
        self.with_conn(|conn| {
            conn.execute(
                "UPDATE event_outbox
                 SET attempt_count = ?2, next_attempt_at = ?3, updated_at = ?4
                 WHERE batch_id = ?1",
                params![batch_id, attempt_count, next_attempt_at, now],
            )?;
            Ok(())
        })
    }

    pub fn load_outbox_batch(&self, batch_id: &str) -> Result<Option<OutboxBatchRecord>> {
        self.with_conn(|conn| {
            conn.query_row(
                "SELECT batch_id, target_id, session_id, seq_start, seq_end, payload,
                        attempt_count, next_attempt_at
                 FROM event_outbox WHERE batch_id = ?1",
                params![batch_id],
                |row| {
                    Ok(OutboxBatchRecord {
                        batch_id: row.get(0)?,
                        target_id: row.get(1)?,
                        session_id: row.get(2)?,
                        seq_start: row.get(3)?,
                        seq_end: row.get(4)?,
                        payload: row.get(5)?,
                        attempt_count: row.get(6)?,
                        next_attempt_at: row.get(7)?,
                    })
                },
            )
            .optional()
        })
    }
}
