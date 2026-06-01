use std::path::Path;

use super::operations::{create_pr, current_pr};
use super::types::{CreatePullRequestResult, CurrentPullRequestResult, HostingServiceError};

pub struct HostingService;

impl HostingService {
    pub fn get_current_pull_request(
        workspace_path: &Path,
    ) -> Result<CurrentPullRequestResult, HostingServiceError> {
        current_pr::get_current_pull_request(workspace_path)
    }

    pub fn create_pull_request(
        workspace_path: &Path,
        title: &str,
        body: Option<&str>,
        base_branch: &str,
        draft: bool,
    ) -> Result<CreatePullRequestResult, HostingServiceError> {
        create_pr::create_pull_request(workspace_path, title, body, base_branch, draft)
    }
}
