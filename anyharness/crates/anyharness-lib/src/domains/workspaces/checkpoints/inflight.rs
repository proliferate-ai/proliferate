//! The process-local in-flight revert registry: which checkpoint ids a revert
//! operation is actively reverting to RIGHT NOW.
//!
//! The retention duty consults it to answer one question — "is a revert relying
//! on this checkpoint's bytes?" — without touching the filesystem or the row.
//! A checkpoint claimed here is never culled, even if it falls past the N-cut or
//! the age cap, because a revert-in-progress that lost its target mid-flight
//! would be unrecoverable. No revert exists in this PR, so nothing claims an id
//! yet; the registry ships now (with the retention exemption that reads it) so
//! the later revert PR only has to claim, and a unit test exercises the
//! exemption by claiming an id directly.
//!
//! The map dies with the process, which is correct: a crashed revert leaves no
//! claim to clear, and the retention duty simply sees the id as unclaimed on the
//! next tick.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Default)]
struct InFlightState {
    /// Checkpoint id → number of live reverts relying on it.
    ids: HashMap<String, usize>,
}

#[derive(Clone, Default)]
pub struct InFlightReverts {
    state: Arc<Mutex<InFlightState>>,
}

/// Drop-guarded claim. Every early return, `?`, and panic in a revert releases
/// it, so a revert that fails halfway never wedges a checkpoint out of
/// retention forever.
pub struct InFlightRevertGuard {
    state: Arc<Mutex<InFlightState>>,
    checkpoint_id: String,
}

impl Drop for InFlightRevertGuard {
    fn drop(&mut self) {
        let mut state = self.state.lock().expect("checkpoint in-flight map poisoned");
        if let Some(count) = state.ids.get_mut(&self.checkpoint_id) {
            *count = count.saturating_sub(1);
            if *count == 0 {
                state.ids.remove(&self.checkpoint_id);
            }
        }
    }
}

impl InFlightReverts {
    /// Claim `checkpoint_id` for an in-flight revert. Re-entrant: a second claim
    /// of the same id increments the count.
    pub fn claim(&self, checkpoint_id: &str) -> InFlightRevertGuard {
        let mut state = self.state.lock().expect("checkpoint in-flight map poisoned");
        *state.ids.entry(checkpoint_id.to_string()).or_insert(0) += 1;
        InFlightRevertGuard {
            state: self.state.clone(),
            checkpoint_id: checkpoint_id.to_string(),
        }
    }

    /// Is any revert currently relying on this checkpoint? Retention's exemption
    /// question.
    pub fn is_claimed(&self, checkpoint_id: &str) -> bool {
        self.state
            .lock()
            .expect("checkpoint in-flight map poisoned")
            .ids
            .contains_key(checkpoint_id)
    }
}

#[cfg(test)]
mod tests {
    use super::InFlightReverts;

    #[test]
    fn a_claimed_id_reads_claimed_until_the_guard_drops() {
        let map = InFlightReverts::default();
        assert!(!map.is_claimed("cp-1"));
        let guard = map.claim("cp-1");
        assert!(map.is_claimed("cp-1"));
        drop(guard);
        assert!(!map.is_claimed("cp-1"));
    }

    #[test]
    fn nested_claims_of_one_id_release_independently() {
        let map = InFlightReverts::default();
        let outer = map.claim("cp-1");
        let inner = map.claim("cp-1");
        drop(inner);
        assert!(map.is_claimed("cp-1"), "the outer claim still holds it");
        drop(outer);
        assert!(!map.is_claimed("cp-1"));
    }
}
