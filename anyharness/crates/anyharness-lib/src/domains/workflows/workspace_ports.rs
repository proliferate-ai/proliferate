use crate::domains::workspaces::deletion::WorkspaceDeleteParticipant;

use super::store::WorkflowStore;

/// Workspace-lifecycle port for broker-materialized workflow worktrees.
///
/// Generic workspace purge may never substitute control-process Git cleanup for
/// the workflow broker's exact materialization receipt.
pub struct WorkflowWorkspaceDeleteParticipant;

impl WorkspaceDeleteParticipant for WorkflowWorkspaceDeleteParticipant {
    fn delete_workspace_rows_in_tx(
        &self,
        _conn: &rusqlite::Connection,
        _workspace_id: &str,
    ) -> rusqlite::Result<()> {
        Ok(())
    }

    fn prepare_workspace_purge_in_tx(
        &self,
        conn: &rusqlite::Connection,
        workspace_id: &str,
        _purged_at: &str,
    ) -> rusqlite::Result<()> {
        WorkflowStore::reject_registered_workspace_purge_tx(conn, workspace_id)
    }

    fn workspace_purge_blocker_in_tx(
        &self,
        conn: &rusqlite::Connection,
        workspace_id: &str,
    ) -> rusqlite::Result<Option<String>> {
        WorkflowStore::workspace_purge_blocker_tx(conn, workspace_id)
    }
}
