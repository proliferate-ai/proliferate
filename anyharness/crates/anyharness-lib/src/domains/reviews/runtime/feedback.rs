use anyharness_contract::v1::ReviewRunDetail;

use super::super::model::{
    ReviewFeedbackJobRecord, ReviewFeedbackJobState, ReviewKind, ReviewRunStatus,
};
use super::super::service::ReviewError;
use super::ReviewRuntime;
use crate::domains::sessions::prompt::provenance::PromptProvenance;
use crate::domains::sessions::runtime::SendPromptOutcome;

const FEEDBACK_RETRY_DELAY_SECS: i64 = 30;

impl ReviewRuntime {
    pub async fn submit_review_result(
        &self,
        reviewer_session_id: &str,
        pass: bool,
        summary: String,
        critique_markdown: String,
    ) -> Result<Option<ReviewFeedbackJobRecord>, ReviewError> {
        let assignment = self
            .service
            .store()
            .find_assignment_for_reviewer_session(reviewer_session_id)
            .map_err(ReviewError::Internal)?
            .ok_or_else(|| ReviewError::AssignmentNotFound(reviewer_session_id.to_string()))?;
        let artifact_path = self.write_critique_artifact(&assignment, &critique_markdown)?;
        let job = self.service.submit_assignment_result(
            reviewer_session_id,
            pass,
            &summary,
            &critique_markdown,
            &artifact_path,
        )?;
        if let Some(job) = job.as_ref() {
            self.emit_review_run_updated_for_job(job).await;
            let run = self
                .service
                .store()
                .find_run(&job.review_run_id)
                .map_err(ReviewError::Internal)?
                .ok_or_else(|| ReviewError::RunNotFound(job.review_run_id.clone()))?;
            if run.auto_iterate || run.status == ReviewRunStatus::Passed {
                self.send_feedback_job(job).await?;
            }
        }
        Ok(job)
    }

    pub async fn send_feedback(&self, run_id: &str) -> Result<ReviewRunDetail, ReviewError> {
        let run = self
            .service
            .store()
            .find_run(run_id)
            .map_err(ReviewError::Internal)?
            .ok_or_else(|| ReviewError::RunNotFound(run_id.to_string()))?;
        let rounds = self
            .service
            .store()
            .list_rounds_for_run(run_id)
            .map_err(ReviewError::Internal)?;
        let Some(job_id) = rounds
            .iter()
            .rev()
            .find_map(|round| round.feedback_job_id.clone())
        else {
            return Err(ReviewError::NotWaitingForRevision);
        };
        let job = self
            .service
            .store()
            .find_feedback_job(&job_id)
            .map_err(ReviewError::Internal)?
            .ok_or_else(|| ReviewError::RunNotFound(run.id.clone()))?;
        self.send_feedback_job(&job).await?;
        self.service.get_run_detail(run_id)
    }

    pub(super) async fn try_auto_iterate_run(
        &self,
        run_id: &str,
        feedback_turn_id: &str,
    ) -> Result<ReviewRunDetail, ReviewError> {
        let run = self
            .service
            .store()
            .find_run(run_id)
            .map_err(ReviewError::Internal)?
            .ok_or_else(|| ReviewError::RunNotFound(run_id.to_string()))?;
        if run.status != ReviewRunStatus::ParentRevising
            || !run.auto_iterate
            || run.current_round_number >= run.max_rounds
        {
            return self.service.get_run_detail(run_id);
        }

        let manifest = if run.kind == ReviewKind::Code {
            Some(self.capture_code_manifest(&run.workspace_id).await?)
        } else {
            None
        };
        let result = self.service.start_next_round_records_after_feedback_turn(
            run_id,
            feedback_turn_id,
            None,
            manifest,
        );
        let (run, started) = match result {
            Ok(value) => value,
            Err(ReviewError::RevisedPlanRequired | ReviewError::AmbiguousRevisedPlan) => {
                if self
                    .service
                    .store()
                    .mark_run_waiting_for_revision(run_id)
                    .map_err(ReviewError::Internal)?
                {
                    self.emit_review_run_updated(&run.parent_session_id, run_id)
                        .await;
                }
                return self.service.get_run_detail(run_id);
            }
            Err(error) => return Err(error),
        };
        if started {
            self.spawn_launch_active_round(run.clone());
            self.emit_review_run_updated(&run.parent_session_id, run_id)
                .await;
        }
        self.service.get_run_detail(run_id)
    }

    pub(super) async fn send_feedback_job(
        &self,
        job: &ReviewFeedbackJobRecord,
    ) -> Result<(), ReviewError> {
        if job.state == ReviewFeedbackJobState::Sent || job.sent_prompt_seq.is_some() {
            return Ok(());
        }
        let Some(job) = self
            .service
            .store()
            .mark_feedback_job_sending(&job.id)
            .map_err(ReviewError::Internal)?
        else {
            return Ok(());
        };
        self.emit_review_run_updated_for_job(&job).await;
        let outcome = self
            .session_runtime
            .send_text_prompt_with_provenance(
                &job.parent_session_id,
                job.prompt_text.clone(),
                PromptProvenance::ReviewFeedback {
                    review_run_id: job.review_run_id.clone(),
                    review_round_id: job.review_round_id.clone(),
                    feedback_job_id: job.id.clone(),
                    label: None,
                },
            )
            .await;
        match outcome {
            Ok(SendPromptOutcome::Queued { seq, .. }) => {
                self.service
                    .store()
                    .mark_feedback_job_queued(&job.id, Some(seq))
                    .map_err(ReviewError::Internal)?;
                self.emit_review_run_updated_for_job(&job).await;
            }
            Ok(SendPromptOutcome::Running { turn_id, .. }) => {
                self.service
                    .store()
                    .mark_feedback_job_sent(&job.id, None, Some(&turn_id), None)
                    .map_err(ReviewError::Internal)?;
                self.emit_review_run_updated_for_job(&job).await;
            }
            Err(error) => {
                let detail = format!("{error:?}");
                let next_attempt_at = (chrono::Utc::now()
                    + chrono::Duration::seconds(FEEDBACK_RETRY_DELAY_SECS))
                .to_rfc3339();
                if job.attempt_count >= 3 {
                    self.service
                        .store()
                        .mark_feedback_job_failed(&job.id, "prompt_send_failed", Some(&detail))
                        .map_err(ReviewError::Internal)?;
                    self.emit_review_run_updated_for_job(&job).await;
                    return Err(ReviewError::Internal(anyhow::anyhow!(detail)));
                } else {
                    self.service
                        .store()
                        .mark_feedback_job_retry(
                            &job.id,
                            "prompt_send_failed",
                            Some(&detail),
                            &next_attempt_at,
                        )
                        .map_err(ReviewError::Internal)?;
                    self.emit_review_run_updated_for_job(&job).await;
                }
            }
        }
        Ok(())
    }
}
