use std::collections::HashSet;

use rusqlite::{params, OptionalExtension};

use super::WorkerStore;
use crate::error::WorkerError;

impl WorkerStore {
    pub fn upsert_tail_session_mapping(
        &self,
        session_id: &str,
        workspace_id: Option<&str>,
    ) -> Result<(), WorkerError> {
        let conn = self.connection()?;
        conn.execute(
            r#"
            INSERT INTO sync_sessions (session_id, workspace_id, last_uploaded_seq, updated_at)
            VALUES (?1, ?2, 0, CURRENT_TIMESTAMP)
            ON CONFLICT(session_id) DO UPDATE SET
                workspace_id = COALESCE(excluded.workspace_id, sync_sessions.workspace_id),
                updated_at = CURRENT_TIMESTAMP
            "#,
            params![session_id, workspace_id],
        )?;
        Ok(())
    }

    pub fn upsert_tail_mappings(
        &self,
        workspace_mappings: &[(String, String)],
        session_mappings: &[(String, Option<String>)],
    ) -> Result<(), WorkerError> {
        let mut conn = self.connection()?;
        let tx = conn.transaction()?;
        for (workspace_id, cloud_workspace_id) in workspace_mappings {
            tx.execute(
                r#"
                INSERT INTO sync_workspaces (workspace_id, cloud_workspace_id, updated_at)
                VALUES (?1, ?2, CURRENT_TIMESTAMP)
                ON CONFLICT(workspace_id) DO UPDATE SET
                    cloud_workspace_id = excluded.cloud_workspace_id,
                    updated_at = CURRENT_TIMESTAMP
                "#,
                params![workspace_id, cloud_workspace_id],
            )?;
        }
        for (session_id, workspace_id) in session_mappings {
            tx.execute(
                r#"
                INSERT INTO sync_sessions (session_id, workspace_id, last_uploaded_seq, updated_at)
                VALUES (?1, ?2, 0, CURRENT_TIMESTAMP)
                ON CONFLICT(session_id) DO UPDATE SET
                    workspace_id = COALESCE(excluded.workspace_id, sync_sessions.workspace_id),
                    updated_at = CURRENT_TIMESTAMP
                "#,
                params![session_id, workspace_id],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn list_known_session_ids_for_workspace(
        &self,
        workspace_id: &str,
    ) -> Result<HashSet<String>, WorkerError> {
        let conn = self.connection()?;
        let mut stmt = conn.prepare(
            r#"
            SELECT session_id
            FROM sync_sessions
            WHERE workspace_id = ?1
            "#,
        )?;
        let rows = stmt.query_map(params![workspace_id], |row| row.get::<_, String>(0))?;
        let mut sessions = HashSet::new();
        for row in rows {
            sessions.insert(row?);
        }
        Ok(sessions)
    }

    pub fn should_discover_workspace(
        &self,
        exposure_id: &str,
        workspace_id: &str,
        now_unix_ms: i64,
        min_interval_ms: i64,
    ) -> Result<bool, WorkerError> {
        let conn = self.connection()?;
        let last_checked = conn
            .query_row(
                r#"
                SELECT anyharness_workspace_id, last_checked_unix_ms
                FROM worker_workspace_discovery
                WHERE exposure_id = ?1
                "#,
                params![exposure_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
            )
            .optional()?;
        let should_discover = match last_checked {
            None => true,
            Some((last_workspace_id, last_checked_unix_ms)) => {
                last_workspace_id != workspace_id
                    || now_unix_ms.saturating_sub(last_checked_unix_ms) >= min_interval_ms
                    || now_unix_ms < last_checked_unix_ms
            }
        };
        if should_discover {
            conn.execute(
                r#"
                INSERT INTO worker_workspace_discovery (
                    exposure_id,
                    anyharness_workspace_id,
                    last_checked_unix_ms,
                    updated_at
                )
                VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP)
                ON CONFLICT(exposure_id) DO UPDATE SET
                    anyharness_workspace_id = excluded.anyharness_workspace_id,
                    last_checked_unix_ms = excluded.last_checked_unix_ms,
                    updated_at = CURRENT_TIMESTAMP
                "#,
                params![exposure_id, workspace_id, now_unix_ms],
            )?;
        }
        Ok(should_discover)
    }
}
