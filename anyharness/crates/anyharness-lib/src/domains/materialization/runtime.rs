//! The materialization runtime valve.
//!
//! `service.rs` owns the durable-only use case (clone-or-adopt repo-root
//! acquisition). Exact-ref workspace materialization also lives here because
//! reusing/adopting an existing workspace must reject one that has live
//! sessions or active terminals — the ONE materialization use case that must
//! reach live truth. This module is the ONLY materialization code allowed to
//! import `crate::live`; see the valve rule in `anyharness-structure.md`.
//!
//! Direction is one-way: the runtime wraps the service and delegates down
//! (`acquire_repo_root` is a thin passthrough), never the reverse. `AppState`
//! exposes only `materialization_runtime`, not the service, so callers reach
//! both use cases through one handle instead of two overlapping ones.

use std::sync::Arc;

use super::identity::{validate_branch_name, validate_head_sha};
use super::model::{
    AcquireRepoRootResult, MaterializationError, MaterializationKind,
    MaterializationOperationRecord, MaterializeWorkspaceResult,
};
use super::operation_lock::MaterializationOperationLocks;
use super::service::{
    begin_operation, hash_request, internal, record_failure, AdmissionPlan, MaterializationService,
    Result,
};
use super::store::MaterializationOperationStore;
use super::workspace_plan::{map_exact_ref_error, prepare_workspace_destination};
use crate::domains::sessions::runtime::SessionRuntime;
use crate::domains::workspaces::runtime::{ExactRefOutcome, WorkspaceRuntime};
use crate::live::terminals::TerminalService;

pub struct MaterializationRuntime {
    materialization_service: Arc<MaterializationService>,
    workspace_runtime: Arc<WorkspaceRuntime>,
    store: MaterializationOperationStore,
    operation_locks: MaterializationOperationLocks,
    session_runtime: Arc<SessionRuntime>,
    terminal_service: Arc<TerminalService>,
}

impl MaterializationRuntime {
    pub fn new(
        materialization_service: Arc<MaterializationService>,
        workspace_runtime: Arc<WorkspaceRuntime>,
        store: MaterializationOperationStore,
        operation_locks: MaterializationOperationLocks,
        session_runtime: Arc<SessionRuntime>,
        terminal_service: Arc<TerminalService>,
    ) -> Self {
        Self {
            materialization_service,
            workspace_runtime,
            store,
            operation_locks,
            session_runtime,
            terminal_service,
        }
    }

    /// Delegates straight down to the durable service. Repo-root acquisition
    /// needs no live truth, but routing it through the valve keeps `AppState`
    /// holding a single materialization handle instead of two overlapping ones.
    pub async fn acquire_repo_root(
        &self,
        operation_id: &str,
        provider: &str,
        owner: &str,
        name: &str,
        clone_url: &str,
        destination_path: &str,
    ) -> Result<AcquireRepoRootResult> {
        self.materialization_service
            .acquire_repo_root(operation_id, provider, owner, name, clone_url, destination_path)
            .await
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

        let _guard = match begin_operation(
            &self.store,
            &self.operation_locks,
            &operation_id,
            MaterializationKind::Workspace,
            &request_hash,
        )
        .await?
        {
            AdmissionPlan::Replay(record) => return self.replay_workspace(&record).await,
            AdmissionPlan::Proceed { guard, .. } => guard,
        };

        // Persist the destination before Git runs for crash adoption (PR3-CRASH-06).
        let effective_destination_id = prepare_workspace_destination(
            &self.workspace_runtime,
            &self.store,
            &operation_id,
            &repo_root_id,
            destination_id.as_deref(),
            preferred_workspace_name.as_deref().unwrap_or(&branch_name),
            &head_sha,
        )?;

        let outcome = self
            .run_materialize_workspace(
                &repo_root_id,
                &branch_name,
                &head_sha,
                Some(&effective_destination_id),
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
                record_failure(&self.store, &operation_id, &error);
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
        validate_head_sha(&observed).map_err(|_| {
            MaterializationError::Failed(
                "completed workspace op has an invalid observed head sha".into(),
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
}
