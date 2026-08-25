//! Persisted AnyHarness converged-version state.
//!
//! The worker's own env (`PROLIFERATE_ANYHARNESS_VERSION`) is fixed at boot
//! and cannot reflect a runtime swap the Supervisor performed afterwards, so
//! the version of the last Supervisor activation the worker reconciled
//! (`supervisor_bridge::mailbox`) survives in the worker's SQLite store. It is
//! the source of truth for what the runtime actually runs — both for the
//! mailbox planning decision and for what the heartbeat reports (R9-006).
//!
//! The `anyharness_update` table keeps its historical name and shape (it also
//! carries the legacy swap's `failed_pin` column, unread since the worker-owned
//! in-place swap was deleted; the schema is applied on real boxes and is not
//! migrated for a dead column).

use rusqlite::{params, OptionalExtension};

use super::WorkerStore;
use crate::error::WorkerError;

impl WorkerStore {
    /// The runtime version the worker last recorded as converged (a
    /// Supervisor activation it reconciled), if any. `None` means no
    /// activation has been reconciled on this box yet.
    pub fn anyharness_converged_version(&self) -> Result<Option<String>, WorkerError> {
        let conn = self.connection()?;
        let value = conn
            .query_row(
                "SELECT converged_version FROM anyharness_update WHERE id = 1",
                [],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()?;
        Ok(value.flatten())
    }

    /// Record a converged activation: the runtime now runs `version`.
    pub fn record_anyharness_converged(&self, version: &str) -> Result<(), WorkerError> {
        let conn = self.connection()?;
        conn.execute(
            r#"
            INSERT INTO anyharness_update (id, converged_version, failed_pin, updated_at)
            VALUES (1, ?1, NULL, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET
                converged_version = excluded.converged_version,
                failed_pin = NULL,
                updated_at = CURRENT_TIMESTAMP
            "#,
            params![version],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    use crate::store::WorkerStore;

    /// Removes its directory on drop so each test gets a fresh, isolated store
    /// without pulling in a temp-dir crate.
    struct TempDir(PathBuf);

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    fn temp_store() -> (WorkerStore, TempDir) {
        let unique = format!(
            "proliferate-worker-anyharness-update-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        );
        let dir = std::env::temp_dir().join(unique);
        std::fs::create_dir_all(&dir).expect("create temp dir");
        let store = WorkerStore::open(dir.join("worker.sqlite3")).expect("open store");
        (store, TempDir(dir))
    }

    #[test]
    fn converged_defaults_to_none() {
        let (store, _dir) = temp_store();
        assert_eq!(store.anyharness_converged_version().unwrap(), None);
    }

    #[test]
    fn recording_converged_sets_and_overwrites_the_version() {
        let (store, _dir) = temp_store();
        store.record_anyharness_converged("0.6.0").unwrap();
        assert_eq!(
            store.anyharness_converged_version().unwrap().as_deref(),
            Some("0.6.0")
        );
        store.record_anyharness_converged("0.7.0").unwrap();
        assert_eq!(
            store.anyharness_converged_version().unwrap().as_deref(),
            Some("0.7.0")
        );
    }
}
