use std::path::Path;

use super::WorkspaceRuntime;
use crate::adapters::git::types::{GitWorktreeRestoreError, GitWorktreeRestoreOutcome};
use crate::adapters::git::GitService;
use crate::domains::workspaces::model::{WorkspaceKind, WorkspaceLifecycleState, WorkspaceRecord};

#[derive(Debug, Clone)]
pub struct RestoreWorktreeResult {
    pub workspace: WorkspaceRecord,
    pub outcome: GitWorktreeRestoreOutcome,
}

#[derive(Debug, thiserror::Error)]
pub enum RestoreWorktreeError {
    #[error("workspace not found: {0}")]
    WorkspaceNotFound(String),
    #[error("workspace {workspace_id} is not a worktree workspace")]
    WorkspaceKindIneligible { workspace_id: String },
    #[error("workspace {workspace_id} is not active")]
    WorkspaceNotActive { workspace_id: String },
    #[error("workspace {workspace_id} has no recorded attached branch")]
    RecordedBranchMissing { workspace_id: String },
    #[error("repository record is missing for workspace {workspace_id}")]
    RepositoryRecordMissing { workspace_id: String },
    #[error(
        "workspace {workspace_id} conflicts with workspace {conflicting_workspace_id} at {path}"
    )]
    WorkspaceRegistrationConflict {
        workspace_id: String,
        conflicting_workspace_id: String,
        path: String,
    },
    #[error(transparent)]
    Git(#[from] GitWorktreeRestoreError),
    #[error("workspace restore storage failed: {0}")]
    Storage(#[source] anyhow::Error),
}

impl WorkspaceRuntime {
    #[tracing::instrument(skip(self), fields(workspace_id = %workspace_id))]
    pub fn restore_worktree(
        &self,
        workspace_id: &str,
    ) -> Result<RestoreWorktreeResult, RestoreWorktreeError> {
        let workspace = self
            .store
            .find_by_id(workspace_id)
            .map_err(RestoreWorktreeError::Storage)?
            .ok_or_else(|| RestoreWorktreeError::WorkspaceNotFound(workspace_id.to_string()))?;
        if workspace.kind != WorkspaceKind::Worktree {
            return Err(RestoreWorktreeError::WorkspaceKindIneligible {
                workspace_id: workspace.id,
            });
        }
        if workspace.lifecycle_state != WorkspaceLifecycleState::Active {
            return Err(RestoreWorktreeError::WorkspaceNotActive {
                workspace_id: workspace.id,
            });
        }
        let branch = workspace
            .current_branch
            .as_deref()
            .map(str::trim)
            .filter(|branch| !branch.is_empty() && *branch != "HEAD")
            .ok_or_else(|| RestoreWorktreeError::RecordedBranchMissing {
                workspace_id: workspace.id.clone(),
            })?;
        let repo_root = self
            .repo_root_service
            .get_repo_root(&workspace.repo_root_id)
            .map_err(RestoreWorktreeError::Storage)?
            .ok_or_else(|| RestoreWorktreeError::RepositoryRecordMissing {
                workspace_id: workspace.id.clone(),
            })?;
        if let Some(conflict) = self
            .store
            .find_active_by_path_excluding_id(&workspace.path, &workspace.id)
            .map_err(RestoreWorktreeError::Storage)?
        {
            return Err(RestoreWorktreeError::WorkspaceRegistrationConflict {
                workspace_id: workspace.id,
                conflicting_workspace_id: conflict.id,
                path: workspace.path,
            });
        }

        let outcome = GitService::restore_worktree(
            Path::new(&repo_root.path),
            Path::new(&workspace.path),
            branch,
        )?;
        Ok(RestoreWorktreeResult { workspace, outcome })
    }
}
