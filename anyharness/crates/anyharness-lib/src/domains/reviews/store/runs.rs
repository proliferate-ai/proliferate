use rusqlite::{params, OptionalExtension};

use super::rows::{insert_assignment, insert_round, insert_run, map_run};
use super::ReviewStore;
use crate::domains::reviews::model::{ReviewAssignmentRecord, ReviewRoundRecord, ReviewRunRecord};

impl ReviewStore {
    pub fn create_run(
        &self,
        run: &ReviewRunRecord,
        round: &ReviewRoundRecord,
        assignments: &[ReviewAssignmentRecord],
    ) -> anyhow::Result<()> {
        self.db.with_tx(|tx| {
            insert_run(tx, run)?;
            insert_round(tx, round)?;
            tx.execute(
                "UPDATE review_runs SET active_round_id = ?1 WHERE id = ?2",
                params![round.id, run.id],
            )?;
            for assignment in assignments {
                insert_assignment(tx, assignment)?;
            }
            Ok(())
        })
    }

    pub fn find_run(&self, run_id: &str) -> anyhow::Result<Option<ReviewRunRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row("SELECT * FROM review_runs WHERE id = ?1", [run_id], map_run)
                .optional()
        })
    }

    pub fn list_runs_for_parent(
        &self,
        parent_session_id: &str,
    ) -> anyhow::Result<Vec<ReviewRunRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT * FROM review_runs
                 WHERE parent_session_id = ?1
                 ORDER BY created_at DESC, id DESC",
            )?;
            let rows = stmt.query_map([parent_session_id], map_run)?;
            rows.collect()
        })
    }

    pub fn find_active_run_for_parent(
        &self,
        parent_session_id: &str,
    ) -> anyhow::Result<Option<ReviewRunRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM review_runs
                 WHERE parent_session_id = ?1
                   AND status IN ('reviewing', 'feedback_ready', 'parent_revising', 'waiting_for_revision')
                 ORDER BY created_at DESC, id DESC
                 LIMIT 1",
                [parent_session_id],
                map_run,
            )
            .optional()
        })
    }

    pub fn list_active_runs_for_workspace(
        &self,
        workspace_id: &str,
    ) -> anyhow::Result<Vec<ReviewRunRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT * FROM review_runs
                 WHERE workspace_id = ?1
                   AND status IN ('reviewing', 'feedback_ready', 'parent_revising', 'waiting_for_revision')
                 ORDER BY created_at DESC, id DESC",
            )?;
            let rows = stmt.query_map([workspace_id], map_run)?;
            rows.collect()
        })
    }

    pub fn mark_run_passed(&self, run_id: &str, round_id: &str) -> anyhow::Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        self.db.with_tx(|tx| {
            tx.execute(
                "UPDATE review_rounds
                 SET status = 'passed', completed_at = ?1, updated_at = ?1
                 WHERE id = ?2",
                params![now, round_id],
            )?;
            tx.execute(
                "UPDATE review_runs
                 SET status = 'passed',
                     active_round_id = NULL,
                     updated_at = ?1
                 WHERE id = ?2",
                params![now, run_id],
            )?;
            Ok(())
        })
    }

    pub fn mark_run_system_failed(
        &self,
        run_id: &str,
        round_id: Option<&str>,
        reason: &str,
        detail: Option<&str>,
    ) -> anyhow::Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        self.db.with_tx(|tx| {
            if let Some(round_id) = round_id {
                tx.execute(
                    "UPDATE review_rounds
                     SET status = 'system_failed',
                         failure_reason = ?1,
                         failure_detail = ?2,
                         completed_at = ?3,
                         updated_at = ?3
                     WHERE id = ?4",
                    params![reason, detail, now, round_id],
                )?;
            }
            tx.execute(
                "UPDATE review_runs
                 SET status = 'system_failed',
                     active_round_id = NULL,
                     failure_reason = ?1,
                     failure_detail = ?2,
                     updated_at = ?3
                 WHERE id = ?4",
                params![reason, detail, now, run_id],
            )?;
            Ok(())
        })
    }

    pub fn mark_run_max_rounds_reached(&self, run_id: &str) -> anyhow::Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE review_runs
                 SET status = 'stopped',
                     active_round_id = NULL,
                     failure_reason = 'max_rounds_reached',
                     failure_detail = 'Feedback was sent and the configured review rounds are complete.',
                     stopped_at = ?1,
                     updated_at = ?1
                 WHERE id = ?2
                   AND status IN ('parent_revising', 'waiting_for_revision')",
                params![now, run_id],
            )?;
            Ok(())
        })
    }

    pub fn mark_run_waiting_for_revision(&self, run_id: &str) -> anyhow::Result<bool> {
        let now = chrono::Utc::now().to_rfc3339();
        self.db.with_conn(|conn| {
            let changed = conn.execute(
                "UPDATE review_runs
                 SET status = 'waiting_for_revision',
                     updated_at = ?1
                 WHERE id = ?2
                   AND status = 'parent_revising'
                   AND current_round_number < max_rounds",
                params![now, run_id],
            )?;
            Ok(changed == 1)
        })
    }

    pub fn stop_run(&self, run_id: &str) -> anyhow::Result<Vec<String>> {
        let now = chrono::Utc::now().to_rfc3339();
        self.db.with_tx(|tx| {
            let mut stmt = tx.prepare(
                "SELECT reviewer_session_id FROM review_assignments
                 WHERE review_run_id = ?1
                   AND reviewer_session_id IS NOT NULL
                   AND status IN ('launching', 'reviewing', 'reminded')",
            )?;
            let reviewer_ids = stmt
                .query_map([run_id], |row| row.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            drop(stmt);
            tx.execute(
                "UPDATE review_assignments
                 SET status = 'cancelled', updated_at = ?1
                 WHERE review_run_id = ?2
                   AND status IN ('queued', 'launching', 'reviewing', 'reminded', 'retryable_failed')",
                params![now, run_id],
            )?;
            tx.execute(
                "UPDATE review_rounds
                 SET status = 'cancelled', updated_at = ?1
                 WHERE review_run_id = ?2
                   AND status IN ('reviewing', 'completing', 'feedback_pending')",
                params![now, run_id],
            )?;
            tx.execute(
                "UPDATE review_feedback_jobs
                 SET state = 'failed',
                     failure_reason = 'stopped',
                     updated_at = ?1
                 WHERE review_run_id = ?2 AND state IN ('pending', 'sending')",
                params![now, run_id],
            )?;
            tx.execute(
                "UPDATE review_runs
                 SET status = 'stopped',
                     stopped_at = ?1,
                     active_round_id = NULL,
                     updated_at = ?1
                 WHERE id = ?2",
                params![now, run_id],
            )?;
            Ok(reviewer_ids)
        })
    }
}
