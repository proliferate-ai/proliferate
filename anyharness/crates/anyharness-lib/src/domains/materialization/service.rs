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
    canonicalize_destination, response_safe_clone_url, validate_branch_name,
    validate_clone_url_matches_identity, validate_head_sha, RemoteIdentity,
};
use super::model::{
    AcquireOutcome, AcquireRepoRootResult, MaterializationError, MaterializationKind,
    MaterializationOperationRecord, MaterializationState, MaterializeWorkspaceResult,
};
use super::operation_lock::MaterializationOperationLocks;
use super::store::MaterializationOperationStore;
use crate::domains::repo_roots::service::RepoRootService;
use crate::domains::sessions::runtime::SessionRuntime;
use crate::domains::workspaces::runtime::{ExactRefOutcome, WorkspaceRuntime};
use crate::domains::workspaces::types::ResolveRepoRootError;
use crate::live::terminals::TerminalService;

pub(crate) type Result<T> = std::result::Result<T, MaterializationError>;

#[derive(Clone)]
pub struct MaterializationService {
    workspace_runtime: Arc<WorkspaceRuntime>,
    repo_root_service: Arc<RepoRootService>,
    session_runtime: Arc<SessionRuntime>,
    terminal_service: Arc<TerminalService>,
    store: MaterializationOperationStore,
    // In-process per-operation-id serialization: distinguishes a live running
    // op (held here) from a crashed one (ledger row with no in-process holder).
    operation_locks: MaterializationOperationLocks,
}

impl MaterializationService {
    pub fn new(
        workspace_runtime: Arc<WorkspaceRuntime>,
        repo_root_service: Arc<RepoRootService>,
        session_runtime: Arc<SessionRuntime>,
        terminal_service: Arc<TerminalService>,
        store: MaterializationOperationStore,
    ) -> Self {
        Self {
            workspace_runtime,
            repo_root_service,
            session_runtime,
            terminal_service,
            store,
            operation_locks: MaterializationOperationLocks::new(),
        }
    }

    // -----------------------------------------------------------------------
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
                self.record_failure(&operation_id, &error);
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
    // Exact-ref workspace materialization
    // -----------------------------------------------------------------------

    pub async fn materialize_workspace_at_ref(
        &self,
        repo_root_id: &str,
        operation_id: &str,
        branch_name: &str,
        head_sha: &str,
        destination_id: Option<&str>,
        preferred_workspace_name: Option<&str>,
    ) -> Result<MaterializeWorkspaceResult> {
        let operation_id = operation_id.trim().to_string();
        if operation_id.is_empty() {
            return Err(MaterializationError::Failed(
                "operation id is required".into(),
            ));
        }
        let repo_root_id = repo_root_id.trim().to_string();
        let branch_name = branch_name.trim().to_string();
        let head_sha = head_sha.trim().to_string();
        let destination_id = destination_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        let preferred_workspace_name = preferred_workspace_name
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);

        // Validate branch + head-sha shape BEFORE any git runs so neither can be
        // read as a git option or ambiguous rev (PR3-GIT-INPUT). destination_id
        // is already validated downstream by `validate_destination_id`.
        validate_branch_name(&branch_name)
            .map_err(MaterializationError::WorkspaceBranchMismatch)?;
        validate_head_sha(&head_sha).map_err(MaterializationError::RequestedRefNotFound)?;

        // Include EVERY behavior-changing request field so reusing an operation
        // id with any changed field yields OPERATION_CONFLICT (PR3-HASH-03).
        let request_hash = hash_request(&[
            "workspace",
            &operation_id,
            &repo_root_id,
            &branch_name,
            &head_sha,
            destination_id.as_deref().unwrap_or(""),
            preferred_workspace_name.as_deref().unwrap_or(""),
        ]);

        let _guard = match self
            .begin_operation(&operation_id, MaterializationKind::Workspace, &request_hash)
            .await?
        {
            AdmissionPlan::Replay(record) => return self.replay_workspace(&record).await,
            AdmissionPlan::Proceed { guard, .. } => guard,
        };

        let outcome = self
            .run_materialize_workspace(
                &repo_root_id,
                &branch_name,
                &head_sha,
                destination_id.as_deref(),
                preferred_workspace_name.as_deref(),
            )
            .await;

        match outcome {
            Ok(result) => {
                self.store
                    .mark_completed_workspace(
                        &operation_id,
                        &result.workspace.id,
                        &result.workspace.path,
                        &result.observed_head_sha,
                    )
                    .map_err(internal)?;
                Ok(result)
            }
            Err(error) => {
                self.record_failure(&operation_id, &error);
                Err(error)
            }
        }
    }

    async fn run_materialize_workspace(
        &self,
        repo_root_id: &str,
        branch_name: &str,
        head_sha: &str,
        destination_id: Option<&str>,
        preferred_workspace_name: Option<&str>,
    ) -> Result<MaterializeWorkspaceResult> {
        let workspace_runtime = self.workspace_runtime.clone();
        let repo_root_id_owned = repo_root_id.to_string();
        let branch_name_owned = branch_name.to_string();
        let head_sha_owned = head_sha.to_string();
        let destination_id_owned = destination_id.map(str::to_string);
        let preferred_owned = preferred_workspace_name.map(str::to_string);

        let exact = tokio::task::spawn_blocking(move || {
            workspace_runtime.create_or_reuse_standard_worktree_at_ref(
                &repo_root_id_owned,
                &branch_name_owned,
                &head_sha_owned,
                destination_id_owned.as_deref(),
                preferred_owned.as_deref(),
            )
        })
        .await
        .map_err(|error| {
            MaterializationError::Failed(format!("materialization task failed: {error}"))
        })?
        .map_err(map_exact_ref_error)?;

        // Busy check: a reused/adopted workspace with live sessions or active
        // terminals is not a "newly materialized copy" and must be rejected.
        if matches!(
            exact.outcome,
            ExactRefOutcome::Reused | ExactRefOutcome::Adopted
        ) {
            self.assert_workspace_not_busy(&exact.workspace.id).await?;
        }

        Ok(MaterializeWorkspaceResult {
            workspace: exact.workspace,
            observed_head_sha: exact.observed_head_sha,
            outcome: exact.outcome,
        })
    }

    async fn replay_workspace(
        &self,
        record: &MaterializationOperationRecord,
    ) -> Result<MaterializeWorkspaceResult> {
        let workspace_id = record.workspace_id.as_deref().ok_or_else(|| {
            MaterializationError::Failed("completed workspace op missing workspace_id".into())
        })?;
        let workspace = self
            .workspace_runtime
            .get_workspace(workspace_id)
            .map_err(internal)?
            .ok_or_else(|| {
                MaterializationError::Failed("recorded workspace no longer exists".into())
            })?;
        // Fail closed on a corrupt completed row: the observed head SHA must be
        // present and a real SHA. Never fall back to the branch name in the SHA
        // field (PR3-REPLAY-05).
        let observed = record.observed_head_sha.clone().ok_or_else(|| {
            MaterializationError::Failed(
                "completed workspace op is missing its observed head sha".into(),
            )
        })?;
        Ok(MaterializeWorkspaceResult {
            workspace,
            observed_head_sha: observed,
            outcome: ExactRefOutcome::Reused,
        })
    }

    /// Reject reuse of a workspace that has live sessions or active terminals.
    async fn assert_workspace_not_busy(&self, workspace_id: &str) -> Result<()> {
        let summary = self
            .session_runtime
            .workspace_execution_summary(workspace_id)
            .await
            .map_err(internal)?;
        if summary.running_count > 0
            || summary.live_session_count > 0
            || summary.awaiting_interaction_count > 0
        {
            return Err(MaterializationError::WorkspaceBusy(
                "workspace has live sessions".into(),
            ));
        }
        let terminals = self.terminal_service.list_terminals(workspace_id).await;
        if terminals.iter().any(|terminal| {
            matches!(
                terminal.status,
                crate::domains::terminals::model::TerminalStatus::Starting
                    | crate::domains::terminals::model::TerminalStatus::Running
            )
        }) {
            return Err(MaterializationError::WorkspaceBusy(
                "workspace has active terminals".into(),
            ));
        }
        Ok(())
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

    fn record_failure(&self, operation_id: &str, error: &MaterializationError) {
        if let Some(code) = error.ledger_failure_code() {
            let _ = self.store.mark_failed(operation_id, code);
        }
        // OperationConflict does not durably fail the underlying op; leave the
        // row in its prior state.
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

/// Map an exact-ref creation error (anyhow, message-classified) to a typed
/// materialization error.
pub(crate) fn map_exact_ref_error(error: anyhow::Error) -> MaterializationError {
    let message = error.to_string();
    let lower = message.to_ascii_lowercase();
    if lower.contains("not requested branch") || lower.contains("not on requested branch") {
        MaterializationError::WorkspaceBranchMismatch(message)
    } else if lower.contains("uncommitted changes") {
        MaterializationError::WorkspaceDirty(message)
    } else if lower.contains("not requested commit")
        || lower.contains("not requested")
        || lower.contains("is at ")
    {
        MaterializationError::WorkspaceHeadMismatch(message)
    } else if lower.contains("does not exist")
        || lower.contains("not found")
        || lower.contains("rev-parse")
        || lower.contains("unknown revision")
        || lower.contains("bad revision")
    {
        MaterializationError::RequestedRefNotFound(message)
    } else if lower.contains("pending cleanup") || lower.contains("already exists") {
        MaterializationError::DestinationConflict(message)
    } else {
        MaterializationError::Failed(message)
    }
}

pub(crate) fn internal(error: anyhow::Error) -> MaterializationError {
    MaterializationError::Failed(error.to_string())
}

/// Response-safe form of a clone URL (rejects embedded credentials). Exposed
/// for the HTTP mapper so it never echoes userinfo.
pub fn response_safe_url(url: &str) -> Option<String> {
    response_safe_clone_url(url)
}
