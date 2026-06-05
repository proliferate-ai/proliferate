use rusqlite::params;

use super::{PendingCommandResult, WorkerStore};
use crate::error::WorkerError;

impl WorkerStore {
    pub fn save_pending_command_result(
        &self,
        result: &PendingCommandResult,
    ) -> Result<(), WorkerError> {
        let conn = self.connection()?;
        let result_json = match &result.result {
            Some(value) => Some(serde_json::to_string(value)?),
            None => None,
        };
        conn.execute(
            r#"
            INSERT INTO pending_command_results (
                command_id,
                lease_id,
                cloud_workspace_id,
                anyharness_workspace_id,
                status,
                error_code,
                error_message,
                result_json,
                updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, CURRENT_TIMESTAMP)
            ON CONFLICT(command_id) DO UPDATE SET
                lease_id = excluded.lease_id,
                cloud_workspace_id = excluded.cloud_workspace_id,
                anyharness_workspace_id = excluded.anyharness_workspace_id,
                status = excluded.status,
                error_code = excluded.error_code,
                error_message = excluded.error_message,
                result_json = excluded.result_json,
                updated_at = CURRENT_TIMESTAMP
            "#,
            params![
                result.command_id,
                result.lease_id,
                result.cloud_workspace_id,
                result.anyharness_workspace_id,
                result.status,
                result.error_code,
                result.error_message,
                result_json
            ],
        )?;
        Ok(())
    }

    pub fn list_pending_command_results(&self) -> Result<Vec<PendingCommandResult>, WorkerError> {
        let conn = self.connection()?;
        let mut stmt = conn.prepare(
            r#"
            SELECT
                command_id,
                lease_id,
                cloud_workspace_id,
                anyharness_workspace_id,
                status,
                error_code,
                error_message,
                result_json
            FROM pending_command_results
            ORDER BY updated_at ASC
            "#,
        )?;
        let rows = stmt.query_map([], |row| {
            let result_json: Option<String> = row.get(7)?;
            let result = match result_json {
                Some(value) => Some(serde_json::from_str(&value).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        7,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })?),
                None => None,
            };
            Ok(PendingCommandResult {
                command_id: row.get(0)?,
                lease_id: row.get(1)?,
                cloud_workspace_id: row.get(2)?,
                anyharness_workspace_id: row.get(3)?,
                status: row.get(4)?,
                error_code: row.get(5)?,
                error_message: row.get(6)?,
                result,
            })
        })?;
        let mut results = Vec::new();
        for row in rows {
            results.push(row?);
        }
        Ok(results)
    }

    pub fn delete_pending_command_result(&self, command_id: &str) -> Result<(), WorkerError> {
        let conn = self.connection()?;
        conn.execute(
            "DELETE FROM pending_command_results WHERE command_id = ?1",
            params![command_id],
        )?;
        Ok(())
    }
}
