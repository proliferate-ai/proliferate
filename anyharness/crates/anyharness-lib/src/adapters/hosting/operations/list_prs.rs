use super::super::pr_status_cache::PrStatusCache;
use super::super::types::{HostingServiceError, RepoPullRequestStatusesResult};

/// Branch-scoped pull-request statuses for a repo root. The caller derives
/// `active_branches` (distinct current branches of the repo root's
/// non-retired workspaces); throttling, dedupe, and error negative-caching
/// live in [`PrStatusCache`].
pub async fn list_repo_pull_requests(
    repo_root_path: &str,
    active_branches: Vec<String>,
    refresh: bool,
    cache: &PrStatusCache,
) -> Result<RepoPullRequestStatusesResult, HostingServiceError> {
    cache
        .get_statuses(repo_root_path, active_branches, refresh)
        .await
}
