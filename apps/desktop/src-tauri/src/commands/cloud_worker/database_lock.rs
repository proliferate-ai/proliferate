use std::{
    fs::OpenOptions,
    io,
    path::{Path, PathBuf},
};

use fs2::FileExt;

pub(super) const WORKER_CREDENTIALS_LOCKED_ERROR: &str =
    "Cannot replace worker credentials while a Proliferate Worker is still running.";

pub(super) struct WorkerDatabaseLock {
    file: std::fs::File,
}

impl Drop for WorkerDatabaseLock {
    fn drop(&mut self) {
        let _ = self.file.unlock();
    }
}

pub(super) fn worker_identity_exists(path: &Path) -> Result<bool, String> {
    Ok(read_worker_identity_id(path)?.is_some())
}

fn read_worker_identity_id(path: &Path) -> Result<Option<String>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let connection = match rusqlite::Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    ) {
        Ok(connection) => connection,
        Err(error) if matches!(error, rusqlite::Error::SqliteFailure(_, _)) => return Ok(None),
        Err(error) => {
            return Err(format!(
                "Failed to inspect worker identity at {}: {error}",
                path.display()
            ));
        }
    };
    match connection.query_row(
        "SELECT worker_id FROM identity WHERE id = 1 AND worker_id <> '' AND worker_token <> ''",
        [],
        |row| row.get::<_, String>(0),
    ) {
        Ok(worker_id) => Ok(Some(worker_id)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(rusqlite::Error::SqliteFailure(error, _))
            if error.code == rusqlite::ErrorCode::Unknown =>
        {
            Ok(None)
        }
        Err(error) => Err(format!(
            "Failed to inspect worker identity at {}: {error}",
            path.display()
        )),
    }
}

pub(super) fn worker_database_lock_is_held(database_path: &Path) -> Result<bool, String> {
    match acquire_worker_database_lock(database_path) {
        Ok(_lock) => Ok(false),
        Err(error) if error == WORKER_CREDENTIALS_LOCKED_ERROR => Ok(true),
        Err(error) => Err(error),
    }
}

// Ticket issuance can prove that an enrolled lock holder is still the exact
// active identity for this user, organization, and Desktop install.
pub(super) fn lock_for_fresh_enrollment(
    database_path: &Path,
    reusable_worker_id: Option<&str>,
) -> Result<Option<WorkerDatabaseLock>, String> {
    match acquire_worker_database_lock(database_path) {
        Ok(lock) => Ok(Some(lock)),
        Err(error) if error == WORKER_CREDENTIALS_LOCKED_ERROR => {
            let persisted_worker_id = read_worker_identity_id(database_path)?;
            if reusable_worker_id == persisted_worker_id.as_deref() && reusable_worker_id.is_some()
            {
                Ok(None)
            } else {
                Err(error)
            }
        }
        Err(error) => Err(error),
    }
}

pub(super) fn acquire_worker_database_lock(
    database_path: &Path,
) -> Result<WorkerDatabaseLock, String> {
    let lock_path = worker_lock_path(database_path);
    if let Some(parent) = lock_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;
    }
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .open(&lock_path)
        .map_err(|error| {
            format!(
                "Failed to inspect worker lock at {}: {error}",
                lock_path.display()
            )
        })?;
    match file.try_lock_exclusive() {
        Ok(()) => Ok(WorkerDatabaseLock { file }),
        Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
            Err(WORKER_CREDENTIALS_LOCKED_ERROR.to_string())
        }
        Err(error) => Err(format!(
            "Failed to inspect worker lock at {}: {error}",
            lock_path.display()
        )),
    }
}

fn worker_lock_path(database_path: &Path) -> PathBuf {
    let database_path = canonical_database_path(database_path);
    let extension = database_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!("{value}.lock"))
        .unwrap_or_else(|| "lock".to_string());
    database_path.with_extension(extension)
}

fn canonical_database_path(database_path: &Path) -> PathBuf {
    if let Ok(path) = database_path.canonicalize() {
        return path;
    }
    let Some(parent) = database_path.parent() else {
        return database_path.to_path_buf();
    };
    let Ok(parent) = parent.canonicalize() else {
        return database_path.to_path_buf();
    };
    match database_path.file_name() {
        Some(file_name) => parent.join(file_name),
        None => database_path.to_path_buf(),
    }
}
