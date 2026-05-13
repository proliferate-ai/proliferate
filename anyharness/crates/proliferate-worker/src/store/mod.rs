pub mod commands;
pub mod cursors;
pub mod identity;
pub mod inventory;
pub mod migrations;
pub mod outbox;
pub mod schema;
pub mod updates;

use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};

use chrono::Utc;
use rusqlite::Connection;

use crate::error::{Result, WorkerError};

#[derive(Clone)]
pub struct Store {
    conn: Arc<Mutex<Connection>>,
}

impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }

        let conn = Connection::open(path)?;
        migrations::run(&conn)?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    pub(crate) fn with_conn<T>(
        &self,
        f: impl FnOnce(&Connection) -> rusqlite::Result<T>,
    ) -> Result<T> {
        let conn = self.conn.lock().map_err(|_| WorkerError::StoreLock)?;
        Ok(f(&conn)?)
    }
}

pub(crate) fn now_rfc3339() -> String {
    Utc::now().to_rfc3339()
}
