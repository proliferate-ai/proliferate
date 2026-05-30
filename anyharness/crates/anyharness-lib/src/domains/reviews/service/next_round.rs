use uuid::Uuid;

use super::detail::{build_assignments, dedupe_personas};
use super::{ReviewError, ReviewService};
use crate::domains::reviews::model::{
    ReviewCodeTargetManifest, ReviewKind, ReviewRoundRecord, ReviewRoundStatus, ReviewRunRecord,
    ReviewRunStatus,
};

impl ReviewService {
    pub fn start_next_round_records(
        &self,
        run_id: &str,
        revised_plan_id: Option<&str>,
        target_manifest: Option<ReviewCodeTargetManifest>,
    ) -> Result<ReviewRunRecord, ReviewError> {
        self.start_next_round_records_with_claim(run_id, revised_plan_id, target_manifest, None)
            .map(|(run, _started)| run)
    }

    pub fn start_next_round_records_after_feedback_turn(
        &self,
        run_id: &str,
        feedback_turn_id: &str,
        revised_plan_id: Option<&str>,
        target_manifest: Option<ReviewCodeTargetManifest>,
    ) -> Result<(ReviewRunRecord, bool), ReviewError> {
        self.start_next_round_records_with_claim(
            run_id,
            revised_plan_id,
            target_manifest,
            Some(feedback_turn_id),
        )
    }

    fn start_next_round_records_with_claim(
        &self,
        run_id: &str,
        revised_plan_id: Option<&str>,
        target_manifest: Option<ReviewCodeTargetManifest>,
        feedback_turn_id: Option<&str>,
    ) -> Result<(ReviewRunRecord, bool), ReviewError> {
        let run = self
            .store
            .find_run(run_id)
            .map_err(ReviewError::Internal)?
            .ok_or_else(|| ReviewError::RunNotFound(run_id.to_string()))?;
        if !matches!(
            run.status,
            ReviewRunStatus::FeedbackReady
                | ReviewRunStatus::ParentRevising
                | ReviewRunStatus::WaitingForRevision
        ) {
            if feedback_turn_id.is_some() {
                return Ok((run, false));
            }
            return Err(ReviewError::NotWaitingForRevision);
        }
        if run.current_round_number >= run.max_rounds {
            if matches!(
                run.status,
                ReviewRunStatus::ParentRevising | ReviewRunStatus::WaitingForRevision
            ) {
                self.store
                    .mark_run_max_rounds_reached(&run.id)
                    .map_err(ReviewError::Internal)?;
                return self
                    .store
                    .find_run(&run.id)
                    .map_err(ReviewError::Internal)?
                    .ok_or_else(|| ReviewError::RunNotFound(run.id))
                    .map(|run| (run, false));
            }
            return Err(ReviewError::MaxRoundsReached);
        }

        let revised_plan = match run.kind {
            ReviewKind::Plan => {
                let inferred_plan_id;
                let plan_id = match revised_plan_id {
                    Some(plan_id) => plan_id,
                    None => {
                        inferred_plan_id = self
                            .store
                            .find_single_candidate_plan_id(&run.id, feedback_turn_id)
                            .map_err(|error| {
                                if error.to_string()
                                    == "multiple revised plan candidates are available"
                                {
                                    ReviewError::AmbiguousRevisedPlan
                                } else {
                                    ReviewError::Internal(error)
                                }
                            })?
                            .ok_or(ReviewError::RevisedPlanRequired)?;
                        inferred_plan_id.as_str()
                    }
                };
                let plan = self
                    .plan_service
                    .get(plan_id)
                    .map_err(ReviewError::Internal)?
                    .ok_or_else(|| ReviewError::PlanNotFound(plan_id.to_string()))?;
                if plan.workspace_id != run.workspace_id || plan.session_id != run.parent_session_id
                {
                    return Err(ReviewError::PlanParentMismatch);
                }
                Some(plan)
            }
            ReviewKind::Code => None,
        };
        let previous_assignments = self
            .store
            .list_assignments_for_run(run_id)
            .map_err(ReviewError::Internal)?;
        let personas = dedupe_personas(previous_assignments);
        let now = chrono::Utc::now().to_rfc3339();
        let round_number = run.current_round_number + 1;
        let round = ReviewRoundRecord {
            id: Uuid::new_v4().to_string(),
            review_run_id: run.id.clone(),
            round_number,
            status: ReviewRoundStatus::Reviewing,
            target_plan_id: revised_plan.as_ref().map(|plan| plan.id.clone()),
            target_plan_snapshot_hash: revised_plan.as_ref().map(|plan| plan.snapshot_hash.clone()),
            target_code_manifest_json: target_manifest
                .as_ref()
                .map(serde_json::to_string)
                .transpose()
                .map_err(|error| ReviewError::Internal(anyhow::Error::from(error)))?,
            feedback_job_id: None,
            feedback_prompt_sent_at: None,
            completed_at: None,
            failure_reason: None,
            failure_detail: None,
            created_at: now.clone(),
            updated_at: now.clone(),
        };
        let assignments = build_assignments(&run, &round, &personas, &now);
        let started = self
            .store
            .start_next_round(
                &run.id,
                &round,
                &assignments,
                round.target_plan_id.as_deref(),
                round.target_plan_snapshot_hash.as_deref(),
                round.target_code_manifest_json.as_deref(),
                run.current_round_number,
                feedback_turn_id,
            )
            .map_err(ReviewError::Internal)?;
        if !started {
            return self
                .store
                .find_run(&run.id)
                .map_err(ReviewError::Internal)?
                .ok_or_else(|| ReviewError::RunNotFound(run.id))
                .map(|run| (run, false));
        }
        self.store
            .find_run(&run.id)
            .map_err(ReviewError::Internal)?
            .ok_or_else(|| ReviewError::RunNotFound(run.id))
            .map(|run| (run, true))
    }
}
