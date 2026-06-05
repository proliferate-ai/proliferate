use rusqlite::{params, OptionalExtension};

use super::{TailCursorUpsert, WorkerStore};
use crate::error::WorkerError;

#[derive(Debug, Clone)]
pub struct WorkerExposureSnapshot {
    pub exposure_id: String,
    pub target_id: String,
    pub cloud_workspace_id: String,
    pub session_projection_id: Option<String>,
    pub anyharness_workspace_id: String,
    pub anyharness_session_id: Option<String>,
    pub projection_level: String,
    pub commandable: bool,
    pub status: String,
    pub revision: Option<i64>,
    pub last_uploaded_seq: i64,
}

#[derive(Debug, Clone)]
pub(crate) struct WorkerControlState {
    pub control_cursor: Option<String>,
    pub revoked_jti_cursor: Option<String>,
    pub exposure_cache_initialized: bool,
    pub legacy_exposure_polling_enabled: bool,
}

impl WorkerStore {
    pub fn reconcile_exposure_snapshots(
        &self,
        exposures: &[WorkerExposureSnapshot],
        cursors: &[TailCursorUpsert],
    ) -> Result<(), WorkerError> {
        let mut conn = self.connection()?;
        let tx = conn.transaction()?;
        tx.execute(
            r#"
            UPDATE worker_projection_cursor
            SET status = 'inactive',
                updated_at = CURRENT_TIMESTAMP
            "#,
            [],
        )?;
        for cursor in cursors {
            tx.execute(
                r#"
                INSERT INTO worker_projection_cursor (
                    session_projection_id,
                    exposure_id,
                    anyharness_workspace_id,
                    anyharness_session_id,
                    projection_level,
                    commandable,
                    last_uploaded_seq,
                    last_ack_seq,
                    status,
                    gap_state_json,
                    updated_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8, NULL, CURRENT_TIMESTAMP)
                ON CONFLICT(session_projection_id) DO UPDATE SET
                    anyharness_workspace_id = excluded.anyharness_workspace_id,
                    anyharness_session_id = excluded.anyharness_session_id,
                    projection_level = excluded.projection_level,
                    commandable = excluded.commandable,
                    last_uploaded_seq = CASE
                        WHEN worker_projection_cursor.anyharness_session_id
                            IS NOT excluded.anyharness_session_id
                        THEN excluded.last_uploaded_seq
                        ELSE MAX(worker_projection_cursor.last_uploaded_seq, excluded.last_uploaded_seq)
                    END,
                    last_ack_seq = CASE
                        WHEN worker_projection_cursor.anyharness_session_id
                            IS NOT excluded.anyharness_session_id
                        THEN excluded.last_ack_seq
                        ELSE MAX(worker_projection_cursor.last_ack_seq, excluded.last_ack_seq)
                    END,
                    status = excluded.status,
                    gap_state_json = CASE
                        WHEN worker_projection_cursor.anyharness_session_id
                            IS NOT excluded.anyharness_session_id
                        THEN NULL
                        WHEN excluded.last_uploaded_seq > worker_projection_cursor.last_uploaded_seq
                        THEN NULL
                        ELSE worker_projection_cursor.gap_state_json
                    END,
                    updated_at = CURRENT_TIMESTAMP
                "#,
                params![
                    cursor.session_projection_id,
                    cursor.exposure_id,
                    cursor.anyharness_workspace_id,
                    cursor.anyharness_session_id,
                    cursor.projection_level,
                    cursor.commandable,
                    cursor.last_uploaded_seq,
                    cursor.status,
                ],
            )?;
        }
        tx.execute("DELETE FROM worker_exposure_snapshot", [])?;
        for exposure in exposures {
            tx.execute(
                r#"
                INSERT INTO worker_exposure_snapshot (
                    snapshot_key,
                    exposure_id,
                    target_id,
                    cloud_workspace_id,
                    session_projection_id,
                    anyharness_workspace_id,
                    anyharness_session_id,
                    projection_level,
                    commandable,
                    status,
                    revision,
                    last_uploaded_seq,
                    updated_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, CURRENT_TIMESTAMP)
                "#,
                params![
                    exposure_snapshot_key(exposure),
                    exposure.exposure_id,
                    exposure.target_id,
                    exposure.cloud_workspace_id,
                    exposure.session_projection_id,
                    exposure.anyharness_workspace_id,
                    exposure.anyharness_session_id,
                    exposure.projection_level,
                    exposure.commandable,
                    exposure.status,
                    exposure.revision,
                    exposure.last_uploaded_seq,
                ],
            )?;
        }
        tx.execute(
            r#"
            INSERT INTO worker_control_state (
                id,
                exposure_cache_initialized,
                legacy_exposure_polling_enabled,
                updated_at
            )
            VALUES (1, 1, 0, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET
                exposure_cache_initialized = 1,
                legacy_exposure_polling_enabled = 0,
                updated_at = CURRENT_TIMESTAMP
            "#,
            [],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn list_cached_exposure_snapshots(
        &self,
    ) -> Result<Vec<WorkerExposureSnapshot>, WorkerError> {
        let conn = self.connection()?;
        let mut stmt = conn.prepare(
            r#"
            SELECT
                exposure_id,
                target_id,
                cloud_workspace_id,
                session_projection_id,
                anyharness_workspace_id,
                anyharness_session_id,
                projection_level,
                commandable,
                status,
                revision,
                last_uploaded_seq
            FROM worker_exposure_snapshot
            ORDER BY updated_at DESC, snapshot_key ASC
            "#,
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(WorkerExposureSnapshot {
                exposure_id: row.get(0)?,
                target_id: row.get(1)?,
                cloud_workspace_id: row.get(2)?,
                session_projection_id: row.get(3)?,
                anyharness_workspace_id: row.get(4)?,
                anyharness_session_id: row.get(5)?,
                projection_level: row.get(6)?,
                commandable: row.get(7)?,
                status: row.get(8)?,
                revision: row.get(9)?,
                last_uploaded_seq: row.get(10)?,
            })
        })?;
        let mut exposures = Vec::new();
        for row in rows {
            exposures.push(row?);
        }
        Ok(exposures)
    }

    pub(crate) fn load_worker_control_state(&self) -> Result<WorkerControlState, WorkerError> {
        let conn = self.connection()?;
        let state = conn
            .query_row(
                r#"
                SELECT
                    control_cursor,
                    revoked_jti_cursor,
                    exposure_cache_initialized,
                    legacy_exposure_polling_enabled
                FROM worker_control_state
                WHERE id = 1
                "#,
                [],
                |row| {
                    Ok(WorkerControlState {
                        control_cursor: row.get(0)?,
                        revoked_jti_cursor: row.get(1)?,
                        exposure_cache_initialized: row.get::<_, i64>(2)? != 0,
                        legacy_exposure_polling_enabled: row.get::<_, i64>(3)? != 0,
                    })
                },
            )
            .optional()?;
        Ok(state.unwrap_or(WorkerControlState {
            control_cursor: None,
            revoked_jti_cursor: None,
            exposure_cache_initialized: false,
            legacy_exposure_polling_enabled: false,
        }))
    }

    pub fn save_control_cursor(&self, control_cursor: &str) -> Result<(), WorkerError> {
        let conn = self.connection()?;
        conn.execute(
            r#"
            INSERT INTO worker_control_state (id, control_cursor, updated_at)
            VALUES (1, ?1, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET
                control_cursor = excluded.control_cursor,
                updated_at = CURRENT_TIMESTAMP
            "#,
            params![control_cursor],
        )?;
        Ok(())
    }

    pub fn save_revoked_jti_cursor(&self, revoked_jti_cursor: &str) -> Result<(), WorkerError> {
        let conn = self.connection()?;
        conn.execute(
            r#"
            INSERT INTO worker_control_state (id, revoked_jti_cursor, updated_at)
            VALUES (1, ?1, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET
                revoked_jti_cursor = excluded.revoked_jti_cursor,
                updated_at = CURRENT_TIMESTAMP
            "#,
            params![revoked_jti_cursor],
        )?;
        Ok(())
    }

    pub fn set_legacy_exposure_polling_enabled(&self, enabled: bool) -> Result<(), WorkerError> {
        let conn = self.connection()?;
        conn.execute(
            r#"
            INSERT INTO worker_control_state (
                id,
                legacy_exposure_polling_enabled,
                updated_at
            )
            VALUES (1, ?1, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET
                legacy_exposure_polling_enabled = excluded.legacy_exposure_polling_enabled,
                updated_at = CURRENT_TIMESTAMP
            "#,
            params![enabled],
        )?;
        Ok(())
    }
}

fn exposure_snapshot_key(exposure: &WorkerExposureSnapshot) -> String {
    format!(
        "{}:{}",
        exposure.exposure_id,
        exposure
            .session_projection_id
            .as_deref()
            .unwrap_or("workspace")
    )
}
