use std::path::Path;
use std::sync::{Arc, Mutex};

use rusqlite::Connection;

use super::migrations;

#[derive(Clone)]
pub struct Db {
    conn: Arc<Mutex<Connection>>,
    execution_store_id: Arc<str>,
}

impl Db {
    pub fn open(runtime_home: &Path) -> anyhow::Result<Self> {
        let db_path = runtime_home.join("db.sqlite");
        let mut conn = Connection::open(&db_path)?;

        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
        migrations::run_migrations(&mut conn)?;
        let execution_store_id = load_or_create_execution_store_id(&conn)?;

        tracing::info!(path = %db_path.display(), "SQLite database ready");

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
            execution_store_id: execution_store_id.into(),
        })
    }

    pub fn open_in_memory() -> anyhow::Result<Self> {
        let mut conn = Connection::open_in_memory()?;
        conn.execute_batch("PRAGMA foreign_keys=ON;")?;
        migrations::run_migrations(&mut conn)?;
        let execution_store_id = load_or_create_execution_store_id(&conn)?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
            execution_store_id: execution_store_id.into(),
        })
    }

    /// Stable, non-secret identity of the authoritative SQLite execution store.
    pub fn execution_store_id(&self) -> &str {
        &self.execution_store_id
    }

    pub fn with_conn<F, T>(&self, f: F) -> anyhow::Result<T>
    where
        F: FnOnce(&Connection) -> rusqlite::Result<T>,
    {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("db lock poisoned: {e}"))?;
        f(&conn).map_err(Into::into)
    }

    pub fn with_tx<F, T>(&self, f: F) -> anyhow::Result<T>
    where
        F: FnOnce(&Connection) -> rusqlite::Result<T>,
    {
        let mut conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("db lock poisoned: {e}"))?;
        let tx = conn.transaction()?;
        let result = f(&tx)?;
        tx.commit()?;
        Ok(result)
    }

    pub fn with_tx_anyhow<F, T>(&self, f: F) -> anyhow::Result<T>
    where
        F: FnOnce(&Connection) -> anyhow::Result<T>,
    {
        let mut conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("db lock poisoned: {e}"))?;
        let tx = conn.transaction()?;
        let result = f(&tx)?;
        tx.commit()?;
        Ok(result)
    }
}

fn load_or_create_execution_store_id(conn: &Connection) -> anyhow::Result<String> {
    conn.execute(
        "INSERT OR IGNORE INTO execution_store_identity (singleton, execution_store_id) \
         VALUES (1, ?1)",
        [uuid::Uuid::new_v4().to_string()],
    )?;
    conn.query_row(
        "SELECT execution_store_id FROM execution_store_identity WHERE singleton = 1",
        [],
        |row| row.get(0),
    )
    .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::Db;

    #[test]
    fn execution_store_id_survives_reopen_and_changes_for_a_fresh_database() {
        let home = std::env::temp_dir().join(format!(
            "anyharness-execution-store-test-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&home).expect("create temp runtime home");
        let first = Db::open(&home).expect("open first database");
        let first_id = first.execution_store_id().to_owned();
        drop(first);

        let reopened = Db::open(&home).expect("reopen database");
        assert_eq!(reopened.execution_store_id(), first_id);

        let fresh_home = std::env::temp_dir().join(format!(
            "anyharness-execution-store-test-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&fresh_home).expect("create fresh runtime home");
        let fresh = Db::open(&fresh_home).expect("open fresh database");
        assert_ne!(fresh.execution_store_id(), first_id);
        drop(reopened);
        drop(fresh);
        fs::remove_dir_all(home).expect("remove temp runtime home");
        fs::remove_dir_all(fresh_home).expect("remove fresh runtime home");
    }
}
