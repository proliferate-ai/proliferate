use super::row::{map_row, WORKSPACE_COLUMNS};
use super::WorkspaceStore;
use crate::domains::workspaces::model::{WorkspaceLifecycleState, WorkspaceRecord};

impl WorkspaceStore {
    /// Execution surfaces filtered to one lifecycle: what `?lifecycle=` answers
    /// and what the leftover sweep walks. The renamed `idx_workspaces_lifecycle`
    /// index exists for exactly this query.
    pub fn list_by_lifecycle(
        &self,
        lifecycle_state: WorkspaceLifecycleState,
    ) -> anyhow::Result<Vec<WorkspaceRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(&format!(
                "SELECT {WORKSPACE_COLUMNS} FROM workspaces
                 WHERE kind IN ('local', 'worktree')
                   AND lifecycle_state = ?1
                 ORDER BY updated_at DESC"
            ))?;
            let rows = stmt.query_map([lifecycle_state.as_str()], map_row)?;
            rows.collect()
        })
    }

    pub fn list_all(&self) -> anyhow::Result<Vec<WorkspaceRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(&format!(
                "SELECT {WORKSPACE_COLUMNS} FROM workspaces ORDER BY updated_at DESC"
            ))?;
            let rows = stmt.query_map([], map_row)?;
            rows.collect()
        })
    }

    pub fn list_execution_surfaces(&self) -> anyhow::Result<Vec<WorkspaceRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(&format!(
                "SELECT {WORKSPACE_COLUMNS} FROM workspaces
                 WHERE kind IN ('local', 'worktree')
                 ORDER BY updated_at DESC"
            ))?;
            let rows = stmt.query_map([], map_row)?;
            rows.collect()
        })
    }

    pub fn list_by_repo_root_id(&self, repo_root_id: &str) -> anyhow::Result<Vec<WorkspaceRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(&format!(
                "SELECT {WORKSPACE_COLUMNS} FROM workspaces
                 WHERE repo_root_id = ?1
                 ORDER BY updated_at DESC"
            ))?;
            let rows = stmt.query_map([repo_root_id], map_row)?;
            rows.collect()
        })
    }

    pub fn list_active_by_repo_root_id(
        &self,
        repo_root_id: &str,
    ) -> anyhow::Result<Vec<WorkspaceRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(&format!(
                "SELECT {WORKSPACE_COLUMNS} FROM workspaces
                 WHERE repo_root_id = ?1 AND lifecycle_state = 'active'
                 ORDER BY updated_at DESC"
            ))?;
            let rows = stmt.query_map([repo_root_id], map_row)?;
            rows.collect()
        })
    }
}
