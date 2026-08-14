use super::WorkspaceRuntime;
use crate::domains::workspaces::model::{WorkspaceKind, WorkspaceRecord};

impl WorkspaceRuntime {
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
