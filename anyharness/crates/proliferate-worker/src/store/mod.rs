use std::path::PathBuf;

use rusqlite::{params, Connection, OptionalExtension};

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
        Ok(Connection::open(&self.path)?)
    }

    fn migrate(&self) -> Result<(), WorkerError> {
        let conn = self.connection()?;
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS identity (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                target_id TEXT NOT NULL,
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
            "#,
        )?;
        Ok(())
    }

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
            INSERT INTO identity (id, target_id, worker_id, worker_token, updated_at)
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
