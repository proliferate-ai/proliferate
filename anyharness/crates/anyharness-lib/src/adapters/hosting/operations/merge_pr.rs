use std::path::Path;

use super::super::github_cli;
use super::super::pr_status_cache::PrStatusCache;
use super::super::types::{HostingServiceError, MergePullRequestResult};
use crate::adapters::git::GitService;

pub fn merge_pull_request(
    workspace_path: &Path,
    pr_number: u64,
    pr_status_cache: &PrStatusCache,
) -> Result<MergePullRequestResult, HostingServiceError> {
    let repo_root = GitService::resolve_repo_root(workspace_path)
        .map_err(|error| HostingServiceError::PullRequestMergeFailed(error.to_string()))?;

    match github_cli::merge_pr(&repo_root, pr_number) {
        Ok(pr) => {
            // Refresh the cache entry for this branch so subsequent reads
            // reflect the merged state within the throttle window.
            pr_status_cache.upsert_branch_pr(&repo_root.to_string_lossy(), pr.clone());
            Ok(MergePullRequestResult { pull_request: pr })
        }
        Err(github_cli::GhError::NotInstalled) => Err(HostingServiceError::GhNotInstalled),
        Err(github_cli::GhError::AuthRequired(msg)) => {
            Err(HostingServiceError::GhAuthRequired(msg))
        }
        Err(github_cli::GhError::NoPrFound) => Err(HostingServiceError::PullRequestMergeFailed(
            "Pull request not found".into(),
        )),
        Err(github_cli::GhError::UnsupportedRemote(msg)) => {
            Err(HostingServiceError::RemoteUnsupported(msg))
        }
        Err(github_cli::GhError::CommandFailed(msg)) => {
            Err(HostingServiceError::PullRequestMergeFailed(msg))
        }
    }
}
