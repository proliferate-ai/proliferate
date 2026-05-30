use anyharness_contract::v1::ReviewRunDetail;

use super::super::model::{ReviewKind, ReviewRunStatus};
use super::super::service::{ReviewError, StartReviewInput};
use super::{
    MarkReviewRevisionReadyInput, RetryReviewAssignmentInput, ReviewRuntime,
    StartCodeReviewRuntimeInput, StartPlanReviewRuntimeInput,
};
use crate::acp::provider_errors::OPUS_4_6_FALLBACK_MODEL_ID;

impl ReviewRuntime {
    pub async fn start_plan_review(
        &self,
        workspace_id: &str,
        plan_id: &str,
        input: StartPlanReviewRuntimeInput,
    ) -> Result<ReviewRunDetail, ReviewError> {
        let target_plan = self
            .service
            .get_plan(plan_id)
            .map_err(ReviewError::Internal)?
            .ok_or_else(|| ReviewError::PlanNotFound(plan_id.to_string()))?;
        let run = self.service.start_review(StartReviewInput {
            workspace_id: workspace_id.to_string(),
            parent_session_id: input.parent_session_id,
            kind: ReviewKind::Plan,
            title: format!("Plan review: {}", target_plan.title),
            target_plan: Some(target_plan),
            target_code_manifest: None,
            max_rounds: input.max_rounds,
            auto_iterate: input.auto_iterate,
            reviewers: input.reviewers,
        })?;
        self.spawn_launch_active_round(run.clone());
        self.service.get_run_detail(&run.id)
    }

    pub async fn start_code_review(
        &self,
        workspace_id: &str,
        input: StartCodeReviewRuntimeInput,
    ) -> Result<ReviewRunDetail, ReviewError> {
        let manifest = self.capture_code_manifest(workspace_id).await?;
        let run = self.service.start_review(StartReviewInput {
            workspace_id: workspace_id.to_string(),
            parent_session_id: input.parent_session_id,
            kind: ReviewKind::Code,
            title: "Implementation review".to_string(),
            target_plan: None,
            target_code_manifest: Some(manifest),
            max_rounds: input.max_rounds,
            auto_iterate: input.auto_iterate,
            reviewers: input.reviewers,
        })?;
        self.spawn_launch_active_round(run.clone());
        self.service.get_run_detail(&run.id)
    }

    pub async fn mark_revision_ready(
        &self,
        run_id: &str,
        input: MarkReviewRevisionReadyInput,
    ) -> Result<ReviewRunDetail, ReviewError> {
        let existing = self
            .service
            .store()
            .find_run(run_id)
            .map_err(ReviewError::Internal)?
            .ok_or_else(|| ReviewError::RunNotFound(run_id.to_string()))?;
        if !matches!(
            existing.status,
            ReviewRunStatus::ParentRevising | ReviewRunStatus::WaitingForRevision
        ) || (existing.status == ReviewRunStatus::ParentRevising && existing.auto_iterate)
        {
            return Err(ReviewError::NotWaitingForRevision);
        }
        let manifest = {
            if existing.kind == ReviewKind::Code {
                Some(self.capture_code_manifest(&existing.workspace_id).await?)
            } else {
                None
            }
        };
        let run = self.service.start_next_round_records(
            run_id,
            input.revised_plan_id.as_deref(),
            manifest,
        )?;
        if run.status == ReviewRunStatus::Reviewing {
            self.spawn_launch_active_round(run.clone());
        }
        self.emit_review_run_updated(&run.parent_session_id, run_id)
            .await;
        self.service.get_run_detail(run_id)
    }

    pub async fn mark_revision_ready_from_parent_tool(
        &self,
        parent_session_id: &str,
        run_id: &str,
        input: MarkReviewRevisionReadyInput,
    ) -> Result<ReviewRunDetail, ReviewError> {
        let run = self
            .service
            .store()
            .find_run(run_id)
            .map_err(ReviewError::Internal)?
            .ok_or_else(|| ReviewError::RunNotFound(run_id.to_string()))?;
        if run.parent_session_id != parent_session_id {
            return Err(ReviewError::RunNotFound(run_id.to_string()));
        }
        if !self.service.run_accepts_manual_revision_signal(&run) {
            return self.service.get_run_detail(run_id);
        }
        self.mark_revision_ready(run_id, input).await
    }

    pub async fn retry_assignment(
        &self,
        run_id: &str,
        assignment_id: &str,
        input: RetryReviewAssignmentInput,
    ) -> Result<ReviewRunDetail, ReviewError> {
        let model_id = input
            .model_id
            .as_deref()
            .unwrap_or(OPUS_4_6_FALLBACK_MODEL_ID);
        let run = self
            .service
            .store()
            .find_run(run_id)
            .map_err(ReviewError::Internal)?
            .ok_or_else(|| ReviewError::RunNotFound(run_id.to_string()))?;
        if self
            .service
            .store()
            .find_assignment_for_run(run_id, assignment_id)
            .map_err(ReviewError::Internal)?
            .is_none()
        {
            return Err(ReviewError::AssignmentNotFound(assignment_id.to_string()));
        }
        let deadline_at = (chrono::Utc::now()
            + chrono::Duration::minutes(
                crate::domains::reviews::service::REVIEWER_DEADLINE_MINUTES,
            ))
        .to_rfc3339();
        let assignment = self
            .service
            .store()
            .prepare_assignment_retry(run_id, assignment_id, Some(model_id), &deadline_at)
            .map_err(ReviewError::Internal)?
            .ok_or(ReviewError::RetryNotAllowed)?;
        if let Err(error) = self.launch_new_assignment_session(&run, &assignment).await {
            let detail = format!("Retry launch failed: {error}");
            if let Err(restore_error) = self
                .service
                .store()
                .restore_assignment_retryable_after_retry_launch_failed(
                    run_id,
                    assignment_id,
                    Some(&detail),
                )
            {
                tracing::warn!(
                    review_run_id = %run_id,
                    assignment_id,
                    error = %restore_error,
                    "failed to restore retryable review assignment after retry launch failure"
                );
            }
            self.emit_review_run_updated(&run.parent_session_id, run_id)
                .await;
            return Err(error);
        }
        self.emit_review_run_updated(&run.parent_session_id, run_id)
            .await;
        self.service.get_run_detail(run_id)
    }

    pub async fn stop_run(&self, run_id: &str) -> Result<ReviewRunDetail, ReviewError> {
        let reviewer_session_ids = self.service.stop_run(run_id)?;
        for session_id in reviewer_session_ids {
            let _ = self.session_runtime.cancel_live_session(&session_id).await;
        }
        if let Some(run) = self
            .service
            .store()
            .find_run(run_id)
            .map_err(ReviewError::Internal)?
        {
            self.emit_review_run_updated(&run.parent_session_id, run_id)
                .await;
        }
        self.service.get_run_detail(run_id)
    }
}
