use super::model::{ReviewCodeTargetManifest, ReviewRunRecord, ReviewRunStatus};
use super::store::ReviewStore;
use crate::domains::plans::model::PlanRecord;
use crate::domains::plans::service::PlanService;
use crate::sessions::deletion::SessionDeleteWorkflow;
use crate::sessions::links::service::SessionLinkService;
use crate::sessions::store::SessionStore;

mod completion;
mod detail;
mod lifecycle;
mod next_round;
mod queries;
mod start;

pub const REVIEWER_DEADLINE_MINUTES: i64 = 30;
pub const MAX_REVIEWERS_PER_RUN: usize = 4;
pub const MAX_REVIEW_ROUNDS: u32 = 10;
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
    pub kind: super::model::ReviewKind,
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
    #[error("review {0} is required")]
    ReviewSubmissionEmpty(&'static str),
    #[error("session link failed: {0}")]
    Link(String),
    #[error(transparent)]
    Internal(anyhow::Error),
}

#[derive(Clone)]
pub struct ReviewService {
    store: ReviewStore,
    session_store: SessionStore,
    delete_workflow: SessionDeleteWorkflow,
    link_service: SessionLinkService,
    plan_service: ArcPlanService,
}

type ArcPlanService = std::sync::Arc<PlanService>;

impl ReviewService {
    pub fn new(
        store: ReviewStore,
        session_store: SessionStore,
        delete_workflow: SessionDeleteWorkflow,
        link_service: SessionLinkService,
        plan_service: ArcPlanService,
    ) -> Self {
        Self {
            store,
            session_store,
            delete_workflow,
            link_service,
            plan_service,
        }
    }

    pub fn store(&self) -> &ReviewStore {
        &self.store
    }

    pub fn session_is_closed(&self, session_id: &str) -> anyhow::Result<bool> {
        Ok(self
            .session_store
            .find_by_id(session_id)?
            .is_some_and(|session| session.closed_at.is_some() || session.status == "closed"))
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
}

#[cfg(test)]
mod service_tests;
