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
