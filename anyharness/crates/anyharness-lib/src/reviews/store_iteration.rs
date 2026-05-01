use rusqlite::params;

use super::model::{ReviewAssignmentRecord, ReviewRoundRecord};
use super::store::ReviewStore;
use super::store_rows::{insert_assignment, insert_round};

impl ReviewStore {
    pub fn start_next_round(
        &self,
        run_id: &str,
        round: &ReviewRoundRecord,
        assignments: &[ReviewAssignmentRecord],
        target_plan_id: Option<&str>,
        target_plan_snapshot_hash: Option<&str>,
        target_code_manifest_json: Option<&str>,
        expected_current_round_number: u32,
        auto_feedback_turn_id: Option<&str>,
    ) -> anyhow::Result<bool> {
        let now = chrono::Utc::now().to_rfc3339();
        self.db.with_tx(|tx| {
            let changed = if let Some(feedback_turn_id) = auto_feedback_turn_id {
                tx.execute(
                    "UPDATE review_runs
                     SET status = 'reviewing',
                         active_round_id = ?1,
                         current_round_number = ?2,
                         target_plan_id = COALESCE(?3, target_plan_id),
                         target_plan_snapshot_hash = COALESCE(?4, target_plan_snapshot_hash),
                         target_code_manifest_json = COALESCE(?5, target_code_manifest_json),
                         updated_at = ?6
                     WHERE id = ?7
                       AND status = 'parent_revising'
                       AND auto_iterate != 0
                       AND current_round_number = ?8
                       AND current_round_number < max_rounds
                       AND EXISTS (
                         SELECT 1
                         FROM review_feedback_jobs job
                         WHERE job.review_run_id = review_runs.id
                           AND job.review_round_id = review_runs.active_round_id
                           AND job.feedback_turn_id = ?9
                           AND job.state = 'sent'
                       )",
                    params![
                        round.id,
                        round.round_number,
                        target_plan_id,
                        target_plan_snapshot_hash,
                        target_code_manifest_json,
                        now,
                        run_id,
                        expected_current_round_number,
                        feedback_turn_id,
                    ],
                )?
            } else {
                tx.execute(
                    "UPDATE review_runs
                     SET status = 'reviewing',
                         active_round_id = ?1,
                         current_round_number = ?2,
                         target_plan_id = COALESCE(?3, target_plan_id),
                         target_plan_snapshot_hash = COALESCE(?4, target_plan_snapshot_hash),
                         target_code_manifest_json = COALESCE(?5, target_code_manifest_json),
                         updated_at = ?6
                     WHERE id = ?7
                       AND status IN ('parent_revising', 'waiting_for_revision')
                       AND current_round_number = ?8
                       AND current_round_number < max_rounds",
                    params![
                        round.id,
                        round.round_number,
                        target_plan_id,
                        target_plan_snapshot_hash,
                        target_code_manifest_json,
                        now,
                        run_id,
                        expected_current_round_number,
                    ],
                )?
            };
            if changed == 0 {
                return Ok(false);
            }
            insert_round(tx, round)?;
            for assignment in assignments {
                insert_assignment(tx, assignment)?;
            }
            Ok(true)
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

    pub fn find_single_candidate_plan_id(
        &self,
        run_id: &str,
        feedback_turn_id: Option<&str>,
    ) -> anyhow::Result<Option<String>> {
        let candidates = self.db.with_conn(|conn| {
            if let Some(feedback_turn_id) = feedback_turn_id {
                let mut stmt = conn.prepare(
                    "SELECT DISTINCT c.plan_id
                     FROM review_run_candidate_plans c
                     WHERE c.review_run_id = ?1
                       AND c.source_turn_id = ?2
                     ORDER BY c.created_at DESC, c.plan_id DESC
                     LIMIT 2",
                )?;
                let rows = stmt.query_map(params![run_id, feedback_turn_id], |row| {
                    row.get::<_, String>(0)
                })?;
                let turn_candidates = rows.collect::<rusqlite::Result<Vec<_>>>()?;
                if !turn_candidates.is_empty() {
                    return Ok(turn_candidates);
                }
            }
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
