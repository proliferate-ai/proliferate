use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

// ---------------------------------------------------------------------------
// Current pull request
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CurrentPullRequestResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pull_request: Option<PullRequestSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestSummary {
    pub number: u64,
    pub title: String,
    pub url: String,
    pub state: PullRequestState,
    pub draft: bool,
    pub head_branch: String,
    pub base_branch: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PullRequestState {
    Open,
    Closed,
    Merged,
}

// ---------------------------------------------------------------------------
// Create pull request
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreatePullRequestRequest {
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    pub base_branch: String,
    #[serde(default)]
    pub draft: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreatePullRequestResponse {
    pub pull_request: PullRequestSummary,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manual_url: Option<String>,
}

// ---------------------------------------------------------------------------
// Repo-root pull-request statuses
// ---------------------------------------------------------------------------

/// Reduced CI-check rollup state for a pull request's head commit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PullRequestChecksState {
    None,
    Pending,
    Passing,
    Failing,
}

/// Reduced review decision for a pull request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PullRequestReviewDecision {
    None,
    Approved,
    ChangesRequested,
}

/// [`PullRequestSummary`] plus reduced check-rollup and review-decision
/// fields. Both are optional so new clients deserialize old daemons (and
/// vice versa); absent maps to "none" at the domain layer.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BranchPullRequestSummary {
    pub number: u64,
    pub title: String,
    pub url: String,
    pub state: PullRequestState,
    pub draft: bool,
    pub head_branch: String,
    pub base_branch: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checks: Option<PullRequestChecksState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub review_decision: Option<PullRequestReviewDecision>,
}

/// One queried head branch. `pullRequest` null/absent means the branch WAS
/// queried and has no PR (authoritative none). Branches missing from
/// [`RepoPullRequestStatusesResponse::entries`] were not queried (unknown).
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BranchPullRequestStatus {
    pub head_branch: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pull_request: Option<BranchPullRequestSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RepoPullRequestStatusesResponse {
    pub entries: Vec<BranchPullRequestStatus>,
    pub fetched_at: String,
}
