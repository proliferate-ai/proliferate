use std::sync::Arc;

use crate::persistence::Db;
use crate::sessions::deletion::SessionDeleteWorkflow;

pub trait WorkspaceDeleteParticipant: Send + Sync {
    fn delete_workspace_rows_in_tx(
        &self,
        conn: &rusqlite::Connection,
        workspace_id: &str,
    ) -> rusqlite::Result<()>;
}

#[derive(Clone)]
pub struct WorkspaceDeleteWorkflow {
    db: Db,
    session_delete_workflow: SessionDeleteWorkflow,
    participants: Vec<Arc<dyn WorkspaceDeleteParticipant>>,
}

impl WorkspaceDeleteWorkflow {
    pub fn new(db: Db, session_delete_workflow: SessionDeleteWorkflow) -> Self {
        Self {
            db,
            session_delete_workflow,
            participants: Vec::new(),
        }
    }

    pub fn with_participants(
        db: Db,
        session_delete_workflow: SessionDeleteWorkflow,
        participants: Vec<Arc<dyn WorkspaceDeleteParticipant>>,
    ) -> Self {
        Self {
            db,
            session_delete_workflow,
            participants,
        }
    }

    pub fn delete_workspace_record(&self, workspace_id: &str) -> anyhow::Result<()> {
        self.db.with_tx(|conn| {
            self.delete_workspace_scoped_graph_rows_in_tx(conn, workspace_id)?;
            crate::workspaces::store::delete_workspace_row_in_tx(conn, workspace_id)?;
            Ok(())
        })
    }

    pub fn purge_workspace_with_sessions(&self, workspace_id: &str) -> anyhow::Result<()> {
        self.db.with_tx(|conn| {
            let session_ids =
                crate::sessions::store::sessions::list_session_ids_by_workspace_in_tx(
                    conn,
                    workspace_id,
                )?;
            for session_id in session_ids {
                self.session_delete_workflow
                    .delete_session_graph_in_tx(conn, &session_id)?;
            }
            self.delete_workspace_scoped_graph_rows_in_tx(conn, workspace_id)?;
            crate::workspaces::store::delete_workspace_row_in_tx(conn, workspace_id)?;
            Ok(())
        })
    }

    fn delete_workspace_scoped_graph_rows_in_tx(
        &self,
        conn: &rusqlite::Connection,
        workspace_id: &str,
    ) -> rusqlite::Result<()> {
        crate::workspaces::access_store::delete_workspace_access_modes_in_tx(conn, workspace_id)?;
        for participant in &self.participants {
            participant.delete_workspace_rows_in_tx(conn, workspace_id)?;
        }
        crate::domains::terminals::store::delete_workspace_terminal_rows_in_tx(conn, workspace_id)?;
        Ok(())
    }
}

#[cfg(test)]
#[path = "deletion_tests.rs"]
mod tests;
