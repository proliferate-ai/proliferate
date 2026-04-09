#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PullRequestState {
    Open,
    Closed,
    Merged,
}

#[derive(Debug)]
pub enum HostingServiceError {
    GhNotInstalled,
    GhAuthRequired(String),
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
