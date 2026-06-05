use rusqlite::{params, OptionalExtension};

use super::WorkerStore;
use crate::{error::WorkerError, identity::credentials::WorkerIdentity};

impl WorkerStore {
    pub fn load_identity(&self) -> Result<Option<WorkerIdentity>, WorkerError> {
        let conn = self.connection()?;
        let value = conn
            .query_row(
                "SELECT target_id, worker_id, worker_token FROM identity WHERE id = 1",
                [],
                |row| {
                    Ok(WorkerIdentity {
                        target_id: row.get(0)?,
                        worker_id: row.get(1)?,
                        worker_token: row.get(2)?,
                    })
                },
            )
            .optional()?;
        Ok(value)
    }

    pub fn save_identity(&self, identity: &WorkerIdentity) -> Result<(), WorkerError> {
        let conn = self.connection()?;
        conn.execute(
            r#"
            INSERT INTO identity (
                id,
                target_id,
                worker_id,
                worker_token,
                updated_at
            )
            VALUES (1, ?1, ?2, ?3, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET
                target_id = excluded.target_id,
                worker_id = excluded.worker_id,
                worker_token = excluded.worker_token,
                updated_at = CURRENT_TIMESTAMP
            "#,
            params![
                identity.target_id,
                identity.worker_id,
                identity.worker_token
            ],
        )?;
        Ok(())
    }
}
