use std::{path::PathBuf, time::Duration};

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;

use crate::{error::WorkerError, identity::credentials::WorkerIdentity};

pub struct WorkerStore {
    path: PathBuf,
}

#[derive(Debug, Clone)]
pub struct ProjectionCursorUpsert {
    pub exposure_id: String,
    pub session_projection_id: Option<String>,
    pub anyharness_workspace_id: String,
    pub anyharness_session_id: Option<String>,
    pub projection_level: String,
    pub commandable: bool,
    pub last_uploaded_seq: i64,
    pub status: String,
}

#[derive(Debug, Clone)]
pub struct ProjectionCursor {
    pub exposure_id: String,
    pub session_projection_id: Option<String>,
    pub anyharness_workspace_id: String,
    pub anyharness_session_id: String,
    pub projection_level: String,
    pub commandable: bool,
    pub last_uploaded_seq: i64,
    pub last_ack_seq: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectionCursorGap {
    expected_seq: i64,
    first_observed_seq: i64,
    reason: String,
}

#[derive(Debug, Clone)]
pub struct PendingCommandResult {
    pub command_id: String,
    pub lease_id: String,
    pub cloud_workspace_id: Option<String>,
    pub slot_generation: Option<i64>,
    pub anyharness_workspace_id: Option<String>,
    pub status: String,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub result: Option<Value>,
}

impl Clone for WorkerStore {
    fn clone(&self) -> Self {
        Self {
            path: self.path.clone(),
        }
    }
}

impl WorkerStore {
    pub fn open(path: PathBuf) -> Result<Self, WorkerError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|source| WorkerError::CreateParent {
                path: parent.to_path_buf(),
                source,
            })?;
            set_private_dir_permissions(&parent.to_path_buf())?;
        }
        let store = Self { path };
        store.migrate()?;
        set_private_file_permissions(&store.path)?;
        Ok(store)
    }

    fn connection(&self) -> Result<Connection, WorkerError> {
        let conn = Connection::open(&self.path)?;
        conn.busy_timeout(Duration::from_secs(5))?;
        conn.execute_batch(
            r#"
            PRAGMA foreign_keys = ON;
            PRAGMA journal_mode = WAL;
            "#,
        )?;
        Ok(conn)
    }

    fn migrate(&self) -> Result<(), WorkerError> {
        let conn = self.connection()?;
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS identity (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                target_id TEXT NOT NULL,
                sandbox_profile_id TEXT,
                cloud_sandbox_id TEXT,
                slot_generation INTEGER,
                worker_id TEXT NOT NULL,
                worker_token TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS sync_sessions (
                session_id TEXT PRIMARY KEY,
                workspace_id TEXT,
                last_uploaded_seq INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS sync_workspaces (
                workspace_id TEXT PRIMARY KEY,
                cloud_workspace_id TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS worker_projection_cursor (
                exposure_id TEXT PRIMARY KEY,
                session_projection_id TEXT,
                anyharness_workspace_id TEXT NOT NULL,
                anyharness_session_id TEXT,
                projection_level TEXT NOT NULL,
                commandable INTEGER NOT NULL CHECK (commandable IN (0, 1)),
                last_uploaded_seq INTEGER NOT NULL DEFAULT 0,
                last_ack_seq INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'active',
                gap_state_json TEXT,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS ix_worker_projection_cursor_active_session
                ON worker_projection_cursor(status, anyharness_session_id);
            CREATE TABLE IF NOT EXISTS pending_command_results (
                command_id TEXT PRIMARY KEY,
                lease_id TEXT NOT NULL,
                cloud_workspace_id TEXT,
                slot_generation INTEGER,
                anyharness_workspace_id TEXT,
                status TEXT NOT NULL,
                error_code TEXT,
                error_message TEXT,
                result_json TEXT,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            "#,
        )?;
        add_column_if_missing(
            &conn,
            "identity",
            "sandbox_profile_id",
            "sandbox_profile_id TEXT",
        )?;
        add_column_if_missing(
            &conn,
            "identity",
            "cloud_sandbox_id",
            "cloud_sandbox_id TEXT",
        )?;
        add_column_if_missing(
            &conn,
            "identity",
            "slot_generation",
            "slot_generation INTEGER",
        )?;
        add_column_if_missing(
            &conn,
            "pending_command_results",
            "cloud_workspace_id",
            "cloud_workspace_id TEXT",
        )?;
        add_column_if_missing(
            &conn,
            "pending_command_results",
            "slot_generation",
            "slot_generation INTEGER",
        )?;
        add_column_if_missing(
            &conn,
            "pending_command_results",
            "anyharness_workspace_id",
            "anyharness_workspace_id TEXT",
        )?;
        add_column_if_missing(
            &conn,
            "worker_projection_cursor",
            "gap_state_json",
            "gap_state_json TEXT",
        )?;
        Ok(())
    }

    pub fn load_identity(&self) -> Result<Option<WorkerIdentity>, WorkerError> {
        let conn = self.connection()?;
        let value = conn
            .query_row(
                "SELECT target_id, sandbox_profile_id, cloud_sandbox_id, slot_generation, worker_id, worker_token FROM identity WHERE id = 1",
                [],
                |row| {
                    Ok(WorkerIdentity {
                        target_id: row.get(0)?,
                        sandbox_profile_id: row.get(1)?,
                        cloud_sandbox_id: row.get(2)?,
                        slot_generation: row.get(3)?,
                        worker_id: row.get(4)?,
                        worker_token: row.get(5)?,
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
                sandbox_profile_id,
                cloud_sandbox_id,
                slot_generation,
                worker_id,
                worker_token,
                updated_at
            )
            VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET
                target_id = excluded.target_id,
                sandbox_profile_id = excluded.sandbox_profile_id,
                cloud_sandbox_id = excluded.cloud_sandbox_id,
                slot_generation = excluded.slot_generation,
                worker_id = excluded.worker_id,
                worker_token = excluded.worker_token,
                updated_at = CURRENT_TIMESTAMP
            "#,
            params![
                identity.target_id,
                identity.sandbox_profile_id,
                identity.cloud_sandbox_id,
                identity.slot_generation,
                identity.worker_id,
                identity.worker_token
            ],
        )?;
        Ok(())
    }

    pub fn upsert_sync_session(
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

    pub fn upsert_sync_mappings(
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

    pub fn reconcile_projection_cursors(
        &self,
        cursors: &[ProjectionCursorUpsert],
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
                    exposure_id,
                    session_projection_id,
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
                ON CONFLICT(exposure_id) DO UPDATE SET
                    session_projection_id = excluded.session_projection_id,
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
                    cursor.exposure_id,
                    cursor.session_projection_id,
                    cursor.anyharness_workspace_id,
                    cursor.anyharness_session_id,
                    cursor.projection_level,
                    cursor.commandable,
                    cursor.last_uploaded_seq,
                    cursor.status,
                ],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn list_active_projection_cursors(&self) -> Result<Vec<ProjectionCursor>, WorkerError> {
        let conn = self.connection()?;
        let mut stmt = conn.prepare(
            r#"
            SELECT
                exposure_id,
                session_projection_id,
                anyharness_workspace_id,
                anyharness_session_id,
                projection_level,
                commandable,
                last_uploaded_seq,
                last_ack_seq
            FROM worker_projection_cursor
            WHERE status = 'active'
              AND anyharness_session_id IS NOT NULL
              AND gap_state_json IS NULL
            ORDER BY updated_at DESC
            "#,
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(ProjectionCursor {
                exposure_id: row.get(0)?,
                session_projection_id: row.get(1)?,
                anyharness_workspace_id: row.get(2)?,
                anyharness_session_id: row.get(3)?,
                projection_level: row.get(4)?,
                commandable: row.get(5)?,
                last_uploaded_seq: row.get(6)?,
                last_ack_seq: row.get(7)?,
            })
        })?;
        let mut cursors = Vec::new();
        for row in rows {
            cursors.push(row?);
        }
        Ok(cursors)
    }

    pub fn update_projection_cursor_ack(
        &self,
        session_id: &str,
        last_contiguous_seq: i64,
    ) -> Result<(), WorkerError> {
        let conn = self.connection()?;
        conn.execute(
            r#"
            UPDATE worker_projection_cursor
            SET last_uploaded_seq = MAX(last_uploaded_seq, ?2),
                last_ack_seq = MAX(last_ack_seq, ?2),
                updated_at = CURRENT_TIMESTAMP
            WHERE anyharness_session_id = ?1
              AND status = 'active'
            "#,
            params![session_id, last_contiguous_seq],
        )?;
        Ok(())
    }

    pub fn record_projection_cursor_gap(
        &self,
        exposure_id: &str,
        expected_seq: i64,
        first_observed_seq: i64,
    ) -> Result<(), WorkerError> {
        let conn = self.connection()?;
        let gap = ProjectionCursorGap {
            expected_seq,
            first_observed_seq,
            reason: "anyharness_event_sequence_gap".to_string(),
        };
        let gap_state_json = serde_json::to_string(&gap)?;
        conn.execute(
            r#"
            UPDATE worker_projection_cursor
            SET gap_state_json = ?2,
                updated_at = CURRENT_TIMESTAMP
            WHERE exposure_id = ?1
            "#,
            params![exposure_id, gap_state_json],
        )?;
        Ok(())
    }

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
                slot_generation,
                anyharness_workspace_id,
                status,
                error_code,
                error_message,
                result_json,
                updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, CURRENT_TIMESTAMP)
            ON CONFLICT(command_id) DO UPDATE SET
                lease_id = excluded.lease_id,
                cloud_workspace_id = excluded.cloud_workspace_id,
                slot_generation = excluded.slot_generation,
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
                result.slot_generation,
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
                slot_generation,
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
            let result_json: Option<String> = row.get(8)?;
            let result = match result_json {
                Some(value) => Some(serde_json::from_str(&value).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        8,
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
                slot_generation: row.get(3)?,
                anyharness_workspace_id: row.get(4)?,
                status: row.get(5)?,
                error_code: row.get(6)?,
                error_message: row.get(7)?,
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

fn add_column_if_missing(
    conn: &Connection,
    table: &str,
    column: &str,
    column_definition: &str,
) -> Result<(), WorkerError> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
    for row in rows {
        if row? == column {
            return Ok(());
        }
    }
    conn.execute(
        &format!("ALTER TABLE {table} ADD COLUMN {column_definition}"),
        [],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
    };

    use super::{ProjectionCursorUpsert, WorkerStore};

    static NEXT_DB_ID: AtomicU64 = AtomicU64::new(1);

    #[test]
    fn projection_cursor_reconcile_lists_only_active_sessions() {
        let store = test_store();
        store
            .reconcile_projection_cursors(&[
                cursor("exposure-active", Some("session-1"), "active", 4),
                cursor("exposure-workspace-only", None, "active", 0),
                cursor("exposure-paused", Some("session-2"), "paused", 0),
            ])
            .expect("reconcile");

        let cursors = store
            .list_active_projection_cursors()
            .expect("active cursors");
        assert_eq!(cursors.len(), 1);
        assert_eq!(cursors[0].exposure_id, "exposure-active");
        assert_eq!(cursors[0].anyharness_session_id, "session-1");
        assert_eq!(cursors[0].last_uploaded_seq, 4);

        store
            .reconcile_projection_cursors(&[])
            .expect("empty reconcile");
        assert!(store
            .list_active_projection_cursors()
            .expect("active cursors")
            .is_empty());
    }

    #[test]
    fn projection_cursor_ack_is_monotonic() {
        let store = test_store();
        store
            .reconcile_projection_cursors(&[cursor("exposure-1", Some("session-1"), "active", 4)])
            .expect("reconcile");

        store
            .update_projection_cursor_ack("session-1", 6)
            .expect("ack");
        store
            .update_projection_cursor_ack("session-1", 5)
            .expect("stale ack");

        let cursors = store
            .list_active_projection_cursors()
            .expect("active cursors");
        assert_eq!(cursors[0].last_uploaded_seq, 6);
        assert_eq!(cursors[0].last_ack_seq, 6);
    }

    #[test]
    fn projection_cursor_gap_removes_cursor_from_active_tail_set_until_repaired() {
        let store = test_store();
        store
            .reconcile_projection_cursors(&[cursor("exposure-1", Some("session-1"), "active", 4)])
            .expect("reconcile");
        store
            .record_projection_cursor_gap("exposure-1", 5, 8)
            .expect("gap");
        assert!(store
            .list_active_projection_cursors()
            .expect("active cursors")
            .is_empty());

        store
            .reconcile_projection_cursors(&[cursor("exposure-1", Some("session-1"), "active", 8)])
            .expect("repair reconcile");
        let cursors = store
            .list_active_projection_cursors()
            .expect("active cursors");
        assert_eq!(cursors.len(), 1);
        assert_eq!(cursors[0].last_uploaded_seq, 8);
    }

    fn cursor(
        exposure_id: &str,
        session_id: Option<&str>,
        status: &str,
        last_uploaded_seq: i64,
    ) -> ProjectionCursorUpsert {
        ProjectionCursorUpsert {
            exposure_id: exposure_id.to_string(),
            session_projection_id: session_id.map(|id| format!("projection-{id}")),
            anyharness_workspace_id: "workspace-1".to_string(),
            anyharness_session_id: session_id.map(ToOwned::to_owned),
            projection_level: "live".to_string(),
            commandable: true,
            last_uploaded_seq,
            status: status.to_string(),
        }
    }

    fn test_store() -> WorkerStore {
        let dir = temp_db_dir();
        let _ = std::fs::remove_dir_all(&dir);
        let path = dir.join("worker.sqlite");
        WorkerStore::open(path).expect("store")
    }

    fn temp_db_dir() -> PathBuf {
        std::env::temp_dir().join(format!(
            "proliferate-worker-store-test-{}-{}",
            std::process::id(),
            NEXT_DB_ID.fetch_add(1, Ordering::Relaxed)
        ))
    }
}

#[cfg(unix)]
fn set_private_dir_permissions(path: &PathBuf) -> Result<(), WorkerError> {
    use std::os::unix::fs::PermissionsExt;

    let permissions = std::fs::Permissions::from_mode(0o700);
    std::fs::set_permissions(path, permissions).map_err(|source| {
        WorkerError::SetPrivatePermissions {
            path: path.clone(),
            source,
        }
    })
}

#[cfg(not(unix))]
fn set_private_dir_permissions(_path: &PathBuf) -> Result<(), WorkerError> {
    Ok(())
}

#[cfg(unix)]
fn set_private_file_permissions(path: &PathBuf) -> Result<(), WorkerError> {
    use std::os::unix::fs::PermissionsExt;

    let permissions = std::fs::Permissions::from_mode(0o600);
    std::fs::set_permissions(path, permissions).map_err(|source| {
        WorkerError::SetPrivatePermissions {
            path: path.clone(),
            source,
        }
    })
}

#[cfg(not(unix))]
fn set_private_file_permissions(_path: &PathBuf) -> Result<(), WorkerError> {
    Ok(())
}
