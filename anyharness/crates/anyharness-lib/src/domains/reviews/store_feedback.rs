use anyharness_contract::v1::{PendingPromptRemovalReason, PromptProvenance, SessionEvent};
use rusqlite::{params, OptionalExtension};

use super::model::{ReviewFeedbackJobRecord, ReviewRunStatus};
use super::store::ReviewStore;
use super::store_rows::{insert_feedback_job, map_feedback_job};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum PendingPromptExecutionLookup {
    Pending,
    Executed {
        turn_id: String,
        executed_at: String,
    },
    Removed {
        reason: PendingPromptRemovalReason,
    },
}

impl ReviewStore {
    pub fn create_feedback_job(
        &self,
        job: &ReviewFeedbackJobRecord,
        next_run_status: ReviewRunStatus,
    ) -> anyhow::Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        let terminal = !next_run_status.is_active();
        self.db.with_tx(|tx| {
            insert_feedback_job(tx, job)?;
            tx.execute(
                "UPDATE review_rounds
                 SET status = 'feedback_pending',
                     feedback_job_id = ?1,
                     completed_at = ?2,
                     updated_at = ?2
                 WHERE id = ?3",
                params![job.id, now, job.review_round_id],
            )?;
            tx.execute(
                "UPDATE review_runs
                 SET status = ?1,
                     active_round_id = CASE WHEN ?4 THEN NULL ELSE active_round_id END,
                     updated_at = ?2
                 WHERE id = ?3",
                params![next_run_status.as_str(), now, job.review_run_id, terminal],
            )?;
            Ok(())
        })
    }

    pub fn mark_feedback_job_sending(
        &self,
        job_id: &str,
    ) -> anyhow::Result<Option<ReviewFeedbackJobRecord>> {
        let now = chrono::Utc::now().to_rfc3339();
        self.db.with_tx(|tx| {
            let changed = tx.execute(
                "UPDATE review_feedback_jobs
                 SET state = 'sending',
                     attempt_count = attempt_count + 1,
                     next_attempt_at = NULL,
                     failure_reason = NULL,
                     failure_detail = NULL,
                     updated_at = ?1
                 WHERE id = ?2
                   AND state IN ('pending', 'failed')",
                params![now, job_id],
            )?;
            if changed == 0 {
                return Ok(None);
            }
            tx.query_row(
                "SELECT * FROM review_feedback_jobs WHERE id = ?1",
                [job_id],
                map_feedback_job,
            )
            .optional()
        })
    }

    pub fn mark_feedback_job_queued(
        &self,
        job_id: &str,
        prompt_seq: Option<i64>,
    ) -> anyhow::Result<Option<ReviewFeedbackJobRecord>> {
        let now = chrono::Utc::now().to_rfc3339();
        self.db.with_tx(|tx| {
            let job = tx
                .query_row(
                    "SELECT * FROM review_feedback_jobs WHERE id = ?1",
                    [job_id],
                    map_feedback_job,
                )
                .optional()?;
            let Some(job) = job else {
                return Ok(None);
            };
            tx.execute(
                "UPDATE review_feedback_jobs
                 SET state = 'pending',
                     sent_prompt_seq = ?1,
                     feedback_turn_id = NULL,
                     next_attempt_at = NULL,
                     updated_at = ?2
                 WHERE id = ?3",
                params![prompt_seq, now, job_id],
            )?;
            Ok(Some(job))
        })
    }

    pub fn reset_queued_feedback_job_for_retry(
        &self,
        job_id: &str,
        prompt_seq: i64,
        reason: &str,
        detail: Option<&str>,
    ) -> anyhow::Result<Option<ReviewFeedbackJobRecord>> {
        let now = chrono::Utc::now().to_rfc3339();
        self.db.with_tx(|tx| {
            let changed = tx.execute(
                "UPDATE review_feedback_jobs
                 SET state = 'pending',
                     sent_prompt_seq = NULL,
                     feedback_turn_id = NULL,
                     next_attempt_at = NULL,
                     failure_reason = ?1,
                     failure_detail = ?2,
                     updated_at = ?3
                 WHERE id = ?4
                   AND state = 'pending'
                   AND sent_prompt_seq = ?5
                   AND feedback_turn_id IS NULL",
                params![reason, detail, now, job_id, prompt_seq],
            )?;
            if changed == 0 {
                return Ok(None);
            }
            tx.query_row(
                "SELECT * FROM review_feedback_jobs WHERE id = ?1",
                [job_id],
                map_feedback_job,
            )
            .optional()
        })
    }

    pub fn mark_feedback_job_sent(
        &self,
        job_id: &str,
        prompt_seq: Option<i64>,
        feedback_turn_id: Option<&str>,
        sent_at: Option<&str>,
    ) -> anyhow::Result<Option<ReviewFeedbackJobRecord>> {
        let now = sent_at
            .map(str::to_string)
            .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
        self.db.with_tx(|tx| {
            let job = tx
                .query_row(
                    "SELECT * FROM review_feedback_jobs WHERE id = ?1",
                    [job_id],
                    map_feedback_job,
                )
                .optional()?;
            let Some(job) = job else {
                return Ok(None);
            };
            tx.execute(
                "UPDATE review_feedback_jobs
                 SET state = 'sent',
                     sent_prompt_seq = COALESCE(?1, sent_prompt_seq),
                     feedback_turn_id = COALESCE(?2, feedback_turn_id),
                     updated_at = ?3
                 WHERE id = ?4",
                params![prompt_seq, feedback_turn_id, now, job_id],
            )?;
            tx.execute(
                "UPDATE review_rounds
                 SET status = 'feedback_sent',
                     feedback_prompt_sent_at = ?1,
                     updated_at = ?1
                 WHERE id = ?2",
                params![now, job.review_round_id],
            )?;
            tx.execute(
                "UPDATE review_runs
                 SET status = 'parent_revising',
                     updated_at = ?1
                 WHERE id = ?2 AND status IN ('feedback_ready', 'parent_revising')",
                params![now, job.review_run_id],
            )?;
            Ok(Some(job))
        })
    }

    pub fn mark_feedback_job_retry(
        &self,
        job_id: &str,
        reason: &str,
        detail: Option<&str>,
        next_attempt_at: &str,
    ) -> anyhow::Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE review_feedback_jobs
                 SET state = 'pending',
                     next_attempt_at = ?1,
                     failure_reason = ?2,
                     failure_detail = ?3,
                     updated_at = ?4
                 WHERE id = ?5
                   AND state = 'sending'",
                params![next_attempt_at, reason, detail, now, job_id],
            )?;
            Ok(())
        })
    }

    pub fn mark_feedback_job_failed(
        &self,
        job_id: &str,
        reason: &str,
        detail: Option<&str>,
    ) -> anyhow::Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        self.db.with_tx(|tx| {
            tx.execute(
                "UPDATE review_feedback_jobs
                 SET state = 'failed',
                     failure_reason = ?1,
                     failure_detail = ?2,
                     attempt_count = attempt_count + 1,
                     updated_at = ?3
                 WHERE id = ?4",
                params![reason, detail, now, job_id],
            )?;
            tx.execute(
                "UPDATE review_runs
                 SET status = 'system_failed',
                     failure_reason = ?1,
                     failure_detail = ?2,
                     updated_at = ?3
                 WHERE id = (
                    SELECT review_run_id FROM review_feedback_jobs WHERE id = ?4
                 )
                   AND status != 'passed'",
                params![reason, detail, now, job_id],
            )?;
            tx.execute(
                "UPDATE review_rounds
                 SET status = 'system_failed',
                     failure_reason = ?1,
                     failure_detail = ?2,
                     updated_at = ?3
                 WHERE id = (
                    SELECT review_round_id FROM review_feedback_jobs WHERE id = ?4
                 )
                   AND NOT EXISTS (
                     SELECT 1
                     FROM review_runs run
                     JOIN review_feedback_jobs job ON job.review_run_id = run.id
                     WHERE job.id = ?4
                       AND run.status = 'passed'
                   )",
                params![reason, detail, now, job_id],
            )?;
            Ok(())
        })
    }

    pub fn pending_feedback_jobs(&self, now: &str) -> anyhow::Result<Vec<ReviewFeedbackJobRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT job.*
                 FROM review_feedback_jobs job
                 JOIN review_runs run ON run.id = job.review_run_id
                 WHERE job.state = 'pending'
                   AND (job.next_attempt_at IS NULL OR job.next_attempt_at <= ?1)
                   AND job.sent_prompt_seq IS NULL
                   AND (
                       run.auto_iterate != 0
                       OR job.attempt_count > 0
                       OR run.status = 'passed'
                   )
                 ORDER BY job.created_at ASC, job.id ASC",
            )?;
            let rows = stmt.query_map([now], map_feedback_job)?;
            rows.collect()
        })
    }

    pub fn queued_feedback_jobs_without_turn(
        &self,
    ) -> anyhow::Result<Vec<ReviewFeedbackJobRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT * FROM review_feedback_jobs
                 WHERE state = 'pending'
                   AND sent_prompt_seq IS NOT NULL
                   AND feedback_turn_id IS NULL
                 ORDER BY created_at ASC, id ASC",
            )?;
            let rows = stmt.query_map([], map_feedback_job)?;
            rows.collect()
        })
    }

    pub fn sent_feedback_jobs_with_parent_revising(
        &self,
    ) -> anyhow::Result<Vec<ReviewFeedbackJobRecord>> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT job.*
                 FROM review_feedback_jobs job
                 JOIN review_runs run ON run.id = job.review_run_id
                 WHERE job.state = 'sent'
                   AND job.feedback_turn_id IS NOT NULL
                   AND run.status = 'parent_revising'
                   AND job.review_round_id = run.active_round_id
                 ORDER BY job.updated_at ASC, job.id ASC",
            )?;
            let rows = stmt.query_map([], map_feedback_job)?;
            rows.collect()
        })
    }

    pub(super) fn find_pending_prompt_execution(
        &self,
        session_id: &str,
        pending_prompt_seq: i64,
        feedback_job_id: &str,
    ) -> anyhow::Result<PendingPromptExecutionLookup> {
        self.db.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT seq, timestamp, event_type, turn_id, payload_json
                 FROM session_events
                 WHERE session_id = ?1
                 ORDER BY seq ASC",
            )?;
            let rows = stmt.query_map([session_id], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, String>(4)?,
                ))
            })?;
            let mut current_turn_id: Option<String> = None;
            let mut tracking_current_attempt = false;
            let mut latest_lookup = PendingPromptExecutionLookup::Pending;
            for row in rows {
                let (_seq, timestamp, event_type, turn_id, payload_json) = row?;
                if event_type == "pending_prompt_added" {
                    let Ok(SessionEvent::PendingPromptAdded(payload)) =
                        serde_json::from_str::<SessionEvent>(&payload_json)
                    else {
                        continue;
                    };
                    let is_current_feedback_prompt = payload.seq == pending_prompt_seq
                        && matches!(
                            payload.prompt_provenance,
                            Some(PromptProvenance::ReviewFeedback {
                                feedback_job_id: ref payload_feedback_job_id,
                                ..
                            }) if payload_feedback_job_id == feedback_job_id
                        );
                    if is_current_feedback_prompt {
                        tracking_current_attempt = true;
                        latest_lookup = PendingPromptExecutionLookup::Pending;
                        current_turn_id = None;
                    }
                    continue;
                }
                if !tracking_current_attempt {
                    continue;
                }
                if event_type == "turn_started" {
                    current_turn_id = turn_id;
                    continue;
                }
                if event_type != "pending_prompt_removed" {
                    continue;
                }
                let Ok(SessionEvent::PendingPromptRemoved(payload)) =
                    serde_json::from_str::<SessionEvent>(&payload_json)
                else {
                    continue;
                };
                if payload.seq != pending_prompt_seq {
                    continue;
                }
                if payload.reason != PendingPromptRemovalReason::Executed {
                    latest_lookup = PendingPromptExecutionLookup::Removed {
                        reason: payload.reason,
                    };
                    tracking_current_attempt = false;
                    current_turn_id = None;
                    continue;
                }
                if let Some(turn_id) = current_turn_id.clone() {
                    latest_lookup = PendingPromptExecutionLookup::Executed {
                        turn_id,
                        executed_at: timestamp,
                    };
                };
                tracking_current_attempt = false;
                current_turn_id = None;
            }
            Ok(latest_lookup)
        })
    }

    pub fn turn_has_finished(&self, session_id: &str, turn_id: &str) -> anyhow::Result<bool> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT EXISTS(
                    SELECT 1
                    FROM session_events
                    WHERE session_id = ?1
                      AND turn_id = ?2
                      AND event_type IN ('turn_ended', 'error', 'session_ended')
                    LIMIT 1
                 )",
                params![session_id, turn_id],
                |row| row.get::<_, i64>(0),
            )
            .map(|value| value != 0)
        })
    }

    pub fn find_feedback_job(
        &self,
        job_id: &str,
    ) -> anyhow::Result<Option<ReviewFeedbackJobRecord>> {
        self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT * FROM review_feedback_jobs WHERE id = ?1",
                [job_id],
                map_feedback_job,
            )
            .optional()
        })
    }

    pub fn mark_parent_feedback_turn_finished(
        &self,
        parent_session_id: &str,
        turn_id: &str,
    ) -> anyhow::Result<Option<String>> {
        let now = chrono::Utc::now().to_rfc3339();
        self.db.with_tx(|tx| {
            let run_id = tx
                .query_row(
                    "SELECT review_runs.id
                     FROM review_runs
                     WHERE parent_session_id = ?1
                       AND status = 'parent_revising'
                       AND EXISTS (
                         SELECT 1
                         FROM review_feedback_jobs job
                         WHERE job.review_run_id = review_runs.id
                           AND job.review_round_id = review_runs.active_round_id
                           AND job.feedback_turn_id = ?2
                           AND job.state = 'sent'
                       )
                     ORDER BY updated_at DESC, id DESC
                     LIMIT 1",
                    params![parent_session_id, turn_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            let Some(run_id) = run_id else {
                return Ok(None);
            };

            tx.execute(
                "UPDATE review_runs
                 SET status = CASE
                       WHEN current_round_number >= max_rounds THEN 'stopped'
                       WHEN auto_iterate != 0 THEN status
                       ELSE 'waiting_for_revision'
                     END,
                     active_round_id = CASE
                       WHEN current_round_number >= max_rounds THEN NULL
                       ELSE active_round_id
                     END,
                     failure_reason = CASE
                       WHEN current_round_number >= max_rounds THEN 'max_rounds_reached'
                       ELSE failure_reason
                     END,
                     failure_detail = CASE
                       WHEN current_round_number >= max_rounds THEN 'Feedback was sent and the configured review rounds are complete.'
                       ELSE failure_detail
                     END,
                     stopped_at = CASE
                       WHEN current_round_number >= max_rounds THEN ?1
                       ELSE stopped_at
                     END,
                     updated_at = ?1
                 WHERE id = ?2
                   AND status = 'parent_revising'",
                params![now, run_id],
            )?;
            Ok(Some(run_id))
        })
    }
}
