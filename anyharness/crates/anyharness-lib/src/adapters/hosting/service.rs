use std::path::Path;

use super::operations::{create_pr, current_pr, list_prs};
use super::pr_status_cache::PrStatusCache;
use super::types::{
    CreatePullRequestResult, CurrentPullRequestResult, HostingServiceError,
    RepoPullRequestStatusesResult,
};

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
        pr_status_cache: &PrStatusCache,
    ) -> Result<CreatePullRequestResult, HostingServiceError> {
        create_pr::create_pull_request(
            workspace_path,
            title,
            body,
            base_branch,
            draft,
            pr_status_cache,
        )
    }

    pub async fn list_repo_pull_requests(
        repo_root_path: &str,
        active_branches: Vec<String>,
        refresh: bool,
        pr_status_cache: &PrStatusCache,
    ) -> Result<RepoPullRequestStatusesResult, HostingServiceError> {
        list_prs::list_repo_pull_requests(repo_root_path, active_branches, refresh, pr_status_cache)
            .await
    }
}
