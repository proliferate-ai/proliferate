//! The archive subdomain: the ordering invariant and the failure policy for
//! archiving and unarchiving a workspace.
//!
//! R2 shipped the git half (capture, restore, the private refs namespace) and R3
//! the three live-plane stop primitives. This module is the composition, and the
//! composition is where the guarantees live:
//!
//! - **Archive answers at the flip.** Everything the user is waiting for happens
//!   before `mark_archived`; everything after it is convergence work that can
//!   fail without failing the request, because "leftover" is a derived listing
//!   fact, not a state.
//! - **Undo is cheap.** The detached phase 2 carries a cancellation token, and
//!   unarchive fires it and waits for confirmed process death before restoring —
//!   which makes Undo-mid-script the CHEAPEST path in the system (the directory
//!   is untouched, so the restore happens in place) rather than the most
//!   expensive.
//! - **Nothing destructive runs on a guess.** Every path claim resolves both
//!   sides, every unresolvable comparison counts as a claim, and every
//!   destructive step re-reads its row under the gate lease.
//!
//! `rt.` in the ADR's pseudocode is shorthand; there is no runtime god object
//! and domains are barred from importing `AppState`. This follows the house
//! orchestrator pattern shared with its sibling, `WorkspacePurgeService`
//! (`domains/workspaces/deletion/purge.rs`, R5): a service struct with
//! injected dependencies, constructed directly in `app/mod.rs` — there is no
//! separate wiring family struct for this pair (R5 retired `app/workspaces.rs`).

// The R5 module family deliberately names the entry-point module after the
// domain (`workspaces::archive::archive` = the archive operation itself,
// beside its phases); renaming it would churn every consumer for a style lint.
#[allow(clippy::module_inception)]
pub mod archive;
pub mod inflight;
pub mod phase2;
pub mod quiesce;
pub mod refs;
pub mod sweep;
pub mod tiers;
pub mod tokens;
pub mod types;
pub mod unarchive;

#[cfg(test)]
mod refs_tests;
#[cfg(test)]
mod tests;

use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use crate::domains::repo_roots::store::RepoRootStore;
use crate::domains::sessions::service::SessionService;
use crate::domains::workspaces::model::WorkspaceRecord;
use crate::domains::workspaces::operation_gate::WorkspaceOperationGate;
use crate::domains::workspaces::store::WorkspaceStore;

use self::inflight::InFlightPaths;
use self::quiesce::QuiescePlanes;
use self::tokens::{Phase2Completion, Phase2Registration, Phase2Tokens};
use self::types::{
    ArchiveError, ArchiveOptions, ArchiveOutcome, UnarchiveError, UnarchiveOptions,
    UnarchiveOutcome,
};

pub struct WorkspaceArchiveService {
    pub(super) store: WorkspaceStore,
    pub(super) repo_root_store: RepoRootStore,
    pub(super) operation_gate: Arc<WorkspaceOperationGate>,
    pub(super) planes: QuiescePlanes,
    pub(super) session_service: Arc<SessionService>,
    pub(super) runtime_home: PathBuf,
    pub(super) tokens: Phase2Tokens,
    pub(super) inflight: InFlightPaths,
    /// Repo roots whose gc was deferred because a flow was in progress. R4 ships
    /// the runner (the sweep's tick drains it once the root is quiet); the
    /// enqueue side is purge's, in R5.
    pub(super) deferred_gc: Arc<Mutex<BTreeSet<PathBuf>>>,
    /// Checkpoints (Lane H): the sweep runs checkpoint retention as an extra
    /// duty each tick. Held here because the sweep is the natural periodic host
    /// for retention, and threading a second background loop would duplicate the
    /// tick cadence and the boot pass.
    pub(super) checkpoints: Arc<super::checkpoints::WorkspaceCheckpointService>,
    /// The quiesce deadline phase 1 enforces. A seam rather than the constant
    /// because the ONE way quiesce fails is the deadline trip, and no
    /// arrangement of three real planes takes eight seconds on demand.
    #[cfg(test)]
    pub(super) quiesce_deadline: Mutex<std::time::Duration>,
    /// What the post-restore HEAD verify observes, when a test substitutes it.
    /// See the comment at its read site in `unarchive.rs`.
    #[cfg(test)]
    pub(super) head_verify_override: Mutex<Option<String>>,
}

impl WorkspaceArchiveService {
    pub fn new(
        store: WorkspaceStore,
        repo_root_store: RepoRootStore,
        operation_gate: Arc<WorkspaceOperationGate>,
        planes: QuiescePlanes,
        session_service: Arc<SessionService>,
        runtime_home: PathBuf,
        checkpoints: Arc<super::checkpoints::WorkspaceCheckpointService>,
    ) -> Self {
        Self {
            store,
            repo_root_store,
            operation_gate,
            planes,
            session_service,
            runtime_home,
            tokens: Phase2Tokens::default(),
            inflight: InFlightPaths::default(),
            deferred_gc: Arc::new(Mutex::new(BTreeSet::new())),
            checkpoints,
            #[cfg(test)]
            quiesce_deadline: Mutex::new(quiesce::QUIESCE_DEADLINE),
            #[cfg(test)]
            head_verify_override: Mutex::new(None),
        }
    }

    /// The deadline phase 1 gives the three planes. Production is the constant;
    /// the suites shorten it to reach the trip.
    #[cfg(not(test))]
    pub(super) fn quiesce_deadline(&self) -> std::time::Duration {
        quiesce::QUIESCE_DEADLINE
    }

    #[cfg(test)]
    pub(super) fn quiesce_deadline(&self) -> std::time::Duration {
        *self
            .quiesce_deadline
            .lock()
            .expect("quiesce deadline poisoned")
    }

    #[cfg(test)]
    pub(crate) fn set_quiesce_deadline_for_tests(&self, deadline: std::time::Duration) {
        *self
            .quiesce_deadline
            .lock()
            .expect("quiesce deadline poisoned") = deadline;
    }

    /// Substitute what the post-restore HEAD verify observes, so the
    /// head-mismatch contract (rescue copy, retained columns, notice, the
    /// sweep's skip) is reachable without racing a torn restore.
    #[cfg(test)]
    pub(crate) fn force_head_verify_mismatch_for_tests(&self, observed: Option<String>) {
        *self
            .head_verify_override
            .lock()
            .expect("head verify override poisoned") = observed;
    }

    pub async fn archive(
        self: &Arc<Self>,
        workspace_id: &str,
        opts: ArchiveOptions,
    ) -> Result<ArchiveOutcome, ArchiveError> {
        archive::archive(self, workspace_id, opts).await
    }

    pub async fn unarchive(
        self: &Arc<Self>,
        workspace_id: &str,
        opts: UnarchiveOptions,
    ) -> Result<UnarchiveOutcome, UnarchiveError> {
        unarchive::unarchive(self, workspace_id, opts).await
    }

    /// Fire this workspace's phase-2 token and hand back an awaitable handle.
    /// Unarchive and purge AWAIT it rather than racing the gate: a TERM-ignoring
    /// script takes the full 5-second escalation while the bounded acquire gives
    /// up at ~3, so racing would make Undo-mid-script a coin flip that lands on
    /// "something else is in flight".
    pub fn cancel_phase2(&self, workspace_id: &str) -> Phase2Completion {
        self.tokens.cancel(workspace_id)
    }

    /// Whether a detached phase-2 task holds this workspace. Read only AFTER the
    /// row already reads archived.
    pub fn phase2_live(&self, workspace_id: &str) -> bool {
        self.tokens.is_live(workspace_id)
    }

    /// Registered BEFORE `mark_archived`, so row-visibility implies
    /// token-existence: a fast Undo racing the flip must always find something
    /// to fire.
    pub fn register_phase2_token(&self, workspace_id: &str) -> Phase2Registration {
        self.tokens.register(workspace_id)
    }

    /// The store, for the archive suites only.
    ///
    /// Tests assert on the ROW after a step fails — that is the whole promise of
    /// "a failure before the flip leaves the workspace fully back to normal" —
    /// and going through `AppState`'s read facade would hide the archive columns
    /// this rung's invariants are stated in.
    #[cfg(test)]
    pub(crate) fn store_for_tests(&self) -> &WorkspaceStore {
        &self.store
    }

    /// The in-flight map, for the path-claim suite only. The serialization it
    /// provides is between two concurrent flows, and standing up a second live
    /// flow just to hold one claim would make the test about scheduling instead
    /// of about the exclusion.
    #[cfg(test)]
    pub(crate) fn inflight_for_tests(&self) -> &InFlightPaths {
        &self.inflight
    }

    /// A snapshot of the deferred-gc set, for purge's gc-guard suite only:
    /// the unconditional-enqueue assertion has nothing else to read, since
    /// the sweep's runner is the only other consumer and running it just to
    /// observe the enqueue would test the runner, not the enqueue.
    #[cfg(test)]
    pub(crate) fn deferred_gc_for_tests(&self) -> BTreeSet<PathBuf> {
        self.deferred_gc
            .lock()
            .expect("deferred gc set poisoned")
            .clone()
    }

    /// Ask for a repo root's gc to run once nothing is working in it. R5's purge
    /// is the enqueuer; the sweep's tick is the runner.
    pub fn defer_gc(&self, repo_root: PathBuf) {
        self.deferred_gc
            .lock()
            .expect("deferred gc set poisoned")
            .insert(repo_root);
    }

    /// Whether a repo root currently has an archive/unarchive flow claimed
    /// against it. Purge's inline gc guard reads this BEFORE running a gc of
    /// its own, so a gc never races the worktree removal or ref rewrite of a
    /// sibling workspace's archive/unarchive in the same repo root; it always
    /// still enqueues into `deferred_gc` regardless of the answer, so a busy
    /// root's reclaim is deferred rather than dropped.
    pub fn repo_root_busy(&self, repo_root: &std::path::Path) -> bool {
        self.inflight.repo_root_busy(repo_root)
    }

    /// Resolve a workspace row's repo root into a path. `WorkspaceRecord`
    /// carries the foreign key, not the path, and this resolution is
    /// deliberately the orchestrator's edge — the git adapter's archive verbs
    /// take a plain `&Path` so they never learn what a workspace row is.
    pub(super) fn repo_root_path(&self, workspace: &WorkspaceRecord) -> anyhow::Result<PathBuf> {
        let record = self
            .repo_root_store
            .find_by_id(&workspace.repo_root_id)?
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "repo root {} not found for workspace {}",
                    workspace.repo_root_id,
                    workspace.id
                )
            })?;
        Ok(PathBuf::from(record.path))
    }
}

/// The single clock for lifecycle writes. A free function rather than inline
/// `Utc::now()` calls so every column this rung writes carries the same
/// timestamp shape as the rest of the table.
pub(super) fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}
