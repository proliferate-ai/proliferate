use std::sync::Arc;

use crate::domains::workspaces::operation_gate::{WorkspaceOperationGate, WorkspaceOperationKind};
use crate::domains::workspaces::runtime::{
    RestoreWorktreeError, RestoreWorktreeResult, WorkspaceRuntime,
};

#[derive(Clone)]
pub struct RestoreWorktreeRuntime {
    workspace_runtime: Arc<WorkspaceRuntime>,
    operation_gate: Arc<WorkspaceOperationGate>,
}

#[derive(Debug, thiserror::Error)]
pub enum RestoreWorktreeRequestError {
    #[error("worktree restore task failed: {0}")]
    TaskFailed(tokio::task::JoinError),
    #[error(transparent)]
    Restore(#[from] RestoreWorktreeError),
}

impl RestoreWorktreeRuntime {
    pub fn new(
        workspace_runtime: Arc<WorkspaceRuntime>,
        operation_gate: Arc<WorkspaceOperationGate>,
    ) -> Self {
        Self {
            workspace_runtime,
            operation_gate,
        }
    }

    #[tracing::instrument(skip(self), fields(workspace_id = %workspace_id))]
    pub async fn restore_worktree(
        &self,
        workspace_id: &str,
    ) -> Result<RestoreWorktreeResult, RestoreWorktreeRequestError> {
        let _lease = self
            .operation_gate
            .acquire_exclusive_with_kind(workspace_id, WorkspaceOperationKind::WorktreeRestore)
            .await;
        let runtime = self.workspace_runtime.clone();
        let workspace_id = workspace_id.to_string();
        tokio::task::spawn_blocking(move || runtime.restore_worktree(&workspace_id))
            .await
            .map_err(RestoreWorktreeRequestError::TaskFailed)?
            .map_err(RestoreWorktreeRequestError::Restore)
    }
}
