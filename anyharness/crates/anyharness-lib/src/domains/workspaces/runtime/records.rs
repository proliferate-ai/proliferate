use std::path::Path;

use uuid::Uuid;

use crate::domains::repo_roots::model::RepoRootRecord;
use crate::domains::workspaces::creator_context::WorkspaceCreatorContext;
use crate::domains::workspaces::model::WorkspaceRecord;
use crate::domains::workspaces::resolver;
use crate::origin::OriginContext;

pub(super) fn build_workspace_record(
    repo_root: &RepoRootRecord,
    path: &str,
    kind: &str,
    surface: &str,
    current_branch: Option<String>,
    origin: OriginContext,
    creator_context: Option<WorkspaceCreatorContext>,
) -> WorkspaceRecord {
    let now = chrono::Utc::now().to_rfc3339();
    WorkspaceRecord {
        id: Uuid::new_v4().to_string(),
        kind: kind.to_string(),
        repo_root_id: Some(repo_root.id.clone()),
        path: path.to_string(),
        surface: surface.to_string(),
        source_repo_root_path: repo_root.path.clone(),
        source_workspace_id: None,
        git_provider: repo_root.remote_provider.clone(),
        git_owner: repo_root.remote_owner.clone(),
        git_repo_name: repo_root.remote_repo_name.clone(),
        original_branch: current_branch.clone(),
        current_branch,
        display_name: None,
        origin: Some(origin),
        creator_context,
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

pub(super) fn reconcile_current_branch(
    mut record: WorkspaceRecord,
) -> anyhow::Result<WorkspaceRecord> {
    let next_branch = resolver::resolve_git_context(&record.path)
        .ok()
        .and_then(|ctx| ctx.current_branch)
        .or(record.current_branch.clone());

    record.current_branch = next_branch;
    Ok(record)
}
pub(super) fn path_basename(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("repo")
        .to_string()
}
