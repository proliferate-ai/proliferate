//! The row-dies-last purge orchestrator (ADR §6).
//!
//! The failure contract is the inverse of archive's: every step before the
//! row delete is individually idempotent, so a crash anywhere leaves the row
//! in place and re-issuing `DELETE` re-walks the steps and converges. Because
//! the row dies last, there is no state where the row is gone but cleanup
//! remains — no tombstone, no preflight, no retry endpoint. What purge
//! deletes: the worktree, the three archive refs (plus any rescue names for
//! this id), session rows + native JSONL + prompt attachments, and the
//! workspace row. What it keeps: the local branch and all committed/pushed
//! history — purge is not a git-history eraser.
//!
//! Quiesce is duplicated on purpose here rather than shared with
//! `archive/quiesce.rs::stop_everything`: the mechanisms are shared (the same
//! three live planes), the three-line stop policy is duplicated, and the one
//! policy difference is that purge proceeds even on a kill timeout — it is
//! destructive by intent and there is no snapshot fidelity to protect.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::adapters::git::service::GitService;
use crate::adapters::git::types::WorktreeRemoveOutcome;
use crate::domains::repo_roots::service::RepoRootService;
use crate::domains::sessions::admission::SessionMutationAdmission;
use crate::domains::sessions::deletion::SessionDeleteWorkflow;
use crate::domains::sessions::runtime::SessionRuntime;
use crate::domains::sessions::store::SessionStore;
use crate::domains::workspaces::archive::refs;
use crate::domains::workspaces::archive::tokens::Phase2CancelOutcome;
use crate::domains::workspaces::archive::WorkspaceArchiveService;
use crate::domains::workspaces::checkpoints::WorkspaceCheckpointService;
use crate::domains::workspaces::managed_root::is_managed_worktree_path;
use crate::domains::workspaces::model::WorkspaceKind;
use crate::domains::workspaces::operation_gate::WorkspaceOperationGate;
use crate::domains::workspaces::setup_runtime::WorkspaceSetupRuntime;
use crate::domains::workspaces::store::WorkspaceStore;
use crate::live::terminals::TerminalService;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkspacePurgeOutcome {
    Deleted { already_deleted: bool },
}

/// Everything that can stop purge before it takes any destructive effect.
/// Deliberately narrow: there is no `Blocked` / `CleanupFailed` outcome
/// because nothing in this flow produces either — no preflight to report, no
/// tombstone to describe.
#[derive(Debug)]
pub enum WorkspacePurgeError {
    /// PR1227-WORKSPACE-FENCE-01: a session controlled by a nonterminal
    /// workflow was observed under the exclusive workspace lease. Carries the
    /// controlling run id for logging only.
    ControlledByWorkflow { run_id: String },
    /// PR1227-WORKSPACE-FENCE-02: a session id enumerated under the exclusive
    /// lease was NOT in the up-front admitted set (bound after the snapshot,
    /// possibly already terminalized). Carries the unadmitted session id for
    /// the conflict detail only.
    SessionAppearedAfterAdmission { session_id: String },
    /// The bounded gate acquire (or the bounded phase-2 cancel await it is
    /// preceded by) timed out. Rare, honest, and retryable — the same shape
    /// archive and unarchive answer with.
    OperationInFlight,
    /// Checkpoint metadata/ref cleanup failed before the workspace row died.
    /// The underlying git/DB detail stays local; the API maps this to a static
    /// code and detail because it may contain repository paths.
    CheckpointCleanupFailed,
    /// A mechanical failure. Every step it can come from is either fully
    /// idempotent or has not yet had any destructive effect, so the honest
    /// answer is always "the row is untouched, try again".
    Failed(String),
}

impl std::fmt::Display for WorkspacePurgeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ControlledByWorkflow { run_id } => {
                write!(
                    f,
                    "session execution is controlled by workflow run {run_id}"
                )
            }
            Self::SessionAppearedAfterAdmission { session_id } => write!(
                f,
                "session {session_id} appeared after destruction admission"
            ),
            Self::OperationInFlight => {
                write!(f, "a workspace operation is already in flight")
            }
            Self::CheckpointCleanupFailed => write!(f, "checkpoint cleanup failed"),
            Self::Failed(message) => write!(f, "{message}"),
        }
    }
}

impl std::error::Error for WorkspacePurgeError {}

#[derive(Clone)]
pub struct WorkspacePurgeService {
    store: WorkspaceStore,
    session_store: SessionStore,
    session_delete_workflow: SessionDeleteWorkflow,
    setup_runtime: Arc<WorkspaceSetupRuntime>,
    session_runtime: Arc<SessionRuntime>,
    terminals: Arc<TerminalService>,
    repo_root_service: RepoRootService,
    operation_gate: Arc<WorkspaceOperationGate>,
    archive: Arc<WorkspaceArchiveService>,
    checkpoints: Arc<WorkspaceCheckpointService>,
    admission: Arc<SessionMutationAdmission>,
    runtime_home: PathBuf,
}

impl WorkspacePurgeService {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        store: WorkspaceStore,
        session_store: SessionStore,
        session_delete_workflow: SessionDeleteWorkflow,
        setup_runtime: Arc<WorkspaceSetupRuntime>,
        session_runtime: Arc<SessionRuntime>,
        terminals: Arc<TerminalService>,
        repo_root_service: RepoRootService,
        operation_gate: Arc<WorkspaceOperationGate>,
        archive: Arc<WorkspaceArchiveService>,
        checkpoints: Arc<WorkspaceCheckpointService>,
        admission: Arc<SessionMutationAdmission>,
        runtime_home: PathBuf,
    ) -> Self {
        Self {
            store,
            session_store,
            session_delete_workflow,
            setup_runtime,
            session_runtime,
            terminals,
            repo_root_service,
            operation_gate,
            archive,
            checkpoints,
            admission,
            runtime_home,
        }
    }

    pub async fn purge(
        &self,
        workspace_id: &str,
    ) -> Result<WorkspacePurgeOutcome, WorkspacePurgeError> {
        self.purge_with_admitted_session_ids(workspace_id, None)
            .await
    }

    /// `admitted_session_ids` is the set of session ids the HTTP layer's
    /// up-front `admit_all_workspace_sessions` snapshotted and holds permits
    /// for (PR1227-WORKSPACE-FENCE-02). `None` skips the admitted-set
    /// membership check and applies only the nonterminal FENCE-01 re-check.
    pub async fn purge_with_admitted_session_ids(
        &self,
        workspace_id: &str,
        admitted_session_ids: Option<BTreeSet<String>>,
    ) -> Result<WorkspacePurgeOutcome, WorkspacePurgeError> {
        // Pre-empt any running phase-2 cleanup exactly like unarchive does:
        // fire AND AWAIT the cancellation BEFORE acquiring the gate. The ~3s
        // bounded acquire must not race the 5s TERM->KILL escalation a
        // TERM-ignoring archive script needs — purge is strictly more
        // destructive than the cleanup it cancels, so pre-empting is always
        // correct.
        if self
            .archive
            .cancel_phase2(workspace_id)
            .await_completion()
            .await
            == Phase2CancelOutcome::TimedOut
        {
            tracing::warn!(
                workspace_id = %workspace_id,
                "the phase-2 cancel await expired; answering in-flight rather than hanging"
            );
            return Err(WorkspacePurgeError::OperationInFlight);
        }

        let _lease = self
            .operation_gate
            .acquire_exclusive_bounded(workspace_id)
            .await
            .map_err(|_| WorkspacePurgeError::OperationInFlight)?;

        // PR1227-WORKSPACE-FENCE-01/02, under the exclusive lease.
        if let Some(error) = self
            .reject_if_workflow_controlled(workspace_id, admitted_session_ids.as_ref())
            .await
            .map_err(|error| WorkspacePurgeError::Failed(error.to_string()))?
        {
            return Err(error);
        }

        // Idempotent: row already gone -> done. Re-issuing DELETE is the only
        // retry mechanism.
        let Some(workspace) = self
            .store
            .find_workspace(workspace_id)
            .map_err(|error| WorkspacePurgeError::Failed(error.to_string()))?
        else {
            return Ok(WorkspacePurgeOutcome::Deleted {
                already_deleted: true,
            });
        };

        // Same three stop primitives as archive's quiesce, same policy —
        // except purge proceeds even on a kill timeout: it is destructive by
        // intent, there is no snapshot fidelity to protect.
        let _ = self.setup_runtime.kill_setup_run(workspace_id).await;
        let _ = self
            .session_runtime
            .stop_all_for_workspace(workspace_id)
            .await;
        let _ = self.terminals.close_all_for_workspace(workspace_id).await;

        let workspace_path = PathBuf::from(&workspace.path);

        // Resolve the repo root for every workspace kind. Local purge never
        // removes the user's directory or archive refs, but checkpoint refs
        // live in that local repository and must be deleted before the row can
        // die.
        let repo_root_record = self
            .repo_root_service
            .get_repo_root(&workspace.repo_root_id)
            .map_err(|error| WorkspacePurgeError::Failed(error.to_string()))?
            .ok_or_else(|| {
                WorkspacePurgeError::Failed(format!(
                    "repo root {} not found for workspace {workspace_id}",
                    workspace.repo_root_id
                ))
            })?;
        let repo_root = PathBuf::from(repo_root_record.path);

        // kind=local: the directory is never touched, but sessions and native
        // JSONL die like any purge. The only repository writes are removal of
        // Proliferate-owned checkpoint refs and a deferred gc handoff.
        if workspace.kind == WorkspaceKind::Local {
            let repo_root_exists = path_exists(&repo_root)
                .await
                .map_err(|error| WorkspacePurgeError::Failed(error.to_string()))?;
            self.delete_checkpoint_artifacts(workspace_id).await?;
            if repo_root_exists {
                self.archive.defer_gc(repo_root);
            }
            self.delete_session_artifacts(workspace_id, &workspace_path)
                .await?;
            self.store
                .delete_workspace(workspace_id)
                .map_err(|error| WorkspacePurgeError::Failed(error.to_string()))?;
            return Ok(WorkspacePurgeOutcome::Deleted {
                already_deleted: false,
            });
        }

        // Managed-root containment guard, kept from today's
        // `retire_worktree_materialization` even though the ADR's §6
        // pseudocode does not carry it: an rm-rf fallback with no containment
        // check is an existing destructive-path guard silently dropped, which
        // this rung deliberately preserves rather than absorbs.
        //
        // The missing-directory early-out is part of that original guard and
        // is load-bearing: `runtime/materialization.rs` did
        // `if !worktree.exists() { return Ok(()); }` BEFORE canonicalizing.
        // `is_managed_worktree_path` canonicalizes, which is an ENOENT `Err`
        // — and therefore reads as "outside the managed root" — the instant
        // nothing exists at the path. An ARCHIVED row has no directory by
        // construction (archive's phase 2 removed it), and a crash between
        // the worktree removal and the ref delete leaves the same shape, so
        // collapsing that case into a refusal would make every archived
        // workspace permanently undeletable and would wedge the retry the
        // whole failure contract rests on. Absent path = the directory step
        // is already done, containment is not applicable, keep walking to the
        // refs, the gc, the artifacts, and the row. Containment is only ever
        // asked about a path that actually exists — which is exactly the only
        // case the rm-rf fallback can do damage in.
        let checkout_exists = path_exists(&workspace_path)
            .await
            .map_err(|error| WorkspacePurgeError::Failed(error.to_string()))?;
        if checkout_exists
            && !self
                .path_is_managed_worktree(&workspace_path)
                .await
                .map_err(|error| WorkspacePurgeError::Failed(error.to_string()))?
        {
            tracing::warn!(
                workspace_id = %workspace_id,
                path = %workspace.path,
                "refusing to remove a worktree outside the managed worktrees root"
            );
            return Err(WorkspacePurgeError::Failed(
                "refusing to remove a worktree outside the managed worktrees root".to_string(),
            ));
        }

        // Worktree removal: fallback rm-rf + re-remove, exit 128 "is not a
        // working tree" mapped to no-op success ONLY when a post-call stat
        // finds nothing at the path. Called unconditionally, including when
        // the checkout is already gone: the same exit-128 mapping converges
        // to `AlreadyGone`, and the call still clears a stale admin
        // registration a half-finished removal can have left behind.
        remove_worktree(&repo_root, &workspace_path)
            .await
            .map_err(WorkspacePurgeError::Failed)?;

        // Refs deletion goes through `archive/refs.rs`, the sole writer of
        // the namespace: the three named archive refs AND every rescue name
        // for this id (rescue names are exempt from every sweep duty and die
        // only with purge).
        {
            let target = repo_root.clone();
            let id = workspace_id.to_string();
            tokio::task::spawn_blocking(move || refs::delete_all_for(&target, &id))
                .await
                .map_err(|error| {
                    WorkspacePurgeError::Failed(format!("ref delete task failed: {error}"))
                })?
                .map_err(|error| WorkspacePurgeError::Failed(error.to_string()))?;
        }

        self.delete_checkpoint_artifacts(workspace_id).await?;

        // The detached, guarded, non-fatal gc: repo-global by nature, so
        // skipped outright while any archive/unarchive is in flight on this
        // repo root (the enqueue below covers it either way), and never
        // awaited — a big repo must never stall DELETE.
        if self.archive.repo_root_busy(&repo_root) {
            tracing::info!(
                workspace_id = %workspace_id,
                repo_root = %repo_root.display(),
                "skipping the inline purge gc: an archive or unarchive is in flight on this repo root"
            );
        } else {
            let target = repo_root.clone();
            let workspace_id = workspace_id.to_string();
            tokio::spawn(async move {
                let result =
                    tokio::task::spawn_blocking(move || GitService::gc_repo(&target)).await;
                match result {
                    Ok(Ok(())) => {}
                    Ok(Err(error)) => tracing::error!(
                        workspace_id = %workspace_id,
                        sentry_code = "PURGE_GC_FAILED",
                        error = %error,
                        "the purge-time repository gc failed"
                    ),
                    Err(error) => tracing::error!(
                        workspace_id = %workspace_id,
                        sentry_code = "PURGE_GC_FAILED",
                        error = %error,
                        "the purge-time gc task failed"
                    ),
                }
            });
        }
        // Unconditional: the purge-time gc reclaims essentially nothing for
        // the snapshot just deleted (its objects land in a cruft pack whose
        // mtimes are the archive time, not now), so every purge — inline gc
        // skipped or not — enqueues its repo root for the sweep's follow-up
        // gc past the hour grace. THAT is the actual free-the-space moment.
        self.archive.defer_gc(repo_root.clone());

        // Session artifacts: JSONL, session/graph rows, prompt attachments —
        // via `domains/sessions/deletion.rs`, the only flow allowed to touch
        // native JSONL.
        self.delete_session_artifacts(workspace_id, &workspace_path)
            .await?;

        // The row dies LAST.
        self.store
            .delete_workspace(workspace_id)
            .map_err(|error| WorkspacePurgeError::Failed(error.to_string()))?;

        Ok(WorkspacePurgeOutcome::Deleted {
            already_deleted: false,
        })
    }

    /// PR1227-WORKSPACE-FENCE-01/02: re-check, under the already-held
    /// exclusive workspace lease, the workspace's session set. FENCE-02 is
    /// checked FIRST because it catches the bind->terminalize race that
    /// FENCE-01 structurally cannot see (a terminal controller yields
    /// `None`).
    async fn reject_if_workflow_controlled(
        &self,
        workspace_id: &str,
        admitted_session_ids: Option<&BTreeSet<String>>,
    ) -> anyhow::Result<Option<WorkspacePurgeError>> {
        let session_ids = self
            .session_store
            .list_with_dismissed_by_workspace(workspace_id)?
            .into_iter()
            .map(|session| session.id)
            .collect::<Vec<_>>();
        if let Some(admitted) = admitted_session_ids {
            if let Some(unadmitted) = session_ids.iter().find(|id| !admitted.contains(*id)) {
                tracing::info!(
                    workspace_id = %workspace_id,
                    session_id = %unadmitted,
                    "workspace purge rejected under exclusive lease: a session appeared after the destruction admission snapshot"
                );
                return Ok(Some(WorkspacePurgeError::SessionAppearedAfterAdmission {
                    session_id: unadmitted.clone(),
                }));
            }
        }
        if let Some((session_id, run_id)) = self
            .admission
            .find_workflow_controlled_session(session_ids)
            .await?
        {
            tracing::info!(
                workspace_id = %workspace_id,
                session_id = %session_id,
                controlling_run_id = %run_id,
                "workspace purge rejected under exclusive lease: a workflow controls a session created after admission"
            );
            return Ok(Some(WorkspacePurgeError::ControlledByWorkflow { run_id }));
        }
        Ok(None)
    }

    /// Checkpoints (Lane H, ADR 5.3): expire rows first, preserving them as
    /// retention discovery metadata until every private ref is gone. Only then
    /// delete the rows. A crash or ref-deletion failure therefore converges on
    /// the next sweep or DELETE retry without making live metadata point at
    /// missing bytes.
    async fn delete_checkpoint_artifacts(
        &self,
        workspace_id: &str,
    ) -> Result<(), WorkspacePurgeError> {
        if self
            .checkpoints
            .delete_all_for_workspace_under_exclusive(workspace_id)
            .await
            .is_err()
        {
            tracing::error!(
                workspace_id = %workspace_id,
                sentry_code = "CHECKPOINT_PURGE_FAILED",
                failure_stage = "checkpoint_artifact_cleanup",
                "workspace purge could not delete checkpoint artifacts"
            );
            return Err(WorkspacePurgeError::CheckpointCleanupFailed);
        }
        Ok(())
    }

    /// `spawn_blocking`-wrapped session-artifact deletion. The workflow walks
    /// the filesystem once per session and then opens a DB transaction, so
    /// running it inline on the async runtime starves the bounded gate
    /// acquire and the bounded phase-2 cancel await this whole design depends
    /// on — the same reason every git and filesystem verb in this flow is
    /// wrapped.
    async fn delete_session_artifacts(
        &self,
        workspace_id: &str,
        workspace_path: &Path,
    ) -> Result<(), WorkspacePurgeError> {
        let workflow = self.session_delete_workflow.clone();
        let id = workspace_id.to_string();
        let path = workspace_path.to_path_buf();
        let runtime_home = self.runtime_home.clone();
        tokio::task::spawn_blocking(move || {
            workflow.delete_artifacts_for_workspace(&id, &path, &runtime_home)
        })
        .await
        .map_err(|error| {
            WorkspacePurgeError::Failed(format!("artifact delete task failed: {error}"))
        })?
        .map_err(|error| WorkspacePurgeError::Failed(error.to_string()))
    }

    async fn path_is_managed_worktree(&self, workspace_path: &Path) -> anyhow::Result<bool> {
        let runtime_home = self.runtime_home.clone();
        let candidate = workspace_path.to_path_buf();
        let managed = tokio::task::spawn_blocking(move || {
            is_managed_worktree_path(&runtime_home, &candidate)
        })
        .await?;
        // Unresolvable counts as "not managed": purge never guesses its way
        // into an rm-rf.
        Ok(managed.unwrap_or(false))
    }
}

/// `spawn_blocking`-wrapped existence stat, following symlinks exactly like
/// the `Path::exists` the original materialization guard used. Purge's
/// containment check is asked only when this says `true`: a path that is not
/// there cannot be canonicalized, and treating that as "outside the managed
/// root" is what made every archived workspace undeletable.
async fn path_exists(path: &Path) -> anyhow::Result<bool> {
    let candidate = path.to_path_buf();
    Ok(tokio::task::spawn_blocking(move || candidate.exists()).await?)
}

/// `spawn_blocking`-wrapped forced worktree removal, mapping the adapter's
/// error-shaped return to a plain message. No repo-global `worktree prune`
/// anywhere in the fallback — `GitService::remove_worktree_force` already
/// omits it.
async fn remove_worktree(repo_root: &Path, workspace_path: &Path) -> Result<(), String> {
    let repo_root_string = repo_root.display().to_string();
    let path_string = workspace_path.display().to_string();
    let removal = tokio::task::spawn_blocking(move || {
        GitService::remove_worktree_force(&repo_root_string, &path_string)
    })
    .await
    .map_err(|error| format!("worktree removal task failed: {error}"))?;
    match removal {
        Ok(WorktreeRemoveOutcome::Removed | WorktreeRemoveOutcome::AlreadyGone) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}
