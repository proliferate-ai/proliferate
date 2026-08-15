use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use rusqlite::{Connection, InterruptHandle};

use super::migrations;

#[derive(Clone)]
pub struct Db {
    conn: Arc<Mutex<Connection>>,
    execution_store_id: Arc<str>,
    interruptible_queries: Arc<InterruptibleQueryState>,
}

struct InterruptibleQueryState {
    next_generation: AtomicU64,
    active: Mutex<Option<ActiveInterruptibleQuery>>,
}

struct ActiveInterruptibleQuery {
    generation: u64,
    interrupt_handle: Arc<InterruptHandle>,
}

#[derive(Clone)]
pub(crate) struct InterruptibleQuery {
    inner: Arc<InterruptibleQueryInner>,
}

struct InterruptibleQueryInner {
    owner: Arc<InterruptibleQueryState>,
    generation: u64,
    cancelled: AtomicBool,
}

pub(crate) struct CancelInterruptibleQueryOnDrop {
    query: InterruptibleQuery,
    armed: bool,
}

#[derive(Debug, thiserror::Error)]
#[error("interruptible SQLite query cancelled")]
pub(crate) struct InterruptibleQueryCancelled;

struct ActiveQueryRegistration<'a> {
    state: &'a InterruptibleQueryState,
    generation: u64,
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
            interruptible_queries: Arc::new(InterruptibleQueryState::new()),
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
            interruptible_queries: Arc::new(InterruptibleQueryState::new()),
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

    /// Run one cancellation-scoped SQLite operation while retaining exclusive
    /// ownership of the shared connection until its interrupt registration is
    /// cleared. The callback never receives the interrupt handle or connection
    /// mutex, so a cancellation generation cannot escape into another DB user.
    pub(crate) fn with_interruptible_conn<F, T>(
        &self,
        query: &InterruptibleQuery,
        f: F,
    ) -> anyhow::Result<T>
    where
        F: FnOnce(&Connection) -> anyhow::Result<T>,
    {
        if !Arc::ptr_eq(&self.interruptible_queries, &query.inner.owner) {
            anyhow::bail!("interruptible query belongs to a different database");
        }
        query.check_cancelled()?;
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("db lock poisoned: {e}"))?;
        let registration = ActiveQueryRegistration::register(
            &query.inner.owner,
            query.inner.generation,
            Arc::new(conn.get_interrupt_handle()),
            &query.inner.cancelled,
        )?;
        query.check_cancelled()?;
        let result = f(&conn);
        drop(registration);
        drop(conn);
        result
    }

    pub(crate) fn begin_interruptible_query(
        &self,
    ) -> (InterruptibleQuery, CancelInterruptibleQueryOnDrop) {
        let generation = self.interruptible_queries.next_generation();
        let query = InterruptibleQuery {
            inner: Arc::new(InterruptibleQueryInner {
                owner: Arc::clone(&self.interruptible_queries),
                generation,
                cancelled: AtomicBool::new(false),
            }),
        };
        let guard = CancelInterruptibleQueryOnDrop {
            query: query.clone(),
            armed: true,
        };
        (query, guard)
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

impl InterruptibleQueryState {
    fn new() -> Self {
        Self {
            next_generation: AtomicU64::new(0),
            active: Mutex::new(None),
        }
    }

    fn next_generation(&self) -> u64 {
        loop {
            let generation = self
                .next_generation
                .fetch_add(1, Ordering::Relaxed)
                .wrapping_add(1);
            if generation != 0 {
                return generation;
            }
        }
    }

    fn lock_active(&self) -> MutexGuard<'_, Option<ActiveInterruptibleQuery>> {
        self.active
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

impl InterruptibleQuery {
    pub(crate) fn check_cancelled(&self) -> anyhow::Result<()> {
        if self.inner.cancelled.load(Ordering::Acquire) {
            return Err(InterruptibleQueryCancelled.into());
        }
        Ok(())
    }

    pub(crate) fn cancel(&self) {
        self.inner.cancelled.store(true, Ordering::Release);
        let active = self.inner.owner.lock_active();
        let Some(active) = active
            .as_ref()
            .filter(|active| active.generation == self.inner.generation)
        else {
            return;
        };
        let handle = Arc::clone(&active.interrupt_handle);
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| handle.interrupt()));
    }
}

impl CancelInterruptibleQueryOnDrop {
    pub(crate) fn disarm(mut self) {
        self.armed = false;
    }
}

impl Drop for CancelInterruptibleQueryOnDrop {
    fn drop(&mut self) {
        if self.armed {
            self.query.cancel();
        }
    }
}

impl<'a> ActiveQueryRegistration<'a> {
    fn register(
        state: &'a InterruptibleQueryState,
        generation: u64,
        interrupt_handle: Arc<InterruptHandle>,
        cancelled: &AtomicBool,
    ) -> anyhow::Result<Self> {
        let mut active = state.lock_active();
        if cancelled.load(Ordering::Acquire) {
            return Err(InterruptibleQueryCancelled.into());
        }
        *active = Some(ActiveInterruptibleQuery {
            generation,
            interrupt_handle,
        });
        Ok(Self { state, generation })
    }
}

impl Drop for ActiveQueryRegistration<'_> {
    fn drop(&mut self) {
        let mut active = self.state.lock_active();
        if active
            .as_ref()
            .is_some_and(|active| active.generation == self.generation)
        {
            *active = None;
        }
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
    use std::sync::mpsc;
    use std::thread;
    use std::time::{Duration, Instant};

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

    #[test]
    fn interruptible_query_cancellation_does_not_poison_the_next_db_user() {
        let db = Db::open_in_memory().expect("open database");
        let (query, guard) = db.begin_interruptible_query();
        let worker_db = db.clone();
        let worker_query = query.clone();
        let (started_tx, started_rx) = mpsc::channel();
        let (finished_tx, finished_rx) = mpsc::channel();
        let worker = thread::spawn(move || {
            let result = worker_db.with_interruptible_conn(&worker_query, |conn| {
                started_tx.send(()).expect("announce registered query");
                conn.query_row(
                    "WITH RECURSIVE counter(value) AS (\
                     VALUES(0) UNION ALL SELECT value + 1 FROM counter WHERE value < 1000000000\
                     ) SELECT sum(value) FROM counter",
                    [],
                    |_| Ok(()),
                )?;
                Ok(())
            });
            finished_tx.send(()).expect("announce finished query");
            result
        });

        started_rx.recv().expect("query should register");
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            query.cancel();
            let remaining = deadline.saturating_duration_since(Instant::now());
            assert!(!remaining.is_zero(), "cancelled query should stop promptly");
            match finished_rx.recv_timeout(remaining.min(Duration::from_millis(10))) {
                Ok(()) => break,
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(error) => panic!("cancelled query completion channel failed: {error}"),
            }
        }
        assert!(worker.join().expect("join query thread").is_err());
        guard.disarm();
        let answer: i64 = db
            .with_conn(|conn| conn.query_row("SELECT 42", [], |row| row.get(0)))
            .expect("next DB user should succeed");
        assert_eq!(answer, 42);
    }

    #[test]
    fn late_interruptible_query_cancellation_cannot_reach_the_next_db_user() {
        let db = Db::open_in_memory().expect("open database");
        let (query, guard) = db.begin_interruptible_query();
        db.with_interruptible_conn(&query, |conn| {
            conn.query_row("SELECT 1", [], |_| Ok(()))?;
            Ok(())
        })
        .expect("finish bounded query");

        query.cancel();
        guard.disarm();
        let answer: i64 = db
            .with_conn(|conn| conn.query_row("SELECT 7", [], |row| row.get(0)))
            .expect("late cancellation must not affect next user");
        assert_eq!(answer, 7);
    }
}
