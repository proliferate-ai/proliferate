use super::WorkspaceRuntime;
use crate::domains::workspaces::model::{
    WorkspaceCleanupOperation, WorkspaceCleanupState, WorkspaceKind, WorkspaceLifecycleState,
    WorkspaceRecord,
};

impl WorkspaceRuntime {
    pub fn set_lifecycle_cleanup_state(
        &self,
        workspace_id: &str,
        lifecycle_state: WorkspaceLifecycleState,
        cleanup_state: WorkspaceCleanupState,
        cleanup_operation: Option<WorkspaceCleanupOperation>,
        cleanup_error_message: Option<&str>,
        cleanup_failed_at: Option<&str>,
        cleanup_attempted_at: Option<&str>,
    ) -> anyhow::Result<Option<WorkspaceRecord>> {
        let now = chrono::Utc::now().to_rfc3339();
        self.store.update_lifecycle_cleanup_state(
            workspace_id,
            lifecycle_state,
            cleanup_state,
            cleanup_operation,
            cleanup_error_message,
            cleanup_failed_at,
            cleanup_attempted_at,
            &now,
        )?;
        self.get_workspace(workspace_id)
    }

    pub fn find_active_workspace_by_path_and_kind(
        &self,
        path: &str,
        kind: WorkspaceKind,
    ) -> anyhow::Result<Option<WorkspaceRecord>> {
        self.store.find_active_by_path_and_kind(path, kind)
    }

    pub fn find_active_worktree_by_path_excluding_id(
        &self,
        path: &str,
        excluded_id: &str,
    ) -> anyhow::Result<Option<WorkspaceRecord>> {
        self.store.find_active_by_path_and_kind_excluding_id(
            path,
            WorkspaceKind::Worktree,
            excluded_id,
        )
    }
}
