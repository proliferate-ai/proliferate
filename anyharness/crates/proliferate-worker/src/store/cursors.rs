use rusqlite::{params, OptionalExtension};

use crate::error::Result;

use super::{now_rfc3339, Store};

#[derive(Debug, Clone)]
pub struct SyncCursorRecord {
    pub workspace_id: String,
    pub session_id: String,
    pub last_uploaded_seq: i64,
    pub last_ack_seq: i64,
}

impl Store {
    pub fn load_cursor(
        &self,
        workspace_id: &str,
        session_id: &str,
    ) -> Result<Option<SyncCursorRecord>> {
        self.with_conn(|conn| {
            conn.query_row(
                "SELECT workspace_id, session_id, last_uploaded_seq, last_ack_seq
                 FROM sync_cursors WHERE workspace_id = ?1 AND session_id = ?2",
                params![workspace_id, session_id],
                |row| {
                    Ok(SyncCursorRecord {
                        workspace_id: row.get(0)?,
                        session_id: row.get(1)?,
                        last_uploaded_seq: row.get(2)?,
                        last_ack_seq: row.get(3)?,
                    })
                },
            )
            .optional()
        })
    }

    pub fn upsert_cursor(&self, record: &SyncCursorRecord) -> Result<()> {
        let now = now_rfc3339();
        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO sync_cursors (
                    workspace_id, session_id, last_uploaded_seq, last_ack_seq, updated_at
                 )
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(workspace_id, session_id) DO UPDATE SET
                    last_uploaded_seq = excluded.last_uploaded_seq,
                    last_ack_seq = excluded.last_ack_seq,
                    updated_at = excluded.updated_at",
                params![
                    record.workspace_id,
                    record.session_id,
                    record.last_uploaded_seq,
                    record.last_ack_seq,
                    now,
                ],
            )?;
            Ok(())
        })
    }

    pub fn list_cursors(&self, limit: usize) -> Result<Vec<SyncCursorRecord>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT workspace_id, session_id, last_uploaded_seq, last_ack_seq
                 FROM sync_cursors
                 ORDER BY updated_at DESC
                 LIMIT ?1",
            )?;
            let records = stmt
                .query_map(params![limit as i64], |row| {
                    Ok(SyncCursorRecord {
                        workspace_id: row.get(0)?,
                        session_id: row.get(1)?,
                        last_uploaded_seq: row.get(2)?,
                        last_ack_seq: row.get(3)?,
                    })
                })?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            Ok(records)
        })
    }
}
