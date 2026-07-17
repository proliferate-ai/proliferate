//! In-process per-operation-id serialization for materialization.
//!
//! The idempotency ledger alone cannot distinguish a *live* `running` row (an
//! in-flight concurrent caller in this process) from a *crashed* one (a process
//! that died mid-operation and left the row behind). A live row must not
//! double-execute the operation; a crashed row must still be adoptable on
//! retry.
//!
//! This gate is the in-process discriminator and the convergence point: a
//! running operation holds a per-id lock for the duration of its
//! filesystem/registration work. A concurrent caller issuing the SAME
//! operation id (and, upstream, the SAME normalized request) does not fail with
//! a conflict — it *waits* on the same lock and, once the holder finishes,
//! re-reads the ledger and replays the completed result. Identical concurrent
//! callers therefore CONVERGE to one execution (PR3-CONVERGENCE-01). A caller
//! with the same id but a DIFFERENT normalized request is still rejected as a
//! conflict by the ledger's request-hash check (in `admit_existing`), before or
//! after the wait. After a crash the map holds no live guard for the id, so a
//! retry acquires cleanly and the ledger's crash-recovery (`Running -> Retry`)
//! adoption path runs. Mirrors the `WorkspaceOperationGate` keyed-lock pattern
//! used elsewhere in the crate.
//!
//! The wait is bounded by the holder's operation and takes no other lock, so it
//! cannot deadlock a caller that holds unrelated locks: acquiring this keyed
//! lock and then re-reading the ledger row is the whole protocol. Because the
//! lock is held across the (possibly slow) clone, it is a `tokio` async mutex —
//! a waiter yields its executor thread rather than blocking it.
//!
//! Cross-process (PR3-CONCURRENCY-01): the anyharness runtime is a single
//! process that owns its SQLite ledger (one `Arc<Mutex<Connection>>`), so an
//! in-process lock is authoritative for all concurrent callers of one runtime —
//! there is no second process racing the same ledger. Should that ever change,
//! the fallback gate is an `updated_at` staleness threshold on the running row
//! (adopt only rows older than the threshold); the ledger already stamps
//! `updated_at` on every transition to support it.
//!
//! Map growth: like the crate's other keyed gates (`WorkspaceOperationGate`),
//! per-id lock entries are retained for the process lifetime rather than
//! reference-counted for removal. Materialization operation ids are bounded by
//! the repositories/workspaces a session acquires, so retention is negligible
//! and keeps acquisition free of drop-time map races.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard};

/// Tracks the per-operation-id locks live in this process. Cloneable and shared
/// (held in `AppState`); a single instance backs all callers.
#[derive(Clone, Default)]
pub(crate) struct MaterializationOperationLocks {
    keys: Arc<Mutex<HashMap<String, Arc<AsyncMutex<()>>>>>,
}

impl MaterializationOperationLocks {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    /// Acquire the lock for `operation_id`, waiting if another live in-process
    /// caller currently holds it. Returns a guard that releases the claim on
    /// drop. Identical concurrent callers converge here: the waiter proceeds
    /// once the holder finishes and then re-reads the ledger to replay the
    /// completed result.
    pub(crate) async fn acquire(&self, operation_id: &str) -> MaterializationOperationGuard {
        // Look up (or create) the per-id mutex under the map lock, then release
        // the map lock BEFORE awaiting the per-id lock so distinct ids never
        // serialize on each other.
        let per_id = {
            let mut keys = self.keys.lock().expect("materialization locks poisoned");
            keys.entry(operation_id.to_string())
                .or_insert_with(|| Arc::new(AsyncMutex::new(())))
                .clone()
        };
        let guard = per_id.lock_owned().await;
        MaterializationOperationGuard { _guard: guard }
    }
}

/// Releases an in-process operation-id claim when dropped.
pub(crate) struct MaterializationOperationGuard {
    _guard: OwnedMutexGuard<()>,
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::time::Duration;

    use tokio::time::timeout;

    use super::*;

    #[tokio::test]
    async fn second_acquire_of_same_id_waits_for_holder() {
        let locks = MaterializationOperationLocks::new();
        let first = locks.acquire("op-1").await;

        // A second acquire of the SAME id must not resolve while the first is
        // held — it converges by waiting, rather than failing.
        let waiter_locks = locks.clone();
        let waiter =
            tokio::spawn(async move { waiter_locks.acquire("op-1").await });
        assert!(
            timeout(Duration::from_millis(30), async {
                while !waiter.is_finished() {
                    tokio::task::yield_now().await;
                }
            })
            .await
            .is_err(),
            "same-id acquire must block while the first guard is held"
        );

        // A DIFFERENT id is independent and acquires immediately.
        let _other = timeout(Duration::from_millis(50), locks.acquire("op-2"))
            .await
            .expect("distinct id acquires without waiting");

        // Once the first guard drops, the waiter unblocks.
        drop(first);
        let _second = timeout(Duration::from_secs(1), waiter)
            .await
            .expect("waiter unblocks after release")
            .expect("waiter task completes");
    }

    #[tokio::test]
    async fn guard_is_send_across_await() {
        // The guard is held across the clone (an `.await` boundary in the
        // service), so it must be `Send`.
        fn assert_send<T: Send>(_: &T) {}
        let locks = Arc::new(MaterializationOperationLocks::new());
        let guard = locks.acquire("op-send").await;
        assert_send(&guard);
        drop(guard);
    }
}
