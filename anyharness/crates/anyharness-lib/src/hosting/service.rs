use std::path::Path;

use super::github_cli;
use super::types::{CreatePullRequestResult, CurrentPullRequestResult, HostingServiceError};
use crate::git::GitService;

pub struct HostingService;

impl HostingService {
    pub fn get_current_pull_request(
        workspace_path: &Path,
    ) -> Result<CurrentPullRequestResult, HostingServiceError> {
        let repo_root = GitService::resolve_repo_root(workspace_path)
            .map_err(|error| HostingServiceError::PullRequestViewFailed(error.to_string()))?;

        match github_cli::get_current_pr(&repo_root) {
            Ok(pr) => Ok(CurrentPullRequestResult { pull_request: pr }),
            Err(github_cli::GhError::NoPrFound) => {
                Ok(CurrentPullRequestResult { pull_request: None })
            }
            Err(github_cli::GhError::NotInstalled) => Err(HostingServiceError::GhNotInstalled),
            Err(github_cli::GhError::AuthRequired(msg)) => {
                Err(HostingServiceError::GhAuthRequired(msg))
            }
            Err(github_cli::GhError::CommandFailed(msg)) => {
                Err(HostingServiceError::PullRequestViewFailed(msg))
            }
        }
    }

    pub fn create_pull_request(
        workspace_path: &Path,
        title: &str,
        body: Option<&str>,
        base_branch: &str,
        draft: bool,
    ) -> Result<CreatePullRequestResult, HostingServiceError> {
        let repo_root = GitService::resolve_repo_root(workspace_path)
            .map_err(|error| HostingServiceError::PullRequestCreateFailed(error.to_string()))?;

        match github_cli::create_pr(&repo_root, title, body, base_branch, draft) {
            Ok(pr) => Ok(CreatePullRequestResult {
                pull_request: pr,
                manual_url: None,
            }),
            Err(github_cli::GhError::NotInstalled) => Err(HostingServiceError::GhNotInstalled),
            Err(github_cli::GhError::AuthRequired(msg)) => {
                Err(HostingServiceError::GhAuthRequired(msg))
            }
            Err(github_cli::GhError::NoPrFound) => {
                Err(HostingServiceError::PullRequestCreateFailed(
                    "PR was created but could not be read back".into(),
                ))
            }
            Err(github_cli::GhError::CommandFailed(msg)) => {
                Err(HostingServiceError::PullRequestCreateFailed(msg))
            }
        }
    }
}
