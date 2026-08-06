//! Local repository / workspace materialization orchestration.
//!
//! The repo/workspace domain decides the operation; the Git adapter executes
//! focused commands. This service owns:
//!   - clone-or-adopt repo acquisition with post-clone remote identity
//!     verification and destination path safety;
//!   - exact-ref workspace materialization (delegating branch/SHA mechanics to
//!     the shared workspace-runtime owner); and
//!   - the idempotency ledger flow (running -> fs mutation -> register ->
//!     completed) with crash-after-fs adoption.

use std::path::Path;
use std::sync::Arc;

use sha2::{Digest, Sha256};

use super::acquire::acquire_blocking;
use super::identity::{
    canonicalize_destination, response_safe_clone_url, validate_clone_url_matches_identity,
    RemoteIdentity,
};
use super::model::{
    AcquireOutcome, AcquireRepoRootResult, MaterializationError, MaterializationKind,
    MaterializationOperationRecord, MaterializationState,
};
use super::operation_lock::MaterializationOperationLocks;
use super::store::MaterializationOperationStore;
use crate::domains::repo_roots::service::RepoRootService;
use crate::domains::workspaces::runtime::WorkspaceRuntime;
use crate::domains::workspaces::types::ResolveRepoRootError;

pub(crate) type Result<T> = std::result::Result<T, MaterializationError>;

#[derive(Clone)]
pub struct MaterializationService {
    workspace_runtime: Arc<WorkspaceRuntime>,
    repo_root_service: Arc<RepoRootService>,
    store: MaterializationOperationStore,
    // In-process per-operation-id serialization: distinguishes a live running
    // op (held here) from a crashed one (ledger row with no in-process holder).
    // Shared with `MaterializationRuntime`, which holds the same instance so
    // repo-root and workspace operation ids converge/conflict against one
    // ledger and one lock map (`app/mod.rs` wires both from one construction).
    operation_locks: MaterializationOperationLocks,
}

impl MaterializationService {
    pub fn new(
        workspace_runtime: Arc<WorkspaceRuntime>,
        repo_root_service: Arc<RepoRootService>,
        store: MaterializationOperationStore,
        operation_locks: MaterializationOperationLocks,
    ) -> Self {
        Self {
            workspace_runtime,
            repo_root_service,
            store,
            operation_locks,
        }
    }

    // Repo-root acquisition
    // -----------------------------------------------------------------------

    /// Acquire (clone-or-adopt) a repository at `destination_path` and register
    /// its main repo root. Idempotent on `operation_id`.
    pub async fn acquire_repo_root(
        &self,
        operation_id: &str,
        provider: &str,
        owner: &str,
        name: &str,
        clone_url: &str,
        destination_path: &str,
    ) -> Result<AcquireRepoRootResult> {
        let operation_id = operation_id.trim().to_string();
        if operation_id.is_empty() {
            return Err(MaterializationError::Failed(
                "operation id is required".into(),
            ));
        }
        let expected = RemoteIdentity::new(provider, owner, name);
        let clone_url = clone_url.trim().to_string();
        let destination_path = destination_path.trim().to_string();
        // Validate the clone URL shape + identity BEFORE any git runs so an
        // option-like or foreign-host URL can never reach `git clone`
        // (PR3-GIT-INPUT). This is the single up-front gate for the source.
        validate_clone_url_matches_identity(&clone_url, &expected)
            .map_err(MaterializationError::RepositoryRemoteMismatch)?;
        // Canonicalize the destination before hashing so two callers that name
        // the same real path via different (symlinked/relative-suffixed) strings
        // converge, and include the clone URL so a same-id retry that swaps the
        // source repo is a conflict rather than a silent double-execution.
        let hashed_destination = hashed_destination_form(&destination_path);
        let request_hash = hash_request(&[
            "repo_root",
            &operation_id,
            &expected.provider,
            &expected.owner,
            &expected.repo,
            &clone_url,
            &hashed_destination,
        ]);

        // In-process serialization + ledger admission. A held guard means we are
        // the sole live in-process runner for this id (crashed rows have none).
        let (_guard, recovered_intended_kind) = match self
            .begin_operation(&operation_id, MaterializationKind::RepoRoot, &request_hash)
            .await?
        {
            AdmissionPlan::Replay(record) => return self.replay_repo_root(&record),
            AdmissionPlan::Proceed {
                guard,
                recovered_intended_kind,
            } => (guard, recovered_intended_kind),
        };

        let outcome = self
            .run_acquire(
                &operation_id,
                &expected,
                &clone_url,
                &destination_path,
                recovered_intended_kind.as_deref(),
            )
            .await;
        match outcome {
            Ok(result) => {
                self.store
                    .mark_completed_repo_root(
                        &operation_id,
                        &result.repo_root.id,
                        &result.repo_root.path,
                    )
                    .map_err(internal)?;
                Ok(result)
            }
            Err(error) => {
                record_failure(&self.store, &operation_id, &error);
                Err(error)
            }
        }
    }

    /// The filesystem + registration work of acquisition, after ledger
    /// admission. Runs the blocking git work on a blocking task.
    async fn run_acquire(
        &self,
        operation_id: &str,
        expected: &RemoteIdentity,
        clone_url: &str,
        destination_path: &str,
        recovered_intended_kind: Option<&str>,
    ) -> Result<AcquireRepoRootResult> {
        let workspace_runtime = self.workspace_runtime.clone();
        let repo_root_service = self.repo_root_service.clone();
        let store = self.store.clone();
        let operation_id = operation_id.to_string();
        let expected = expected.clone();
        let clone_url = clone_url.to_string();
        let destination_path = destination_path.to_string();
        let recovered_intended_kind = recovered_intended_kind.map(str::to_string);
        tokio::task::spawn_blocking(move || {
            acquire_blocking(
                &workspace_runtime,
                &repo_root_service,
                &store,
                &operation_id,
                &expected,
                &clone_url,
                &destination_path,
                recovered_intended_kind.as_deref(),
            )
        })
        .await
        .map_err(|error| {
            MaterializationError::Failed(format!("acquisition task failed: {error}"))
        })?
    }

    fn replay_repo_root(
        &self,
        record: &MaterializationOperationRecord,
    ) -> Result<AcquireRepoRootResult> {
        let repo_root_id = record.repo_root_id.as_deref().ok_or_else(|| {
            MaterializationError::Failed("completed repo-root op missing repo_root_id".into())
        })?;
        let repo_root = self
            .repo_root_service
            .get_repo_root(repo_root_id)
            .map_err(internal)?
            .ok_or_else(|| {
                MaterializationError::Failed("recorded repo root no longer exists".into())
            })?;
        Ok(AcquireRepoRootResult {
            repo_root,
            outcome: AcquireOutcome::Reused,
        })
    }

    // -----------------------------------------------------------------------
    // Ledger admission helpers
    // -----------------------------------------------------------------------

    /// Acquire the in-process lock and reconcile the ledger for an operation.
    ///
    /// Returns [`AdmissionPlan::Replay`] for an already-completed op (no lock
    /// needed — replay is a pure read), and conflicts immediately for a same-id
    /// caller with a different normalized request. Otherwise takes the
    /// in-process guard, WAITING if a live same-id+same-hash caller holds it so
    /// identical concurrent callers converge, then reconciles the ledger row:
    ///   - the holder we waited on completed → replay its result;
    ///   - a `running` row with the lock free is a *crashed* op we adopt on
    ///     retry (its `intended_kind`, if any, is recovered).
    async fn begin_operation(
        &self,
        operation_id: &str,
        kind: MaterializationKind,
        request_hash: &str,
    ) -> Result<AdmissionPlan> {
        begin_operation(
            &self.store,
            &self.operation_locks,
            operation_id,
            kind,
            request_hash,
        )
        .await
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Admission {
    /// The operation already completed; return the recorded result.
    Replay,
    /// The operation may (re)run its filesystem + registration work.
    Retry,
}

/// The outcome of [`begin_operation`]: either replay a completed op or proceed
/// holding the in-process guard for its lifetime.
pub(crate) enum AdmissionPlan {
    Replay(MaterializationOperationRecord),
    Proceed {
        /// Held for the duration of the operation; dropping it releases the
        /// in-process claim so a later retry (or crash-recovery) can adopt.
        guard: super::operation_lock::MaterializationOperationGuard,
        /// The clone intent recovered from a crashed running row, if any.
        recovered_intended_kind: Option<String>,
    },
}

/// Acquire the in-process lock and reconcile the ledger for an operation.
///
/// A completed op replays without contending for the lock (a pure read), and a
/// same-id caller whose normalized request differs (kind/request-hash mismatch)
/// conflicts immediately — never waiting on the lock.
///
/// Otherwise the in-process guard is taken, WAITING if a live same-id+same-hash
/// runner currently holds it (PR3-CONVERGENCE-01: identical concurrent callers
/// converge to one execution). Once the guard is held the ledger is re-read:
///   - the holder we waited on completed → replay its recorded result;
///   - the holder failed, or the row is a crashed `running` (no live holder) →
///     retry, recovering any recorded `intended_kind`.
///
/// The wait takes only this keyed lock and then re-reads the row, so it cannot
/// deadlock a caller holding unrelated locks. Shared by the service methods and
/// the convergence tests so both drive one implementation.
pub(crate) async fn begin_operation(
    store: &MaterializationOperationStore,
    operation_locks: &MaterializationOperationLocks,
    operation_id: &str,
    kind: MaterializationKind,
    request_hash: &str,
) -> Result<AdmissionPlan> {
    // Fast, lock-free path: a completed op replays and a different-request reuse
    // conflicts without ever contending for (or waiting on) the lock. A running
    // same-hash row falls through to the lock so the caller converges by waiting
    // for the live holder rather than 409-ing.
    if let Some(existing) = store.find(operation_id).map_err(internal)? {
        if matches!(
            admit_existing(&existing, kind, request_hash)?,
            Admission::Replay
        ) {
            return Ok(AdmissionPlan::Replay(existing));
        }
    }

    // Claim the id in-process. If a live same-id runner holds it, this WAITS for
    // that runner to finish (convergence) rather than failing. A different-hash
    // caller never reaches here — it conflicted in the lock-free check above,
    // because a live runner always leaves a same-hash `running` row.
    let guard = operation_locks.acquire(operation_id).await;

    // Re-read under the guard: reconcile the durable row now that we are the
    // sole live in-process runner for this id. If we waited on a holder that has
    // since completed, this re-read replays its result — one execution.
    let mut recovered_intended_kind = None;
    if let Some(existing) = store.find(operation_id).map_err(internal)? {
        match admit_existing(&existing, kind, request_hash)? {
            Admission::Replay => return Ok(AdmissionPlan::Replay(existing)),
            Admission::Retry => {
                // Either the holder we waited on failed, or this is a crashed
                // `running` row (no live holder). Recover its recorded clone
                // intent so re-registration stays truthful, then flip to running.
                recovered_intended_kind = existing.intended_kind.clone();
                store.mark_running(operation_id).map_err(internal)?;
            }
        }
    } else {
        // No row yet: insert a fresh running row. A lost INSERT race means a
        // committed row appeared without an in-process holder — treat it as a
        // crash-recovery retry (converge or conflict on re-read).
        if store
            .insert_running(operation_id, kind, request_hash)
            .is_err()
        {
            let existing = store.find(operation_id).map_err(internal)?.ok_or_else(|| {
                MaterializationError::Failed("operation row vanished after conflict".into())
            })?;
            match admit_existing(&existing, kind, request_hash)? {
                Admission::Replay => return Ok(AdmissionPlan::Replay(existing)),
                Admission::Retry => {
                    recovered_intended_kind = existing.intended_kind.clone();
                    store.mark_running(operation_id).map_err(internal)?;
                }
            }
        }
    }

    Ok(AdmissionPlan::Proceed {
        guard,
        recovered_intended_kind,
    })
}

/// Ledger admission decision for an existing row: replay a completed op,
/// retry a failed/running one with a matching hash, or conflict on a reused
/// operation id with a different kind/request.
pub(crate) fn admit_existing(
    existing: &MaterializationOperationRecord,
    kind: MaterializationKind,
    request_hash: &str,
) -> Result<Admission> {
    if existing.kind != kind || existing.request_hash != request_hash {
        return Err(MaterializationError::OperationConflict(
            "operation id was reused with a different request".into(),
        ));
    }
    match existing.state {
        MaterializationState::Completed => Ok(Admission::Replay),
        MaterializationState::Failed => Ok(Admission::Retry),
        // A running row is either an in-flight concurrent op or a crashed
        // op. We converge by adopting the deterministic destination on
        // retry, which is safe because all identity/ref/safety checks run
        // again before adoption. Treat as retry.
        MaterializationState::Running => Ok(Admission::Retry),
    }
}

/// The destination form fed into the repo-root request hash. Canonicalizes the
/// destination (collapsing symlinks in the existing prefix; the target itself
/// need not exist) so two callers naming the same real path via different
/// strings converge. Falls back to the trimmed input if canonicalization fails
/// (e.g. no existing ancestor), which still hashes deterministically.
pub(crate) fn hashed_destination_form(destination_path: &str) -> String {
    canonicalize_destination(Path::new(destination_path))
        .map(|canonical| canonical.to_string_lossy().to_string())
        .unwrap_or_else(|_| destination_path.to_string())
}

/// Deterministic hash over the normalized request parts.
pub(crate) fn hash_request(parts: &[&str]) -> String {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update(part.as_bytes());
        hasher.update([0u8]);
    }
    format!("{:x}", hasher.finalize())
}

pub(crate) fn map_resolve_repo_root_error(error: ResolveRepoRootError) -> MaterializationError {
    match error {
        ResolveRepoRootError::NotGitRepo => {
            MaterializationError::Failed("acquired path is not a git repository".into())
        }
        ResolveRepoRootError::WorktreeNotAllowed => {
            MaterializationError::RepoRootWorktreeUnsupported(
                "adoption requires a main checkout, not a linked worktree".into(),
            )
        }
        ResolveRepoRootError::Unexpected(inner) => MaterializationError::Failed(inner.to_string()),
    }
}

pub(crate) fn internal(error: anyhow::Error) -> MaterializationError {
    MaterializationError::Failed(error.to_string())
}

/// Record a durable failure against the ledger row, if the error carries a
/// failure code. `OperationConflict` does not durably fail the underlying op —
/// it leaves the row in its prior state. Shared by the service's repo-root
/// path and the runtime's workspace-materialization path, both of which write
/// to the same ledger.
pub(crate) fn record_failure(
    store: &MaterializationOperationStore,
    operation_id: &str,
    error: &MaterializationError,
) {
    if let Some(code) = error.ledger_failure_code() {
        let _ = store.mark_failed(operation_id, code);
    }
}

/// Response-safe form of a clone URL (rejects embedded credentials). Exposed
/// for the HTTP mapper so it never echoes userinfo.
pub fn response_safe_url(url: &str) -> Option<String> {
    response_safe_clone_url(url)
}
