//! The checkpoints subdomain: turn-start capture of a workspace's git state
//! into the private `refs/proliferate/checkpoints/*` namespace, and the
//! retention that bounds it.
//!
//! Sibling of `archive/` and shaped the same way — a thin service struct with
//! the per-concern logic in its own files (`refs`, `capture`, `retention`) —
//! because the two share a discipline: the private refs namespace is the bytes
//! truth (sole-written in `refs.rs`, survives gc via peelable objects), a row is
//! the metadata truth, and every destructive step orders itself in the fail-safe
//! direction (bytes durable before metadata at capture; metadata expired before
//! bytes at deletion).
//!
//! What is IN this rung: turn-start capture behind `ANYHARNESS_CHECKPOINT_CAPTURE`
//! (default off, cost-observation), retention (keep-N + age cap), purge
//! integration, and fork rows referencing the boundary checkpoint. What is OUT,
//! by ADR scope: the revert operation and its modal (later PRs). The in-flight
//! revert registry ships here anyway, because retention must already exempt a
//! checkpoint a future revert is relying on.

pub mod capture;
pub mod flags;
pub mod inflight;
pub mod refs;
pub mod retention;

#[cfg(test)]
mod gc_tests;
#[cfg(test)]
mod retention_tests;
#[cfg(test)]
pub(crate) mod test_support;
#[cfg(test)]
mod tests;

use std::path::PathBuf;
use std::sync::Arc;

use crate::domains::repo_roots::store::RepoRootStore;
use crate::domains::workspaces::model::{WorkspaceKind, WorkspaceRecord};
use crate::domains::workspaces::operation_gate::WorkspaceOperationGate;
use crate::domains::workspaces::store::WorkspaceStore;

use self::inflight::InFlightReverts;

/// The cadence that produced a checkpoint. Persisted as the row's `origin`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CheckpointOrigin {
    /// A turn-start capture (the only cadence this rung captures).
    TurnStart,
    /// A fork boundary (reserved for a later PR; rows are never written with
    /// this origin here, but the enum carries it so the schema and lookups are
    /// stable).
    ForkBoundary,
    /// The standing un-revert handle (reserved for the revert PR).
    Safety,
}

impl CheckpointOrigin {
    pub fn as_str(self) -> &'static str {
        match self {
            CheckpointOrigin::TurnStart => "turn_start",
            CheckpointOrigin::ForkBoundary => "fork_boundary",
            CheckpointOrigin::Safety => "safety",
        }
    }

    pub fn parse(value: &str) -> anyhow::Result<Self> {
        Ok(match value {
            "turn_start" => CheckpointOrigin::TurnStart,
            "fork_boundary" => CheckpointOrigin::ForkBoundary,
            "safety" => CheckpointOrigin::Safety,
            other => anyhow::bail!("unknown checkpoint origin: {other}"),
        })
    }
}

/// One captured checkpoint's metadata row. The bytes it names live in
/// `refs/proliferate/checkpoints/<workspace_id>/<id>/{head,worktree,index}`.
#[derive(Debug, Clone)]
pub struct CheckpointRecord {
    pub id: String,
    pub workspace_id: String,
    pub origin: CheckpointOrigin,
    pub session_id: Option<String>,
    pub turn_id: Option<String>,
    pub prompt_id: Option<String>,
    pub fork_operation_id: Option<String>,
    pub revert_operation_id: Option<String>,
    pub head_sha: String,
    /// The PEELED working-tree tree OID.
    pub work_tree_oid: String,
    /// The PEELED staged-tree tree OID.
    pub index_tree_oid: String,
    /// Whether the worktree ref points at a parentless LFS anchor commit.
    pub work_tree_anchored: bool,
    /// Whether the index ref points at a parentless LFS anchor commit.
    pub index_tree_anchored: bool,
    pub notices_json: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub expired_at: Option<String>,
}

/// The house orchestrator pattern shared with `WorkspaceArchiveService` and
/// `WorkspacePurgeService`: a service struct with injected dependencies,
/// assembled by the workspace composition family in `app/workspaces.rs`.
pub struct WorkspaceCheckpointService {
    pub(super) store: WorkspaceStore,
    pub(super) repo_root_store: RepoRootStore,
    pub(super) workspace_operation_gate: Arc<WorkspaceOperationGate>,
    pub(super) inflight: InFlightReverts,
}

impl WorkspaceCheckpointService {
    pub fn new(
        store: WorkspaceStore,
        repo_root_store: RepoRootStore,
        operation_gate: Arc<WorkspaceOperationGate>,
    ) -> Self {
        Self {
            store,
            repo_root_store,
            workspace_operation_gate: operation_gate,
            inflight: InFlightReverts::default(),
        }
    }

    /// Capture the workspace's current git state as a turn-start checkpoint.
    /// The caller MUST hold the workspace's shared `SessionPrompt` lease for
    /// the full capture→dispatch→settlement interval. SessionRuntime owns that
    /// one non-nested lease for every prompt source, including internal ones.
    pub(crate) async fn capture_turn_start_under_workspace_lease(
        self: &Arc<Self>,
        workspace_id: &str,
        session_id: Option<String>,
        prompt_id: Option<String>,
    ) -> Result<CheckpointRecord, capture::CheckpointCaptureError> {
        capture::capture(
            self,
            workspace_id,
            CheckpointOrigin::TurnStart,
            session_id,
            prompt_id,
        )
        .await
    }

    /// The retention duty (keep-N + age cap + exemptions + orphan reap). See
    /// `retention.rs`. Runs as a new duty of the archive sweep.
    pub async fn sweep_retention(self: &Arc<Self>) {
        retention::sweep_retention(self).await
    }

    /// The `(parent_session_id, anchor_turn_id)` boundary lookup fork uses to
    /// stamp `fork_operations.checkpoint_id`. `None` when capture was off or no
    /// unexpired checkpoint sits at the boundary.
    pub fn find_checkpoint_id_for_boundary(
        &self,
        session_id: &str,
        turn_id: &str,
    ) -> Option<String> {
        match self
            .store
            .find_unexpired_checkpoint_by_boundary(session_id, turn_id)
        {
            Ok(record) => record.map(|record| record.id),
            Err(_error) => {
                tracing::warn!(
                    session_id = %session_id,
                    turn_id = %turn_id,
                    sentry_code = "CHECKPOINT_LINKAGE_FAILED",
                    failure_stage = "checkpoint_boundary_lookup",
                    "checkpoint linkage lookup failed; recording fork without a checkpoint"
                );
                None
            }
        }
    }

    /// The in-flight revert registry, so the future revert flow (and this rung's
    /// retention-exemption test) can claim a checkpoint id.
    pub fn inflight_reverts(&self) -> &InFlightReverts {
        &self.inflight
    }

    /// Backfill `turn_id` onto a checkpoint once the actor reports the turn it
    /// started, and expire a checkpoint whose turn was queued (the race lost).
    /// Thin pass-throughs so the prompt hook does not reach into the store.
    pub fn set_turn_id(&self, checkpoint_id: &str, turn_id: &str) -> anyhow::Result<()> {
        self.store
            .set_checkpoint_turn_id(checkpoint_id, turn_id, &now())
    }

    /// Expire a checkpoint (row) and delete its three refs, in the fail-safe
    /// order (row first). Used by the prompt hook when a dispatch queued.
    pub async fn expire_and_delete(self: &Arc<Self>, checkpoint_id: &str) -> anyhow::Result<()> {
        let Some(record) = self.store.find_checkpoint(checkpoint_id)? else {
            return Ok(());
        };
        self.store.mark_checkpoint_expired(checkpoint_id, &now())?;
        let workspace = self.store.require_workspace(&record.workspace_id)?;
        let repo_root = self.repo_root_path(&workspace)?;
        let checkpoint_id = checkpoint_id.to_string();
        let workspace_id = record.workspace_id;
        tokio::task::spawn_blocking(move || {
            refs::delete_for(&repo_root, &workspace_id, &checkpoint_id)
        })
        .await
        .map_err(|error| anyhow::anyhow!("checkpoint ref delete task failed: {error}"))?
    }

    /// Remove every checkpoint artifact for a workspace in the fail-safe order:
    /// expire metadata, delete refs, then delete metadata. All authoritative
    /// workspace-row deletion paths call this before the row dies.
    #[tracing::instrument(skip_all, fields(workspace_id = %workspace_id))]
    pub async fn delete_all_for_workspace_under_exclusive(
        self: &Arc<Self>,
        workspace_id: &str,
    ) -> anyhow::Result<()> {
        let Some(workspace) = self.store.find_workspace(workspace_id)? else {
            return Ok(());
        };
        let repo_root = self.repo_root_path(&workspace)?;
        let local_repo_missing =
            workspace.kind == WorkspaceKind::Local && !repo_root.try_exists()?;
        self.store
            .mark_checkpoints_expired_for_workspace(workspace_id, &now())?;
        if !local_repo_missing {
            let target = repo_root;
            let id = workspace_id.to_string();
            tokio::task::spawn_blocking(move || refs::delete_all_for(&target, &id))
                .await
                .map_err(|error| anyhow::anyhow!("checkpoint ref delete task failed: {error}"))??;
        }
        self.store.delete_checkpoints_for_workspace(workspace_id)
    }

    /// Blocking twin for the mobility destroy-source pipeline, whose domain
    /// execution already runs inside `spawn_blocking` while holding the global
    /// workspace-exclusive lease.
    #[tracing::instrument(skip_all, fields(workspace_id = %workspace_id))]
    pub fn delete_all_for_workspace_under_exclusive_blocking(
        &self,
        workspace_id: &str,
    ) -> anyhow::Result<()> {
        let Some(workspace) = self.store.find_workspace(workspace_id)? else {
            return Ok(());
        };
        let repo_root = self.repo_root_path(&workspace)?;
        let local_repo_missing =
            workspace.kind == WorkspaceKind::Local && !repo_root.try_exists()?;
        self.store
            .mark_checkpoints_expired_for_workspace(workspace_id, &now())?;
        if !local_repo_missing {
            refs::delete_all_for(&repo_root, workspace_id)?;
        }
        self.store.delete_checkpoints_for_workspace(workspace_id)
    }

    /// Resolve a workspace row's repo root into a path. Mirrors
    /// `WorkspaceArchiveService::repo_root_path` (whose `pub(super)` is not
    /// widened): the two-step `WorkspaceStore`/`RepoRootStore` resolution is the
    /// orchestrator's edge, keeping the git adapter ignorant of workspace rows.
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

    /// The store, for the checkpoint suites only (mirrors archive's
    /// `store_for_tests`).
    #[cfg(test)]
    pub(crate) fn store_for_tests(&self) -> &WorkspaceStore {
        &self.store
    }
}

/// The single clock for checkpoint lifecycle writes, matching the archive
/// subdomain's `now()` so every column carries the same rfc3339 shape.
pub(super) fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}
