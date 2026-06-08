use rusqlite::{params, Connection};

use super::row::insert_workspace;
use super::WorkspaceStore;
use crate::domains::workspaces::model::{
    WorkspaceCleanupOperation, WorkspaceCleanupState, WorkspaceLifecycleState, WorkspaceRecord,
};

impl WorkspaceStore {
    pub fn update_lifecycle_cleanup_state(
        &self,
        workspace_id: &str,
        lifecycle_state: WorkspaceLifecycleState,
        cleanup_state: WorkspaceCleanupState,
        cleanup_operation: Option<WorkspaceCleanupOperation>,
        cleanup_error_message: Option<&str>,
        cleanup_failed_at: Option<&str>,
        cleanup_attempted_at: Option<&str>,
        updated_at: &str,
    ) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE workspaces
                 SET lifecycle_state = ?2,
                     cleanup_state = ?3,
                     cleanup_operation = ?4,
                     cleanup_error_message = ?5,
                     cleanup_failed_at = ?6,
                     cleanup_attempted_at = ?7,
                     updated_at = ?8
                 WHERE id = ?1",
                params![
                    workspace_id,
                    lifecycle_state.as_str(),
                    cleanup_state.as_str(),
                    cleanup_operation.map(WorkspaceCleanupOperation::as_str),
                    cleanup_error_message,
                    cleanup_failed_at,
                    cleanup_attempted_at,
                    updated_at,
                ],
            )?;
            Ok(())
        })
    }

    pub fn update_current_branch(
        &self,
        workspace_id: &str,
        current_branch: Option<&str>,
        updated_at: &str,
    ) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE workspaces
                 SET current_branch = ?2, updated_at = ?3
                 WHERE id = ?1",
                params![workspace_id, current_branch, updated_at],
            )?;
            Ok(())
        })
    }

    pub fn update_display_name(
        &self,
        workspace_id: &str,
        display_name: Option<&str>,
        updated_at: &str,
    ) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE workspaces
                 SET display_name = ?2, updated_at = ?3
                 WHERE id = ?1",
                params![workspace_id, display_name, updated_at],
            )?;
            Ok(())
        })
    }

    pub fn insert(&self, record: &WorkspaceRecord) -> anyhow::Result<()> {
        self.db.with_conn(|conn| insert_workspace(conn, record))
    }

    pub fn delete_by_id(&self, workspace_id: &str) -> anyhow::Result<()> {
        self.db
            .with_tx(|conn| delete_workspace_row_in_tx(conn, workspace_id))
    }
}

pub(crate) fn delete_workspace_row_in_tx(
    conn: &Connection,
    workspace_id: &str,
) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM workspaces WHERE id = ?1", [workspace_id])?;
    Ok(())
}
