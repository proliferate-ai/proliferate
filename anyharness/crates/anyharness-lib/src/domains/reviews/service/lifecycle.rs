use super::{ReviewError, ReviewService};
use crate::domains::plans::model::PlanRecord;
use crate::domains::reviews::model::{ReviewRunRecord, ReviewRunStatus};

impl ReviewService {
    pub fn stop_run(&self, run_id: &str) -> Result<Vec<String>, ReviewError> {
        self.store.stop_run(run_id).map_err(ReviewError::Internal)
    }

    pub fn stop_active_run_for_parent(
        &self,
        parent_session_id: &str,
    ) -> Result<Vec<String>, ReviewError> {
        let Some(run) = self
            .store
            .find_active_run_for_parent(parent_session_id)
            .map_err(ReviewError::Internal)?
        else {
            return Ok(Vec::new());
        };
        self.stop_run(&run.id)
    }

    pub(crate) fn delete_unlaunched_reviewer_session(
        &self,
        session_id: &str,
    ) -> Result<(), ReviewError> {
        self.delete_workflow
            .delete_session(session_id)
            .map_err(ReviewError::Internal)
    }

    pub fn mark_parent_feedback_turn_finished(
        &self,
        parent_session_id: &str,
        turn_id: &str,
    ) -> Result<Option<ReviewRunRecord>, ReviewError> {
        let run_id = self
            .store
            .mark_parent_feedback_turn_finished(parent_session_id, turn_id)
            .map_err(ReviewError::Internal)?;
        run_id
            .map(|run_id| {
                self.store
                    .find_run(&run_id)
                    .map_err(ReviewError::Internal)?
                    .ok_or_else(|| ReviewError::RunNotFound(run_id))
            })
            .transpose()
    }

    pub fn record_candidate_plan(&self, plan: &PlanRecord) {
        let Ok(Some(run)) = self.store.find_active_run_for_parent(&plan.session_id) else {
            return;
        };
        if !matches!(
            run.status,
            ReviewRunStatus::ParentRevising | ReviewRunStatus::WaitingForRevision
        ) {
            return;
        }
        if let Err(error) = self.store.record_candidate_plan(
            &run.id,
            &plan.id,
            plan.source_turn_id.as_deref(),
            plan.source_tool_call_id.as_deref(),
            &plan.snapshot_hash,
        ) {
            tracing::warn!(review_run_id = %run.id, plan_id = %plan.id, error = %error, "failed to record review candidate plan");
        }
    }
}
