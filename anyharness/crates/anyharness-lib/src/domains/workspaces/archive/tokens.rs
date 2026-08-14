//! The phase-2 cancellation map: workspace id → (generation, token, completion
//! handle), plus the four crash-safety rules that make an Undo deterministic.
//!
//! Why a map at all: archive answers 200 at the row flip and lets the rest of
//! the work (the archive script, the worktree removal, the branch delete) run
//! detached. A user who immediately presses Undo must not wait out a 300-second
//! script, and must not be told "something else is in flight" either. So the
//! detached task carries a token, and unarchive fires it and WAITS for the
//! confirmation that the cancelled step's process is dead.
//!
//! Why generations: archive → Undo → re-archive → Undo. Without a generation
//! tag the first task's wind-down would delete the SECOND task's token on its
//! way out, and the second Undo would cancel nothing and stall behind the
//! second script. Removal is therefore a compare-and-remove on the task's own
//! generation.
//!
//! Why the handle resolves only on confirmed process death, not on "the task
//! noticed the token": unarchive restores IN PLACE on the intact tier, and an
//! in-place restore under a still-dying script's writes is a torn restore that
//! can then pass a HEAD-only verify and release the snapshot that would have
//! proved it wrong.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio_util::sync::CancellationToken;

/// How long a caller waits for a fired token to be confirmed dead. One kill
/// escalation window (TERM → 5s grace → KILL) plus margin: a truly wedged task
/// degrades to the honest `WORKSPACE_OPERATION_IN_FLIGHT`, never to a hang.
pub const PHASE2_CANCEL_AWAIT: Duration = Duration::from_secs(10);

struct Phase2Entry {
    generation: u64,
    token: CancellationToken,
    /// Shared with the registration, which is the half that RESOLVES it. The
    /// map only ever hands out subscriptions.
    completion: Arc<tokio::sync::watch::Sender<bool>>,
}

#[derive(Clone, Default)]
pub struct Phase2Tokens {
    entries: Arc<Mutex<HashMap<String, Phase2Entry>>>,
    next_generation: Arc<AtomicU64>,
}

/// A live phase-2 registration. Dropping it resolves the completion handle and
/// compare-and-removes the map entry, which is why a PANICKED phase 2 still
/// releases an awaiting unarchive instead of hanging it. The Drop path is the
/// crash backstop; the normal path drops it too, so there is only one exit.
pub struct Phase2Registration {
    workspace_id: String,
    generation: u64,
    token: CancellationToken,
    /// This registration's OWN completion sender, held here rather than only in
    /// the map so the handle resolves when the task ends — not when something
    /// else happens to evict the map entry.
    completion: Arc<tokio::sync::watch::Sender<bool>>,
    entries: Arc<Mutex<HashMap<String, Phase2Entry>>>,
}

impl Phase2Registration {
    /// The token the task's own steps `select!` against.
    pub fn token(&self) -> CancellationToken {
        self.token.clone()
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    /// Whether cancellation has been requested. Read between steps, so a token
    /// that fired while a step was running still skips the steps that follow.
    pub fn is_cancelled(&self) -> bool {
        self.token.is_cancelled()
    }

    /// Resolve and deregister early — used by the phase-1 error path, where the
    /// flip itself failed after registration and no task will ever run. A
    /// registered-but-never-flipped token left behind would sit unresolvable
    /// and hang a later unarchive's await.
    pub fn release(self) {
        drop(self);
    }
}

impl Drop for Phase2Registration {
    fn drop(&mut self) {
        // Resolution rides the registration's own lifetime, which is the task's:
        // the guard is dropped when the task ends, and the task only ends after
        // its cancelled step has awaited confirmed process death. Resolving from
        // anywhere else — an eviction, a successor's registration — would
        // release an awaiting unarchive under a still-dying script, and an
        // in-place restore under a still-dying script is a torn restore.
        let _ = self.completion.send(true);
        let mut entries = self.entries.lock().expect("phase 2 token map poisoned");
        // Compare-and-remove: a winding-down task must never delete its
        // successor's token.
        if let Some(entry) = entries.get(&self.workspace_id) {
            if entry.generation == self.generation {
                entries.remove(&self.workspace_id);
            }
        }
    }
}

/// An awaitable "the cancelled phase 2 is finished" handle.
pub struct Phase2Completion {
    receiver: Option<tokio::sync::watch::Receiver<bool>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase2CancelOutcome {
    /// Nothing was live, or the task finished and confirmed its process dead.
    Resolved,
    /// The bounded await expired. The caller degrades to the honest in-flight
    /// refusal rather than waiting on a wedged task forever.
    TimedOut,
}

impl Phase2Completion {
    /// Rule 3: cancelling an empty map is success, not a wait.
    pub fn resolved() -> Self {
        Self { receiver: None }
    }

    pub async fn await_completion(self) -> Phase2CancelOutcome {
        self.await_completion_with_timeout(PHASE2_CANCEL_AWAIT)
            .await
    }

    /// The bounded await with the deadline supplied: the timeout is the
    /// behavior under test in the token-map suites, and a test that waited the
    /// real ten seconds to observe it is a test nobody runs.
    pub async fn await_completion_with_timeout(self, timeout: Duration) -> Phase2CancelOutcome {
        let Some(mut receiver) = self.receiver else {
            return Phase2CancelOutcome::Resolved;
        };
        if *receiver.borrow() {
            return Phase2CancelOutcome::Resolved;
        }
        match tokio::time::timeout(timeout, receiver.changed()).await {
            Ok(_) => Phase2CancelOutcome::Resolved,
            Err(_) => Phase2CancelOutcome::TimedOut,
        }
    }
}

impl Phase2Tokens {
    /// Register a generation-tagged token for `workspace_id`.
    ///
    /// Every detached lease-holding task registers, not just the archive
    /// request's phase 2: the convergence cleanup and the sweep's removal do
    /// too. Otherwise `phase2_live` reads false during their minutes-long
    /// removals, a double-POST falls through to the gate, and the answer
    /// reinstates the sidebar row of a genuinely archived workspace.
    pub fn register(&self, workspace_id: &str) -> Phase2Registration {
        let generation = self.next_generation.fetch_add(1, Ordering::SeqCst) + 1;
        let token = CancellationToken::new();
        let (completion, _) = tokio::sync::watch::channel(false);
        let completion = Arc::new(completion);
        let mut entries = self.entries.lock().expect("phase 2 token map poisoned");
        // A predecessor whose Drop has not run yet: every registrant holds the
        // workspace's exclusive lease, so this should be unreachable. Its token
        // is fired so the live task starts winding down, but its handle is NOT
        // resolved here — the handle's contract is that it resolves on confirmed
        // process death, and the predecessor's own Drop is what knows that. An
        // awaiter released early would begin an in-place restore under a still
        // dying script.
        if let Some(previous) = entries.remove(workspace_id) {
            tracing::warn!(
                workspace_id = %workspace_id,
                previous_generation = previous.generation,
                "registering a phase-2 token over a live predecessor; cancelling it and letting \
                 its own wind-down resolve its awaiters"
            );
            previous.token.cancel();
        }
        entries.insert(
            workspace_id.to_string(),
            Phase2Entry {
                generation,
                token: token.clone(),
                completion: completion.clone(),
            },
        );
        Phase2Registration {
            workspace_id: workspace_id.to_string(),
            generation,
            token,
            completion,
            entries: self.entries.clone(),
        }
    }

    /// Is a phase-2 task live for this workspace? The liveness signal the
    /// archive fast path consults AFTER the row already reads archived — the
    /// converse order would misfire in the register→flip window, where a token
    /// exists moments before the row flips.
    pub fn is_live(&self, workspace_id: &str) -> bool {
        self.entries
            .lock()
            .expect("phase 2 token map poisoned")
            .contains_key(workspace_id)
    }

    /// Fire the token and hand back a handle that resolves when the task is
    /// finished. An empty map resolves immediately.
    pub fn cancel(&self, workspace_id: &str) -> Phase2Completion {
        let entries = self.entries.lock().expect("phase 2 token map poisoned");
        let Some(entry) = entries.get(workspace_id) else {
            return Phase2Completion::resolved();
        };
        entry.token.cancel();
        Phase2Completion {
            receiver: Some(entry.completion.subscribe()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{Phase2CancelOutcome, Phase2Completion, Phase2Tokens};
    use std::time::Duration;

    /// Rule 3: nothing to cancel is success, not a wait.
    #[tokio::test]
    async fn cancelling_an_empty_map_resolves_immediately() {
        let tokens = Phase2Tokens::default();

        let outcome = tokens.cancel("workspace-1").await_completion().await;

        assert_eq!(outcome, Phase2CancelOutcome::Resolved);
    }

    /// Rule 1: the registration's Drop resolves the handle, so a panicked phase
    /// 2 releases an awaiting unarchive instead of hanging it.
    #[tokio::test]
    async fn a_panicking_task_still_resolves_its_completion_handle() {
        let tokens = Phase2Tokens::default();
        let registration = tokens.register("workspace-1");
        let completion = tokens.cancel("workspace-1");

        let task = tokio::spawn(async move {
            let _registration = registration;
            panic!("phase 2 blew up");
        });
        assert!(task.await.is_err(), "the task must have panicked");

        assert_eq!(
            completion.await_completion().await,
            Phase2CancelOutcome::Resolved
        );
        assert!(!tokens.is_live("workspace-1"));
    }

    /// Rule 2: a phase-1 failure after registration compare-and-removes the
    /// token, so nothing is left unresolvable.
    #[tokio::test]
    async fn releasing_a_registration_clears_liveness_and_resolves_awaiters() {
        let tokens = Phase2Tokens::default();
        let registration = tokens.register("workspace-1");
        assert!(tokens.is_live("workspace-1"));
        let completion = tokens.cancel("workspace-1");

        registration.release();

        assert!(!tokens.is_live("workspace-1"));
        assert_eq!(
            completion.await_completion().await,
            Phase2CancelOutcome::Resolved
        );
    }

    /// Rule 4: a wedged task trips the bounded await instead of hanging.
    #[tokio::test]
    async fn a_wedged_task_trips_the_bounded_await() {
        let tokens = Phase2Tokens::default();
        let _registration = tokens.register("workspace-1");

        let outcome = tokens
            .cancel("workspace-1")
            .await_completion_with_timeout(Duration::from_millis(30))
            .await;

        assert_eq!(outcome, Phase2CancelOutcome::TimedOut);
    }

    /// The generation tag: archive → Undo → re-archive → Undo. The first
    /// registration winding down must not delete the second's token, or the
    /// second Undo cancels nothing.
    #[tokio::test]
    async fn a_winding_down_task_does_not_delete_its_successors_token() {
        let tokens = Phase2Tokens::default();
        let first = tokens.register("workspace-1");
        let second = tokens.register("workspace-1");
        assert_ne!(first.generation(), second.generation());

        drop(first);

        assert!(
            tokens.is_live("workspace-1"),
            "the second registration must survive the first's Drop"
        );
        let completion = tokens.cancel("workspace-1");
        assert!(second.is_cancelled(), "the second token must have fired");
        drop(second);
        assert_eq!(
            completion.await_completion().await,
            Phase2CancelOutcome::Resolved
        );
        assert!(!tokens.is_live("workspace-1"));
    }

    /// The handle's contract: it resolves on the cancelled task's confirmed
    /// death, never on "something evicted its map entry". Registering over a
    /// live predecessor evicts it — and an awaiter of the predecessor must keep
    /// waiting until the predecessor itself winds down, because that awaiter
    /// goes on to restore IN PLACE.
    #[tokio::test]
    async fn registering_over_a_predecessor_does_not_resolve_its_handle_early() {
        let tokens = Phase2Tokens::default();
        let first = tokens.register("workspace-1");
        // Both handles are subscriptions to the FIRST registration, taken before
        // the successor evicts it from the map.
        let early_awaiter = tokens.cancel("workspace-1");
        let patient_awaiter = tokens.cancel("workspace-1");

        let _second = tokens.register("workspace-1");

        assert_eq!(
            early_awaiter
                .await_completion_with_timeout(Duration::from_millis(30))
                .await,
            Phase2CancelOutcome::TimedOut,
            "the predecessor's process is still dying, so its handle must not have resolved"
        );
        assert!(
            first.is_cancelled(),
            "it IS cancelled — the wind-down was started, just not declared finished"
        );

        drop(first);

        assert_eq!(
            patient_awaiter
                .await_completion_with_timeout(Duration::from_millis(200))
                .await,
            Phase2CancelOutcome::Resolved,
            "and it resolves the moment the predecessor itself winds down"
        );
    }

    #[tokio::test]
    async fn a_prebuilt_resolved_handle_never_waits() {
        assert_eq!(
            Phase2Completion::resolved().await_completion().await,
            Phase2CancelOutcome::Resolved
        );
    }
}
