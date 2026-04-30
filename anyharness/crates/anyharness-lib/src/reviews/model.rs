use std::fmt;

use anyharness_contract::v1;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReviewKind {
    Plan,
    Code,
}

impl ReviewKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Plan => "plan",
            Self::Code => "code",
        }
    }

    pub fn parse(value: &str) -> Result<Self, ReviewParseError> {
        match value {
            "plan" => Ok(Self::Plan),
            "code" => Ok(Self::Code),
            other => Err(ReviewParseError::UnknownKind(other.to_string())),
        }
    }
}

impl From<ReviewKind> for v1::ReviewKind {
    fn from(value: ReviewKind) -> Self {
        match value {
            ReviewKind::Plan => Self::Plan,
            ReviewKind::Code => Self::Code,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReviewRunStatus {
    Reviewing,
    FeedbackReady,
    ParentRevising,
    WaitingForRevision,
    Passed,
    Stopped,
    SystemFailed,
}

impl ReviewRunStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Reviewing => "reviewing",
            Self::FeedbackReady => "feedback_ready",
            Self::ParentRevising => "parent_revising",
            Self::WaitingForRevision => "waiting_for_revision",
            Self::Passed => "passed",
            Self::Stopped => "stopped",
            Self::SystemFailed => "system_failed",
        }
    }

    pub fn parse(value: &str) -> Result<Self, ReviewParseError> {
        match value {
            "reviewing" => Ok(Self::Reviewing),
            "feedback_ready" => Ok(Self::FeedbackReady),
            "parent_revising" => Ok(Self::ParentRevising),
            "waiting_for_revision" => Ok(Self::WaitingForRevision),
            "passed" => Ok(Self::Passed),
            "stopped" => Ok(Self::Stopped),
            "system_failed" => Ok(Self::SystemFailed),
            other => Err(ReviewParseError::UnknownRunStatus(other.to_string())),
        }
    }

    pub fn is_active(self) -> bool {
        matches!(
            self,
            Self::Reviewing | Self::FeedbackReady | Self::ParentRevising | Self::WaitingForRevision
        )
    }
}

impl From<ReviewRunStatus> for v1::ReviewRunStatus {
    fn from(value: ReviewRunStatus) -> Self {
        match value {
            ReviewRunStatus::Reviewing => Self::Reviewing,
            ReviewRunStatus::FeedbackReady => Self::FeedbackReady,
            ReviewRunStatus::ParentRevising => Self::ParentRevising,
            ReviewRunStatus::WaitingForRevision => Self::WaitingForRevision,
            ReviewRunStatus::Passed => Self::Passed,
            ReviewRunStatus::Stopped => Self::Stopped,
            ReviewRunStatus::SystemFailed => Self::SystemFailed,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
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

impl ReviewRoundStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Reviewing => "reviewing",
            Self::Completing => "completing",
            Self::Passed => "passed",
            Self::FeedbackPending => "feedback_pending",
            Self::FeedbackSent => "feedback_sent",
            Self::CompletedWithDrift => "completed_with_drift",
            Self::Cancelled => "cancelled",
            Self::SystemFailed => "system_failed",
        }
    }

    pub fn parse(value: &str) -> Result<Self, ReviewParseError> {
        match value {
            "reviewing" => Ok(Self::Reviewing),
            "completing" => Ok(Self::Completing),
            "passed" => Ok(Self::Passed),
            "feedback_pending" => Ok(Self::FeedbackPending),
            "feedback_sent" => Ok(Self::FeedbackSent),
            "completed_with_drift" => Ok(Self::CompletedWithDrift),
            "cancelled" => Ok(Self::Cancelled),
            "system_failed" => Ok(Self::SystemFailed),
            other => Err(ReviewParseError::UnknownRoundStatus(other.to_string())),
        }
    }
}

impl From<ReviewRoundStatus> for v1::ReviewRoundStatus {
    fn from(value: ReviewRoundStatus) -> Self {
        match value {
            ReviewRoundStatus::Reviewing => Self::Reviewing,
            ReviewRoundStatus::Completing => Self::Completing,
            ReviewRoundStatus::Passed => Self::Passed,
            ReviewRoundStatus::FeedbackPending => Self::FeedbackPending,
            ReviewRoundStatus::FeedbackSent => Self::FeedbackSent,
            ReviewRoundStatus::CompletedWithDrift => Self::CompletedWithDrift,
            ReviewRoundStatus::Cancelled => Self::Cancelled,
            ReviewRoundStatus::SystemFailed => Self::SystemFailed,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
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

impl ReviewAssignmentStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Launching => "launching",
            Self::Reviewing => "reviewing",
            Self::Reminded => "reminded",
            Self::Submitted => "submitted",
            Self::Cancelled => "cancelled",
            Self::TimedOut => "timed_out",
            Self::SystemFailed => "system_failed",
        }
    }

    pub fn parse(value: &str) -> Result<Self, ReviewParseError> {
        match value {
            "queued" => Ok(Self::Queued),
            "launching" => Ok(Self::Launching),
            "reviewing" => Ok(Self::Reviewing),
            "reminded" => Ok(Self::Reminded),
            "submitted" => Ok(Self::Submitted),
            "cancelled" => Ok(Self::Cancelled),
            "timed_out" => Ok(Self::TimedOut),
            "system_failed" => Ok(Self::SystemFailed),
            other => Err(ReviewParseError::UnknownAssignmentStatus(other.to_string())),
        }
    }
}

impl From<ReviewAssignmentStatus> for v1::ReviewAssignmentStatus {
    fn from(value: ReviewAssignmentStatus) -> Self {
        match value {
            ReviewAssignmentStatus::Queued => Self::Queued,
            ReviewAssignmentStatus::Launching => Self::Launching,
            ReviewAssignmentStatus::Reviewing => Self::Reviewing,
            ReviewAssignmentStatus::Reminded => Self::Reminded,
            ReviewAssignmentStatus::Submitted => Self::Submitted,
            ReviewAssignmentStatus::Cancelled => Self::Cancelled,
            ReviewAssignmentStatus::TimedOut => Self::TimedOut,
            ReviewAssignmentStatus::SystemFailed => Self::SystemFailed,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReviewModeVerificationStatus {
    Pending,
    Verified,
    Mismatch,
    NotChecked,
}

impl ReviewModeVerificationStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Verified => "verified",
            Self::Mismatch => "mismatch",
            Self::NotChecked => "not_checked",
        }
    }

    pub fn parse(value: &str) -> Result<Self, ReviewParseError> {
        match value {
            "pending" => Ok(Self::Pending),
            "verified" => Ok(Self::Verified),
            "mismatch" => Ok(Self::Mismatch),
            "not_checked" => Ok(Self::NotChecked),
            other => Err(ReviewParseError::UnknownModeVerificationStatus(
                other.to_string(),
            )),
        }
    }
}

impl From<ReviewModeVerificationStatus> for v1::ReviewModeVerificationStatus {
    fn from(value: ReviewModeVerificationStatus) -> Self {
        match value {
            ReviewModeVerificationStatus::Pending => Self::Pending,
            ReviewModeVerificationStatus::Verified => Self::Verified,
            ReviewModeVerificationStatus::Mismatch => Self::Mismatch,
            ReviewModeVerificationStatus::NotChecked => Self::NotChecked,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReviewFeedbackJobState {
    Pending,
    Sending,
    Sent,
    Failed,
}

impl ReviewFeedbackJobState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Sending => "sending",
            Self::Sent => "sent",
            Self::Failed => "failed",
        }
    }

    pub fn parse(value: &str) -> Result<Self, ReviewParseError> {
        match value {
            "pending" => Ok(Self::Pending),
            "sending" => Ok(Self::Sending),
            "sent" => Ok(Self::Sent),
            "failed" => Ok(Self::Failed),
            other => Err(ReviewParseError::UnknownFeedbackJobState(other.to_string())),
        }
    }
}

impl From<ReviewFeedbackJobState> for v1::ReviewFeedbackDeliveryState {
    fn from(value: ReviewFeedbackJobState) -> Self {
        match value {
            ReviewFeedbackJobState::Pending => Self::Pending,
            ReviewFeedbackJobState::Sending => Self::Sending,
            ReviewFeedbackJobState::Sent => Self::Sent,
            ReviewFeedbackJobState::Failed => Self::Failed,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ReviewRunRecord {
    pub id: String,
    pub workspace_id: String,
    pub parent_session_id: String,
    pub kind: ReviewKind,
    pub status: ReviewRunStatus,
    pub target_plan_id: Option<String>,
    pub target_plan_snapshot_hash: Option<String>,
    pub target_code_manifest_json: Option<String>,
    pub title: String,
    pub max_rounds: u32,
    pub auto_send_feedback: bool,
    pub active_round_id: Option<String>,
    pub current_round_number: u32,
    pub parent_can_signal_revision_via_mcp: bool,
    pub failure_reason: Option<String>,
    pub failure_detail: Option<String>,
    pub stopped_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct ReviewRoundRecord {
    pub id: String,
    pub review_run_id: String,
    pub round_number: u32,
    pub status: ReviewRoundStatus,
    pub target_plan_id: Option<String>,
    pub target_plan_snapshot_hash: Option<String>,
    pub target_code_manifest_json: Option<String>,
    pub feedback_job_id: Option<String>,
    pub feedback_prompt_sent_at: Option<String>,
    pub completed_at: Option<String>,
    pub failure_reason: Option<String>,
    pub failure_detail: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct ReviewAssignmentRecord {
    pub id: String,
    pub review_run_id: String,
    pub review_round_id: String,
    pub reviewer_session_id: Option<String>,
    pub session_link_id: Option<String>,
    pub persona_id: String,
    pub persona_label: String,
    pub persona_prompt: String,
    pub agent_kind: String,
    pub model_id: Option<String>,
    pub requested_mode_id: Option<String>,
    pub actual_mode_id: Option<String>,
    pub mode_verification_status: ReviewModeVerificationStatus,
    pub status: ReviewAssignmentStatus,
    pub pass: Option<bool>,
    pub summary: Option<String>,
    pub critique_markdown: Option<String>,
    pub critique_artifact_path: Option<String>,
    pub submitted_at: Option<String>,
    pub deadline_at: String,
    pub reminder_count: u32,
    pub failure_reason: Option<String>,
    pub failure_detail: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct ReviewFeedbackJobRecord {
    pub id: String,
    pub review_run_id: String,
    pub review_round_id: String,
    pub parent_session_id: String,
    pub state: ReviewFeedbackJobState,
    pub prompt_text: String,
    pub attempt_count: u32,
    pub next_attempt_at: Option<String>,
    pub sent_prompt_seq: Option<i64>,
    pub feedback_turn_id: Option<String>,
    pub failure_reason: Option<String>,
    pub failure_detail: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewCodeTargetManifest {
    pub git_head: Option<String>,
    pub branch: Option<String>,
    pub changed_files: Vec<ReviewChangedFileManifest>,
    pub manifest_hash: String,
    pub captured_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewChangedFileManifest {
    pub path: String,
    pub status: String,
    pub diff_hash: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ReviewParseError {
    #[error("unknown review kind: {0}")]
    UnknownKind(String),
    #[error("unknown review run status: {0}")]
    UnknownRunStatus(String),
    #[error("unknown review round status: {0}")]
    UnknownRoundStatus(String),
    #[error("unknown review assignment status: {0}")]
    UnknownAssignmentStatus(String),
    #[error("unknown review mode verification status: {0}")]
    UnknownModeVerificationStatus(String),
    #[error("unknown review feedback job state: {0}")]
    UnknownFeedbackJobState(String),
}

impl fmt::Display for ReviewKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}
