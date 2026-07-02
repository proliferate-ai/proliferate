#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PullRequestState {
    Open,
    Closed,
    Merged,
}

/// Reduced CI-check rollup state for a pull request's head commit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PullRequestChecksState {
    None,
    Pending,
    Passing,
    Failing,
}

/// Reduced review decision for a pull request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PullRequestReviewDecision {
    None,
    Approved,
    ChangesRequested,
}

#[derive(Debug)]
pub enum HostingServiceError {
    GhNotInstalled,
    GhAuthRequired(String),
    RemoteUnsupported(String),
    PullRequestViewFailed(String),
    PullRequestCreateFailed(String),
}

impl std::fmt::Display for HostingServiceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            HostingServiceError::GhNotInstalled => {
                write!(f, "GitHub CLI (gh) is not installed")
            }
            HostingServiceError::GhAuthRequired(message)
            | HostingServiceError::RemoteUnsupported(message)
            | HostingServiceError::PullRequestViewFailed(message)
            | HostingServiceError::PullRequestCreateFailed(message) => {
                write!(f, "{message}")
            }
        }
    }
}

impl std::error::Error for HostingServiceError {}

#[derive(Debug, Clone)]
pub struct PullRequestSummary {
    pub number: u64,
    pub title: String,
    pub url: String,
    pub state: PullRequestState,
    pub draft: bool,
    pub head_branch: String,
    pub base_branch: String,
    /// Reduced check rollup; `None` when the source did not report it.
    pub checks: Option<PullRequestChecksState>,
    /// Reduced review decision; `None` when the source did not report it.
    pub review_decision: Option<PullRequestReviewDecision>,
}

/// One queried head branch. `pull_request` `None` means the branch WAS
/// queried and has no PR (authoritative none).
#[derive(Debug, Clone)]
pub struct BranchPullRequestStatus {
    pub head_branch: String,
    pub pull_request: Option<PullRequestSummary>,
}

#[derive(Debug, Clone)]
pub struct RepoPullRequestStatusesResult {
    pub entries: Vec<BranchPullRequestStatus>,
    /// RFC3339 timestamp of the fetch that produced `entries` (stale results
    /// keep their original timestamp).
    pub fetched_at: String,
}

#[derive(Debug, Clone)]
pub struct CurrentPullRequestResult {
    pub pull_request: Option<PullRequestSummary>,
}

#[derive(Debug, Clone)]
pub struct CreatePullRequestResult {
    pub pull_request: PullRequestSummary,
    pub manual_url: Option<String>,
}
