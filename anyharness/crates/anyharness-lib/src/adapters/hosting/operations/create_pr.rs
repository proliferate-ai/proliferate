use std::path::Path;

use super::super::github_cli;
use super::super::pr_status_cache::PrStatusCache;
use super::super::types::{CreatePullRequestResult, HostingServiceError};
use crate::adapters::git::GitService;

pub fn create_pull_request(
    workspace_path: &Path,
    title: &str,
    body: Option<&str>,
    base_branch: &str,
    draft: bool,
    pr_status_cache: &PrStatusCache,
) -> Result<CreatePullRequestResult, HostingServiceError> {
    let repo_root = GitService::resolve_repo_root(workspace_path)
        .map_err(|error| HostingServiceError::PullRequestCreateFailed(error.to_string()))?;

    match github_cli::create_pr(&repo_root, title, body, base_branch, draft) {
        Ok(pr) => {
            // Publish the fresh PR into the status cache so repo-root PR
            // status requests inside the throttle window already see it
            // (publish must never flap back to "no PR").
            pr_status_cache.upsert_branch_pr(&repo_root.to_string_lossy(), pr.clone());
            Ok(CreatePullRequestResult {
                pull_request: pr,
                manual_url: None,
            })
        }
        Err(github_cli::GhError::NotInstalled) => Err(HostingServiceError::GhNotInstalled),
        Err(github_cli::GhError::AuthRequired(msg)) => {
            Err(HostingServiceError::GhAuthRequired(msg))
        }
        Err(github_cli::GhError::NoPrFound) => Err(HostingServiceError::PullRequestCreateFailed(
            "PR was created but could not be read back".into(),
        )),
        Err(github_cli::GhError::UnsupportedRemote(msg)) => {
            Err(HostingServiceError::RemoteUnsupported(msg))
        }
        Err(github_cli::GhError::CommandFailed(msg)) => {
            Err(HostingServiceError::PullRequestCreateFailed(msg))
        }
    }
}
