use anyharness_contract::v1::ReviewRunUpdatedPayload;

use super::super::hooks::ReviewHookEvent;
use super::super::model::{ReviewFeedbackJobRecord, ReviewRunStatus};
use super::super::service::ReviewError;
use super::ReviewRuntime;
use crate::domains::sessions::extensions::SessionTurnOutcome;
use crate::domains::sessions::prompt::provenance::PromptProvenance;
use crate::domains::sessions::runtime_event::RuntimeInjectedSessionEvent;

impl ReviewRuntime {
    pub(super) async fn emit_review_run_updated_for_job(&self, job: &ReviewFeedbackJobRecord) {
        self.emit_review_run_updated(&job.parent_session_id, &job.review_run_id)
            .await;
    }

    pub(super) async fn emit_review_run_updated(&self, parent_session_id: &str, run_id: &str) {
        let Ok(Some(run)) = self.service.store().find_run(run_id) else {
            return;
        };
        let payload = ReviewRunUpdatedPayload {
            review_run_id: run.id.clone(),
            parent_session_id: run.parent_session_id.clone(),
            kind: run.kind.into(),
            status: run.status.into(),
            current_round_number: run.current_round_number,
            max_rounds: run.max_rounds,
            auto_iterate: run.auto_iterate,
            active_round_id: run.active_round_id.clone(),
            updated_at: run.updated_at.clone(),
        };
        if let Err(error) = self
            .session_runtime
            .emit_runtime_event(
                &run.parent_session_id,
                RuntimeInjectedSessionEvent::ReviewRunUpdated(payload),
            )
            .await
        {
            tracing::warn!(
                review_run_id = %run.id,
                parent_session_id = %run.parent_session_id,
                requested_parent_session_id = %parent_session_id,
                error = %error,
                "failed to emit review run update event"
            );
        }
    }

    pub(super) async fn handle_hook_event(&self, event: ReviewHookEvent) {
        match event {
            ReviewHookEvent::TurnFinished(ctx) => {
                if ctx.outcome == SessionTurnOutcome::Completed {
                    match self
                        .service
                        .mark_parent_feedback_turn_finished(&ctx.session_id, &ctx.turn_id)
                    {
                        Ok(Some(run)) => {
                            self.emit_review_run_updated(&run.parent_session_id, &run.id)
                                .await;
                            if run.status == ReviewRunStatus::ParentRevising && run.auto_iterate {
                                if let Err(error) =
                                    self.try_auto_iterate_run(&run.id, &ctx.turn_id).await
                                {
                                    tracing::warn!(
                                        review_run_id = %run.id,
                                        error = %error,
                                        "failed to auto-iterate review run after parent turn finished"
                                    );
                                }
                            }
                        }
                        Ok(None) => {}
                        Err(error) => {
                            tracing::warn!(
                                parent_session_id = %ctx.session_id,
                                turn_id = %ctx.turn_id,
                                error = %error,
                                "failed to process review parent turn-finished hook"
                            );
                        }
                    }
                }
                if let Err(error) = self.handle_reviewer_turn_finished(&ctx).await {
                    tracing::warn!(
                        session_id = %ctx.session_id,
                        error = %error,
                        "failed to process reviewer turn-finished review hook"
                    );
                }
            }
        }
    }

    pub(super) async fn handle_reviewer_turn_finished(
        &self,
        ctx: &crate::domains::sessions::extensions::SessionTurnFinishedContext,
    ) -> Result<(), ReviewError> {
        let Some(assignment) = self
            .service
            .store()
            .find_assignment_for_reviewer_session(&ctx.session_id)
            .map_err(ReviewError::Internal)?
        else {
            return Ok(());
        };
        if ctx.outcome == SessionTurnOutcome::Failed
            && matches!(
                ctx.error_details.as_ref(),
                Some(anyharness_contract::v1::ErrorEventDetails::ProviderRateLimit { .. })
            )
        {
            if let Some(updated) = self
                .service
                .store()
                .mark_assignment_retryable_failed(
                    &assignment.id,
                    &ctx.session_id,
                    "provider_rate_limit",
                    Some("Reviewer hit the provider rate limit. Retry with Opus 4.6."),
                )
                .map_err(ReviewError::Internal)?
            {
                if let Some(run) = self
                    .service
                    .store()
                    .find_run(&updated.review_run_id)
                    .map_err(ReviewError::Internal)?
                {
                    self.emit_review_run_updated(&run.parent_session_id, &run.id)
                        .await;
                }
            }
            return Ok(());
        }
        if assignment.reminder_count < 2 {
            if self
                .service
                .store()
                .mark_assignment_reminded(&assignment.id)
                .map_err(ReviewError::Internal)?
            {
                self.session_runtime
                    .send_text_prompt_with_provenance(
                        &ctx.session_id,
                        "Submit your review verdict now with submit_review_result. Put a concise structured Markdown review in critiqueMarkdown, including concrete findings when failing. Do not continue with only prose.".to_string(),
                        PromptProvenance::System {
                            label: Some("review_submit_reminder".to_string()),
                        },
                    )
                    .await
                    .map_err(|error| ReviewError::Internal(anyhow::anyhow!("{error:?}")))?;
            }
            return Ok(());
        }
        self.service
            .store()
            .mark_assignment_system_failed(
                &assignment.id,
                "missing_review_result",
                Some("Reviewer finished multiple turns without calling submit_review_result."),
            )
            .map_err(ReviewError::Internal)?;
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
        Ok(())
    }
}
