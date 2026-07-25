use std::sync::Arc;

use crate::domains::sessions::deletion::SessionDeleteWorkflow;
use crate::persistence::Db;

pub trait WorkspaceDeleteParticipant: Send + Sync {
    fn delete_workspace_rows_in_tx(
        &self,
        conn: &rusqlite::Connection,
        workspace_id: &str,
    ) -> rusqlite::Result<()>;

    /// Consume durable ownership that may be released only after the purge
    /// caller has proven external workspace cleanup. Product domains implement
    /// this hook; the core workspace domain does not import them directly.
    fn prepare_workspace_purge_in_tx(
        &self,
        _conn: &rusqlite::Connection,
        _workspace_id: &str,
        _purged_at: &str,
    ) -> rusqlite::Result<()> {
        Ok(())
    }

    /// Race-sensitive durable ownership check performed before any live
    /// session, filesystem, or Git cleanup. Returning a blocker keeps the
    /// workspace and every external ownership record intact.
    fn workspace_purge_blocker_in_tx(
        &self,
        _conn: &rusqlite::Connection,
        _workspace_id: &str,
    ) -> rusqlite::Result<Option<String>> {
        Ok(None)
    }
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
            crate::domains::workspaces::store::delete_workspace_row_in_tx(conn, workspace_id)?;
            Ok(())
        })
    }

    pub fn purge_workspace_with_sessions(&self, workspace_id: &str) -> anyhow::Result<()> {
        let purged_at = chrono::Utc::now().to_rfc3339();
        self.db.with_tx(|conn| {
            let session_ids =
                crate::domains::sessions::store::sessions::list_session_ids_by_workspace_in_tx(
                    conn,
                    workspace_id,
                )?;
            for session_id in session_ids {
                self.session_delete_workflow
                    .delete_session_graph_in_tx(conn, &session_id)?;
            }
            self.delete_workspace_scoped_graph_rows_in_tx(conn, workspace_id)?;
            for participant in &self.participants {
                participant.prepare_workspace_purge_in_tx(conn, workspace_id, &purged_at)?;
            }
            crate::domains::workspaces::store::delete_workspace_row_in_tx(conn, workspace_id)?;
            Ok(())
        })
    }

    pub fn workspace_purge_blocker(&self, workspace_id: &str) -> anyhow::Result<Option<String>> {
        self.db.with_conn(|conn| {
            for participant in &self.participants {
                if let Some(blocker) =
                    participant.workspace_purge_blocker_in_tx(conn, workspace_id)?
                {
                    return Ok(Some(blocker));
                }
            }
            Ok(None)
        })
    }

    fn delete_workspace_scoped_graph_rows_in_tx(
        &self,
        conn: &rusqlite::Connection,
        workspace_id: &str,
    ) -> rusqlite::Result<()> {
        crate::domains::workspaces::access_store::delete_workspace_access_modes_in_tx(
            conn,
            workspace_id,
        )?;
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
