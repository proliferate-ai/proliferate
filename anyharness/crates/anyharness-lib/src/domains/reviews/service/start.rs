use uuid::Uuid;

use super::detail::{
    build_assignments, map_link_error, session_has_review_mcp, validate_reviewers, validate_rounds,
};
use super::{ReviewError, ReviewService, StartReviewInput};
use crate::domains::reviews::model::{
    ReviewModeVerificationStatus, ReviewRoundRecord, ReviewRoundStatus, ReviewRunRecord,
    ReviewRunStatus,
};
use crate::domains::sessions::links::model::{SessionLinkRelation, SessionLinkWorkspaceRelation};
use crate::domains::sessions::links::service::CreateSessionLinkInput;

impl ReviewService {
    pub fn start_review(&self, input: StartReviewInput) -> Result<ReviewRunRecord, ReviewError> {
        validate_rounds(input.max_rounds)?;
        validate_reviewers(&input.reviewers)?;
        let parent = self
            .session_store
            .find_by_id(&input.parent_session_id)
            .map_err(ReviewError::Internal)?
            .ok_or_else(|| ReviewError::SessionNotFound(input.parent_session_id.clone()))?;
        if parent.workspace_id != input.workspace_id {
            return Err(ReviewError::WorkspaceNotFound(input.workspace_id));
        }
        if self
            .store
            .find_active_run_for_parent(&input.parent_session_id)
            .map_err(ReviewError::Internal)?
            .is_some()
        {
            return Err(ReviewError::ActiveReviewExists);
        }
        if let Some(plan) = input.target_plan.as_ref() {
            if plan.workspace_id != input.workspace_id || plan.session_id != input.parent_session_id
            {
                return Err(ReviewError::PlanParentMismatch);
            }
        }

        let now = chrono::Utc::now().to_rfc3339();
        let run_id = Uuid::new_v4().to_string();
        let round_id = Uuid::new_v4().to_string();
        let target_code_manifest_json = input
            .target_code_manifest
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|error| ReviewError::Internal(anyhow::Error::from(error)))?;
        let parent_can_signal_revision_via_mcp = session_has_review_mcp(&parent);
        let run = ReviewRunRecord {
            id: run_id.clone(),
            workspace_id: input.workspace_id.clone(),
            parent_session_id: input.parent_session_id.clone(),
            kind: input.kind,
            status: ReviewRunStatus::Reviewing,
            target_plan_id: input.target_plan.as_ref().map(|plan| plan.id.clone()),
            target_plan_snapshot_hash: input
                .target_plan
                .as_ref()
                .map(|plan| plan.snapshot_hash.clone()),
            target_code_manifest_json: target_code_manifest_json.clone(),
            title: input.title,
            max_rounds: input.max_rounds,
            auto_iterate: input.auto_iterate,
            active_round_id: Some(round_id.clone()),
            current_round_number: 1,
            parent_can_signal_revision_via_mcp,
            failure_reason: None,
            failure_detail: None,
            stopped_at: None,
            created_at: now.clone(),
            updated_at: now.clone(),
        };
        let round = ReviewRoundRecord {
            id: round_id.clone(),
            review_run_id: run_id.clone(),
            round_number: 1,
            status: ReviewRoundStatus::Reviewing,
            target_plan_id: run.target_plan_id.clone(),
            target_plan_snapshot_hash: run.target_plan_snapshot_hash.clone(),
            target_code_manifest_json,
            feedback_job_id: None,
            feedback_prompt_sent_at: None,
            completed_at: None,
            failure_reason: None,
            failure_detail: None,
            created_at: now.clone(),
            updated_at: now.clone(),
        };
        let assignments = build_assignments(&run, &round, &input.reviewers, &now);
        self.store
            .create_run(&run, &round, &assignments)
            .map_err(ReviewError::Internal)?;
        Ok(run)
    }

    pub fn link_reviewer_session(
        &self,
        run_id: &str,
        assignment_id: &str,
        parent_session_id: &str,
        reviewer_session_id: &str,
        label: Option<String>,
        actual_mode_id: Option<&str>,
        mode_status: ReviewModeVerificationStatus,
    ) -> Result<String, ReviewError> {
        let link = self
            .link_service
            .create_link(CreateSessionLinkInput {
                relation: SessionLinkRelation::ReviewAgent,
                parent_session_id: parent_session_id.to_string(),
                child_session_id: reviewer_session_id.to_string(),
                workspace_relation: SessionLinkWorkspaceRelation::SameWorkspace,
                label,
                created_by_turn_id: None,
                created_by_tool_call_id: None,
            })
            .map_err(map_link_error)?;
        let launched = self
            .store
            .update_assignment_launched(
                assignment_id,
                reviewer_session_id,
                &link.id,
                actual_mode_id,
                mode_status,
            )
            .map_err(ReviewError::Internal)?;
        if !launched {
            self.link_service
                .delete_link(&link.id)
                .map_err(ReviewError::Internal)?;
            return Err(ReviewError::RetryNotAllowed);
        }
        tracing::info!(
            review_run_id = %run_id,
            assignment_id,
            reviewer_session_id,
            session_link_id = %link.id,
            "linked review agent session"
        );
        Ok(link.id)
    }
}
