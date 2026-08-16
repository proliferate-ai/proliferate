//! The two loose workflow columns on `sessions` (migration 0069): written when
//! a workflow actor launches a node's session, cleared when undo-advance
//! disposes one, read by the workflow session extension as its cheap "is this
//! a workflow session?" pre-filter. The sessions store owns the writes because
//! the sessions domain owns the table; the columns stay nullable and loose —
//! ordinary sessions never carry them.

use rusqlite::{params, OptionalExtension};

use super::SessionStore;

impl SessionStore {
    /// Link a session to the workflow node it executes, naming it with the
    /// node's title when it has none yet. The launch path creates node
    /// sessions untitled and prompts below the HTTP layer's fallback titling,
    /// so this link is the one write that names them (PRO-277); riding the
    /// same statement keeps link and name atomic, and the CASE keeps a user
    /// rename or any other pre-assigned title authoritative.
    pub fn link_workflow_columns(
        &self,
        session_id: &str,
        workflow_run_id: &str,
        workflow_node_row_id: &str,
        fallback_title: &str,
    ) -> anyhow::Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE sessions SET workflow_run_id = ?2, workflow_node_row_id = ?3,
                     title = CASE WHEN title IS NULL OR TRIM(title) = '' THEN ?4 ELSE title END,
                     updated_at = ?5
                 WHERE id = ?1",
                params![
                    session_id,
                    workflow_run_id,
                    workflow_node_row_id,
                    fallback_title,
                    now
                ],
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

#[cfg(test)]
mod tests {
    use crate::app::test_support;
    use crate::domains::sessions::store::SessionStore;
    use crate::persistence::Db;

    fn seed_session(db: &Db, id: &str, title: Option<&str>) {
        db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO sessions (
                    id, workspace_id, agent_kind, native_session_id,
                    requested_model_id, current_model_id, requested_mode_id, current_mode_id,
                    title, thinking_level_id, thinking_budget_tokens, status,
                    created_at, updated_at, last_prompt_at, closed_at, dismissed_at,
                    mcp_bindings_ciphertext, mcp_binding_summaries_json, system_prompt_append,
                    origin_json, subagents_enabled
                ) VALUES (
                    ?1, 'workspace-1', 'claude', NULL, NULL, NULL, NULL, NULL, ?2, NULL, NULL,
                    'idle', ?3, ?3, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1
                )",
                rusqlite::params![id, title, "2026-03-25T00:00:00Z"],
            )?;
            Ok(())
        })
        .expect("seed session");
    }

    #[test]
    fn linking_names_an_untitled_session_and_keeps_an_assigned_title() {
        let db = Db::open_in_memory().expect("open db");
        test_support::seed_workspace_with_repo_root(&db, "workspace-1", "local", "/tmp/workspace");
        seed_session(&db, "untitled-1", None);
        seed_session(&db, "named-1", Some("Kept name"));
        let store = SessionStore::new(db);

        store
            .link_workflow_columns("untitled-1", "run-1", "row-1", "01 · Plan")
            .expect("link untitled");
        store
            .link_workflow_columns("named-1", "run-1", "row-2", "02 · Ship")
            .expect("link named");

        let untitled = store.find_by_id("untitled-1").expect("load").expect("exists");
        assert_eq!(untitled.title.as_deref(), Some("01 · Plan"));
        let named = store.find_by_id("named-1").expect("load").expect("exists");
        assert_eq!(named.title.as_deref(), Some("Kept name"));
        assert_eq!(
            store.workflow_columns("untitled-1").expect("columns"),
            Some(("run-1".to_string(), "row-1".to_string()))
        );

        // Unlink keeps the name: the disposed session survives as evidence.
        store.clear_workflow_columns("untitled-1").expect("clear");
        assert_eq!(store.workflow_columns("untitled-1").expect("columns"), None);
        let cleared = store.find_by_id("untitled-1").expect("load").expect("exists");
        assert_eq!(cleared.title.as_deref(), Some("01 · Plan"));
    }
}
