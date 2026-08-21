//! One harness slot's LIVE state: what a polling surface is told about an attempt
//! that has been admitted but has not yet finished.
//!
//! Split out of the engine because it is no longer a field and two setters. Pokes
//! are admitted BEFORE they queue on the single-flight gate, so several admitted
//! attempts can hold one slot at the same time, and the rules for what the slot
//! reports while that is true — and for who may take it back to `Idle` — are the
//! whole content of this file.

use std::sync::Arc;

use chrono::{DateTime, Utc};

use super::HarnessSlot;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum LiveState {
    Idle,
    Queued,
    Running,
}

/// The engine's live, in-memory view of one harness.
///
/// Not persisted, deliberately: a restart costs at most one extra attempt, the
/// same tradeoff the spec already accepts for the Worker's upload state. Persisting
/// backoff would mean a machine could boot already-throttled with no way for a user
/// to tell why.
#[derive(Debug)]
pub(super) struct HarnessRuntimeState {
    /// What a polling surface is told. `Queued` is set the moment an attempt is
    /// admitted — BEFORE it waits on the single-flight gate and the machine-wide
    /// semaphore — so a probe that is genuinely pending never reports `idle`. At
    /// `max_concurrent_probes = 1` that wait is the common case, not an edge one.
    pub(super) live: LiveState,
    /// How many admitted attempts hold this slot right now. Admission happens
    /// before the gate, so the losers of a coalesce are admitted too, and the slot
    /// may only fall back to `Idle` when the LAST of them lets go.
    admitted: u32,
    pub(super) consecutive_failures: u32,
    pub(super) next_attempt_at: Option<DateTime<Utc>>,
    pub(super) last_attempt_at: Option<DateTime<Utc>>,
}

impl Default for HarnessRuntimeState {
    fn default() -> Self {
        Self {
            live: LiveState::Idle,
            admitted: 0,
            consecutive_failures: 0,
            next_attempt_at: None,
            last_attempt_at: None,
        }
    }
}

/// RAII guard over one [`HarnessSlot`]'s live state, for the lifetime of a single
/// attempt (F-036).
///
/// Before this guard, the engine set `Queued`/`Running`/`Idle` as three bare
/// statements straddling await points (the single-flight gate, the machine-wide
/// semaphore, and the probe itself). Dropping the caller's future anywhere between
/// the first write and the last — a client that disconnects mid `refresh_now`, a
/// task that gets aborted — skipped the final `Idle` write and left the slot pinned
/// at `Queued` or `Running` forever, because the in-flight check treats both as
/// in-flight and refuses every subsequent poke for that harness. A wedge like that
/// is invisible from the status surface too: it reads a plausible
/// `queued`/`running` forever.
///
/// The fix mirrors two guards this module already has: `ProbeScratch` removes its
/// scratch root on `Drop`, and the `CancellationToken` guard in `probe.rs` fires
/// cancellation on `Drop`. Both make their piece of attempt state correct by
/// construction, covering return, `?`, panic and future-drop alike.
pub(super) struct LiveStateGuard {
    slot: Arc<HarnessSlot>,
    /// Did THIS guard take the slot into `Running`? Only the guard that did may
    /// take it back out, so a coalesce loser letting go cannot demote the winner.
    running: bool,
}

impl LiveStateGuard {
    /// Admits the attempt: `Queued` immediately, BEFORE the single-flight gate and
    /// the machine-wide semaphore, so a probe that is genuinely pending never
    /// reports `idle`. An admission never overwrites a `Running` set by an earlier
    /// admitted attempt — it only joins the queue behind it.
    pub(super) fn admit(slot: Arc<HarnessSlot>) -> Self {
        {
            let mut state = slot.state.lock().expect("launch probe slot poisoned");
            state.admitted = state.admitted.saturating_add(1);
            if matches!(state.live, LiveState::Idle) {
                state.live = LiveState::Queued;
            }
        }
        Self {
            slot,
            running: false,
        }
    }

    /// The attempt cleared both concurrency waits and is now inside the probe
    /// itself.
    pub(super) fn running(&mut self) {
        self.running = true;
        self.slot
            .state
            .lock()
            .expect("launch probe slot poisoned")
            .live = LiveState::Running;
    }
}

impl Drop for LiveStateGuard {
    fn drop(&mut self) {
        // Every exit lands here: a return, an early `?`, a panic unwinding through
        // the frame, or — the case F-036 proved reachable — the whole future being
        // dropped without any of the attempt's own code running again. Since
        // admission moved ahead of the gate, that now includes a poke abandoned
        // while it waits its turn, which must not report the running winner idle.
        let mut state = self.slot.state.lock().expect("launch probe slot poisoned");
        state.admitted = state.admitted.saturating_sub(1);
        state.live = if state.admitted == 0 {
            LiveState::Idle
        } else if self.running {
            // Attempts still admitted behind this one are waiting on the gate.
            LiveState::Queued
        } else {
            state.live
        };
    }
}
