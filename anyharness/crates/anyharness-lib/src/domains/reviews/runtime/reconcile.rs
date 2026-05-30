use super::super::model::ReviewRunStatus;
use super::super::service::ReviewError;
use super::super::store::feedback::PendingPromptExecutionLookup;
use super::ReviewRuntime;

impl ReviewRuntime {
    pub(super) async fn reconcile_active_reviews(&self) {
        if let Err(error) = self.resolve_queued_feedback_jobs().await {
            tracing::warn!(error = %error, "failed to reconcile queued review feedback jobs");
        }
        if let Err(error) = self.finish_completed_feedback_turns().await {
            tracing::warn!(error = %error, "failed to reconcile finished review feedback turns");
        }
        if let Err(error) = self.send_due_feedback_jobs().await {
            tracing::warn!(error = %error, "failed to reconcile due review feedback jobs");
        }
        if let Err(error) = self.timeout_overdue_assignments().await {
            tracing::warn!(error = %error, "failed to reconcile overdue review assignments");
        }
    }

    async fn resolve_queued_feedback_jobs(&self) -> Result<(), ReviewError> {
        let jobs = self
            .service
            .store()
            .queued_feedback_jobs_without_turn()
            .map_err(ReviewError::Internal)?;
        for job in jobs {
            let Some(seq) = job.sent_prompt_seq else {
                continue;
            };
            match self
                .service
                .store()
                .find_pending_prompt_execution(&job.parent_session_id, seq, &job.id)
                .map_err(ReviewError::Internal)?
            {
                PendingPromptExecutionLookup::Pending => continue,
                PendingPromptExecutionLookup::Executed {
                    turn_id,
                    executed_at,
                } => {
                    self.service
                        .store()
                        .mark_feedback_job_sent(
                            &job.id,
                            Some(seq),
                            Some(&turn_id),
                            Some(&executed_at),
                        )
                        .map_err(ReviewError::Internal)?;
                    self.emit_review_run_updated_for_job(&job).await;
                }
                PendingPromptExecutionLookup::Removed { reason } => {
                    let detail = format!(
                        "Queued review feedback prompt seq {seq} was removed before execution ({reason:?}).",
                    );
                    if let Some(updated_job) = self
                        .service
                        .store()
                        .reset_queued_feedback_job_for_retry(
                            &job.id,
                            seq,
                            "queued_prompt_removed",
                            Some(&detail),
                        )
                        .map_err(ReviewError::Internal)?
                    {
                        self.emit_review_run_updated_for_job(&updated_job).await;
                    }
                }
            }
        }
        Ok(())
    }

    async fn finish_completed_feedback_turns(&self) -> Result<(), ReviewError> {
        let jobs = self
            .service
            .store()
            .sent_feedback_jobs_with_parent_revising()
            .map_err(ReviewError::Internal)?;
        for job in jobs {
            let Some(turn_id) = job.feedback_turn_id.as_deref() else {
                continue;
            };
            if !self
                .service
                .store()
                .turn_has_finished(&job.parent_session_id, turn_id)
                .map_err(ReviewError::Internal)?
            {
                continue;
            }
            let Some(run) = self
                .service
                .mark_parent_feedback_turn_finished(&job.parent_session_id, turn_id)?
            else {
                continue;
            };
            self.emit_review_run_updated(&run.parent_session_id, &run.id)
                .await;
            if run.status == ReviewRunStatus::ParentRevising && run.auto_iterate {
                self.try_auto_iterate_run(&run.id, turn_id).await?;
            }
        }
        Ok(())
    }

    async fn send_due_feedback_jobs(&self) -> Result<(), ReviewError> {
        let now = chrono::Utc::now().to_rfc3339();
        let jobs = self
            .service
            .store()
            .pending_feedback_jobs(&now)
            .map_err(ReviewError::Internal)?;
        for job in jobs {
            if let Err(error) = self.send_feedback_job(&job).await {
                tracing::warn!(
                    review_feedback_job_id = %job.id,
                    error = %error,
                    "failed to send due review feedback job"
                );
            }
        }
        Ok(())
    }

    async fn timeout_overdue_assignments(&self) -> Result<(), ReviewError> {
        let now = chrono::Utc::now().to_rfc3339();
        let assignments = self
            .service
            .store()
            .active_assignments_past_deadline(&now)
            .map_err(ReviewError::Internal)?;
        for assignment in assignments {
            if !self
                .service
                .store()
                .mark_assignment_timed_out(
                    &assignment.id,
                    "reviewer_deadline_exceeded",
                    Some("Reviewer did not submit a result before the assignment deadline."),
                )
                .map_err(ReviewError::Internal)?
            {
                continue;
            }
            if let Some(session_id) = assignment.reviewer_session_id.as_deref() {
                let _ = self.session_runtime.cancel_live_session(session_id).await;
            }
            if let Some(job) = self
                .service
                .try_complete_round(&assignment.review_round_id)?
            {
                self.emit_review_run_updated_for_job(&job).await;
                let run = self
                    .service
                    .store()
                    .find_run(&job.review_run_id)
                    .map_err(ReviewError::Internal)?
                    .ok_or_else(|| ReviewError::RunNotFound(job.review_run_id.clone()))?;
                if run.auto_iterate {
                    self.send_feedback_job(&job).await?;
                }
            } else if let Some(run) = self
                .service
                .store()
                .find_run(&assignment.review_run_id)
                .map_err(ReviewError::Internal)?
                .filter(|run| run.status == ReviewRunStatus::SystemFailed)
            {
                self.emit_review_run_updated(&run.parent_session_id, &run.id)
                    .await;
            }
        }
        Ok(())
    }
}
