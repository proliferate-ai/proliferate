use uuid::Uuid;

use super::detail::{assignment_is_terminal, build_feedback_prompt, validate_review_submission};
use super::{ReviewError, ReviewService};
use crate::domains::reviews::model::{
    ReviewAssignmentStatus, ReviewFeedbackJobRecord, ReviewFeedbackJobState, ReviewRunStatus,
};

impl ReviewService {
    pub fn submit_assignment_result(
        &self,
        reviewer_session_id: &str,
        pass: bool,
        summary: &str,
        critique_markdown: &str,
        critique_artifact_path: &str,
    ) -> Result<Option<ReviewFeedbackJobRecord>, ReviewError> {
        validate_review_submission(summary, critique_markdown)?;
        let assignment = self
            .store
            .find_assignment_for_reviewer_session(reviewer_session_id)
            .map_err(ReviewError::Internal)?
            .ok_or_else(|| ReviewError::AssignmentNotFound(reviewer_session_id.to_string()))?;
        let Some(updated) = self
            .store
            .submit_assignment_result(
                &assignment.id,
                pass,
                summary,
                critique_markdown,
                critique_artifact_path,
            )
            .map_err(ReviewError::Internal)?
        else {
            return Err(ReviewError::AssignmentTerminal);
        };
        self.try_complete_round(&updated.review_round_id)
    }

    pub fn try_complete_round(
        &self,
        round_id: &str,
    ) -> Result<Option<ReviewFeedbackJobRecord>, ReviewError> {
        let assignments = self
            .store
            .list_assignments_for_round(round_id)
            .map_err(ReviewError::Internal)?;
        if assignments.is_empty() {
            return Ok(None);
        }
        if assignments
            .iter()
            .any(|assignment| !assignment_is_terminal(assignment.status))
        {
            return Ok(None);
        }
        if !self
            .store
            .claim_round_for_completion(round_id)
            .map_err(ReviewError::Internal)?
        {
            return Ok(None);
        }
        let round = self
            .store
            .find_round(round_id)
            .map_err(ReviewError::Internal)?
            .ok_or_else(|| ReviewError::RunNotFound(round_id.to_string()))?;
        let run = self
            .store
            .find_run(&round.review_run_id)
            .map_err(ReviewError::Internal)?
            .ok_or_else(|| ReviewError::RunNotFound(round.review_run_id.clone()))?;
        let submitted_count = assignments
            .iter()
            .filter(|assignment| assignment.status == ReviewAssignmentStatus::Submitted)
            .count();
        if submitted_count == 0 {
            self.store
                .mark_run_system_failed(
                    &run.id,
                    Some(round_id),
                    "all_reviewers_failed",
                    Some("No reviewer submitted critique before the review round ended."),
                )
                .map_err(ReviewError::Internal)?;
            return Ok(None);
        }

        let now = chrono::Utc::now().to_rfc3339();
        let all_approved = assignments.iter().all(|assignment| {
            assignment.status == ReviewAssignmentStatus::Submitted && assignment.pass == Some(true)
        });
        if all_approved {
            let job = ReviewFeedbackJobRecord {
                id: Uuid::new_v4().to_string(),
                review_run_id: run.id.clone(),
                review_round_id: round.id.clone(),
                parent_session_id: run.parent_session_id.clone(),
                state: ReviewFeedbackJobState::Pending,
                prompt_text: build_feedback_prompt(&run, &round, &assignments),
                attempt_count: 0,
                next_attempt_at: None,
                sent_prompt_seq: None,
                feedback_turn_id: None,
                failure_reason: None,
                failure_detail: None,
                created_at: now.clone(),
                updated_at: now,
            };
            self.store
                .create_feedback_job(&job, ReviewRunStatus::Passed)
                .map_err(ReviewError::Internal)?;
            return Ok(Some(job));
        }

        let job = ReviewFeedbackJobRecord {
            id: Uuid::new_v4().to_string(),
            review_run_id: run.id.clone(),
            review_round_id: round.id.clone(),
            parent_session_id: run.parent_session_id.clone(),
            state: ReviewFeedbackJobState::Pending,
            prompt_text: build_feedback_prompt(&run, &round, &assignments),
            attempt_count: 0,
            next_attempt_at: None,
            sent_prompt_seq: None,
            feedback_turn_id: None,
            failure_reason: None,
            failure_detail: None,
            created_at: now.clone(),
            updated_at: now,
        };
        self.store
            .create_feedback_job(&job, ReviewRunStatus::FeedbackReady)
            .map_err(ReviewError::Internal)?;
        Ok(Some(job))
    }
}
