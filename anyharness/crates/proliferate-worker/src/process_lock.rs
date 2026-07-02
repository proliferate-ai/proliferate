use std::{
    fs::{File, OpenOptions},
    io,
    path::{Path, PathBuf},
};

use fs2::FileExt;

use crate::error::WorkerError;

pub struct WorkerProcessLock {
    file: File,
}

impl WorkerProcessLock {
    pub fn acquire(worker_db_path: &Path) -> Result<Self, WorkerError> {
        let lock_path = worker_lock_path(worker_db_path);
        if let Some(parent) = lock_path.parent() {
            std::fs::create_dir_all(parent).map_err(|source| WorkerError::CreateParent {
                path: parent.to_path_buf(),
                source,
            })?;
        }
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&lock_path)
            .map_err(|source| WorkerError::AcquireProcessLock {
                path: lock_path.clone(),
                source,
            })?;
        match file.try_lock_exclusive() {
            Ok(()) => Ok(Self { file }),
            Err(source) if source.kind() == io::ErrorKind::WouldBlock => {
                Err(WorkerError::AlreadyRunning { path: lock_path })
            }
            Err(source) => Err(WorkerError::AcquireProcessLock {
                path: lock_path,
                source,
            }),
        }
    }
}

impl Drop for WorkerProcessLock {
    fn drop(&mut self) {
        let _ = self.file.unlock();
    }
}

pub fn worker_lock_path(worker_db_path: &Path) -> PathBuf {
    let database_path = canonical_database_path(worker_db_path);
    let extension = database_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!("{value}.lock"))
        .unwrap_or_else(|| "lock".to_string());
    database_path.with_extension(extension)
}

fn canonical_database_path(worker_db_path: &Path) -> PathBuf {
    if let Ok(path) = worker_db_path.canonicalize() {
        return path;
    }
    let Some(parent) = worker_db_path.parent() else {
        return worker_db_path.to_path_buf();
    };
    let Ok(parent) = parent.canonicalize() else {
        return worker_db_path.to_path_buf();
    };
    match worker_db_path.file_name() {
        Some(file_name) => parent.join(file_name),
        None => worker_db_path.to_path_buf(),
    }
}
