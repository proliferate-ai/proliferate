use std::path::Path;

use uuid::Uuid;

use crate::origin::OriginContext;
use crate::workspaces::model::{ResolvedGitContext, WorkspaceRecord};
use crate::workspaces::resolver;

pub(super) fn build_repo_workspace_record(ctx: &ResolvedGitContext) -> WorkspaceRecord {
    let remote = ctx
        .remote_url
        .as_deref()
        .and_then(resolver::parse_remote_url);
    let current_branch = ctx.current_branch.clone();
    let now = chrono::Utc::now().to_rfc3339();

    WorkspaceRecord {
        id: Uuid::new_v4().to_string(),
        kind: "repo".into(),
        repo_root_id: None,
        path: ctx.repo_root.clone(),
        surface: "standard".into(),
        source_repo_root_path: ctx.repo_root.clone(),
        source_workspace_id: None,
        git_provider: remote.as_ref().map(|r| r.provider.clone()),
        git_owner: remote.as_ref().map(|r| r.owner.clone()),
        git_repo_name: remote.as_ref().map(|r| r.repo.clone()),
        original_branch: current_branch.clone(),
        current_branch,
        display_name: None,
        origin: Some(OriginContext::system_local_runtime()),
        creator_context: None,
        lifecycle_state: "active".to_string(),
        cleanup_state: "none".to_string(),
        cleanup_operation: None,
        cleanup_error_message: None,
        cleanup_failed_at: None,
        cleanup_attempted_at: None,
        created_at: now.clone(),
        updated_at: now,
    }
}

pub(super) fn build_local_workspace_record(
    ctx: &ResolvedGitContext,
    source_repo: &WorkspaceRecord,
) -> WorkspaceRecord {
    let remote = ctx
        .remote_url
        .as_deref()
        .and_then(resolver::parse_remote_url);
    let current_branch = ctx.current_branch.clone();
    let now = chrono::Utc::now().to_rfc3339();

    WorkspaceRecord {
        id: Uuid::new_v4().to_string(),
        kind: "local".into(),
        repo_root_id: None,
        path: ctx.repo_root.clone(),
        surface: "standard".into(),
        source_repo_root_path: source_repo.source_repo_root_path.clone(),
        source_workspace_id: Some(source_repo.id.clone()),
        git_provider: remote.as_ref().map(|r| r.provider.clone()),
        git_owner: remote.as_ref().map(|r| r.owner.clone()),
        git_repo_name: remote.as_ref().map(|r| r.repo.clone()),
        original_branch: current_branch.clone(),
        current_branch,
        display_name: None,
        origin: Some(OriginContext::api_local_runtime()),
        creator_context: None,
        lifecycle_state: "active".to_string(),
        cleanup_state: "none".to_string(),
        cleanup_operation: None,
        cleanup_error_message: None,
        cleanup_failed_at: None,
        cleanup_attempted_at: None,
        created_at: now.clone(),
        updated_at: now,
    }
}

pub(super) fn path_basename(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("repo")
        .to_string()
}
