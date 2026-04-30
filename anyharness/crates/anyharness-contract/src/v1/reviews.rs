use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ReviewKind {
    Plan,
    Code,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ReviewRunStatus {
    Reviewing,
    FeedbackReady,
    ParentRevising,
    WaitingForRevision,
    Passed,
    Stopped,
    SystemFailed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ReviewRoundStatus {
    Reviewing,
    Completing,
    Passed,
    FeedbackPending,
    FeedbackSent,
    CompletedWithDrift,
    Cancelled,
    SystemFailed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ReviewAssignmentStatus {
    Queued,
    Launching,
    Reviewing,
    Reminded,
    Submitted,
    Cancelled,
    TimedOut,
    SystemFailed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ReviewModeVerificationStatus {
    Pending,
    Verified,
    Mismatch,
    NotChecked,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ReviewFeedbackDeliveryState {
    Pending,
    Sending,
    Sent,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReviewPersonaRequest {
    pub persona_id: String,
    pub label: String,
    pub prompt: String,
    pub agent_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StartPlanReviewRequest {
    pub parent_session_id: String,
    #[serde(default = "default_review_max_rounds")]
    pub max_rounds: u32,
    #[serde(default = "default_auto_send_feedback")]
    pub auto_send_feedback: bool,
    pub reviewers: Vec<ReviewPersonaRequest>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StartCodeReviewRequest {
    pub parent_session_id: String,
    #[serde(default = "default_review_max_rounds")]
    pub max_rounds: u32,
    #[serde(default = "default_auto_send_feedback")]
    pub auto_send_feedback: bool,
    pub reviewers: Vec<ReviewPersonaRequest>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SendReviewFeedbackRequest {}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MarkReviewRevisionReadyRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revised_plan_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReviewRunResponse {
    pub run: ReviewRunDetail,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionReviewsResponse {
    pub reviews: Vec<ReviewRunDetail>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReviewCritiqueResponse {
    pub assignment_id: String,
    pub review_run_id: String,
    pub review_round_id: String,
    pub persona_id: String,
    pub persona_label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pass: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub critique_markdown: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub critique_artifact_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub submitted_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReviewRunDetail {
    pub id: String,
    pub workspace_id: String,
    pub parent_session_id: String,
    pub kind: ReviewKind,
    pub status: ReviewRunStatus,
    pub title: String,
    pub max_rounds: u32,
    pub current_round_number: u32,
    pub auto_send_feedback: bool,
    pub parent_can_signal_revision_via_mcp: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_round_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_plan_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_plan_snapshot_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_detail: Option<String>,
    pub child_session_ids: Vec<String>,
    pub rounds: Vec<ReviewRoundDetail>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReviewRoundDetail {
    pub id: String,
    pub review_run_id: String,
    pub round_number: u32,
    pub status: ReviewRoundStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_plan_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_plan_snapshot_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub feedback_job_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub feedback_prompt_sent_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub feedback_delivery: Option<ReviewFeedbackDeliveryDetail>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_detail: Option<String>,
    pub assignments: Vec<ReviewAssignmentDetail>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReviewFeedbackDeliveryDetail {
    pub state: ReviewFeedbackDeliveryState,
    pub attempt_count: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_attempt_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReviewAssignmentDetail {
    pub id: String,
    pub review_run_id: String,
    pub review_round_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reviewer_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_link_id: Option<String>,
    pub persona_id: String,
    pub persona_label: String,
    pub agent_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requested_mode_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actual_mode_id: Option<String>,
    pub mode_verification_status: ReviewModeVerificationStatus,
    pub status: ReviewAssignmentStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pass: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    pub has_critique: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub critique_artifact_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_detail: Option<String>,
    pub deadline_at: String,
    pub created_at: String,
    pub updated_at: String,
}

const fn default_review_max_rounds() -> u32 {
    2
}

const fn default_auto_send_feedback() -> bool {
    true
}
