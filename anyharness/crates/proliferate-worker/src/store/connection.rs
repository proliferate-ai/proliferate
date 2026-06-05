use std::{path::PathBuf, time::Duration};

use rusqlite::Connection;

use super::WorkerStore;
use crate::error::WorkerError;

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
