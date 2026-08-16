//! The gen-2 workspace-destruction controller policy. Gen-2 runs keep their
//! sessions chattable — the mutation gate's admission policy stays permissive
//! (`NoControllerPolicy`), because queued interjections are load-bearing for
//! the Hold decision. Workspace DESTRUCTION is the question that still needs a
//! durable controller lookup: purging or retiring a workspace out from under a
//! non-terminal run would strand its rows and sessions. This policy answers
//! only that question, injected as the admission gate's `destruction_policy`.

use super::model::WorkflowRunStatus;
use crate::domains::sessions::admission::SessionControllerPolicy;
use crate::persistence::Db;

pub struct WorkflowSessionControllerPolicy {
    db: Db,
}

impl WorkflowSessionControllerPolicy {
    pub fn new(db: Db) -> Self {
        Self { db }
    }
}

impl SessionControllerPolicy for WorkflowSessionControllerPolicy {
    /// The id of the non-terminal gen-2 run whose node links `session_id`, if
    /// any. Terminal runs (completed, failed, cancelled) release their
    /// sessions: their workspaces are ordinary destruction candidates again.
    fn controlling_run_id(&self, session_id: &str) -> anyhow::Result<Option<String>> {
        let terminal = [
            WorkflowRunStatus::Completed.as_str(),
            WorkflowRunStatus::Failed.as_str(),
            WorkflowRunStatus::Cancelled.as_str(),
        ];
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT runs.id
                 FROM workflow_run_nodes AS nodes
                 JOIN workflow_runs AS runs ON runs.id = nodes.run_id
                 WHERE nodes.session_id = ?1 AND runs.status NOT IN (?2, ?3, ?4)
                 LIMIT 1",
                rusqlite::params![session_id, terminal[0], terminal[1], terminal[2]],
                |row| row.get(0),
            )
            .map(Some)
            .or_else(|error| match error {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(other),
            })
        })
    }
}

#[cfg(test)]
mod tests {
    //! Direct coverage for `WorkflowSessionControllerPolicy`: previously this
    //! type had zero tests of its own anywhere in the crate (only mock
    //! `SessionControllerPolicy` impls existed for its callers), so the
    //! Cancelled-belongs-in-the-terminal-set drive-by fix was asserted by
    //! nothing. Runs a non-terminal, and each terminal status through the
    //! real query against a real migrated database.

    use super::*;
    use crate::persistence::Db;

    fn seed_run_with_node(db: &Db, run_id: &str, status: WorkflowRunStatus, session_id: &str) {
        db.with_conn(|conn| {
            conn.execute(
                "INSERT OR IGNORE INTO repo_roots (id, kind, path, created_at, updated_at)
                 VALUES ('repo-root-1', 'external', '/tmp/repo-root-1',
                         '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
                [],
            )?;
            conn.execute(
                "INSERT OR IGNORE INTO workspaces (id, kind, repo_root_id, path, created_at, updated_at)
                 VALUES ('workspace-1', 'local', 'repo-root-1', '/tmp/workspace-1',
                         '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
                [],
            )?;
            let failure_code = if status == WorkflowRunStatus::Failed {
                Some("turn_error")
            } else {
                None
            };
            conn.execute(
                "INSERT INTO workflow_runs (
                    id, invocation_id, definition_json, arguments_json, workspace_id, status,
                    current_node_row_id, failure_code, created_at, updated_at, completed_at
                 ) VALUES (?1, ?2, '{}', '{}', 'workspace-1', ?3, ?4, ?5, ?6, ?6, ?6)",
                rusqlite::params![
                    run_id,
                    format!("invocation-{run_id}"),
                    status.as_str(),
                    format!("node-{run_id}"),
                    failure_code,
                    "2026-01-01T00:00:00Z",
                ],
            )?;
            conn.execute(
                "INSERT INTO workflow_run_nodes (
                    id, run_id, kind, node_type, title, prompt, status, session_id,
                    failure_code, created_at
                 ) VALUES (?1, ?2, 'defined', 'agent', 'Plan', 'Write a plan.', ?3, ?4, ?5, ?6)",
                rusqlite::params![
                    format!("node-{run_id}"),
                    run_id,
                    status.as_str(),
                    session_id,
                    failure_code,
                    "2026-01-01T00:00:00Z",
                ],
            )?;
            Ok(())
        })
        .expect("seed run and node");
    }

    #[test]
    fn a_running_run_controls_its_node_session() {
        let db = Db::open_in_memory().expect("in-memory db with full migrations");
        seed_run_with_node(&db, "run-running", WorkflowRunStatus::Running, "sess-1");
        let policy = WorkflowSessionControllerPolicy::new(db);
        assert_eq!(
            policy.controlling_run_id("sess-1").expect("query"),
            Some("run-running".to_string())
        );
    }

    #[test]
    fn a_completed_run_releases_its_node_session() {
        let db = Db::open_in_memory().expect("in-memory db with full migrations");
        seed_run_with_node(&db, "run-completed", WorkflowRunStatus::Completed, "sess-1");
        let policy = WorkflowSessionControllerPolicy::new(db);
        assert_eq!(policy.controlling_run_id("sess-1").expect("query"), None);
    }

    #[test]
    fn a_failed_run_releases_its_node_session() {
        let db = Db::open_in_memory().expect("in-memory db with full migrations");
        seed_run_with_node(&db, "run-failed", WorkflowRunStatus::Failed, "sess-1");
        let policy = WorkflowSessionControllerPolicy::new(db);
        assert_eq!(policy.controlling_run_id("sess-1").expect("query"), None);
    }

    /// The drive-by fix under review: a cancelled run's workspace must be an
    /// ordinary destruction candidate again, same as completed and failed.
    #[test]
    fn a_cancelled_run_releases_its_node_session() {
        let db = Db::open_in_memory().expect("in-memory db with full migrations");
        seed_run_with_node(&db, "run-cancelled", WorkflowRunStatus::Cancelled, "sess-1");
        let policy = WorkflowSessionControllerPolicy::new(db);
        assert_eq!(policy.controlling_run_id("sess-1").expect("query"), None);
    }

    #[test]
    fn an_unlinked_session_has_no_controller() {
        let db = Db::open_in_memory().expect("in-memory db with full migrations");
        seed_run_with_node(&db, "run-running", WorkflowRunStatus::Running, "sess-1");
        let policy = WorkflowSessionControllerPolicy::new(db);
        assert_eq!(
            policy.controlling_run_id("sess-unrelated").expect("query"),
            None
        );
    }
}
