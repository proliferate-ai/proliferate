use super::WorkerStore;
use crate::error::WorkerError;

impl WorkerStore {
    pub(super) fn migrate(&self) -> Result<(), WorkerError> {
        let conn = self.connection()?;
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS identity (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                worker_id TEXT NOT NULL,
                worker_token TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            -- Single-row state for the in-place AnyHarness runtime binary swap.
            -- `converged_version` is the pin the worker last swapped the runtime
            -- onto and health-verified (the source of truth for what runs after
            -- a swap, since the worker's boot-time env is fixed). `failed_pin`
            -- is the pin that last failed preflight/swap/health, skipped until a
            -- newer pin supersedes it so a lagging artifact never crash-loops.
            CREATE TABLE IF NOT EXISTS anyharness_update (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                converged_version TEXT,
                failed_pin TEXT,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            "#,
        )?;
        Ok(())
    }
}
