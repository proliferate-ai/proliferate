use std::sync::Arc;

use crate::persistence::Db;

pub mod purge;

pub trait WorkspaceDeleteParticipant: Send + Sync {
    fn delete_workspace_rows_in_tx(
        &self,
        conn: &rusqlite::Connection,
        workspace_id: &str,
    ) -> rusqlite::Result<()>;
}

/// The surviving, non-purge half: workspace materialization's own cleanup
/// path (`remove_worktree_workspace`/`park_local_workspace`), always run on a
/// workspace already known to have zero sessions — so unlike purge's split
/// surfaces, there is no session graph left to delete here, and this struct
/// holds no `SessionDeleteWorkflow` of its own.
#[derive(Clone)]
pub struct WorkspaceDeleteWorkflow {
    db: Db,
    participants: Vec<Arc<dyn WorkspaceDeleteParticipant>>,
}

impl WorkspaceDeleteWorkflow {
    pub fn new(db: Db) -> Self {
        Self {
            db,
            participants: Vec::new(),
        }
    }

    pub fn with_participants(
        db: Db,
        participants: Vec<Arc<dyn WorkspaceDeleteParticipant>>,
    ) -> Self {
        Self { db, participants }
    }

    pub fn delete_workspace_record(&self, workspace_id: &str) -> anyhow::Result<()> {
        self.db.with_tx(|conn| {
            self.delete_workspace_scoped_graph_rows_in_tx(conn, workspace_id)?;
            crate::domains::workspaces::store::delete_workspace_row_in_tx(conn, workspace_id)?;
            Ok(())
        })
    }

    fn delete_workspace_scoped_graph_rows_in_tx(
        &self,
        conn: &rusqlite::Connection,
        workspace_id: &str,
    ) -> rusqlite::Result<()> {
        crate::domains::workspaces::store::delete_workspace_access_modes_in_tx(conn, workspace_id)?;
        for participant in &self.participants {
            participant.delete_workspace_rows_in_tx(conn, workspace_id)?;
        }
        crate::domains::terminals::store::delete_workspace_terminal_rows_in_tx(conn, workspace_id)?;
        Ok(())
    }
}

#[cfg(test)]
#[path = "tests/mod.rs"]
mod tests;
