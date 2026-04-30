use anyharness_contract::v1;
use uuid::Uuid;

use super::model::{
    ReviewAssignmentStatus, ReviewCodeTargetManifest, ReviewFeedbackJobRecord,
    ReviewFeedbackJobState, ReviewKind, ReviewModeVerificationStatus, ReviewRoundRecord,
    ReviewRoundStatus, ReviewRunRecord, ReviewRunStatus,
};
use super::service_detail::{
    assignment_is_terminal, build_assignments, build_feedback_prompt, dedupe_personas,
    map_link_error, session_has_review_mcp, validate_review_submission, validate_reviewers,
    validate_rounds,
};
use super::store::ReviewStore;
use crate::plans::model::PlanRecord;
use crate::plans::service::PlanService;
use crate::sessions::links::model::{SessionLinkRelation, SessionLinkWorkspaceRelation};
use crate::sessions::links::service::{CreateSessionLinkInput, SessionLinkService};
use crate::sessions::store::SessionStore;

pub const REVIEWER_DEADLINE_MINUTES: i64 = 30;
pub const MAX_REVIEWERS_PER_RUN: usize = 4;
pub const MAX_REVIEW_ROUNDS: u32 = 5;
pub const MAX_REVIEW_SUMMARY_BYTES: usize = 4 * 1024;
pub const MAX_REVIEW_CRITIQUE_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone)]
pub struct ReviewPersonaInput {
    pub persona_id: String,
    pub label: String,
    pub prompt: String,
    pub agent_kind: String,
    pub model_id: Option<String>,
    pub mode_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct StartReviewInput {
    pub workspace_id: String,
    pub parent_session_id: String,
    pub kind: ReviewKind,
    pub title: String,
    pub target_plan: Option<PlanRecord>,
    pub target_code_manifest: Option<ReviewCodeTargetManifest>,
    pub max_rounds: u32,
    pub auto_iterate: bool,
    pub reviewers: Vec<ReviewPersonaInput>,
}

#[derive(Debug, thiserror::Error)]
pub enum ReviewError {
    #[error("session not found: {0}")]
    SessionNotFound(String),
    #[error("workspace not found: {0}")]
    WorkspaceNotFound(String),
    #[error("plan not found: {0}")]
    PlanNotFound(String),
    #[error("plan does not belong to this review parent session")]
    PlanParentMismatch,
    #[error("review run not found: {0}")]
    RunNotFound(String),
    #[error("review assignment not found: {0}")]
    AssignmentNotFound(String),
    #[error("a review is already active for this session")]
    ActiveReviewExists,
    #[error("reviewer list must contain between 1 and {MAX_REVIEWERS_PER_RUN} reviewers")]
    InvalidReviewerCount,
    #[error("max rounds must be between 1 and {MAX_REVIEW_ROUNDS}")]
    InvalidMaxRounds,
    #[error("review run is not waiting for a revision")]
    NotWaitingForRevision,
    #[error("review run has reached its max rounds")]
    MaxRoundsReached,
    #[error("revised plan is required")]
    RevisedPlanRequired,
    #[error("multiple revised plans are available; pass revisedPlanId")]
    AmbiguousRevisedPlan,
    #[error("cannot submit review result after assignment is terminal")]
    AssignmentTerminal,
    #[error("review assignment cannot be retried in its current state")]
    RetryNotAllowed,
    #[error("review {0} is too large")]
    ReviewSubmissionTooLarge(&'static str),
    #[error("session link failed: {0}")]
    Link(String),
    #[error(transparent)]
    Internal(anyhow::Error),
}

#[derive(Clone)]
pub struct ReviewService {
    store: ReviewStore,
    session_store: SessionStore,
    link_service: SessionLinkService,
    plan_service: ArcPlanService,
}

type ArcPlanService = std::sync::Arc<PlanService>;

impl ReviewService {
    pub fn new(
        store: ReviewStore,
        session_store: SessionStore,
        link_service: SessionLinkService,
        plan_service: ArcPlanService,
    ) -> Self {
        Self {
            store,
            session_store,
            link_service,
            plan_service,
        }
    }

    pub fn store(&self) -> &ReviewStore {
        &self.store
    }

    pub fn get_plan(&self, plan_id: &str) -> anyhow::Result<Option<PlanRecord>> {
        self.plan_service.get(plan_id)
    }

    pub fn run_accepts_manual_revision_signal(&self, run: &ReviewRunRecord) -> bool {
        if run.current_round_number >= run.max_rounds {
            return false;
        }
        matches!(run.status, ReviewRunStatus::WaitingForRevision)
            || (run.status == ReviewRunStatus::ParentRevising && !run.auto_iterate)
    }

    pub fn run_can_signal_revision_via_mcp(&self, run: &ReviewRunRecord) -> bool {
        run.parent_can_signal_revision_via_mcp && self.run_accepts_manual_revision_signal(run)
    }

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
    ) -> Result<v1::ReviewCritiqueResponse, ReviewError> {
        let assignment = self
            .store
            .find_assignment_for_run(run_id, assignment_id)
            .map_err(ReviewError::Internal)?
            .ok_or_else(|| ReviewError::AssignmentNotFound(assignment_id.to_string()))?;
        Ok(v1::ReviewCritiqueResponse {
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

    pub fn stop_run(&self, run_id: &str) -> Result<Vec<String>, ReviewError> {
        self.store.stop_run(run_id).map_err(ReviewError::Internal)
    }

    pub(crate) fn delete_unlaunched_reviewer_session(
        &self,
        session_id: &str,
    ) -> Result<(), ReviewError> {
        self.session_store
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

#[cfg(test)]
mod tests {
    use rusqlite::params;

    use super::*;
    use crate::persistence::Db;
    use crate::plans::service::PlanService;
    use crate::plans::store::PlanStore;
    use crate::sessions::links::store::SessionLinkStore;
    use crate::sessions::model::{SessionMcpBindingPolicy, SessionRecord};

    fn seed_workspace(db: &Db) {
        db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO workspaces (id, kind, path, source_repo_root_path, created_at, updated_at)
                 VALUES (?1, 'repo', '/tmp/workspace', '/tmp/workspace', ?2, ?2)",
                params!["workspace-1", "2026-03-25T00:00:00Z"],
            )?;
            Ok(())
        })
        .expect("seed workspace");
    }

    fn session_record(id: &str) -> SessionRecord {
        SessionRecord {
            id: id.to_string(),
            workspace_id: "workspace-1".to_string(),
            agent_kind: "claude".to_string(),
            native_session_id: None,
            requested_model_id: None,
            current_model_id: None,
            requested_mode_id: None,
            current_mode_id: None,
            title: None,
            thinking_level_id: None,
            thinking_budget_tokens: None,
            status: "idle".to_string(),
            created_at: "2026-03-25T00:00:00Z".to_string(),
            updated_at: "2026-03-25T00:00:00Z".to_string(),
            last_prompt_at: None,
            closed_at: None,
            dismissed_at: None,
            mcp_bindings_ciphertext: None,
            mcp_binding_summaries_json: None,
            mcp_binding_policy: SessionMcpBindingPolicy::InheritWorkspace,
            system_prompt_append: None,
            subagents_enabled: true,
            origin: None,
        }
    }

    fn service_fixture() -> (ReviewService, SessionStore) {
        let db = Db::open_in_memory().expect("open db");
        seed_workspace(&db);
        let session_store = SessionStore::new(db.clone());
        session_store
            .insert(&session_record("parent-1"))
            .expect("insert parent");
        session_store
            .insert(&session_record("child-1"))
            .expect("insert child");
        let link_service =
            SessionLinkService::new(SessionLinkStore::new(db.clone()), session_store.clone());
        let service = ReviewService::new(
            ReviewStore::new(db.clone()),
            session_store.clone(),
            link_service,
            std::sync::Arc::new(PlanService::new(PlanStore::new(db))),
        );
        (service, session_store)
    }

    fn reviewer() -> ReviewPersonaInput {
        ReviewPersonaInput {
            persona_id: "skeptic".to_string(),
            label: "Plan skeptic".to_string(),
            prompt: "Find plan gaps.".to_string(),
            agent_kind: "claude".to_string(),
            model_id: Some("opus".to_string()),
            mode_id: Some("bypassPermissions".to_string()),
        }
    }

    #[test]
    fn link_reviewer_session_makes_reviewer_role_visible_immediately() {
        let (service, _session_store) = service_fixture();
        let run = service
            .start_review(StartReviewInput {
                workspace_id: "workspace-1".to_string(),
                parent_session_id: "parent-1".to_string(),
                kind: ReviewKind::Code,
                title: "Review current changes".to_string(),
                target_plan: None,
                target_code_manifest: None,
                max_rounds: 2,
                auto_iterate: true,
                reviewers: vec![reviewer()],
            })
            .expect("start review");
        let assignment = service
            .store()
            .list_assignments_for_run(&run.id)
            .expect("list assignments")
            .pop()
            .expect("assignment");

        let link_id = service
            .link_reviewer_session(
                &run.id,
                &assignment.id,
                "parent-1",
                "child-1",
                Some("Plan skeptic".to_string()),
                None,
                ReviewModeVerificationStatus::Pending,
            )
            .expect("link reviewer");

        let visible = service
            .store()
            .find_assignment_for_reviewer_session("child-1")
            .expect("find reviewer role")
            .expect("reviewer assignment visible");
        assert_eq!(visible.id, assignment.id);
        assert_eq!(visible.session_link_id.as_deref(), Some(link_id.as_str()));
        assert_eq!(visible.status, ReviewAssignmentStatus::Reviewing);
        assert_eq!(
            visible.mode_verification_status,
            ReviewModeVerificationStatus::Pending
        );
    }

    #[test]
    fn parent_review_mcp_detection_uses_internal_review_binding_summary() {
        let (service, session_store) = service_fixture();
        let mut parent = session_record("parent-with-review-mcp");
        parent.mcp_binding_summaries_json = Some(
            serde_json::to_string(&vec![v1::SessionMcpBindingSummary {
                id: "internal:reviews".to_string(),
                server_name: "reviews".to_string(),
                display_name: Some("Reviews".to_string()),
                transport: v1::SessionMcpTransport::Http,
                outcome: v1::SessionMcpBindingOutcome::Applied,
                reason: None::<v1::SessionMcpBindingNotAppliedReason>,
            }])
            .expect("serialize summary"),
        );
        session_store.insert(&parent).expect("insert parent");

        let run = service
            .start_review(StartReviewInput {
                workspace_id: "workspace-1".to_string(),
                parent_session_id: parent.id,
                kind: ReviewKind::Code,
                title: "Review current changes".to_string(),
                target_plan: None,
                target_code_manifest: None,
                max_rounds: 1,
                auto_iterate: true,
                reviewers: vec![reviewer()],
            })
            .expect("start review");

        assert!(run.parent_can_signal_revision_via_mcp);
    }

    #[test]
    fn approved_terminal_round_creates_final_feedback_job() {
        let (service, _session_store) = service_fixture();
        let run = service
            .start_review(StartReviewInput {
                workspace_id: "workspace-1".to_string(),
                parent_session_id: "parent-1".to_string(),
                kind: ReviewKind::Code,
                title: "Review current changes".to_string(),
                target_plan: None,
                target_code_manifest: None,
                max_rounds: 2,
                auto_iterate: false,
                reviewers: vec![reviewer()],
            })
            .expect("start review");
        let assignment = service
            .store()
            .list_assignments_for_run(&run.id)
            .expect("list assignments")
            .pop()
            .expect("assignment");
        service
            .link_reviewer_session(
                &run.id,
                &assignment.id,
                "parent-1",
                "child-1",
                Some("Plan skeptic".to_string()),
                None,
                ReviewModeVerificationStatus::Pending,
            )
            .expect("link reviewer");

        let job = service
            .submit_assignment_result(
                "child-1",
                true,
                "Looks ready.",
                "## Approval\n\nNo blockers.",
                "/tmp/review.md",
            )
            .expect("submit review")
            .expect("final feedback job");
        let run = service
            .store()
            .find_run(&run.id)
            .expect("find run")
            .expect("run");

        assert_eq!(run.status, ReviewRunStatus::Passed);
        assert_eq!(run.active_round_id, None);
        assert!(job.prompt_text.contains("All reviewers approved."));
        assert!(job.prompt_text.contains("continue the implementation"));
        let due = service
            .store()
            .pending_feedback_jobs("9999-01-01T00:00:00Z")
            .expect("list pending feedback");
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].id, job.id);

        service
            .store()
            .mark_feedback_job_sending(&job.id)
            .expect("mark sending")
            .expect("claim approval feedback");
        service
            .store()
            .mark_feedback_job_failed(&job.id, "prompt_send_failed", Some("network unavailable"))
            .expect("mark feedback failed");
        let run_after_failure = service
            .store()
            .find_run(&run.id)
            .expect("find run")
            .expect("run");
        let round_after_failure = service
            .store()
            .find_round(&job.review_round_id)
            .expect("find round")
            .expect("round");
        let job_after_failure = service
            .store()
            .find_feedback_job(&job.id)
            .expect("find feedback job")
            .expect("feedback job");
        assert_eq!(run_after_failure.status, ReviewRunStatus::Passed);
        assert_eq!(
            round_after_failure.status,
            ReviewRoundStatus::FeedbackPending
        );
        assert_eq!(job_after_failure.state, ReviewFeedbackJobState::Failed);
    }

    #[test]
    fn final_round_revision_ready_closes_run_instead_of_error() {
        let (service, _session_store) = service_fixture();
        let run = service
            .start_review(StartReviewInput {
                workspace_id: "workspace-1".to_string(),
                parent_session_id: "parent-1".to_string(),
                kind: ReviewKind::Code,
                title: "Review current changes".to_string(),
                target_plan: None,
                target_code_manifest: None,
                max_rounds: 1,
                auto_iterate: true,
                reviewers: vec![reviewer()],
            })
            .expect("start review");
        let assignment = service
            .store()
            .list_assignments_for_run(&run.id)
            .expect("list assignments")
            .pop()
            .expect("assignment");
        service
            .link_reviewer_session(
                &run.id,
                &assignment.id,
                "parent-1",
                "child-1",
                Some("Plan skeptic".to_string()),
                None,
                ReviewModeVerificationStatus::Pending,
            )
            .expect("link reviewer");
        let job = service
            .submit_assignment_result(
                "child-1",
                false,
                "Needs changes.",
                "## Findings\n\nMissing concrete checks.",
                "/tmp/review.md",
            )
            .expect("submit review")
            .expect("feedback job");
        service
            .store()
            .mark_feedback_job_sent(&job.id, None, Some("feedback-turn-1"), None)
            .expect("mark feedback sent");

        let run = service
            .start_next_round_records(&run.id, None, None)
            .expect("finalize at max rounds");

        assert_eq!(run.status, ReviewRunStatus::Stopped);
        assert_eq!(run.active_round_id, None);
        assert_eq!(run.failure_reason.as_deref(), Some("max_rounds_reached"));
    }

    #[test]
    fn requested_changes_stay_feedback_ready_until_feedback_turn_is_recorded() {
        let (service, _session_store) = service_fixture();
        let run = service
            .start_review(StartReviewInput {
                workspace_id: "workspace-1".to_string(),
                parent_session_id: "parent-1".to_string(),
                kind: ReviewKind::Code,
                title: "Review current changes".to_string(),
                target_plan: None,
                target_code_manifest: None,
                max_rounds: 2,
                auto_iterate: true,
                reviewers: vec![reviewer()],
            })
            .expect("start review");
        let assignment = service
            .store()
            .list_assignments_for_run(&run.id)
            .expect("list assignments")
            .pop()
            .expect("assignment");
        service
            .link_reviewer_session(
                &run.id,
                &assignment.id,
                "parent-1",
                "child-1",
                Some("Plan skeptic".to_string()),
                None,
                ReviewModeVerificationStatus::Pending,
            )
            .expect("link reviewer");
        let job = service
            .submit_assignment_result(
                "child-1",
                false,
                "Needs changes.",
                "## Findings\n\nMissing concrete checks.",
                "/tmp/review.md",
            )
            .expect("submit review")
            .expect("feedback job");

        let run_before_delivery = service
            .store()
            .find_run(&run.id)
            .expect("find run")
            .expect("run");
        assert_eq!(run_before_delivery.status, ReviewRunStatus::FeedbackReady);

        service
            .store()
            .mark_feedback_job_sending(&job.id)
            .expect("mark sending")
            .expect("claimed sending job");
        let run_while_sending = service
            .store()
            .find_run(&run.id)
            .expect("find run")
            .expect("run");
        assert_eq!(run_while_sending.status, ReviewRunStatus::FeedbackReady);

        service
            .store()
            .mark_feedback_job_sent(&job.id, None, Some("feedback-turn-1"), None)
            .expect("mark sent");
        let run_after_delivery = service
            .store()
            .find_run(&run.id)
            .expect("find run")
            .expect("run");
        assert_eq!(run_after_delivery.status, ReviewRunStatus::ParentRevising);
    }

    #[test]
    fn manual_feedback_jobs_are_not_due_until_delivery_has_been_attempted() {
        let (service, _session_store) = service_fixture();
        let run = service
            .start_review(StartReviewInput {
                workspace_id: "workspace-1".to_string(),
                parent_session_id: "parent-1".to_string(),
                kind: ReviewKind::Code,
                title: "Review current changes".to_string(),
                target_plan: None,
                target_code_manifest: None,
                max_rounds: 2,
                auto_iterate: false,
                reviewers: vec![reviewer()],
            })
            .expect("start review");
        let assignment = service
            .store()
            .list_assignments_for_run(&run.id)
            .expect("list assignments")
            .pop()
            .expect("assignment");
        service
            .link_reviewer_session(
                &run.id,
                &assignment.id,
                "parent-1",
                "child-1",
                Some("Plan skeptic".to_string()),
                None,
                ReviewModeVerificationStatus::Pending,
            )
            .expect("link reviewer");
        let job = service
            .submit_assignment_result(
                "child-1",
                false,
                "Needs changes.",
                "## Findings\n\nMissing concrete checks.",
                "/tmp/review.md",
            )
            .expect("submit review")
            .expect("feedback job");

        let due_before_manual_send = service
            .store()
            .pending_feedback_jobs("9999-01-01T00:00:00Z")
            .expect("list pending feedback");
        assert!(due_before_manual_send.is_empty());

        service
            .store()
            .mark_feedback_job_sending(&job.id)
            .expect("mark sending")
            .expect("claimed sending job");
        service
            .store()
            .mark_feedback_job_retry(
                &job.id,
                "send_failed",
                Some("temporary failure"),
                "2000-01-01T00:00:00Z",
            )
            .expect("mark retry");

        let due_after_manual_attempt = service
            .store()
            .pending_feedback_jobs("9999-01-01T00:00:00Z")
            .expect("list pending feedback");
        assert_eq!(due_after_manual_attempt.len(), 1);
        assert_eq!(due_after_manual_attempt[0].id, job.id);
    }

    #[test]
    fn reviewer_session_can_be_reused_after_terminal_assignment() {
        let (service, _session_store) = service_fixture();
        let run = service
            .start_review(StartReviewInput {
                workspace_id: "workspace-1".to_string(),
                parent_session_id: "parent-1".to_string(),
                kind: ReviewKind::Code,
                title: "Review current changes".to_string(),
                target_plan: None,
                target_code_manifest: None,
                max_rounds: 2,
                auto_iterate: true,
                reviewers: vec![reviewer()],
            })
            .expect("start review");
        let assignment = service
            .store()
            .list_assignments_for_run(&run.id)
            .expect("list assignments")
            .pop()
            .expect("assignment");
        let link_id = service
            .link_reviewer_session(
                &run.id,
                &assignment.id,
                "parent-1",
                "child-1",
                Some("Plan skeptic".to_string()),
                None,
                ReviewModeVerificationStatus::Pending,
            )
            .expect("link reviewer");
        let job = service
            .submit_assignment_result(
                "child-1",
                false,
                "Needs changes.",
                "## Findings\n\nMissing concrete checks.",
                "/tmp/review.md",
            )
            .expect("submit review")
            .expect("feedback job");
        service
            .store()
            .mark_feedback_job_sent(&job.id, None, Some("feedback-turn-1"), None)
            .expect("mark feedback sent");
        service
            .mark_parent_feedback_turn_finished("parent-1", "feedback-turn-1")
            .expect("mark parent turn finished");

        let run = service
            .start_next_round_records(&run.id, None, None)
            .expect("start next round");
        let next_round_id = run.active_round_id.as_deref().expect("active round");
        let next_assignment = service
            .store()
            .list_assignments_for_round(next_round_id)
            .expect("list next assignments")
            .pop()
            .expect("next assignment");

        let launched = service
            .store()
            .update_assignment_launched(
                &next_assignment.id,
                "child-1",
                &link_id,
                None,
                ReviewModeVerificationStatus::Pending,
            )
            .expect("reuse reviewer session");
        assert!(launched);
        let visible = service
            .store()
            .find_assignment_for_reviewer_session("child-1")
            .expect("find active reviewer assignment")
            .expect("active reviewer assignment");

        assert_eq!(visible.id, next_assignment.id);
    }

    #[test]
    fn retry_launch_failure_restores_retryable_assignment_after_system_failure() {
        let (service, _session_store) = service_fixture();
        let run = service
            .start_review(StartReviewInput {
                workspace_id: "workspace-1".to_string(),
                parent_session_id: "parent-1".to_string(),
                kind: ReviewKind::Code,
                title: "Review current changes".to_string(),
                target_plan: None,
                target_code_manifest: None,
                max_rounds: 2,
                auto_iterate: true,
                reviewers: vec![reviewer()],
            })
            .expect("start review");
        let assignment = service
            .store()
            .list_assignments_for_run(&run.id)
            .expect("list assignments")
            .pop()
            .expect("assignment");
        service
            .link_reviewer_session(
                &run.id,
                &assignment.id,
                "parent-1",
                "child-1",
                Some("Plan skeptic".to_string()),
                None,
                ReviewModeVerificationStatus::Pending,
            )
            .expect("link reviewer");
        service
            .store()
            .mark_assignment_retryable_failed(
                &assignment.id,
                "child-1",
                "provider_rate_limit",
                Some("original provider limit"),
            )
            .expect("mark retryable")
            .expect("retryable assignment");

        let prepared = service
            .store()
            .prepare_assignment_retry(
                &run.id,
                &assignment.id,
                Some("claude-opus-4-6"),
                "2026-04-28T01:00:00Z",
            )
            .expect("prepare retry")
            .expect("prepared assignment");
        assert_eq!(prepared.status, ReviewAssignmentStatus::Launching);
        service
            .store()
            .mark_assignment_system_failed(
                &assignment.id,
                "reviewer_start_failed",
                Some("start failed"),
            )
            .expect("mark system failed");

        let restored = service
            .store()
            .restore_assignment_retryable_after_retry_launch_failed(
                &run.id,
                &assignment.id,
                Some("Retry launch failed: start failed"),
            )
            .expect("restore retryable");

        assert!(restored);
        let updated = service
            .store()
            .find_assignment(&assignment.id)
            .expect("find assignment")
            .expect("assignment");
        assert_eq!(updated.status, ReviewAssignmentStatus::RetryableFailed);
        assert_eq!(
            updated.failure_reason.as_deref(),
            Some("provider_rate_limit")
        );
        assert_eq!(
            updated.failure_detail.as_deref(),
            Some("Retry launch failed: start failed")
        );
        assert_eq!(updated.model_id.as_deref(), Some("claude-opus-4-6"));
        let completion = service
            .try_complete_round(&updated.review_round_id)
            .expect("try complete round");
        assert!(completion.is_none());
        let run_after_restore = service
            .store()
            .find_run(&run.id)
            .expect("find run")
            .expect("run");
        assert_eq!(run_after_restore.status, ReviewRunStatus::Reviewing);
    }

    #[test]
    fn retry_prompt_failure_restores_retryable_assignment_and_blocks_late_submission() {
        let (service, session_store) = service_fixture();
        session_store
            .insert(&session_record("child-retry-1"))
            .expect("insert retry child");
        let run = service
            .start_review(StartReviewInput {
                workspace_id: "workspace-1".to_string(),
                parent_session_id: "parent-1".to_string(),
                kind: ReviewKind::Code,
                title: "Review current changes".to_string(),
                target_plan: None,
                target_code_manifest: None,
                max_rounds: 2,
                auto_iterate: true,
                reviewers: vec![reviewer()],
            })
            .expect("start review");
        let assignment = service
            .store()
            .list_assignments_for_run(&run.id)
            .expect("list assignments")
            .pop()
            .expect("assignment");
        service
            .link_reviewer_session(
                &run.id,
                &assignment.id,
                "parent-1",
                "child-1",
                Some("Plan skeptic".to_string()),
                None,
                ReviewModeVerificationStatus::Pending,
            )
            .expect("link reviewer");
        service
            .store()
            .mark_assignment_retryable_failed(
                &assignment.id,
                "child-1",
                "provider_rate_limit",
                Some("original provider limit"),
            )
            .expect("mark retryable")
            .expect("retryable assignment");
        service
            .store()
            .prepare_assignment_retry(
                &run.id,
                &assignment.id,
                Some("claude-opus-4-6"),
                "2026-04-28T01:00:00Z",
            )
            .expect("prepare retry")
            .expect("prepared assignment");
        service
            .link_reviewer_session(
                &run.id,
                &assignment.id,
                "parent-1",
                "child-retry-1",
                Some("Plan skeptic".to_string()),
                None,
                ReviewModeVerificationStatus::Pending,
            )
            .expect("link retry reviewer");

        let restored = service
            .store()
            .restore_assignment_retryable_after_retry_launch_failed(
                &run.id,
                &assignment.id,
                Some("Retry launch failed: prompt rejected"),
            )
            .expect("restore retryable");

        assert!(restored);
        let updated = service
            .store()
            .find_assignment(&assignment.id)
            .expect("find assignment")
            .expect("assignment");
        assert_eq!(updated.status, ReviewAssignmentStatus::RetryableFailed);
        assert_eq!(
            updated.reviewer_session_id.as_deref(),
            Some("child-retry-1")
        );
        assert_eq!(
            updated.failure_reason.as_deref(),
            Some("provider_rate_limit")
        );

        let late_submission = service
            .submit_assignment_result(
                "child-retry-1",
                true,
                "Looks ready.",
                "## Approval\n\nNo blockers.",
                "/tmp/review.md",
            )
            .expect_err("retryable failed assignment must not accept submissions");
        assert!(matches!(
            late_submission,
            ReviewError::AssignmentNotFound(_)
        ));
    }

    #[test]
    fn retry_launch_update_does_not_resurrect_stopped_assignment() {
        let (service, session_store) = service_fixture();
        session_store
            .insert(&session_record("child-retry-1"))
            .expect("insert retry child");
        let run = service
            .start_review(StartReviewInput {
                workspace_id: "workspace-1".to_string(),
                parent_session_id: "parent-1".to_string(),
                kind: ReviewKind::Code,
                title: "Review current changes".to_string(),
                target_plan: None,
                target_code_manifest: None,
                max_rounds: 2,
                auto_iterate: true,
                reviewers: vec![reviewer()],
            })
            .expect("start review");
        let assignment = service
            .store()
            .list_assignments_for_run(&run.id)
            .expect("list assignments")
            .pop()
            .expect("assignment");
        service
            .link_reviewer_session(
                &run.id,
                &assignment.id,
                "parent-1",
                "child-1",
                Some("Plan skeptic".to_string()),
                None,
                ReviewModeVerificationStatus::Pending,
            )
            .expect("link reviewer");
        service
            .store()
            .mark_assignment_retryable_failed(
                &assignment.id,
                "child-1",
                "provider_rate_limit",
                Some("original provider limit"),
            )
            .expect("mark retryable")
            .expect("retryable assignment");
        service
            .store()
            .prepare_assignment_retry(
                &run.id,
                &assignment.id,
                Some("claude-opus-4-6"),
                "2026-04-28T01:00:00Z",
            )
            .expect("prepare retry")
            .expect("prepared assignment");

        let reviewer_ids = service.stop_run(&run.id).expect("stop run");
        assert!(reviewer_ids.is_empty());

        let link_after_stop = service
            .link_reviewer_session(
                &run.id,
                &assignment.id,
                "parent-1",
                "child-retry-1",
                Some("Plan skeptic".to_string()),
                Some("bypassPermissions"),
                ReviewModeVerificationStatus::Verified,
            )
            .expect_err("stopped review must reject retry reviewer link");
        assert!(matches!(link_after_stop, ReviewError::RetryNotAllowed));
        let leaked_link = service
            .link_service
            .find_link_by_relation(
                SessionLinkRelation::ReviewAgent,
                "parent-1",
                "child-retry-1",
            )
            .expect("find retry link");
        assert!(leaked_link.is_none());

        let launched = service
            .store()
            .update_assignment_launched(
                &assignment.id,
                "child-retry-1",
                "retry-link-1",
                Some("bypassPermissions"),
                ReviewModeVerificationStatus::Verified,
            )
            .expect("attempt launch update after stop");
        service
            .store()
            .mark_assignment_system_failed(
                &assignment.id,
                "reviewer_start_failed",
                Some("late start failure"),
            )
            .expect("late system failure marker");

        assert!(!launched);
        let updated = service
            .store()
            .find_assignment(&assignment.id)
            .expect("find assignment")
            .expect("assignment");
        assert_eq!(updated.status, ReviewAssignmentStatus::Cancelled);
        assert_eq!(updated.reviewer_session_id, None);
        assert_eq!(updated.session_link_id, None);
        let stopped = service
            .store()
            .find_run(&run.id)
            .expect("find run")
            .expect("run");
        assert_eq!(stopped.status, ReviewRunStatus::Stopped);

        service
            .delete_unlaunched_reviewer_session("child-retry-1")
            .expect("delete unlaunched reviewer");
        let deleted_child = session_store
            .find_by_id("child-retry-1")
            .expect("find deleted child");
        assert!(deleted_child.is_none());
    }

    #[test]
    fn auto_feedback_turn_claim_starts_next_round_once() {
        let (service, _session_store) = service_fixture();
        let run = service
            .start_review(StartReviewInput {
                workspace_id: "workspace-1".to_string(),
                parent_session_id: "parent-1".to_string(),
                kind: ReviewKind::Code,
                title: "Review current changes".to_string(),
                target_plan: None,
                target_code_manifest: None,
                max_rounds: 2,
                auto_iterate: true,
                reviewers: vec![reviewer()],
            })
            .expect("start review");
        let assignment = service
            .store()
            .list_assignments_for_run(&run.id)
            .expect("list assignments")
            .pop()
            .expect("assignment");
        service
            .link_reviewer_session(
                &run.id,
                &assignment.id,
                "parent-1",
                "child-1",
                Some("Plan skeptic".to_string()),
                None,
                ReviewModeVerificationStatus::Pending,
            )
            .expect("link reviewer");
        let job = service
            .submit_assignment_result(
                "child-1",
                false,
                "Needs changes.",
                "## Findings\n\nMissing concrete checks.",
                "/tmp/review.md",
            )
            .expect("submit review")
            .expect("feedback job");
        service
            .store()
            .mark_feedback_job_sent(&job.id, None, Some("feedback-turn-1"), None)
            .expect("mark feedback sent");
        service
            .mark_parent_feedback_turn_finished("parent-1", "feedback-turn-1")
            .expect("mark parent turn finished");

        let (first, first_started) = service
            .start_next_round_records_after_feedback_turn(&run.id, "feedback-turn-1", None, None)
            .expect("first auto start");
        let (second, second_started) = service
            .start_next_round_records_after_feedback_turn(&run.id, "feedback-turn-1", None, None)
            .expect("second auto start");
        let rounds = service
            .store()
            .list_rounds_for_run(&run.id)
            .expect("list rounds");

        assert!(first_started);
        assert!(!second_started);
        assert_eq!(first.current_round_number, 2);
        assert_eq!(second.current_round_number, 2);
        assert_eq!(rounds.len(), 2);
    }

    #[test]
    fn final_feedback_turn_stops_run_when_max_rounds_reached() {
        let (service, _session_store) = service_fixture();
        let run = service
            .start_review(StartReviewInput {
                workspace_id: "workspace-1".to_string(),
                parent_session_id: "parent-1".to_string(),
                kind: ReviewKind::Code,
                title: "Review current changes".to_string(),
                target_plan: None,
                target_code_manifest: None,
                max_rounds: 1,
                auto_iterate: true,
                reviewers: vec![reviewer()],
            })
            .expect("start review");
        let assignment = service
            .store()
            .list_assignments_for_run(&run.id)
            .expect("list assignments")
            .pop()
            .expect("assignment");
        service
            .link_reviewer_session(
                &run.id,
                &assignment.id,
                "parent-1",
                "child-1",
                Some("Plan skeptic".to_string()),
                None,
                ReviewModeVerificationStatus::Pending,
            )
            .expect("link reviewer");
        let job = service
            .submit_assignment_result(
                "child-1",
                false,
                "Needs changes.",
                "## Findings\n\nMissing concrete checks.",
                "/tmp/review.md",
            )
            .expect("submit review")
            .expect("feedback job");
        service
            .store()
            .mark_feedback_job_sent(&job.id, None, Some("feedback-turn-1"), None)
            .expect("mark feedback sent");

        service
            .mark_parent_feedback_turn_finished("parent-1", "feedback-turn-1")
            .expect("mark parent turn finished");
        let run = service
            .store()
            .find_run(&run.id)
            .expect("find run")
            .expect("run");

        assert_eq!(run.status, ReviewRunStatus::Stopped);
        assert_eq!(run.active_round_id, None);
        assert_eq!(run.failure_reason.as_deref(), Some("max_rounds_reached"));
    }
}
