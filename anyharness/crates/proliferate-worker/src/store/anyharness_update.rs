//! Persisted state for the in-place AnyHarness runtime binary swap.
//!
//! Unlike the worker's own self-update — whose attempt marker rides an env var
//! across `exec` — the AnyHarness swap keeps the worker process alive, so its
//! state must survive in the worker's SQLite store instead. Two facts are
//! tracked in a single row:
//!
//! - `converged_version`: the pin the worker last swapped the runtime onto and
//!   health-verified. The worker's own env (`PROLIFERATE_ANYHARNESS_VERSION`)
//!   is fixed at boot and cannot reflect an in-process swap, so this is the
//!   source of truth for what the runtime actually runs afterward — both for
//!   the convergence decision and for what the heartbeat reports.
//! - `failed_pin`: the pin that last failed preflight, swap, or the
//!   post-relaunch health gate. `plan` skips it until a *newer* pin supersedes
//!   it, so a lagging published artifact self-heals on publish and a bad swap
//!   never crash-loops the box.

use rusqlite::{params, OptionalExtension};

use super::WorkerStore;
use crate::error::WorkerError;

impl WorkerStore {
    /// The runtime version the worker last swapped onto and health-verified,
    /// if any. `None` means no swap has succeeded on this box yet.
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

    /// The pin that last failed a swap attempt, if any.
    pub fn anyharness_failed_pin(&self) -> Result<Option<String>, WorkerError> {
        let conn = self.connection()?;
        let value = conn
            .query_row(
                "SELECT failed_pin FROM anyharness_update WHERE id = 1",
                [],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()?;
        Ok(value.flatten())
    }

    /// Record a successful swap: the runtime now runs `version`. Clears any
    /// prior failure marker (a healthy swap supersedes it).
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

    /// Record a failed swap attempt for `pin`, preserving the currently
    /// converged version (the old runnable binary keeps serving).
    pub fn record_anyharness_failed(&self, pin: &str) -> Result<(), WorkerError> {
        let conn = self.connection()?;
        conn.execute(
            r#"
            INSERT INTO anyharness_update (id, converged_version, failed_pin, updated_at)
            VALUES (1, NULL, ?1, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET
                failed_pin = excluded.failed_pin,
                updated_at = CURRENT_TIMESTAMP
            "#,
            params![pin],
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
    fn converged_and_failed_default_to_none() {
        let (store, _dir) = temp_store();
        assert_eq!(store.anyharness_converged_version().unwrap(), None);
        assert_eq!(store.anyharness_failed_pin().unwrap(), None);
    }

    #[test]
    fn recording_converged_sets_version_and_clears_failure() {
        let (store, _dir) = temp_store();
        store.record_anyharness_failed("0.5.0").unwrap();
        assert_eq!(
            store.anyharness_failed_pin().unwrap().as_deref(),
            Some("0.5.0")
        );

        store.record_anyharness_converged("0.6.0").unwrap();
        assert_eq!(
            store.anyharness_converged_version().unwrap().as_deref(),
            Some("0.6.0")
        );
        // A healthy swap supersedes any earlier failure.
        assert_eq!(store.anyharness_failed_pin().unwrap(), None);
    }

    #[test]
    fn recording_failure_preserves_converged_version() {
        let (store, _dir) = temp_store();
        store.record_anyharness_converged("0.6.0").unwrap();
        store.record_anyharness_failed("0.7.0").unwrap();
        // The old runnable binary keeps serving; only the failed pin is noted.
        assert_eq!(
            store.anyharness_converged_version().unwrap().as_deref(),
            Some("0.6.0")
        );
        assert_eq!(
            store.anyharness_failed_pin().unwrap().as_deref(),
            Some("0.7.0")
        );
    }
}
