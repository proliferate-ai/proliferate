//! The two loose workflow columns on `sessions` (migration 0069): written when
//! a workflow actor launches a node's session, cleared when undo-advance
//! disposes one, read by the workflow session extension as its cheap "is this
//! a workflow session?" pre-filter. The sessions store owns the writes because
//! the sessions domain owns the table; the columns stay nullable and loose —
//! ordinary sessions never carry them.

use rusqlite::{params, OptionalExtension};

use super::SessionStore;

impl SessionStore {
    /// Link a session to the workflow node it executes.
    pub fn link_workflow_columns(
        &self,
        session_id: &str,
        workflow_run_id: &str,
        workflow_node_row_id: &str,
    ) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE sessions SET workflow_run_id = ?2, workflow_node_row_id = ?3
                 WHERE id = ?1",
                params![session_id, workflow_run_id, workflow_node_row_id],
            )?;
            Ok(())
        })
    }

    /// Unlink (undo-advance disposal): the session survives as retained
    /// evidence, but it no longer reports into any workflow.
    pub fn clear_workflow_columns(&self, session_id: &str) -> anyhow::Result<()> {
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE sessions SET workflow_run_id = NULL, workflow_node_row_id = NULL
                 WHERE id = ?1",
                params![session_id],
            )?;
            Ok(())
        })
    }

    /// `(workflow_run_id, workflow_node_row_id)` when the session carries
    /// both; `None` for ordinary sessions, unlinked sessions, and unknown ids.
    pub fn workflow_columns(&self, session_id: &str) -> anyhow::Result<Option<(String, String)>> {
        self.db.with_conn(|conn| {
            let row: Option<(Option<String>, Option<String>)> = conn
                .query_row(
                    "SELECT workflow_run_id, workflow_node_row_id FROM sessions WHERE id = ?1",
                    params![session_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?;
            Ok(match row {
                Some((Some(run_id), Some(node_row_id))) => Some((run_id, node_row_id)),
                _ => None,
            })
        })
    }
}
