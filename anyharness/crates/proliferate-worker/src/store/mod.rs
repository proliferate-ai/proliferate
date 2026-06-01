use std::{collections::HashSet, path::PathBuf, time::Duration};

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

use crate::{error::WorkerError, identity::credentials::WorkerIdentity};

mod exposures;
mod projection_cursors;

pub use exposures::WorkerExposureSnapshot;
pub use projection_cursors::{ProjectionCursor, ProjectionCursorUpsert};

pub struct WorkerStore {
    path: PathBuf,
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

    pub(super) fn connection(&self) -> Result<Connection, WorkerError> {
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
                session_projection_id TEXT PRIMARY KEY,
                exposure_id TEXT NOT NULL,
                anyharness_workspace_id TEXT NOT NULL,
                anyharness_session_id TEXT NOT NULL,
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
            CREATE TABLE IF NOT EXISTS worker_workspace_discovery (
                exposure_id TEXT PRIMARY KEY,
                anyharness_workspace_id TEXT NOT NULL,
                last_checked_unix_ms INTEGER NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS worker_exposure_snapshot (
                snapshot_key TEXT PRIMARY KEY,
                exposure_id TEXT NOT NULL,
                target_id TEXT NOT NULL,
                cloud_workspace_id TEXT NOT NULL,
                session_projection_id TEXT,
                anyharness_workspace_id TEXT NOT NULL,
                anyharness_session_id TEXT,
                projection_level TEXT NOT NULL,
                commandable INTEGER NOT NULL CHECK (commandable IN (0, 1)),
                status TEXT NOT NULL,
                revision INTEGER,
                last_uploaded_seq INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS ix_worker_exposure_snapshot_workspace
                ON worker_exposure_snapshot(status, anyharness_workspace_id);
            CREATE TABLE IF NOT EXISTS worker_control_state (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                control_cursor TEXT,
                exposure_cache_initialized INTEGER NOT NULL DEFAULT 0
                    CHECK (exposure_cache_initialized IN (0, 1)),
                legacy_exposure_polling_enabled INTEGER NOT NULL DEFAULT 0
                    CHECK (legacy_exposure_polling_enabled IN (0, 1)),
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
        ensure_projection_cursor_keyed_by_projection(&conn)?;
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

fn ensure_projection_cursor_keyed_by_projection(conn: &Connection) -> Result<(), WorkerError> {
    let mut stmt = conn.prepare("PRAGMA table_info(worker_projection_cursor)")?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(1)?, row.get::<_, i64>(5)?))
    })?;
    let mut primary_key_column = None;
    for row in rows {
        let (name, primary_key_order) = row?;
        if primary_key_order > 0 {
            primary_key_column = Some(name);
            break;
        }
    }
    if primary_key_column.as_deref() == Some("session_projection_id") {
        return Ok(());
    }
    conn.execute("DROP TABLE IF EXISTS worker_projection_cursor", [])?;
    conn.execute(
        r#"
        CREATE TABLE worker_projection_cursor (
            session_projection_id TEXT PRIMARY KEY,
            exposure_id TEXT NOT NULL,
            anyharness_workspace_id TEXT NOT NULL,
            anyharness_session_id TEXT NOT NULL,
            projection_level TEXT NOT NULL,
            commandable INTEGER NOT NULL CHECK (commandable IN (0, 1)),
            last_uploaded_seq INTEGER NOT NULL DEFAULT 0,
            last_ack_seq INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'active',
            gap_state_json TEXT,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        "#,
        [],
    )?;
    conn.execute(
        r#"
        CREATE INDEX IF NOT EXISTS ix_worker_projection_cursor_active_session
            ON worker_projection_cursor(status, anyharness_session_id)
        "#,
        [],
    )?;
    Ok(())
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
