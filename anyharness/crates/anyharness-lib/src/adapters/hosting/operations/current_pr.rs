use std::path::Path;

use super::super::github_cli;
use super::super::types::{CurrentPullRequestResult, HostingServiceError};
use crate::adapters::git::GitService;

pub fn get_current_pull_request(
    workspace_path: &Path,
) -> Result<CurrentPullRequestResult, HostingServiceError> {
    let repo_root = GitService::resolve_repo_root(workspace_path)
        .map_err(|error| HostingServiceError::PullRequestViewFailed(error.to_string()))?;

    match github_cli::get_current_pr(&repo_root) {
        Ok(pr) => Ok(CurrentPullRequestResult { pull_request: pr }),
        Err(github_cli::GhError::NoPrFound) => Ok(CurrentPullRequestResult { pull_request: None }),
        Err(github_cli::GhError::NotInstalled) => Err(HostingServiceError::GhNotInstalled),
        Err(github_cli::GhError::AuthRequired(msg)) => {
            Err(HostingServiceError::GhAuthRequired(msg))
        }
        Err(github_cli::GhError::CommandFailed(msg)) => {
            Err(HostingServiceError::PullRequestViewFailed(msg))
        }
    }
}
