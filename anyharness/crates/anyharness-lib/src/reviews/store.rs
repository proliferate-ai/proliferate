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
    ) -> anyhow::Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE review_assignments
                 SET reviewer_session_id = ?1,
                     session_link_id = ?2,
                     actual_mode_id = ?3,
                     mode_verification_status = ?4,
                     status = 'reviewing',
                     updated_at = ?5
                 WHERE id = ?6",
                params![
                    reviewer_session_id,
                    session_link_id,
                    actual_mode_id,
                    mode_status.as_str(),
                    now,
                    assignment_id
                ],
            )?;
            Ok(())
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
                 WHERE id = ?4",
                params![reason, detail, now, assignment_id],
            )?;
            Ok(())
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
                   AND status IN ('queued', 'launching', 'reviewing', 'reminded')",
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

    pub fn start_next_round(
        &self,
        run_id: &str,
        round: &ReviewRoundRecord,
        assignments: &[ReviewAssignmentRecord],
        target_plan_id: Option<&str>,
        target_plan_snapshot_hash: Option<&str>,
        target_code_manifest_json: Option<&str>,
    ) -> anyhow::Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        self.db.with_tx(|tx| {
            insert_round(tx, round)?;
            for assignment in assignments {
                insert_assignment(tx, assignment)?;
            }
            tx.execute(
                "UPDATE review_runs
                 SET status = 'reviewing',
                     active_round_id = ?1,
                     current_round_number = ?2,
                     target_plan_id = COALESCE(?3, target_plan_id),
                     target_plan_snapshot_hash = COALESCE(?4, target_plan_snapshot_hash),
                     target_code_manifest_json = COALESCE(?5, target_code_manifest_json),
                     updated_at = ?6
                 WHERE id = ?7",
                params![
                    round.id,
                    round.round_number,
                    target_plan_id,
                    target_plan_snapshot_hash,
                    target_code_manifest_json,
                    now,
                    run_id
                ],
            )?;
            Ok(())
        })
    }

    pub fn record_candidate_plan(
        &self,
        run_id: &str,
        plan_id: &str,
        source_turn_id: Option<&str>,
        source_tool_call_id: Option<&str>,
        snapshot_hash: &str,
    ) -> anyhow::Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        self.db.with_conn(|conn| {
            conn.execute(
                "INSERT OR IGNORE INTO review_run_candidate_plans (
                    review_run_id, plan_id, source_turn_id, source_tool_call_id,
                    snapshot_hash, created_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    run_id,
                    plan_id,
                    source_turn_id,
                    source_tool_call_id,
                    snapshot_hash,
                    now
                ],
            )?;
            Ok(())
        })
    }

    pub fn find_single_candidate_plan_id(&self, run_id: &str) -> anyhow::Result<Option<String>> {
        let candidates = self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT DISTINCT c.plan_id
                 FROM review_run_candidate_plans c
                 JOIN review_runs r ON r.id = c.review_run_id
                 LEFT JOIN review_rounds active_round ON active_round.id = r.active_round_id
                 WHERE c.review_run_id = ?1
                   AND (
                     active_round.feedback_prompt_sent_at IS NULL
                     OR c.created_at >= active_round.feedback_prompt_sent_at
                   )
                 ORDER BY c.created_at DESC, c.plan_id DESC
                 LIMIT 2",
            )?;
            let rows = stmt.query_map([run_id], |row| row.get::<_, String>(0))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
        })?;
        match candidates.as_slice() {
            [] => Ok(None),
            [plan_id] => Ok(Some(plan_id.clone())),
            _ => anyhow::bail!("multiple revised plan candidates are available"),
        }
    }
}
