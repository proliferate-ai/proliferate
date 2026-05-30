use anyharness_contract::v1;

use super::{ReviewError, ReviewService};
use crate::domains::reviews::model::ReviewCritique;

impl ReviewService {
    pub fn list_session_reviews(
        &self,
        session_id: &str,
    ) -> Result<Vec<v1::ReviewRunDetail>, ReviewError> {
        self.session_store
            .find_by_id(session_id)
            .map_err(ReviewError::Internal)?
            .ok_or_else(|| ReviewError::SessionNotFound(session_id.to_string()))?;
        let runs = self
            .store
            .list_runs_for_parent(session_id)
            .map_err(ReviewError::Internal)?;
        runs.iter().map(|run| self.detail_for_run(run)).collect()
    }

    pub fn get_run_detail(&self, run_id: &str) -> Result<v1::ReviewRunDetail, ReviewError> {
        let run = self
            .store
            .find_run(run_id)
            .map_err(ReviewError::Internal)?
            .ok_or_else(|| ReviewError::RunNotFound(run_id.to_string()))?;
        self.detail_for_run(&run)
    }

    pub fn get_assignment_critique(
        &self,
        run_id: &str,
        assignment_id: &str,
    ) -> Result<ReviewCritique, ReviewError> {
        let assignment = self
            .store
            .find_assignment_for_run(run_id, assignment_id)
            .map_err(ReviewError::Internal)?
            .ok_or_else(|| ReviewError::AssignmentNotFound(assignment_id.to_string()))?;
        Ok(ReviewCritique {
            assignment_id: assignment.id,
            review_run_id: assignment.review_run_id,
            review_round_id: assignment.review_round_id,
            persona_id: assignment.persona_id,
            persona_label: assignment.persona_label,
            pass: assignment.pass,
            summary: assignment.summary,
            critique_markdown: assignment.critique_markdown,
            critique_artifact_path: assignment.critique_artifact_path,
            submitted_at: assignment.submitted_at,
        })
    }
}
