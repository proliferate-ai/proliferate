//! In-process per-operation-id serialization for materialization.
//!
//! The idempotency ledger alone cannot distinguish a *live* `running` row (an
//! in-flight concurrent caller in this process) from a *crashed* one (a process
//! that died mid-operation and left the row behind). A live row must reject a
//! same-id caller with a retryable conflict so the operation never
//! double-executes; a crashed row must still be adoptable on retry.
//!
//! This gate is the in-process discriminator: a running operation holds a guard
//! keyed by its operation id for the duration of its filesystem/registration
//! work. A concurrent same-id caller fails to acquire and is rejected. After a
//! crash the map is empty, so a retry acquires cleanly and the ledger's
//! crash-recovery (`Running -> Retry`) adoption path runs. Mirrors the
//! `WorkspaceOperationGate` keyed-lock pattern used elsewhere in the crate.
//!
//! Cross-process (PR3-CONCURRENCY-01): the anyharness runtime is a single
//! process that owns its SQLite ledger (one `Arc<Mutex<Connection>>`), so an
//! in-process lock is authoritative for all concurrent callers of one runtime —
//! there is no second process racing the same ledger. Should that ever change,
//! the fallback gate is an `updated_at` staleness threshold on the running row
//! (adopt only rows older than the threshold); the ledger already stamps
//! `updated_at` on every transition to support it.

use std::collections::HashSet;
use std::sync::{Arc, Mutex};

/// Tracks the operation ids currently executing in this process. Cloneable and
/// shared (held in `AppState`); a single instance backs all callers.
#[derive(Clone, Default)]
pub(crate) struct MaterializationOperationLocks {
    in_flight: Arc<Mutex<HashSet<String>>>,
}

impl MaterializationOperationLocks {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    /// Try to claim `operation_id` for the current caller. Returns a guard that
    /// releases the claim on drop, or `None` if another live in-process caller
    /// already holds it (the caller should surface a retryable conflict).
    pub(crate) fn try_acquire(&self, operation_id: &str) -> Option<MaterializationOperationGuard> {
        let mut in_flight = self
            .in_flight
            .lock()
            .expect("materialization locks poisoned");
        if !in_flight.insert(operation_id.to_string()) {
            return None;
        }
        Some(MaterializationOperationGuard {
            locks: self.in_flight.clone(),
            operation_id: operation_id.to_string(),
        })
    }
}

/// Releases an in-process operation-id claim when dropped.
pub(crate) struct MaterializationOperationGuard {
    locks: Arc<Mutex<HashSet<String>>>,
    operation_id: String,
}

impl Drop for MaterializationOperationGuard {
    fn drop(&mut self) {
        if let Ok(mut in_flight) = self.locks.lock() {
            in_flight.remove(&self.operation_id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn second_acquire_of_same_id_is_rejected_while_held() {
        let locks = MaterializationOperationLocks::new();
        let first = locks.try_acquire("op-1").expect("first acquire");
        assert!(locks.try_acquire("op-1").is_none());
        // A different id is independent.
        let _other = locks.try_acquire("op-2").expect("distinct id acquires");
        drop(first);
        // Once released, the id is claimable again (e.g. a later retry).
        assert!(locks.try_acquire("op-1").is_some());
    }
}
