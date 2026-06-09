use super::row::{map_row, WORKSPACE_COLUMNS};
use super::WorkspaceStore;
use crate::domains::workspaces::model::WorkspaceRecord;

impl WorkspaceStore {
    pub fn list_all(&self) -> anyhow::Result<Vec<WorkspaceRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(&format!(
                "SELECT {WORKSPACE_COLUMNS} FROM workspaces ORDER BY updated_at DESC"
            ))?;
            let rows = stmt.query_map([], |row| map_row(row))?;
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

    pub fn list_standard_active_worktrees(&self) -> anyhow::Result<Vec<WorkspaceRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(&format!(
                "SELECT {WORKSPACE_COLUMNS} FROM workspaces
                 WHERE kind = 'worktree'
                   AND surface = 'standard'
                   AND lifecycle_state = 'active'
                 ORDER BY repo_root_id ASC,
                          updated_at DESC,
                          created_at DESC,
                          id ASC"
            ))?;
            let rows = stmt.query_map([], map_row)?;
            rows.collect()
        })
    }
}
