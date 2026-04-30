use rusqlite::{params, OptionalExtension};

use super::model::{
    ReviewAssignmentRecord, ReviewModeVerificationStatus, ReviewRoundRecord, ReviewRunRecord,
};
use super::store_rows::{
    insert_assignment, insert_round, insert_run, map_assignment, map_round, map_run,
};
use crate::persistence::Db;

#[derive(Clone)]
pub struct ReviewStore {
    pub(crate) db: Db,
}

impl ReviewStore {
    pub fn new(db: Db) -> Self {
        Self { db }
    }

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

    pub fn list_rounds_for_run(&self, run_id: &str) -> anyhow::Result<Vec<ReviewRoundRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT * FROM review_rounds
                 WHERE review_run_id = ?1
                 ORDER BY round_number ASC",
            )?;
            let rows = stmt.query_map([run_id], map_round)?;
            rows.collect()
        })
    }

    pub fn find_round(&self, round_id: &str) -> anyhow::Result<Option<ReviewRoundRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM review_rounds WHERE id = ?1",
                [round_id],
                map_round,
            )
            .optional()
        })
    }

    pub fn list_assignments_for_round(
        &self,
        round_id: &str,
    ) -> anyhow::Result<Vec<ReviewAssignmentRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT * FROM review_assignments
                 WHERE review_round_id = ?1
                 ORDER BY created_at ASC, id ASC",
            )?;
            let rows = stmt.query_map([round_id], map_assignment)?;
            rows.collect()
        })
    }

    pub fn list_assignments_for_run(
        &self,
        run_id: &str,
    ) -> anyhow::Result<Vec<ReviewAssignmentRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT * FROM review_assignments
                 WHERE review_run_id = ?1
                 ORDER BY created_at ASC, id ASC",
            )?;
            let rows = stmt.query_map([run_id], map_assignment)?;
            rows.collect()
        })
    }

    pub fn find_assignment_for_reviewer_session(
        &self,
        reviewer_session_id: &str,
    ) -> anyhow::Result<Option<ReviewAssignmentRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM review_assignments
                 WHERE reviewer_session_id = ?1
                   AND status IN ('launching', 'reviewing', 'reminded')
                 ORDER BY created_at DESC, id DESC
                 LIMIT 1",
                [reviewer_session_id],
                map_assignment,
            )
            .optional()
        })
    }

    pub fn find_assignment(
        &self,
        assignment_id: &str,
    ) -> anyhow::Result<Option<ReviewAssignmentRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM review_assignments WHERE id = ?1",
                [assignment_id],
                map_assignment,
            )
            .optional()
        })
    }

    pub fn find_assignment_for_run(
        &self,
        run_id: &str,
        assignment_id: &str,
    ) -> anyhow::Result<Option<ReviewAssignmentRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM review_assignments
                 WHERE id = ?1 AND review_run_id = ?2",
                params![assignment_id, run_id],
                map_assignment,
            )
            .optional()
        })
    }

    pub fn update_assignment_launched(
        &self,
        assignment_id: &str,
        reviewer_session_id: &str,
        session_link_id: &str,
        actual_mode_id: Option<&str>,
        mode_status: ReviewModeVerificationStatus,
    ) -> anyhow::Result<bool> {
        let now = chrono::Utc::now().to_rfc3339();
        self.db.with_conn(|conn| {
            let changed = conn.execute(
                "UPDATE review_assignments
                 SET reviewer_session_id = ?1,
                     session_link_id = ?2,
                     actual_mode_id = ?3,
                     mode_verification_status = ?4,
                     status = 'reviewing',
                     updated_at = ?5
                 WHERE id = ?6
                   AND status IN ('queued', 'launching', 'reviewing')
                   AND EXISTS (
                       SELECT 1
                       FROM review_runs
                       JOIN review_rounds ON review_rounds.id = review_assignments.review_round_id
                       WHERE review_runs.id = review_assignments.review_run_id
                         AND review_runs.active_round_id = review_assignments.review_round_id
                         AND review_runs.status = 'reviewing'
                         AND review_rounds.status = 'reviewing'
                   )",
                params![
                    reviewer_session_id,
                    session_link_id,
                    actual_mode_id,
                    mode_status.as_str(),
                    now,
                    assignment_id
                ],
            )?;
            Ok(changed == 1)
        })
    }

    pub fn mark_assignment_system_failed(
        &self,
        assignment_id: &str,
        reason: &str,
        detail: Option<&str>,
    ) -> anyhow::Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE review_assignments
                 SET status = 'system_failed',
                     failure_reason = ?1,
                     failure_detail = ?2,
                     updated_at = ?3
                 WHERE id = ?4
                   AND status IN ('queued', 'launching', 'reviewing', 'reminded')",
                params![reason, detail, now, assignment_id],
            )?;
            Ok(())
        })
    }

    pub fn mark_assignment_retryable_failed(
        &self,
        assignment_id: &str,
        reviewer_session_id: &str,
        reason: &str,
        detail: Option<&str>,
    ) -> anyhow::Result<Option<ReviewAssignmentRecord>> {
        let now = chrono::Utc::now().to_rfc3339();
        self.db.with_conn(|conn| {
            let changed = conn.execute(
                "UPDATE review_assignments
                 SET status = 'retryable_failed',
                     failure_reason = ?1,
                     failure_detail = ?2,
                     updated_at = ?3
                 WHERE id = ?4
                   AND reviewer_session_id = ?5
                   AND status IN ('launching', 'reviewing', 'reminded')
                   AND EXISTS (
                       SELECT 1
                       FROM review_runs
                       JOIN review_rounds ON review_rounds.id = review_assignments.review_round_id
                       WHERE review_runs.id = review_assignments.review_run_id
                         AND review_runs.active_round_id = review_assignments.review_round_id
                         AND review_runs.status = 'reviewing'
                         AND review_rounds.status = 'reviewing'
                   )",
                params![reason, detail, now, assignment_id, reviewer_session_id],
            )?;
            if changed == 0 {
                return Ok(None);
            }
            conn.query_row(
                "SELECT * FROM review_assignments WHERE id = ?1",
                [assignment_id],
                map_assignment,
            )
            .optional()
        })
    }

    pub fn prepare_assignment_retry(
        &self,
        run_id: &str,
        assignment_id: &str,
        model_id: Option<&str>,
        deadline_at: &str,
    ) -> anyhow::Result<Option<ReviewAssignmentRecord>> {
        let now = chrono::Utc::now().to_rfc3339();
        self.db.with_tx(|tx| {
            let changed = tx.execute(
                "UPDATE review_assignments
                 SET status = 'launching',
                     model_id = ?1,
                     reviewer_session_id = NULL,
                     session_link_id = NULL,
                     actual_mode_id = NULL,
                     mode_verification_status = 'pending',
                     pass = NULL,
                     summary = NULL,
                     critique_markdown = NULL,
                     critique_artifact_path = NULL,
                     submitted_at = NULL,
                     deadline_at = ?2,
                     reminder_count = 0,
                     failure_reason = NULL,
                     failure_detail = NULL,
                     updated_at = ?3
                 WHERE id = ?4
                   AND review_run_id = ?5
                   AND status = 'retryable_failed'
                   AND failure_reason = 'provider_rate_limit'
                   AND EXISTS (
                       SELECT 1
                       FROM review_runs
                       JOIN review_rounds ON review_rounds.id = review_assignments.review_round_id
                       WHERE review_runs.id = review_assignments.review_run_id
                         AND review_runs.active_round_id = review_assignments.review_round_id
                         AND review_runs.status = 'reviewing'
                         AND review_rounds.status = 'reviewing'
                   )",
                params![model_id, deadline_at, now, assignment_id, run_id],
            )?;
            if changed == 0 {
                return Ok(None);
            }
            tx.query_row(
                "SELECT * FROM review_assignments WHERE id = ?1",
                [assignment_id],
                map_assignment,
            )
            .optional()
        })
    }

    pub fn restore_assignment_retryable_after_retry_launch_failed(
        &self,
        run_id: &str,
        assignment_id: &str,
        detail: Option<&str>,
    ) -> anyhow::Result<bool> {
        let now = chrono::Utc::now().to_rfc3339();
        self.db.with_conn(|conn| {
            let changed = conn.execute(
                "UPDATE review_assignments
                 SET status = 'retryable_failed',
                     failure_reason = 'provider_rate_limit',
                     failure_detail = ?1,
                     updated_at = ?2
                 WHERE id = ?3
                   AND review_run_id = ?4
                   AND status IN ('launching', 'reviewing', 'system_failed')
                   AND EXISTS (
                       SELECT 1
                       FROM review_runs
                       JOIN review_rounds ON review_rounds.id = review_assignments.review_round_id
                       WHERE review_runs.id = review_assignments.review_run_id
                         AND review_runs.active_round_id = review_assignments.review_round_id
                         AND review_runs.status = 'reviewing'
                         AND review_rounds.status = 'reviewing'
                   )",
                params![detail, now, assignment_id, run_id],
            )?;
            Ok(changed == 1)
        })
    }

    pub fn mark_assignment_timed_out(
        &self,
        assignment_id: &str,
        reason: &str,
        detail: Option<&str>,
    ) -> anyhow::Result<bool> {
        let now = chrono::Utc::now().to_rfc3339();
        self.db.with_conn(|conn| {
            let changed = conn.execute(
                "UPDATE review_assignments
                 SET status = 'timed_out',
                     failure_reason = ?1,
                     failure_detail = ?2,
                     updated_at = ?3
                 WHERE id = ?4
                   AND status IN ('queued', 'launching', 'reviewing', 'reminded')",
                params![reason, detail, now, assignment_id],
            )?;
            Ok(changed == 1)
        })
    }

    pub fn mark_assignment_reminded(&self, assignment_id: &str) -> anyhow::Result<bool> {
        let now = chrono::Utc::now().to_rfc3339();
        self.db.with_conn(|conn| {
            let changed = conn.execute(
                "UPDATE review_assignments
                 SET status = 'reminded',
                     reminder_count = reminder_count + 1,
                     updated_at = ?1
                 WHERE id = ?2
                   AND status IN ('launching', 'reviewing', 'reminded')",
                params![now, assignment_id],
            )?;
            Ok(changed == 1)
        })
    }

    pub fn active_assignments_past_deadline(
        &self,
        now: &str,
    ) -> anyhow::Result<Vec<ReviewAssignmentRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT * FROM review_assignments
                 WHERE status IN ('queued', 'launching', 'reviewing', 'reminded')
                   AND deadline_at <= ?1
                 ORDER BY deadline_at ASC, id ASC",
            )?;
            let rows = stmt.query_map([now], map_assignment)?;
            rows.collect()
        })
    }

    pub fn submit_assignment_result(
        &self,
        assignment_id: &str,
        pass: bool,
        summary: &str,
        critique_markdown: &str,
        critique_artifact_path: &str,
    ) -> anyhow::Result<Option<ReviewAssignmentRecord>> {
        let now = chrono::Utc::now().to_rfc3339();
        self.db.with_conn(|conn| {
            let changed = conn.execute(
                "UPDATE review_assignments
                 SET status = 'submitted',
                     pass = ?1,
                     summary = ?2,
                     critique_markdown = ?3,
                     critique_artifact_path = ?4,
                     submitted_at = ?5,
                     updated_at = ?5
                 WHERE id = ?6
                   AND status IN ('launching', 'reviewing', 'reminded')",
                params![
                    if pass { 1 } else { 0 },
                    summary,
                    critique_markdown,
                    critique_artifact_path,
                    now,
                    assignment_id
                ],
            )?;
            if changed == 0 {
                return Ok(None);
            }
            conn.query_row(
                "SELECT * FROM review_assignments WHERE id = ?1",
                [assignment_id],
                map_assignment,
            )
            .optional()
        })
    }

    pub fn claim_round_for_completion(&self, round_id: &str) -> anyhow::Result<bool> {
        let now = chrono::Utc::now().to_rfc3339();
        self.db.with_conn(|conn| {
            let changed = conn.execute(
                "UPDATE review_rounds
                 SET status = 'completing', updated_at = ?1
                 WHERE id = ?2 AND status = 'reviewing'",
                params![now, round_id],
            )?;
            Ok(changed == 1)
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
