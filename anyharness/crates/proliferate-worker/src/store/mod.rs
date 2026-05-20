use std::{path::PathBuf, time::Duration};

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

use crate::{error::WorkerError, identity::credentials::WorkerIdentity};

pub struct WorkerStore {
    path: PathBuf,
}

#[derive(Debug, Clone)]
pub struct SyncSession {
    pub session_id: String,
    pub workspace_id: Option<String>,
    pub last_uploaded_seq: i64,
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

    pub fn list_sync_sessions(&self) -> Result<Vec<SyncSession>, WorkerError> {
        let conn = self.connection()?;
        let mut stmt = conn.prepare(
            "SELECT session_id, workspace_id, last_uploaded_seq FROM sync_sessions ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(SyncSession {
                session_id: row.get(0)?,
                workspace_id: row.get(1)?,
                last_uploaded_seq: row.get(2)?,
            })
        })?;
        let mut sessions = Vec::new();
        for row in rows {
            sessions.push(row?);
        }
        Ok(sessions)
    }

    pub fn update_sync_cursor(
        &self,
        session_id: &str,
        last_uploaded_seq: i64,
    ) -> Result<(), WorkerError> {
        let conn = self.connection()?;
        conn.execute(
            r#"
            UPDATE sync_sessions
            SET last_uploaded_seq = MAX(last_uploaded_seq, ?2),
                updated_at = CURRENT_TIMESTAMP
            WHERE session_id = ?1
            "#,
            params![session_id, last_uploaded_seq],
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
